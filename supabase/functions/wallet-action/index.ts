// wallet-action Edge Function — v2
// Handles all user-facing wallet operations server-side.
// Binance credentials are NEVER sent to clients.
//
// Root cause fix: CORS preflight must include Access-Control-Allow-Headers
// for Authorization, apikey, and content-type — without this the browser
// blocks every request with "Failed to send a request to the Edge Function".
//
// Credentials priority: Supabase Secrets (Deno.env) → DB fallback.
// Structured logging: fn name | action | asset | network | http status | Binance error code.
// Secrets and signatures are NEVER logged.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { crypto } from 'https://deno.land/std@0.208.0/crypto/mod.ts';
import { encodeHex } from 'https://deno.land/std@0.208.0/encoding/hex.ts';

const FN = '[wallet-action]';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Credentials from Supabase Secrets (preferred) or fall back to DB
const ENV_API_KEY    = Deno.env.get('BINANCE_API_KEY');
const ENV_API_SECRET = Deno.env.get('BINANCE_API_SECRET');
const BINANCE_BASE   = Deno.env.get('BINANCE_BASE_URL') ?? 'https://api.binance.com';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ─── CORS headers — MUST include Allow-Headers for browser preflight ──────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

// ─── Custom error types ───────────────────────────────────────────────────────
class AuthError       extends Error { constructor(m: string) { super(m); this.name = 'AuthError'; } }
class ValidationError extends Error { constructor(m: string) { super(m); this.name = 'ValidationError'; } }
class ProviderError   extends Error {
  code: string;
  binanceCode?: number;
  httpStatus?: number;
  constructor(code: string, m: string, binanceCode?: number, httpStatus?: number) {
    super(m);
    this.name        = 'ProviderError';
    this.code        = code;
    this.binanceCode = binanceCode;
    this.httpStatus  = httpStatus;
  }
}

