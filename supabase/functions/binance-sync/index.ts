// binance-sync Edge Function
// Triggered every minute via pg_cron (or manually from admin UI).
// Syncs Binance spot + futures balances/orders/positions into platform tables.
// Updates provider health status after each sync.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { binanceFetch, hmacSha256 } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BINANCE_SPOT = 'https://api.binance.com';
const BINANCE_FAPI = 'https://fapi.binance.com';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function signedGet(
  baseUrl: string, path: string, params: Record<string, string>,
  apiKey: string, secret: string,
): Promise<unknown> {
  const qs  = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(secret, qs);
  const res = await binanceFetch(`${baseUrl}${path}?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  if (!res.ok) throw new Error(`Binance ${path} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface BinanceBal   { asset: string; free: string; locked: string }
interface BinanceFAss  { asset: string; walletBalance: string; availableBalance: string }
interface BinanceFPos  {
  symbol: string; positionAmt: string; entryPrice: string;
  markPrice: string; unrealizedProfit: string; leverage: string;
  marginType: 'cross'|'isolated'; isolatedMargin: string; liquidationPrice: string;
}
interface BinanceOrd {
  orderId: number; symbol: string; side: 'BUY'|'SELL'; type: string;
  price: string; origQty: string; executedQty: string; status: string;
  time: number; clientOrderId: string;
}
interface ProviderCfg {
  id: string; label: string; api_key: string; api_secret: string;
  is_testnet: boolean; user_id: string;
}

const STATUS: Record<string, string> = {
  NEW: 'open', PARTIALLY_FILLED: 'open', FILLED: 'filled',
  CANCELED: 'cancelled', EXPIRED: 'cancelled',
};

// ─── Spot ─────────────────────────────────────────────────────────────────────
async function syncSpotBal(cfg: ProviderCfg): Promise<number> {
  const base = cfg.is_testnet ? 'https://testnet.binance.vision' : BINANCE_SPOT;
  const data = await signedGet(base, '/api/v3/account', {}, cfg.api_key, cfg.api_secret) as { balances: BinanceBal[] };
  const rows = (data.balances ?? []).filter(b => +b.free > 0 || +b.locked > 0);
  for (const b of rows) {
    await supabase.from('wallets').upsert({
      user_id: cfg.user_id, asset: b.asset, wallet_type: 'spot',
      balance: +b.free, locked_balance: +b.locked,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,asset,wallet_type' });
  }
  return rows.length;
}

async function syncSpotOrd(cfg: ProviderCfg): Promise<number> {
  const base = cfg.is_testnet ? 'https://testnet.binance.vision' : BINANCE_SPOT;
  const data = await signedGet(base, '/api/v3/openOrders', {}, cfg.api_key, cfg.api_secret) as BinanceOrd[];
  let n = 0;
  for (const o of data ?? []) {
    const ba = o.symbol.replace(/USDT$|BTC$|ETH$|BNB$/, '') || o.symbol.slice(0, -4);
    await supabase.from('orders').upsert({
      user_id: cfg.user_id, symbol: o.symbol,
      base_asset: ba, quote_asset: o.symbol.slice(ba.length),
      side: o.side.toLowerCase(), order_type_v2: o.type.toLowerCase(),
      market_type_v2: 'spot', status_v2: STATUS[o.status] ?? 'open',
      price: +o.price, quantity: +o.origQty,
      filled_qty: +o.executedQty, remaining_qty: +o.origQty - +o.executedQty,
      client_order_id: o.clientOrderId,
      created_at: new Date(o.time).toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,client_order_id' });
    n++;
  }
  return n;
}

// ─── Futures ──────────────────────────────────────────────────────────────────
async function syncFutBal(cfg: ProviderCfg): Promise<number> {
  const base = cfg.is_testnet ? 'https://testnet.binancefuture.com' : BINANCE_FAPI;
  const data = await signedGet(base, '/fapi/v2/account', {}, cfg.api_key, cfg.api_secret) as { assets: BinanceFAss[] };
  const rows = (data.assets ?? []).filter(a => +a.walletBalance > 0);
  for (const a of rows) {
    const total = +a.walletBalance;
    const avail = +a.availableBalance;
    await supabase.from('wallets').upsert({
      user_id: cfg.user_id, asset: a.asset, wallet_type: 'futures',
      balance: avail, locked_balance: total - avail,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,asset,wallet_type' });
  }
  return rows.length;
}

async function syncFutPos(cfg: ProviderCfg): Promise<number> {
  const base = cfg.is_testnet ? 'https://testnet.binancefuture.com' : BINANCE_FAPI;
  const data = await signedGet(base, '/fapi/v2/positionRisk', {}, cfg.api_key, cfg.api_secret) as BinanceFPos[];
  const open = (data ?? []).filter(p => +p.positionAmt !== 0);
  for (const p of open) {
    const qty = +p.positionAmt;
    const abs = Math.abs(qty);
    const lev = parseInt(p.leverage, 10);
    const not = abs * +p.entryPrice;
    const mgn = p.marginType === 'isolated' ? +p.isolatedMargin : not / lev;
    await supabase.from('positions').upsert({
      user_id: cfg.user_id, symbol: p.symbol, side: qty > 0 ? 'long' : 'short',
      entry_price: +p.entryPrice, mark_price: +p.markPrice,
      liq_price: +p.liquidationPrice, size: abs, notional: not,
      leverage: lev, margin_mode: p.marginType,
      initial_margin: mgn, maint_margin: mgn * 0.005,
      unrealized_pnl: +p.unrealizedProfit,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,symbol,side' });
  }
  return open.length;
}

async function syncFutOrd(cfg: ProviderCfg): Promise<number> {
  const base = cfg.is_testnet ? 'https://testnet.binancefuture.com' : BINANCE_FAPI;
  const data = await signedGet(base, '/fapi/v1/openOrders', {}, cfg.api_key, cfg.api_secret) as BinanceOrd[];
  let n = 0;
  for (const o of data ?? []) {
    await supabase.from('orders').upsert({
      user_id: cfg.user_id, symbol: o.symbol,
      base_asset: o.symbol.replace(/USDT$/, ''), quote_asset: 'USDT',
      side: o.side.toLowerCase(), order_type_v2: o.type.toLowerCase(),
      market_type_v2: 'futures', status_v2: STATUS[o.status] ?? 'open',
      price: +o.price, quantity: +o.origQty,
      filled_qty: +o.executedQty, remaining_qty: +o.origQty - +o.executedQty,
      client_order_id: `fut_${o.clientOrderId}`,
      created_at: new Date(o.time).toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,client_order_id' });
    n++;
  }
  return n;
}

// ─── Deposit history sync ─────────────────────────────────────────────────────
// Credits internal ledger for confirmed Binance deposits.
// Idempotent: process_deposit_credit skips already-credited provider_tx_id.
async function syncDepositHistory(cfg: ProviderCfg): Promise<number> {
  const base = cfg.is_testnet ? 'https://testnet.binance.vision' : BINANCE_SPOT;
  // Fetch last 24h of confirmed deposits
  const startTime = Date.now() - 24 * 60 * 60 * 1000;
  const qs  = new URLSearchParams({ status: '1', startTime: startTime.toString(), timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(cfg.api_secret, qs);
  const res = await binanceFetch(`${base}/sapi/v1/capital/deposit/hisrec?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': cfg.api_key },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Missing capital permission is non-fatal for sync — just skip
    if (res.status === 403 || body.includes('permission') || body.includes('1100')) return 0;
    throw new Error(`deposit-history HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const deposits = await res.json() as {
    id: string; coin: string; network: string; amount: string; address: string;
    addressTag?: string; txId: string; status: number;
    insertTime: number;
  }[];

  let credited = 0;
  for (const dep of deposits ?? []) {
    if (dep.status !== 1) continue; // only confirmed

    // Resolve user from deposit_addresses table
    const { data: addrRow } = await supabase
      .from('deposit_addresses')
      .select('user_id')
      .eq('address', dep.address)
      .maybeSingle();

    const resolvedUserId = addrRow?.user_id ?? cfg.user_id;
    if (!resolvedUserId) {
      // Log unknown deposit as reconciliation warning
      await supabase.from('reconciliation_warnings').insert({
        provider_name: 'binance', provider_config_id: cfg.id,
        asset: dep.coin, warning_type: 'unknown_deposit',
        details: { tx_id: dep.id, address: dep.address, amount: dep.amount, network: dep.network },
      }).catch(() => null);
      continue;
    }

    const { data: result } = await supabase.rpc('process_deposit_credit', {
      p_user_id:            resolvedUserId,
      p_asset:              dep.coin,
      p_network:            dep.network,
      p_amount:             parseFloat(dep.amount),
      p_provider_tx_id:     dep.txId || dep.id,
      p_provider_name:      'binance',
      p_provider_config_id: cfg.id,
      p_to_address:         dep.address,
      p_tx_hash:            dep.txId || null,
      p_fee:                0,
      p_wallet_type:        'funding',
      p_raw_data:           dep,
    });

    const r = result as { ok: boolean; duplicate?: boolean } | null;
    if (r?.ok && !r?.duplicate) credited++;
  }
  return credited;
}

// ─── Withdrawal history sync ──────────────────────────────────────────────────
// Updates internal withdrawal statuses, refunds failed withdrawals.
async function syncWithdrawalHistory(cfg: ProviderCfg): Promise<number> {
  const base = cfg.is_testnet ? 'https://testnet.binance.vision' : BINANCE_SPOT;
  const startTime = Date.now() - 24 * 60 * 60 * 1000;
  const qs  = new URLSearchParams({ startTime: startTime.toString(), timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(cfg.api_secret, qs);
  const res = await binanceFetch(`${base}/sapi/v1/capital/withdraw/history?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': cfg.api_key },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 || body.includes('permission')) return 0;
    throw new Error(`withdrawal-history HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const withdrawals = await res.json() as {
    id: string; amount: string; coin: string; status: number;
    txId?: string; network: string; withdrawOrderId?: string;
  }[];

  // Binance status: 0=email,1=cancelled,2=waiting,3=rejected,4=processing,5=failure,6=completed
  let updated = 0;
  for (const wd of withdrawals ?? []) {
    const { data: internalWd } = await supabase.from('withdrawals').select('id, status')
      .or(`binance_withdraw_id.eq.${wd.id},id.eq.${wd.withdrawOrderId ?? '00000000-0000-0000-0000-000000000000'}`)
      .maybeSingle();
    if (!internalWd) continue;
    const s = internalWd.status as string;
    if (s === 'completed' || s === 'cancelled') continue;

    if (wd.status === 6) {
      await supabase.rpc('mark_withdrawal_completed', { p_withdrawal_id: internalWd.id, p_tx_hash: wd.txId ?? '', p_provider_status: 'completed' }).catch(() => null);
      updated++;
    } else if (wd.status === 3 || wd.status === 5) {
      await supabase.rpc('mark_withdrawal_failed', { p_withdrawal_id: internalWd.id, p_reason: wd.status === 3 ? 'Rejected by Binance' : 'Binance processing failed' }).catch(() => null);
      updated++;
    } else if (wd.status === 4) {
      await supabase.from('withdrawals').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', internalWd.id).catch(() => null);
      updated++;
    }
  }
  return updated;
}

// ─── Provider health ──────────────────────────────────────────────────────────
async function markHealthy(id: string, ms: number) {
  await supabase.from('exchange_provider_configs').update({
    last_sync_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    sync_error: null, health_status: 'active',
    avg_response_ms: ms, error_count: 0,
  }).eq('id', id);
}

async function markFailed(id: string, err: string) {
  const status = err.includes('429') ? 'rate_limited' : 'failed';
  await supabase.from('exchange_provider_configs').update({
    last_sync_at: new Date().toISOString(),
    last_failure_at: new Date().toISOString(),
    sync_error: err.slice(0, 500), health_status: status,
  }).eq('id', id);
  await supabase.rpc('increment_provider_error_count', { p_config_id: id }).catch(() => null);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (_req) => {
  try {
    const { data: configs, error: cfgErr } = await supabase
      .from('exchange_provider_configs')
      .select('id,label,api_key,api_secret,is_testnet,user_id')
      .eq('provider_name', 'binance').eq('is_active', true)
      .not('api_key', 'is', null).not('api_secret', 'is', null).not('user_id', 'is', null);

    if (cfgErr) throw cfgErr;
    if (!configs || configs.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No active Binance configs' }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    const summary: { label: string; balances: number; orders: number; error?: string }[] = [];

    for (const cfg of configs as ProviderCfg[]) {
      const t0 = Date.now();
      try {
        const [sb, so, fb, fp, fo, dc, wc] = await Promise.all([
          syncSpotBal(cfg), syncSpotOrd(cfg),
          syncFutBal(cfg), syncFutPos(cfg), syncFutOrd(cfg),
          syncDepositHistory(cfg).catch(() => 0),
          syncWithdrawalHistory(cfg).catch(() => 0),
        ]);
        await markHealthy(cfg.id, Date.now() - t0);
        summary.push({ label: cfg.label, balances: sb + fb, orders: so + fo });
        console.log(`[binance-sync] ${cfg.label}: spot(${sb}bal,${so}ord) fut(${fb}bal,${fp}pos,${fo}ord) deposits_credited=${dc} withdrawals_updated=${wc}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await markFailed(cfg.id, msg);
        summary.push({ label: cfg.label, balances: 0, orders: 0, error: msg });
        console.error(`[binance-sync] ${cfg.label}:`, msg);
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }),
      { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[binance-sync] fatal:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
