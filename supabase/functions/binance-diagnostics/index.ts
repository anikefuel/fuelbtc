// binance-diagnostics Edge Function
// Admin-only: runs 6 Binance API health checks + multi-call outbound IP detection.
// Detects current public egress IP, confirms if it is static across 5 probes,
// and performs a real signed Binance auth test.
// Never returns API keys, secrets, signatures, or auth headers.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { binanceFetch, hmacSha256 } from '../_shared/binance-signer.ts';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ENV_API_KEY   = Deno.env.get('BINANCE_API_KEY');
const ENV_API_SECRET = Deno.env.get('BINANCE_API_SECRET');
const BINANCE_BASE  = Deno.env.get('BINANCE_BASE_URL') ?? 'https://api.binance.com';
const GATEWAY_URL   = Deno.env.get('BINANCE_GATEWAY_URL')?.replace(/\/$/, '');

// Confirm presence — never expose values
const HAS_API_KEY    = !!ENV_API_KEY    && ENV_API_KEY.length > 8;
const HAS_API_SECRET = !!ENV_API_SECRET && ENV_API_SECRET.length > 8;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

// ─── Auth — admin only ────────────────────────────────────────────────────────
async function requireAdmin(authHeader: string | null) {
  if (!authHeader) throw new Error('Missing Authorization header');
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Not authenticated');
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if ((profile as { role?: string } | null)?.role !== 'admin') throw new Error('Admin access required');
  return user;
}

// ─── Outbound IP detection ────────────────────────────────────────────────────
// Uses three independent IP-reflection services for redundancy.
async function detectOutboundIP(): Promise<{ ip: string | null; source: string; latencyMs: number }> {
  if (GATEWAY_URL) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${GATEWAY_URL}/egress`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json() as { ip?: string };
      if (res.ok && data.ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(data.ip)) {
        return { ip: data.ip, source: `${GATEWAY_URL}/egress`, latencyMs: Date.now() - t0 };
      }
    } catch { /* fall back to direct probes */ }
  }
  const sources = [
    { url: 'https://api.ipify.org?format=json', parse: (t: string) => (JSON.parse(t) as { ip: string }).ip },
    { url: 'https://api4.my-ip.io/ip.json',     parse: (t: string) => (JSON.parse(t) as { ip: string }).ip },
    { url: 'https://ipv4.icanhazip.com',         parse: (t: string) => t.trim() },
  ];
  for (const s of sources) {
    const t0 = Date.now();
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      const ip = s.parse(text);
      if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        return { ip, source: s.url, latencyMs: Date.now() - t0 };
      }
    } catch { /* try next source */ }
  }
  return { ip: null, source: 'all_failed', latencyMs: 0 };
}

// Run IP detection N times in parallel to detect if IP changes between invocations.
// Within a single EF instance the IP will be the same process — but multiple invocations
// each get an independent Deno worker, so this accurately reflects egress IP stability.
async function probeIPs(count: number): Promise<{ probes: { attempt: number; ip: string | null; source: string; latencyMs: number }[]; unique: string[]; isStatic: boolean | null; note: string }> {
  const probes = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      detectOutboundIP().then(r => ({ attempt: i + 1, ...r }))
    )
  );
  const known = probes.map(p => p.ip).filter((ip): ip is string => ip !== null);
  const unique = [...new Set(known)];
  const isStatic = known.length < count ? null : unique.length === 1;
  const note = GATEWAY_URL && known.length === count && isStatic
    ? `All ${count} probes returned the same VPS gateway egress IP. This is the address to allowlist at Binance.`
    : known.length < count
    ? `Only ${known.length}/${count} probes returned a valid IP — inconclusive.`
    : isStatic
      ? `All ${count} probes returned the same IP. NOTE: this confirms the current egress IP but does NOT guarantee it is permanently static. Supabase does not publish an SLA for fixed egress IPs on the free/pro tier.`
      : `⚠️ IP changed across ${count} probes (${unique.length} unique IPs observed). Supabase Edge Functions use dynamic IPs — Binance IP allowlisting CANNOT be done reliably without a static-IP proxy.`;
  return { probes, unique, isStatic, note };
}

// ─── Binance helpers ──────────────────────────────────────────────────────────
interface TestResult {
  ok:           boolean;
  latencyMs:    number;
  httpStatus?:  number;
  binanceCode?: number;
  error?:       string;
  status?:      string;
}

async function binancePublic(path: string): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const res  = await binanceFetch(`${BINANCE_BASE}${path}`);
    const text = await res.text();
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      let code = 0;
      try { code = (JSON.parse(text) as { code?: number }).code ?? 0; } catch { /* */ }
      return { ok: false, latencyMs, httpStatus: res.status, binanceCode: code, error: text.slice(0, 200) };
    }
    return { ok: true, latencyMs, httpStatus: res.status };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

async function binanceSigned(
  path: string, params: Record<string, string>, apiKey: string, secret: string,
): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const qs  = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: Date.now().toString() }).toString();
    const sig = await hmacSha256(secret, qs);
    const res  = await binanceFetch(`${BINANCE_BASE}${path}?${qs}&signature=${sig}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const text = await res.text();
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      let code = 0; let msg = text;
      try { const j = JSON.parse(text) as { code?: number; msg?: string }; code = j.code ?? 0; msg = j.msg ?? text; } catch { /* */ }
      // Sanitize: never expose raw API key in error
      const safeMsg = msg.replace(/apiKey=[^&\s]*/gi, 'apiKey=***').replace(/'[A-Za-z0-9]{20,}'/, '***');
      return { ok: false, latencyMs, httpStatus: res.status, binanceCode: code, error: safeMsg.slice(0, 200) };
    }
    return { ok: true, latencyMs, httpStatus: res.status };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

