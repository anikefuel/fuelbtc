// provider-action Edge Function
// Handles all privileged provider operations server-side:
//   test-connection | get-balances | manual-sync | get-symbols | get-ticker
// API credentials NEVER leave this function — never returned to frontend.
// Internal ledger is never overwritten — mismatches create reconciliation_warnings.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { binanceFetch, hmacSha256 } from '../_shared/binance-signer.ts';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BINANCE_SPOT  = 'https://api.binance.com';
const BINANCE_FAPI  = 'https://fapi.binance.com';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ─── Auth guard ───────────────────────────────────────────────────────────────
async function getAdminUser(authHeader: string | null) {
  if (!authHeader) throw new Error('Missing Authorization header');
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Not authenticated');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') throw new Error('Admin access required');
  return user;
}

async function binanceGet(
  base: string, path: string,
  params: Record<string, string>,
  apiKey: string, secret: string,
) {
  const qs  = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(secret, qs);
  const res = await binanceFetch(`${base}${path}?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Binance ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Provider adapter ─────────────────────────────────────────────────────────
interface ProviderCfg {
  id: string; label: string; provider_name: string;
  api_key: string; api_secret: string; passphrase?: string;
  is_testnet: boolean; user_id: string;
}

function binanceBase(cfg: ProviderCfg, futures = false): string {
  if (cfg.is_testnet) return futures ? 'https://testnet.binancefuture.com' : 'https://testnet.binance.vision';
  return futures ? BINANCE_FAPI : BINANCE_SPOT;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/** Test connection: ping account endpoint, return permissions + account type */
async function testConnection(cfg: ProviderCfg) {
  if (cfg.provider_name !== 'binance') throw new Error(`Provider "${cfg.provider_name}" not yet supported`);
  const t0 = Date.now();
  const data = await binanceGet(
    binanceBase(cfg), '/api/v3/account', {}, cfg.api_key, cfg.api_secret,
  ) as { accountType: string; permissions: string[]; canTrade: boolean; canWithdraw: boolean };
  const ms = Date.now() - t0;
  // Update health
  await supabase.from('exchange_provider_configs').update({
    last_sync_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    health_status: 'active', sync_error: null,
    avg_response_ms: ms, error_count: 0,
  }).eq('id', cfg.id);
  return {
    ok: true,
    provider: cfg.provider_name,
    label: cfg.label,
    accountType: data.accountType ?? 'SPOT',
    permissions: data.permissions ?? [],
    canTrade: Boolean(data.canTrade),
    canWithdraw: Boolean(data.canWithdraw),
    latencyMs: ms,
  };
}

/** Get provider balances without touching the internal ledger */
async function getProviderBalances(cfg: ProviderCfg) {
  if (cfg.provider_name !== 'binance') throw new Error(`Provider "${cfg.provider_name}" not yet supported`);
  const spotBase = binanceBase(cfg, false);
  const futBase  = binanceBase(cfg, true);

  const [spotData, futData] = await Promise.allSettled([
    binanceGet(spotBase, '/api/v3/account', {}, cfg.api_key, cfg.api_secret) as Promise<{ balances: { asset: string; free: string; locked: string }[] }>,
    binanceGet(futBase,  '/fapi/v2/account', {}, cfg.api_key, cfg.api_secret) as Promise<{ assets: { asset: string; walletBalance: string; availableBalance: string }[] }>,
  ]);

  const spot = spotData.status === 'fulfilled'
    ? (spotData.value.balances ?? [])
        .filter(b => +b.free > 0 || +b.locked > 0)
        .map(b => ({ asset: b.asset, free: +b.free, locked: +b.locked, walletType: 'spot' }))
    : [];

  const futures = futData.status === 'fulfilled'
    ? (futData.value.assets ?? [])
        .filter(a => +a.walletBalance > 0)
        .map(a => ({ asset: a.asset, free: +a.availableBalance, locked: +a.walletBalance - +a.availableBalance, walletType: 'futures' }))
    : [];

  // NOTE: these are PROVIDER balances — do NOT write to user wallets here
  return { spot, futures, spotError: spotData.status === 'rejected' ? String(spotData.reason) : null, futuresError: futData.status === 'rejected' ? String(futData.reason) : null };
}

// ─── Normalize Binance error codes to safe internal codes ─────────────────────
function normalizeBinanceError(raw: string): { code: string; message: string } {
  if (raw.includes('-2014') || raw.includes('API-key') || raw.includes('Invalid API'))
    return { code: 'auth_failed', message: 'Authentication failed — check API key and secret' };
  if (raw.includes('-2015') || raw.includes('Invalid API-key, IP'))
    return { code: 'auth_failed', message: 'API key invalid or IP not whitelisted' };
  if (raw.includes('-1003') || raw.includes('429') || raw.includes('Too many requests'))
    return { code: 'rate_limited', message: 'Rate limit reached — try again in a moment' };
  if (raw.includes('-1100') || raw.includes('permission'))
    return { code: 'missing_permission', message: 'Missing required API permission' };
  if (raw.includes('ENOTFOUND') || raw.includes('network') || raw.includes('timeout'))
    return { code: 'degraded', message: 'Provider connection degraded — network issue' };
  return { code: 'provider_error', message: 'Provider request failed' };
}

// ─── Derive wallet_provider_status from connection test ───────────────────────
function deriveProviderStatus(
  permissions: string[],
  canTrade: boolean,
  canWithdraw: boolean,
  canDeposit: boolean,
): { status: string; deposit_enabled: boolean; withdraw_enabled: boolean; spot_enabled: boolean; futures_enabled: boolean } {
  const hasFutures = permissions.some(p => p === 'FUTURES' || p === 'MARGIN');
  return {
    status: 'connected',
    deposit_enabled: canDeposit,
    withdraw_enabled: canWithdraw,
    spot_enabled: canTrade,
    futures_enabled: hasFutures,
  };
}

// ─── Get deposit address for a user+asset+network from Binance Capital ────────
// Binance Capital API: GET /sapi/v1/capital/deposit/address
// Requires SPOT wallet + READ permission. Uses memo/tag for XRP/XLM/EOS/BNB.
async function getDepositAddress(
  cfg: ProviderCfg,
  asset: string,
  network: string,
  userId: string,
) {
  if (cfg.provider_name !== 'binance')
    throw new Error(`Provider "${cfg.provider_name}" not supported for deposit addresses`);

  // For testnet: Binance testnet does not support capital API — use internal assignment
  if (cfg.is_testnet) {
    const base = userId.replace(/-/g, '').slice(0, 12);
    const prefixes: Record<string, string> = {
      BTC: 'bc1q', ETH: '0x', BNB: 'bnb', TRX: 'T', SOL: '', XRP: 'r',
    };
    const prefix = prefixes[asset] ?? '0x';
    const hasMemo = ['XRP', 'XLM', 'EOS', 'BNB'].includes(asset);
    return {
      address: `${prefix}${asset.toLowerCase()}${base}${network.slice(0, 4)}test`,
      coin: asset,
      network,
      memo: hasMemo ? String(1000000 + parseInt(base.slice(0, 6), 16) % 9000000) : undefined,
      source: 'testnet_stub',
    };
  }

  const base = 'https://api.binance.com';
  // Binance sapi requires GET with signed query
  const params: Record<string, string> = { coin: asset, network };
  const qs  = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(cfg.api_secret, qs);
  const res = await binanceFetch(`${base}/sapi/v1/capital/deposit/address?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': cfg.api_key },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 || body.includes('permission'))
      throw new Error('missing_permission:Deposit address API requires Binance READ permission with "capital" access');
    const norm = normalizeBinanceError(body);
    throw new Error(`${norm.code}:${norm.message}`);
  }

  const data = await res.json() as {
    address: string; coin: string; tag?: string; url?: string;
  };

  return {
    address: data.address,
    coin: data.coin,
    network,
    memo: data.tag || undefined,
    source: 'binance',
  };
}