// ─── User-facing error messages (safe, no secrets) ───────────────────────────
function userFacingMessage(err: unknown): string {
  if (err instanceof ProviderError) {
    switch (err.code) {
      case 'auth_failed':           return 'Wallet service unavailable — authentication failed. Contact support.';
      case 'ip_restricted':         return 'Wallet service unavailable — IP restriction. Contact support.';
      case 'missing_permission':    return 'Wallet service unavailable — API permission missing. Contact support.';
      case 'rate_limited':          return 'Wallet service temporarily unavailable — please try again in a moment.';
      case 'provider_unavailable':  return 'Wallet service unavailable — please try again shortly.';
      case 'provider_not_configured': return 'Wallet service is not configured. Contact support.';
      case 'testnet_unsupported':   return 'Deposit addresses require mainnet configuration — contact admin.';
      case 'network_not_supported': return 'Network not supported for this asset.';
      case 'deposit_disabled':      return 'Deposits suspended for this network — check back later.';
      case 'no_address':            return 'Unable to retrieve deposit address — please retry.';
      case 'invalid_network':       return 'Network not supported for this asset.';
      case 'insufficient_balance':  return 'Insufficient balance for this withdrawal.';
      case 'amount_too_small':      return err.message;
      default:                      return err.message;
    }
  }
  if (err instanceof ValidationError) return err.message;
  if (err instanceof AuthError)       return 'Authentication expired — please sign in again.';
  return 'Wallet service unavailable — please try again.';
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getAuthUser(authHeader: string | null) {
  if (!authHeader) throw new AuthError('Missing Authorization header');
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new AuthError('Not authenticated');
  return user;
}

// ─── HMAC-SHA256 (never log the secret) ──────────────────────────────────────
async function hmacSha256(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return encodeHex(new Uint8Array(sig));
}

// ─── Binance signed request (timestamp + recvWindow + HMAC SHA256) ────────────
async function binanceSigned(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  secret: string,
  method: 'GET' | 'POST' = 'GET',
  logAsset?: string,
  logNetwork?: string,
): Promise<unknown> {
  const endpoint = `${BINANCE_BASE}${path}`;
  const qs = new URLSearchParams({
    ...params,
    recvWindow: '10000',
    timestamp:  Date.now().toString(),
  }).toString();
  const sig = await hmacSha256(secret, qs);

  // Structured log: endpoint + asset + network — no secret, no signature
  console.log(`${FN} binance_request path=${path} asset=${logAsset ?? '-'} network=${logNetwork ?? '-'}`);

  let res: Response;
  if (method === 'POST') {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `${qs}&signature=${sig}`,
    });
  } else {
    res = await fetch(`${endpoint}?${qs}&signature=${sig}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
  }

  const bodyText = await res.text().catch(() => '');
  console.log(`${FN} binance_response path=${path} http_status=${res.status}`);

  if (!res.ok) throw normalizeBinanceError(res.status, bodyText, path);
  try { return JSON.parse(bodyText); } catch { return bodyText; }
}

function normalizeBinanceError(httpStatus: number, body: string, path: string): ProviderError {
  let code = -1, msg = body;
  try { const j = JSON.parse(body) as { code: number; msg: string }; code = j.code; msg = j.msg; } catch { /* raw */ }

  // Log the Binance error code safely (no secrets)
  console.error(`${FN} binance_error path=${path} http=${httpStatus} binance_code=${code} msg=${msg.slice(0, 120)}`);

  if (code === -2015 || code === -2014 || msg.includes('API-key format invalid'))
    return new ProviderError('auth_failed', `Invalid API key — code ${code}`, code, httpStatus);
  if (httpStatus === 401 || msg.includes('Signature') || msg.includes('timestamp'))
    return new ProviderError('auth_failed', `Authentication failed — code ${code}`, code, httpStatus);
  if (msg.includes('restricted location') || msg.includes('IP'))
    return new ProviderError('ip_restricted', `IP not whitelisted — code ${code}`, code, httpStatus);
  if (httpStatus === 403 || code === -1100 || msg.toLowerCase().includes('permission'))
    return new ProviderError('missing_permission', `API permission denied — code ${code}`, code, httpStatus);
  if (httpStatus === 429 || code === -1003)
    return new ProviderError('rate_limited', `Binance rate limit — code ${code}`, code, httpStatus);
  if (code === -4026 || msg.includes('minimum'))
    return new ProviderError('amount_too_small', `Amount below minimum — code ${code}`, code, httpStatus);
  if (code === -3010 || msg.includes('insufficient'))
    return new ProviderError('insufficient_balance', `Provider insufficient balance — code ${code}`, code, httpStatus);
  if (code === -1121 || msg.includes('Invalid symbol') || msg.includes('network'))
    return new ProviderError('invalid_network', `Invalid network/coin — code ${code}`, code, httpStatus);
  if (msg.includes('ENOTFOUND') || msg.includes('timeout') || httpStatus >= 500)
    return new ProviderError('provider_unavailable', `Binance unreachable — http ${httpStatus}`, code, httpStatus);

  return new ProviderError('provider_error', `Provider error — http ${httpStatus} code ${code}: ${msg.slice(0, 80)}`, code, httpStatus);
}

// ─── Load credentials (env secrets first, DB fallback) ───────────────────────
interface ProviderCfg { id: string; api_key: string; api_secret: string; is_testnet: boolean }

async function loadProviderConfig(): Promise<ProviderCfg> {
  // Prefer Supabase Secrets
  if (ENV_API_KEY && ENV_API_SECRET) {
    const { data } = await supabase
      .from('exchange_provider_configs')
      .select('id,is_testnet')
      .eq('provider_name', 'binance')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (data) {
      return { id: (data as { id: string; is_testnet: boolean }).id, api_key: ENV_API_KEY, api_secret: ENV_API_SECRET, is_testnet: (data as { id: string; is_testnet: boolean }).is_testnet ?? false };
    }
  }

  // DB fallback
  const { data, error } = await supabase
    .from('exchange_provider_configs')
    .select('id,api_key,api_secret,is_testnet')
    .eq('provider_name', 'binance')
    .eq('is_active', true)
    .not('api_key', 'is', null)
    .not('api_secret', 'is', null)
    .limit(1)
    .single();

  if (error || !data) throw new ProviderError('provider_not_configured', 'Binance wallet provider is not configured');
  const cfg = data as ProviderCfg;
  if (!cfg.api_key || !cfg.api_secret) throw new ProviderError('provider_not_configured', 'Binance API credentials are not set');
  return cfg;
}

// ─── Action: get-networks ─────────────────────────────────────────────────────
async function actionGetNetworks(asset?: string) {
  let q = supabase
    .from('asset_networks')
    .select('id,asset,network,network_label,binance_network,deposit_enabled,withdraw_enabled,min_deposit,min_withdrawal,withdrawal_fee,required_confs,estimated_arrival,has_memo,memo_label,address_regex,sort_order')
    .eq('is_active', true)
    .order('sort_order');
  if (asset) q = q.eq('asset', asset);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load networks: ${error.message}`);
  return data ?? [];
}