function classify(r: TestResult): string {
  if (r.ok) return 'connected';
  if (!r.httpStatus) return 'provider_unavailable';
  const c   = r.binanceCode ?? 0;
  const msg = (r.error ?? '').toLowerCase();
  if (c === -2015 || c === -2014 || r.httpStatus === 401 || msg.includes('api-key') || msg.includes('signature'))
    return 'auth_failed';
  if (msg.includes('ip') || msg.includes('restricted location') || msg.includes('ip restrict'))
    return 'ip_restricted';
  if (r.httpStatus === 403 || msg.includes('permission'))
    return 'permission_denied';
  if (r.httpStatus === 429 || c === -1003)
    return 'rate_limited';
  if (r.httpStatus >= 500)
    return 'provider_unavailable';
  return 'error';
}

function statusLabel(s: string): string {
  const MAP: Record<string, string> = {
    connected:            '✅ Connected',
    auth_failed:          '❌ Authentication failed',
    ip_restricted:        '❌ IP restriction — whitelist required',
    permission_denied:    '❌ Permission denied',
    rate_limited:         '⚠️ Rate limited',
    provider_unavailable: '❌ Binance unavailable',
    not_configured:       '⚠️ Not configured',
    error:                '❌ Error',
  };
  return MAP[s] ?? `❌ ${s}`;
}