// ─── Submit withdrawal to Binance ─────────────────────────────────────────────
// Binance Capital API: POST /sapi/v1/capital/withdraw/apply
// Requires WITHDRAWALS permission.
async function submitWithdrawal(
  cfg: ProviderCfg,
  params: {
    asset: string; network: string; address: string; memo?: string;
    amount: number; withdrawalId: string;
  },
) {
  if (cfg.provider_name !== 'binance')
    throw new Error(`Provider "${cfg.provider_name}" not supported for withdrawals`);

  if (cfg.is_testnet) {
    // Testnet stub: simulate submission
    const fakeId = `test_${Date.now()}_${params.withdrawalId.slice(0, 8)}`;
    return { binanceWithdrawId: fakeId, status: 'submitted', source: 'testnet_stub' };
  }

  const base = 'https://api.binance.com';
  const body: Record<string, string> = {
    coin:             params.asset,
    network:          params.network,
    address:          params.address,
    amount:           params.amount.toString(),
    withdrawOrderId:  params.withdrawalId, // idempotency key
    timestamp:        Date.now().toString(),
  };
  if (params.memo) body.addressTag = params.memo;

  const qs  = new URLSearchParams(body).toString();
  const sig = await hmacSha256(cfg.api_secret, qs);

  const res = await binanceFetch(`${base}/sapi/v1/capital/withdraw/apply`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': cfg.api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${qs}&signature=${sig}`,
  });

  if (!res.ok) {
    const bodyTxt = await res.text().catch(() => '');
    const norm = normalizeBinanceError(bodyTxt);
    // Parse Binance JSON error code if available
    try {
      const j = JSON.parse(bodyTxt) as { code: number; msg: string };
      if (j.code === -4026 || j.msg?.includes('withdrawal amount is lower than minimum'))
        throw new Error('amount_too_small:Withdrawal amount below minimum');
      if (j.code === -4043 || j.msg?.includes('more than maximum limit'))
        throw new Error('amount_too_large:Withdrawal amount exceeds daily limit');
      if (j.code === -3010 || j.msg?.includes('insufficient'))
        throw new Error('insufficient_balance:Insufficient provider balance');
      if (j.code === -1121 || j.msg?.includes('Invalid symbol'))
        throw new Error('invalid_network:Invalid network for this asset');
    } catch (parseErr) {
      if ((parseErr as Error).message.includes(':')) throw parseErr;
    }
    throw new Error(`${norm.code}:${norm.message}`);
  }

  const data = await res.json() as { id: string };
  return { binanceWithdrawId: data.id, status: 'submitted', source: 'binance' };
}