// ─── Action: get-deposit-address ─────────────────────────────────────────────
// UI network labels → Binance network codes
const UI_NETWORK_MAP: Record<string, string> = {
  'ETH':  'ETH',
  'TRX':  'TRX',
  'BSC':  'BSC',
  'SOL':  'SOL',
  'BTC':  'BTC',
  'BNB':  'BSC',
  'XRP':  'XRP',
  'LTC':  'LTC',
  'DOGE': 'DOGE',
  'ARB':  'ARBITRUM',
  'OP':   'OPTIMISM',
  'MATIC': 'MATIC',
};

async function actionGetDepositAddress(userId: string, asset: string, network: string) {
  console.log(`${FN} get-deposit-address asset=${asset} network=${network} user=${userId.slice(0, 8)}***`);

  // 1. Validate asset/network in DB
  const { data: netRow, error: netErr } = await supabase
    .from('asset_networks')
    .select('binance_network,deposit_enabled,has_memo,memo_label,network_label')
    .eq('asset', asset)
    .eq('network', network)
    .eq('is_active', true)
    .maybeSingle();

  if (netErr || !netRow) {
    console.warn(`${FN} network_not_found asset=${asset} network=${network}`);
    throw new ProviderError('network_not_supported', `Network "${network}" is not supported for ${asset}`);
  }
  if (!(netRow as { deposit_enabled: boolean }).deposit_enabled) {
    throw new ProviderError('deposit_disabled', `Deposits are currently suspended for ${asset} on ${(netRow as { network_label?: string }).network_label ?? network}`);
  }

  // 2. Resolve Binance network code: DB mapping → UI map → uppercase fallback
  const binanceNetwork: string =
    (netRow as { binance_network?: string }).binance_network ||
    UI_NETWORK_MAP[network.toUpperCase()] ||
    network.toUpperCase();

  // 3. Return cached address
  const { data: cached } = await supabase
    .from('deposit_addresses')
    .select('address,memo,provider_name')
    .eq('user_id', userId)
    .eq('asset', asset)
    .eq('network', network)
    .maybeSingle();

  if ((cached as { provider_name?: string } | null)?.provider_name === 'binance' && (cached as { address?: string } | null)?.address) {
    console.log(`${FN} address_cache_hit asset=${asset} network=${network}`);
    return {
      address:       (cached as { address: string }).address,
      memo:          (cached as { memo?: string }).memo || undefined,
      coin:          asset,
      network:       network,
      binanceNetwork,
      source:        'cached',
    };
  }

  // 4. Fetch real address from Binance capital deposit address endpoint
  const cfg = await loadProviderConfig();
  if (cfg.is_testnet) {
    throw new ProviderError('testnet_unsupported', 'Deposit addresses require mainnet — update Admin → Provider APIs');
  }

  const result = await binanceSigned(
    '/sapi/v1/capital/deposit/address',
    { coin: asset, network: binanceNetwork },
    cfg.api_key,
    cfg.api_secret,
    'GET',
    asset,
    binanceNetwork,
  ) as { address: string; coin: string; tag?: string; url?: string };

  if (!result.address) {
    throw new ProviderError('no_address', 'Binance did not return a deposit address for this asset/network');
  }

  const memo = result.tag || undefined;
  console.log(`${FN} address_fetched asset=${asset} network=${binanceNetwork} has_memo=${!!memo}`);

  // 5. Persist for reuse
  await supabase.from('deposit_addresses').upsert({
    user_id:            userId,
    asset,
    network,
    binance_network:    binanceNetwork,
    address:            result.address,
    memo:               memo ?? null,
    provider_name:      'binance',
    provider_config_id: cfg.id,
    is_active:          true,
  }, { onConflict: 'user_id,asset,network' });

  return {
    address:       result.address,
    memo,
    coin:          result.coin ?? asset,
    network,
    binanceNetwork,
    addressUrl:    result.url,
    source:        'binance',
  };
}

