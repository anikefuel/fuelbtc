// binance-deposit-sync Edge Function
// Polls Binance deposit history every 5 minutes via pg_cron.
// For each confirmed deposit:
//   - Matches to a user via deposit_addresses table
//   - Credits internal ledger via process_deposit_credit RPC (idempotent)
//   - Records unmatched deposits for admin review if no user found

import { createClient } from 'npm:@supabase/supabase-js@2';
import { crypto } from 'https://deno.land/std@0.208.0/crypto/mod.ts';
import { encodeHex } from 'https://deno.land/std@0.208.0/encoding/hex.ts';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ─── HMAC-SHA256 ─────────────────────────────────────────────────────────────
async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return encodeHex(new Uint8Array(sig));
}

async function binanceSigned(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  secret: string,
): Promise<unknown> {
  const qs  = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
  const sig = await hmac(secret, qs);
  const url = `https://api.binance.com${path}?${qs}&signature=${sig}`;
  const res = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Binance ${res.status}: ${body}`);
  return JSON.parse(body);
}

interface BinanceDeposit {
  id:           string;
  coin:         string;
  network:      string;
  amount:       string;
  fee?:         string;
  status:       number;   // 0=pending, 1=success, 6=credited
  address:      string;
  addressTag?:  string;
  txId?:        string;
  insertTime:   number;
  transferType: number;
}

interface ProviderCfg {
  id:         string;
  api_key:    string;
  api_secret: string;
}

async function loadConfig(): Promise<ProviderCfg | null> {
  const { data } = await supabase
    .from('exchange_provider_configs')
    .select('id,api_key,api_secret')
    .eq('provider_name', 'binance')
    .eq('is_active', true)
    .not('api_key', 'is', null)
    .not('api_secret', 'is', null)
    .limit(1).maybeSingle();
  return data as ProviderCfg | null;
}

async function getSyncState(): Promise<{ last_sync_at: string; last_start_time: number }> {
  const { data } = await supabase
    .from('deposit_sync_state')
    .select('last_sync_at, last_start_time')
    .eq('provider_name', 'binance')
    .single();
  return data ?? { last_sync_at: new Date(Date.now() - 7 * 86400 * 1000).toISOString(), last_start_time: 0 };
}

async function updateSyncState(startTime: number, error?: string) {
  await supabase.from('deposit_sync_state').upsert({
    provider_name:   'binance',
    last_sync_at:    new Date().toISOString(),
    last_start_time: startTime,
    error_count:     error ? 1 : 0,
    last_error:      error ?? null,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'provider_name' });
}

// Map Binance coin+network → internal network name via asset_networks
async function resolveNetwork(coin: string, binanceNetwork: string): Promise<string> {
  const { data } = await supabase
    .from('asset_networks')
    .select('network')
    .eq('asset', coin)
    .eq('binance_network', binanceNetwork)
    .maybeSingle();
  return (data?.network as string | undefined) ?? binanceNetwork.toLowerCase();
}

// Find the internal user_id who owns this deposit address
async function resolveUser(address: string, asset: string, network: string): Promise<string | null> {
  // Match by exact address + asset + network
  const { data } = await supabase
    .from('deposit_addresses')
    .select('user_id')
    .eq('address', address)
    .eq('asset', asset)
    .eq('network', network)
    .maybeSingle();
  if (data?.user_id) return data.user_id as string;

  // Fallback: match by address + asset only (network may differ for multi-chain assets)
  const { data: d2 } = await supabase
    .from('deposit_addresses')
    .select('user_id')
    .eq('address', address)
    .eq('asset', asset)
    .limit(1).maybeSingle();
  return (d2?.user_id as string | undefined) ?? null;
}

Deno.serve(async (_req: Request) => {
  const h = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (_req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: h });

  try {
    const cfg = await loadConfig();
    if (!cfg) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_binance_config' }), { headers: h });
    }

    const state   = await getSyncState();
    const startMs = state.last_start_time > 0
      ? state.last_start_time
      : Date.now() - 7 * 24 * 60 * 60 * 1000; // up to 7 days back on first run

    // Fetch confirmed deposits since last run
    // Binance returns max 1000 records per call; loop pages if needed
    let allDeposits: BinanceDeposit[] = [];
    let offset = 0;
    const limit = 1000;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const params: Record<string, string> = {
        status:    '1',                      // 1 = success (confirmed)
        startTime: startMs.toString(),
        endTime:   Date.now().toString(),
        limit:     limit.toString(),
        offset:    offset.toString(),
      };

      const page = await binanceSigned(
        '/sapi/v1/capital/deposit/hisrec', params, cfg.api_key, cfg.api_secret,
      ) as BinanceDeposit[];

      allDeposits = allDeposits.concat(page);
      if (page.length < limit) break;
      offset += limit;
      if (offset > 10000) break; // Safety cap: 10 pages max per run
    }

    let credited = 0, unmatched = 0, skipped = 0;
    const newMaxTime = allDeposits.reduce((m, d) => Math.max(m, d.insertTime), startMs);

    for (const dep of allDeposits) {
      const coin     = dep.coin;
      const network  = await resolveNetwork(coin, dep.network);
      const amount   = parseFloat(dep.amount);
      const fee      = parseFloat(dep.fee ?? '0');
      const txId     = dep.id;

      if (amount <= 0) { skipped++; continue; }

      // Already credited? Check idempotency before hitting the RPC
      const { data: existing } = await supabase
        .from('deposits')
        .select('id')
        .eq('provider_name', 'binance')
        .eq('provider_tx_id', txId)
        .eq('status', 'credited')
        .maybeSingle();
      if (existing) { skipped++; continue; }

      const userId = await resolveUser(dep.address, coin, network);

      if (userId) {
        // Credit to user's funding wallet
        const { data: result } = await supabase.rpc('process_deposit_credit', {
          p_user_id:            userId,
          p_asset:              coin,
          p_network:            network,
          p_amount:             amount,
          p_provider_tx_id:     txId,
          p_provider_name:      'binance',
          p_provider_config_id: cfg.id,
          p_to_address:         dep.address,
          p_from_address:       null,
          p_tx_hash:            dep.txId ?? null,
          p_fee:                fee,
          p_wallet_type:        'funding',
          p_raw_data:           dep,
        });

        const r = result as { ok?: boolean; reason?: string } | null;
        if (r?.ok || r?.reason === 'already_credited') {
          credited++;
        } else {
          console.error('[deposit-sync] credit failed', txId, r);
        }
      } else {
        // No matching user — store for admin review
        await supabase.from('unmatched_deposits').upsert({
          provider_name:  'binance',
          provider_tx_id: txId,
          asset:          coin,
          network,
          amount,
          fee,
          to_address:     dep.address,
          tx_hash:        dep.txId ?? null,
          insert_time:    dep.insertTime,
          raw_data:       dep,
          status:         'pending',
        }, { onConflict: 'provider_name,provider_tx_id', ignoreDuplicates: true });
        unmatched++;
      }
    }

    // Update cursor to the latest seen insertTime (+ 1ms to avoid re-fetching)
    await updateSyncState(newMaxTime > startMs ? newMaxTime + 1 : startMs);

    console.log(`[deposit-sync] credited=${credited} unmatched=${unmatched} skipped=${skipped} total=${allDeposits.length}`);
    return new Response(JSON.stringify({ ok: true, credited, unmatched, skipped, total: allDeposits.length }), { headers: h });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[deposit-sync] fatal error:', msg);
    await updateSyncState(0, msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: h });
  }
});