// ─── Sync deposit history from Binance ────────────────────────────────────────
// Fetches deposit records, matches to user deposit addresses, credits via RPC.
async function syncDepositHistory(cfg: ProviderCfg, targetUserId?: string) {
  if (cfg.provider_name !== 'binance')
    throw new Error(`Provider "${cfg.provider_name}" not supported`);

  const base = cfg.is_testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
  // Last 7 days
  const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const params: Record<string, string> = { status: '1', startTime: startTime.toString() };
  const qs = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(cfg.api_secret, qs);

  const res = await binanceFetch(`${base}/sapi/v1/capital/deposit/hisrec?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': cfg.api_key },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const norm = normalizeBinanceError(body);
    throw new Error(`${norm.code}:${norm.message}`);
  }

  const deposits = await res.json() as {
    id: string; coin: string; network: string; amount: string; address: string;
    addressTag?: string; txId: string; status: number; transferType: number;
    confirmTimes?: string; unlockConfirm?: number;
    insertTime: number;
  }[];

  let credited = 0; let skipped = 0; let unmatched = 0;
  const errors: string[] = [];

  for (const dep of deposits ?? []) {
    if (dep.status !== 1) continue; // 1 = success

    // Find which user owns this address
    const { data: addrRow } = await supabase
      .from('deposit_addresses')
      .select('user_id, asset, network')
      .eq('address', dep.address)
      .maybeSingle();

    const resolvedUserId = addrRow?.user_id ?? targetUserId ?? cfg.user_id;

    if (!resolvedUserId) {
      unmatched++;
      // Create reconciliation warning for unknown deposit
      await supabase.from('reconciliation_warnings').insert({
        provider_name: 'binance',
        provider_config_id: cfg.id,
        asset: dep.coin,
        warning_type: 'unknown_deposit',
        details: { tx_id: dep.id, address: dep.address, amount: dep.amount, network: dep.network },
      }).catch(() => null);
      continue;
    }

    try {
      const { data: result } = await supabase.rpc('process_deposit_credit', {
        p_user_id:            resolvedUserId,
        p_asset:              dep.coin,
        p_network:            dep.network,
        p_amount:             parseFloat(dep.amount),
        p_provider_tx_id:     dep.txId || dep.id,
        p_provider_name:      'binance',
        p_provider_config_id: cfg.id,
        p_to_address:         dep.address,
        p_tx_hash:            dep.txId,
        p_fee:                0,
        p_wallet_type:        'funding',
        p_raw_data:           dep,
      });
      const r = result as { ok: boolean; duplicate?: boolean };
      if (r?.ok && !r?.duplicate) credited++;
      else skipped++;
    } catch (e) {
      errors.push(`${dep.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { credited, skipped, unmatched, errors: errors.length > 0 ? errors : undefined, total: deposits?.length ?? 0 };
}

// ─── Sync withdrawal history from Binance ─────────────────────────────────────
async function syncWithdrawalHistory(cfg: ProviderCfg) {
  if (cfg.provider_name !== 'binance')
    throw new Error(`Provider "${cfg.provider_name}" not supported`);

  const base = cfg.is_testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
  const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const params: Record<string, string> = { startTime: startTime.toString() };
  const qs  = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(cfg.api_secret, qs);

  const res = await binanceFetch(`${base}/sapi/v1/capital/withdraw/history?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': cfg.api_key },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const norm = normalizeBinanceError(body);
    throw new Error(`${norm.code}:${norm.message}`);
  }

  const withdrawals = await res.json() as {
    id: string; amount: string; transactionFee: string; coin: string;
    status: number; address: string; txId?: string; applyTime: string;
    network: string; withdrawOrderId?: string;
  }[];

  // Binance withdrawal status codes: 0=email,1=cancelled,2=waiting,3=rejected,4=processing,5=failure,6=completed
  const STATUS_MAP: Record<number, string> = {
    0: 'security_review', 1: 'cancelled', 2: 'approved', 3: 'rejected',
    4: 'processing', 5: 'failed', 6: 'completed',
  };

  let updated = 0; let refunded = 0;
  const errors: string[] = [];

  for (const wd of withdrawals ?? []) {
    // Find our internal withdrawal by binance_withdraw_id or withdrawOrderId
    const { data: internalWd } = await supabase
      .from('withdrawals')
      .select('id, status, amount, asset')
      .or(`binance_withdraw_id.eq.${wd.id},id.eq.${wd.withdrawOrderId ?? '00000000-0000-0000-0000-000000000000'}`)
      .maybeSingle();

    if (!internalWd) continue;
    const internalStatus = internalWd.status as string;
    const newStatus = STATUS_MAP[wd.status] ?? 'processing';
    if (internalStatus === newStatus || internalStatus === 'completed' || internalStatus === 'cancelled') continue;

    try {
      if (wd.status === 6) {
        await supabase.rpc('mark_withdrawal_completed', {
          p_withdrawal_id: internalWd.id,
          p_tx_hash: wd.txId ?? '',
          p_provider_status: 'completed',
        });
        updated++;
      } else if (wd.status === 3 || wd.status === 5) {
        await supabase.rpc('mark_withdrawal_failed', {
          p_withdrawal_id: internalWd.id,
          p_reason: wd.status === 3 ? 'Rejected by provider' : 'Provider processing failed',
        });
        refunded++;
      } else {
        // Intermediate status update
        await supabase.from('withdrawals')
          .update({ status: newStatus, updated_at: new Date().toISOString(), binance_tx_hash: wd.txId ?? null })
          .eq('id', internalWd.id);
        updated++;
      }
    } catch (e) {
      errors.push(`${wd.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { updated, refunded, errors: errors.length > 0 ? errors : undefined, total: withdrawals?.length ?? 0 };
}

/** Manual sync: reconcile provider data against internal ledger, write warnings for mismatches */
async function manualSync(cfg: ProviderCfg, triggeredBy: string) {
  if (cfg.provider_name !== 'binance') throw new Error(`Provider "${cfg.provider_name}" not yet supported`);
  const t0 = Date.now();
  let balancesSynced = 0, ordersSynced = 0, positionsSynced = 0, warningsCreated = 0;
  const errors: string[] = [];

  // 1. Fetch provider spot balances
  let spotBalances: { asset: string; free: number; locked: number }[] = [];
  try {
    const spotBase = binanceBase(cfg, false);
    const data = await binanceGet(spotBase, '/api/v3/account', {}, cfg.api_key, cfg.api_secret) as { balances: { asset: string; free: string; locked: string }[] };
    spotBalances = (data.balances ?? []).filter(b => +b.free > 0 || +b.locked > 0).map(b => ({ asset: b.asset, free: +b.free, locked: +b.locked }));
    balancesSynced += spotBalances.length;
  } catch (e) { errors.push(`Spot balances: ${e instanceof Error ? e.message : String(e)}`); }

  // 2. Fetch open spot orders
  let spotOrders: { orderId: number; symbol: string; status: string }[] = [];
  try {
    const spotBase = binanceBase(cfg, false);
    spotOrders = await binanceGet(spotBase, '/api/v3/openOrders', {}, cfg.api_key, cfg.api_secret) as typeof spotOrders;
    ordersSynced += spotOrders.length;
  } catch (e) { errors.push(`Spot orders: ${e instanceof Error ? e.message : String(e)}`); }

  // 3. Fetch futures positions
  let positions: { symbol: string; positionAmt: string }[] = [];
  try {
    const futBase = binanceBase(cfg, true);
    const raw = await binanceGet(futBase, '/fapi/v2/positionRisk', {}, cfg.api_key, cfg.api_secret) as typeof positions;
    positions = raw.filter(p => +p.positionAmt !== 0);
    positionsSynced += positions.length;
  } catch (e) { errors.push(`Futures positions: ${e instanceof Error ? e.message : String(e)}`); }

  // 4. Reconcile: compare provider spot balances against internal wallets
  // Internal ledger is the source of truth — mismatches create warnings only
  for (const provBal of spotBalances) {
    const { data: walletRow } = await supabase
      .from('wallets')
      .select('balance, locked_balance')
      .eq('user_id', cfg.user_id)
      .eq('asset', provBal.asset)
      .eq('wallet_type', 'spot')
      .maybeSingle();

    const ledgerTotal = walletRow ? Number(walletRow.balance) + Number(walletRow.locked_balance) : 0;
    const providerTotal = provBal.free + provBal.locked;
    const delta = Math.abs(providerTotal - ledgerTotal);
    const threshold = Math.max(providerTotal * 0.001, 0.00001); // 0.1% or dust threshold

    if (delta > threshold && (providerTotal > 0 || ledgerTotal > 0)) {
      const deltaPct = ledgerTotal > 0 ? ((providerTotal - ledgerTotal) / ledgerTotal) * 100 : 100;
      await supabase.from('reconciliation_warnings').insert({
        provider_name: cfg.provider_name,
        provider_config_id: cfg.id,
        asset: provBal.asset,
        ledger_balance: ledgerTotal,
        provider_balance: providerTotal,
        delta_pct: deltaPct,
        warning_type: 'balance_mismatch',
        details: { wallet_type: 'spot', provider_free: provBal.free, provider_locked: provBal.locked },
      });
      warningsCreated++;
    }
  }

  // 5. Update provider health
  const durationMs = Date.now() - t0;
  const success = errors.length === 0;
  await supabase.from('exchange_provider_configs').update({
    last_sync_at: new Date().toISOString(),
    ...(success ? { last_success_at: new Date().toISOString(), health_status: 'active', sync_error: null, error_count: 0 } : { last_failure_at: new Date().toISOString(), health_status: 'degraded', sync_error: errors.join('; ').slice(0, 500) }),
    avg_response_ms: durationMs,
  }).eq('id', cfg.id);

  // 6. Log sync result
  await supabase.from('provider_sync_results').insert({
    config_id: cfg.id,
    triggered_by: triggeredBy,
    trigger_type: 'manual',
    success,
    balances_synced: balancesSynced,
    orders_synced: ordersSynced,
    positions_synced: positionsSynced,
    warnings_created: warningsCreated,
    error_message: errors.length > 0 ? errors.join('; ').slice(0, 500) : null,
    duration_ms: durationMs,
  });

  return {
    ok: success,
    durationMs,
    balancesSynced,
    ordersSynced,
    positionsSynced,
    warningsCreated,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const adminUser = await getAdminUser(req.headers.get('Authorization'));

    const body = await req.json() as {
      action: string;
      configId: string;
      // get-deposit-address
      asset?: string; network?: string; userId?: string;
      // submit-withdrawal
      withdrawalId?: string; address?: string; memo?: string; amount?: number;
    };
    const { action, configId } = body;

    if (!action || !configId) {
      return new Response(JSON.stringify({ error: 'Missing action or configId' }), { status: 400, headers });
    }

    // Load config from DB — API secrets stay server-side, NEVER returned to client
    const { data: cfg, error: cfgErr } = await supabase
      .from('exchange_provider_configs')
      .select('id,label,provider_name,api_key,api_secret,passphrase,is_testnet,user_id')
      .eq('id', configId)
      .single();

    if (cfgErr || !cfg) {
      return new Response(JSON.stringify({ error: 'Provider config not found' }), { status: 404, headers });
    }
    if (!cfg.api_key || !cfg.api_secret) {
      return new Response(JSON.stringify({ error: 'API credentials not configured' }), { status: 400, headers });
    }

    const providerCfg = cfg as ProviderCfg;
    let result: unknown;

    switch (action) {
      // ── Existing actions ──────────────────────────────────────────────────
      case 'test-connection': {
        const conn = await testConnection(providerCfg);
        // Persist provider status to DB so wallet UI can read it without re-calling
        const perm = (conn as { permissions?: string[] }).permissions ?? [];
        const canTrade    = Boolean((conn as { canTrade?: boolean }).canTrade);
        const canWithdraw = Boolean((conn as { canWithdraw?: boolean }).canWithdraw);
        const canDeposit  = perm.includes('SPOT') || perm.includes('MARGIN') || perm.length > 0;
        const derived = deriveProviderStatus(perm, canTrade, canWithdraw, canDeposit);
        await supabase.rpc('upsert_wallet_provider_status', {
          p_config_id:       providerCfg.id,
          p_status:          derived.status,
          p_deposit_enabled: derived.deposit_enabled,
          p_withdraw_enabled: derived.withdraw_enabled,
          p_spot_enabled:    derived.spot_enabled,
          p_futures_enabled: derived.futures_enabled,
          p_permissions:     perm,
          p_latency_ms:      (conn as { latencyMs?: number }).latencyMs ?? null,
          p_error_message:   null,
        }).catch(() => null);
        result = conn;
        break;
      }
      case 'get-balances':
        result = await getProviderBalances(providerCfg);
        break;
      case 'manual-sync':
        result = await manualSync(providerCfg, adminUser.id);
        break;

      // ── Deposit address ───────────────────────────────────────────────────
      case 'get-deposit-address': {
        if (!body.asset || !body.network || !body.userId) {
          return new Response(JSON.stringify({ error: 'asset, network, userId required' }), { status: 400, headers });
        }
        const addrResult = await getDepositAddress(providerCfg, body.asset, body.network, body.userId);
        // Persist/update the address mapping so deposit sync can match it
        await supabase.from('deposit_addresses').upsert({
          user_id:            body.userId,
          asset:              body.asset,
          network:            body.network,
          address:            addrResult.address,
          memo:               addrResult.memo ?? null,
          provider_name:      'binance',
          provider_config_id: providerCfg.id,
          is_active:          true,
        }, { onConflict: 'user_id,asset,network' }).catch(() => null);
        // Return address but NEVER return api_key/api_secret
        result = { address: addrResult.address, memo: addrResult.memo, coin: addrResult.coin, network: addrResult.network };
        break;
      }

      // ── Submit withdrawal to Binance ──────────────────────────────────────
      case 'submit-withdrawal': {
        if (!body.asset || !body.network || !body.address || !body.amount || !body.withdrawalId) {
          return new Response(JSON.stringify({ error: 'asset, network, address, amount, withdrawalId required' }), { status: 400, headers });
        }
        const wdResult = await submitWithdrawal(providerCfg, {
          asset:        body.asset,
          network:      body.network,
          address:      body.address,
          memo:         body.memo,
          amount:       body.amount,
          withdrawalId: body.withdrawalId,
        });
        // Mark the internal withdrawal record as submitted
        await supabase.rpc('mark_withdrawal_submitted', {
          p_withdrawal_id:       body.withdrawalId,
          p_binance_withdraw_id: wdResult.binanceWithdrawId,
          p_provider_name:       'binance',
          p_provider_config_id:  providerCfg.id,
        }).catch(() => null);
        result = { ok: true, binanceWithdrawId: wdResult.binanceWithdrawId, status: wdResult.status };
        break;
      }

      // ── Sync deposit history (credits internal ledger for confirmed deposits) ──
      case 'sync-deposits': {
        const syncResult = await syncDepositHistory(providerCfg, body.userId);
        result = { ok: true, ...syncResult };
        break;
      }

      // ── Sync withdrawal history (updates statuses, refunds failed) ─────────
      case 'sync-withdrawals': {
        const syncResult = await syncWithdrawalHistory(providerCfg);
        result = { ok: true, ...syncResult };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers });
    }

    return new Response(JSON.stringify(result), { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Parse structured errors emitted as "code:message"
    const [errCode, ...rest] = msg.split(':');
    const safeMessage = rest.length > 0 ? rest.join(':') : 'Provider action failed';
    const knownCodes = new Set(['auth_failed', 'missing_permission', 'rate_limited', 'degraded', 'amount_too_small', 'amount_too_large', 'insufficient_balance', 'invalid_network']);
    const isKnown = knownCodes.has(errCode);

    // Never log secrets — mask long alphanumeric strings
    const safe = msg.replace(/[A-Za-z0-9]{30,}/g, '***');
    console.error('[provider-action]', safe);

    const status = msg.includes('Not authenticated') || msg.includes('Admin access') ? 401
      : msg.includes('not found') ? 404 : 500;

    return new Response(JSON.stringify({
      error: isKnown ? safeMessage : (msg.includes('Admin') ? msg : 'Provider action failed'),
      code: isKnown ? errCode : 'provider_error',
    }), { status, headers });
  }
});