// ─── Action: get-deposit-history ──────────────────────────────────────────────
async function actionGetDepositHistory(userId: string, asset?: string, limit = 30) {
  console.log(`${FN} get-deposit-history user=${userId.slice(0, 8)}*** asset=${asset ?? 'all'}`);
  let q = supabase
    .from('deposits')
    .select('id,asset,network,amount,fee,to_address,from_address,tx_hash,provider_tx_id,status,confirmations,required_confs,credited_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (asset) q = q.eq('asset', asset);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load deposit history: ${error.message}`);
  return data ?? [];
}

// ─── Action: get-provider-status ──────────────────────────────────────────────
async function actionGetProviderStatus() {
  const { data } = await supabase
    .from('wallet_provider_status')
    .select('status,deposit_enabled,withdraw_enabled,spot_enabled,futures_enabled,last_checked_at,error_message')
    .limit(1)
    .maybeSingle();

  if (!data) {
    const { data: cfg } = await supabase
      .from('exchange_provider_configs')
      .select('id').eq('provider_name', 'binance').eq('is_active', true).limit(1).maybeSingle();
    return {
      status:           cfg ? 'unknown' : 'not_configured',
      deposit_enabled:  false,
      withdraw_enabled: false,
      spot_enabled:     false,
      futures_enabled:  false,
      error_message:    cfg
        ? 'Provider not yet tested — run diagnostics in Admin'
        : 'No Binance provider configured',
    };
  }
  return data;
}

// ─── Action: submit-withdrawal ────────────────────────────────────────────────
async function actionSubmitWithdrawal(userId: string, params: {
  asset: string; network: string; toAddress: string; memo?: string; amount: number;
}) {
  const { asset, network, toAddress, memo, amount } = params;
  console.log(`${FN} submit-withdrawal asset=${asset} network=${network} amount=${amount} user=${userId.slice(0, 8)}***`);

  const { data: netRow } = await supabase
    .from('asset_networks')
    .select('binance_network,withdraw_enabled,min_withdrawal,withdrawal_fee')
    .eq('asset', asset).eq('network', network).eq('is_active', true)
    .maybeSingle();

  if (!netRow) throw new ValidationError(`Network "${network}" is not supported for ${asset}`);
  if (!(netRow as { withdraw_enabled: boolean }).withdraw_enabled) throw new ValidationError(`Withdrawals are currently disabled for ${asset} on ${network}`);

  const minWd = Number((netRow as { min_withdrawal?: unknown }).min_withdrawal ?? 0);
  const fee   = Number((netRow as { withdrawal_fee?: unknown }).withdrawal_fee ?? 0);
  if (amount < minWd) throw new ValidationError(`Minimum withdrawal is ${minWd} ${asset}`);
  if (!toAddress || toAddress.length < 10) throw new ValidationError('Invalid recipient address');

  const binanceNetwork: string =
    (netRow as { binance_network?: string }).binance_network ||
    UI_NETWORK_MAP[network.toUpperCase()] ||
    network.toUpperCase();

  // Check wallet freeze
  const { data: freeze } = await supabase
    .from('wallet_freezes').select('id')
    .eq('user_id', userId).eq('is_active', true).maybeSingle();
  if (freeze) throw new ValidationError('Your wallet is frozen — please contact support');

  // Atomic balance lock + create withdrawal record
  const { data: withdrawalId, error: rpcErr } = await supabase.rpc('wallet_withdrawal_request', {
    p_user_id:    userId,
    p_asset:      asset,
    p_network:    network,
    p_to_address: toAddress,
    p_amount:     amount,
    p_memo:       memo ?? null,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? '';
    console.error(`${FN} withdrawal_lock_failed asset=${asset} msg=${msg.slice(0, 80)}`);
    if (msg.includes('insufficient') || msg.includes('balance'))
      throw new ValidationError('Insufficient available balance');
    throw new Error(msg || 'Failed to create withdrawal record');
  }

  // Submit to Binance
  const cfg = await loadProviderConfig();
  if (cfg.is_testnet) {
    const testId = `testnet_${Date.now()}_${(withdrawalId as string).slice(0, 8)}`;
    await supabase.rpc('mark_withdrawal_submitted', {
      p_withdrawal_id:       withdrawalId,
      p_binance_withdraw_id: testId,
      p_provider_name:       'binance_testnet',
      p_provider_config_id:  cfg.id,
    });
    return { id: withdrawalId, status: 'submitted', binanceWithdrawId: testId, source: 'testnet' };
  }

  let binanceWithdrawId: string;
  try {
    const body: Record<string, string> = {
      coin:            asset,
      network:         binanceNetwork,
      address:         toAddress,
      amount:          (amount - fee).toFixed(8),
      withdrawOrderId: withdrawalId as string,
    };
    if (memo) body.addressTag = memo;

    const result = await binanceSigned(
      '/sapi/v1/capital/withdraw/apply', body, cfg.api_key, cfg.api_secret, 'POST', asset, binanceNetwork,
    ) as { id: string };
    binanceWithdrawId = result.id;
  } catch (e) {
    await supabase.rpc('mark_withdrawal_failed', {
      p_withdrawal_id: withdrawalId,
      p_reason: e instanceof ProviderError ? e.message : 'Provider rejected the withdrawal',
    }).catch(() => null);
    throw e;
  }

  await supabase.rpc('mark_withdrawal_submitted', {
    p_withdrawal_id:       withdrawalId,
    p_binance_withdraw_id: binanceWithdrawId,
    p_provider_name:       'binance',
    p_provider_config_id:  cfg.id,
  });

  return { id: withdrawalId, status: 'submitted', binanceWithdrawId, source: 'binance' };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // OPTIONS preflight — MUST return all required CORS headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS });
  }

  try {
    const user = await getAuthUser(req.headers.get('Authorization'));
    const body = await req.json() as {
      action: string;
      asset?: string; network?: string;
      toAddress?: string; memo?: string; amount?: number;
      limit?: number;
    };

    console.log(`${FN} action=${body.action} user=${user.id.slice(0, 8)}***`);

    let result: unknown;

    switch (body.action) {
      case 'get-networks':
        result = await actionGetNetworks(body.asset);
        break;

      case 'get-deposit-address': {
        if (!body.asset || !body.network)
          return new Response(JSON.stringify({ error: 'asset and network are required' }), { status: 400, headers: JSON_HEADERS });
        result = await actionGetDepositAddress(user.id, body.asset, body.network);
        break;
      }

      case 'get-deposit-history':
        result = await actionGetDepositHistory(user.id, body.asset, body.limit);
        break;

      case 'get-provider-status':
        result = await actionGetProviderStatus();
        break;

      case 'submit-withdrawal': {
        if (!body.asset || !body.network || !body.toAddress || !body.amount)
          return new Response(JSON.stringify({ error: 'asset, network, toAddress and amount are required' }), { status: 400, headers: JSON_HEADERS });
        result = await actionSubmitWithdrawal(user.id, {
          asset:     body.asset,
          network:   body.network,
          toAddress: body.toAddress,
          memo:      body.memo,
          amount:    body.amount,
        });
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${body.action}` }), { status: 400, headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });

  } catch (err) {
    const userMsg = userFacingMessage(err);
    const code    = err instanceof ProviderError ? err.code
                  : err instanceof ValidationError ? 'validation_error'
                  : err instanceof AuthError ? 'auth_error'
                  : 'internal_error';
    const status  = err instanceof AuthError ? 401
                  : err instanceof ValidationError ? 422
                  : 500;

    // Safe log — mask any string >25 chars that might be a key/secret
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = rawMsg.replace(/[A-Za-z0-9+/]{25,}/g, '***REDACTED***');
    console.error(`${FN} error code=${code} status=${status} msg=${safeMsg.slice(0, 200)}`);

    return new Response(JSON.stringify({ error: userMsg, code }), { status, headers: JSON_HEADERS });
  }
});