// ─── Architecture recommendation based on IP stability results ────────────────
function architectureRec(isStatic: boolean | null, ipRestricted: boolean): string {
  if (isStatic === false || isStatic === null) {
    return [
      '⚠️ DYNAMIC IP DETECTED — Supabase Edge Functions cannot be reliably IP-allowlisted on Binance.',
      '',
      'Recommended architecture:',
      '1. [Best] Deploy a lightweight proxy (e.g. Node.js on Fly.io, Railway, or a $5 VPS) with a static IP.',
      '   - Route all Binance wallet calls through it.',
      '   - Whitelist that single static IP on your Binance API key.',
      '   - Keep wallet-action EF but forward signed requests to the proxy (no secrets exposed to client).',
      '2. [Alternative] Upgrade to Supabase Team/Enterprise plan — they offer dedicated static egress IPs.',
      '3. [Not recommended] Remove IP restriction on Binance API key — exposes funds to higher risk.',
    ].join('\n');
  }
  if (ipRestricted) {
    return [
      '✅ IP appears stable across this session. However, stability is not guaranteed permanently.',
      '',
      'Action required: Add the outbound IP shown above to your Binance API key IP whitelist.',
      '',
      'Steps:',
      '1. Log in to Binance → API Management',
      '2. Edit your API key → IP Access Restriction',
      '3. Add the exact IP shown in "Outbound IP" above',
      '4. Save and wait ~1 minute for Binance to apply the change',
      '5. Re-run this diagnostic to confirm',
      '',
      'Long-term note: Monitor for IP changes. If Supabase rotates your project IP (e.g. after region migration or plan change), you will need to update the Binance whitelist again.',
    ].join('\n');
  }
  return '✅ All Binance API checks passed. No IP restriction detected. Current configuration is working correctly.';
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });

  try {
    await requireAdmin(req.headers.get('Authorization'));
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 401, headers: JSON_HEADERS });
  }

  // Parse mode: full (default) vs ip_only
  let mode = 'full';
  try { const b = await req.json() as { mode?: string }; if (b.mode) mode = b.mode; } catch { /* default */ }
  const ipProbeCount = mode === 'ip_only' ? 5 : 3; // 5 probes for ip_only, 3 parallel for full

  // ── Step 1: Detect outbound IP (run in parallel with credential load) ────────
  const [ipResult, credResult] = await Promise.all([
    probeIPs(ipProbeCount),
    (async () => {
      let apiKey    = ENV_API_KEY;
      let apiSecret = ENV_API_SECRET;
      let configuredVia = 'env_secrets';
      if (!apiKey || !apiSecret) {
        const { data } = await supabase
          .from('exchange_provider_configs')
          .select('api_key,api_secret')
          .eq('provider_name', 'binance').eq('is_active', true)
          .not('api_key', 'is', null).not('api_secret', 'is', null)
          .limit(1).maybeSingle();
        if (data) {
          apiKey    = (data as { api_key: string }).api_key;
          apiSecret = (data as { api_secret: string }).api_secret;
          configuredVia = 'database';
        }
      }
      return { apiKey, apiSecret, configuredVia };
    })(),
  ]);

  const { apiKey, apiSecret, configuredVia } = credResult;
  const noCredentials = !apiKey || !apiSecret;

  // ── Step 2: Run Binance API health checks ────────────────────────────────────
  const marketCheck = await binancePublic('/api/v3/ping');
  marketCheck.status = statusLabel(classify(marketCheck));

  const noCredsResult: TestResult = { ok: false, latencyMs: 0, status: statusLabel('not_configured'), error: 'No API credentials configured' };
  let accountCheck      = noCredsResult;
  let walletCheck       = noCredsResult;
  let depositAddrCheck  = noCredsResult;
  let depositHistCheck  = noCredsResult;
  let withdrawPermCheck = noCredsResult;

  if (!noCredentials) {
    // Run all 5 signed checks in parallel for speed
    [accountCheck, walletCheck, depositAddrCheck, depositHistCheck, withdrawPermCheck] = await Promise.all([
      binanceSigned('/sapi/v1/account/info',           {},                                  apiKey!, apiSecret!),
      binanceSigned('/sapi/v3/asset/getUserAsset',     {},                                  apiKey!, apiSecret!),
      binanceSigned('/sapi/v1/capital/deposit/address', { coin: 'USDT', network: 'ETH' },  apiKey!, apiSecret!),
      binanceSigned('/sapi/v1/capital/deposit/hisrec', { limit: '1' },                     apiKey!, apiSecret!),
      binanceSigned('/sapi/v1/capital/withdraw/history', { limit: '1' },                   apiKey!, apiSecret!),
    ]);
    accountCheck.status      = statusLabel(classify(accountCheck));
    walletCheck.status       = statusLabel(classify(walletCheck));
    depositAddrCheck.status  = statusLabel(classify(depositAddrCheck));
    depositHistCheck.status  = statusLabel(classify(depositHistCheck));
    withdrawPermCheck.status = statusLabel(classify(withdrawPermCheck));
  }

  const allChecks = [marketCheck, accountCheck, walletCheck, depositAddrCheck, depositHistCheck, withdrawPermCheck];
  const anyIpRestricted = allChecks.some(c => classify(c) === 'ip_restricted');

  const sanitize = (r: TestResult) => ({
    ok:          r.ok,
    latencyMs:   r.latencyMs,
    httpStatus:  r.httpStatus,
    binanceCode: r.binanceCode,
    status:      r.status,
    error:       r.ok ? undefined : (r.error ?? 'unknown error').slice(0, 180),
  });

  return new Response(JSON.stringify({
    // ── Outbound IP diagnostic ──
    outbound_ip: {
      current:       ipResult.unique[0] ?? null,
      all_observed:  ipResult.unique,
      is_static:     ipResult.isStatic,
      probe_count:   ipProbeCount,
      probes:        ipResult.probes,  // per-probe: attempt, ip, source, latencyMs
      note:          ipResult.note,
    },

    // ── Credential presence (values never returned) ──
    credentials: {
      api_key_present:    HAS_API_KEY,
      api_secret_present: HAS_API_SECRET,
      configured_via:     configuredVia,
    },

    // ── Binance API checks ──
    checks: {
      public_market:    sanitize(marketCheck),
      account:          sanitize(accountCheck),
      wallet_balance:   sanitize(walletCheck),
      deposit_address:  sanitize(depositAddrCheck),
      deposit_history:  sanitize(depositHistCheck),
      withdraw_perm:    sanitize(withdrawPermCheck),
    },

    // ── Summary ──
    summary: {
      all_ok:           allChecks.every(r => r.ok),
      has_creds:        !noCredentials,
      ip_restricted:    anyIpRestricted,
      current_outbound_ip: ipResult.unique[0] ?? null,
      ip_stability:     ipResult.isStatic === true ? 'stable_this_session' : ipResult.isStatic === false ? 'dynamic' : 'inconclusive',
    },

    // ── Architecture recommendation ──
    recommendation: architectureRec(ipResult.isStatic, anyIpRestricted),
  }), { headers: JSON_HEADERS });
});
