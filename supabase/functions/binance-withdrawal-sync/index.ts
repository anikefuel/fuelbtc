// binance-withdrawal-sync Edge Function
// Polls Binance withdrawal history every 5 minutes via pg_cron.
// For each withdrawal record:
//   - Matches to internal withdrawal by binance_withdraw_id
//   - Updates status (email_sent→processing→broadcast→success|failure)
//   - Auto-refunds failed withdrawals via mark_withdrawal_failed RPC (idempotent)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { binanceFetch, hmacSha256 } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function binanceSigned(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  secret: string,
): Promise<unknown> {
  const qs  = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString();
  const sig = await hmacSha256(secret, qs);
  const url = `https://api.binance.com${path}?${qs}&signature=${sig}`;
  const res = await binanceFetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Binance ${res.status}: ${body}`);
  return JSON.parse(body);
}

interface BinanceWithdrawal {
  id:              string;   // Binance withdrawal ID
  coin:            string;
  network:         string;
  amount:          string;
  transactionFee:  string;
  address:         string;
  txId?:           string;
  applyTime:       string;
  status:          number;
  // Binance status codes:
  // 0=Email Sent, 1=Cancelled, 2=Awaiting Approval, 3=Rejected,
  // 4=Processing, 5=Failure, 6=Completed
  info?:           string;   // failure reason
  withdrawOrderId?: string;  // our internal withdrawal UUID
}

// Binance status → internal status
function mapStatus(binanceStatus: number): { status: string; isFinal: boolean; isFailed: boolean } {
  switch (binanceStatus) {
    case 0: return { status: 'broadcasting',  isFinal: false, isFailed: false }; // Email Sent
    case 1: return { status: 'cancelled',     isFinal: true,  isFailed: true  }; // Cancelled
    case 2: return { status: 'broadcasting',  isFinal: false, isFailed: false }; // Awaiting Approval
    case 3: return { status: 'rejected',      isFinal: true,  isFailed: true  }; // Rejected
    case 4: return { status: 'broadcasting',  isFinal: false, isFailed: false }; // Processing
    case 5: return { status: 'failed',        isFinal: true,  isFailed: true  }; // Failure
    case 6: return { status: 'completed',     isFinal: true,  isFailed: false }; // Completed
    default: return { status: 'broadcasting', isFinal: false, isFailed: false };
  }
}

interface ProviderCfg { id: string; api_key: string; api_secret: string; is_testnet: boolean }

async function loadConfig(): Promise<ProviderCfg | null> {
  const { data } = await supabase
    .from('exchange_provider_configs')
    .select('id,api_key,api_secret,is_testnet')
    .eq('provider_name', 'binance').eq('is_active', true)
    .not('api_key', 'is', null).not('api_secret', 'is', null)
    .limit(1).maybeSingle();
  return data as ProviderCfg | null;
}

async function getSyncState(): Promise<{ last_start_time: number }> {
  const { data } = await supabase
    .from('withdrawal_sync_state')
    .select('last_start_time')
    .eq('provider_name', 'binance').single();
  return data ?? { last_start_time: 0 };
}

async function updateSyncState(startTime: number, error?: string) {
  await supabase.from('withdrawal_sync_state').upsert({
    provider_name:   'binance',
    last_sync_at:    new Date().toISOString(),
    last_start_time: startTime,
    error_count:     error ? 1 : 0,
    last_error:      error ?? null,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'provider_name' });
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
    if (cfg.is_testnet) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'Binance capital withdrawal history is unavailable on testnet',
      }), { headers: h });
    }

    const state   = await getSyncState();
    const startMs = state.last_start_time > 0
      ? state.last_start_time
      : Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Also sync pending/broadcasting withdrawals specifically (regardless of time range)
    const { data: pendingWithdrawals } = await supabase
      .from('withdrawals')
      .select('id,binance_withdraw_id,asset,network,amount,status')
      .eq('provider_name', 'binance')
      .not('binance_withdraw_id', 'is', null)
      .in('status', ['submitted', 'broadcasting', 'pending_review'])
      .limit(200);

    let updated = 0, refunded = 0, completed = 0, skipped = 0;
    const newMaxTime = startMs;

    // Fetch full history page for time-range sync
    const allWithdrawals: BinanceWithdrawal[] = [];
    let offset = 0;
    const limit = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await binanceSigned(
        '/sapi/v1/capital/withdraw/history',
        {
          startTime: startMs.toString(),
          endTime:   Date.now().toString(),
          limit:     limit.toString(),
          offset:    offset.toString(),
        },
        cfg.api_key, cfg.api_secret,
      ) as BinanceWithdrawal[];
      allWithdrawals.push(...page);
      if (page.length < limit) break;
      offset += limit;
      if (offset > 5000) break;
    }

    // Build a lookup map: binanceId → withdrawal record
    const byBinanceId = new Map<string, BinanceWithdrawal>(
      allWithdrawals.map(w => [w.id, w])
    );

    // Also look up by withdrawOrderId (our UUID submitted to Binance)
    const byOurId = new Map<string, BinanceWithdrawal>(
      allWithdrawals
        .filter(w => w.withdrawOrderId)
        .map(w => [w.withdrawOrderId!, w])
    );

    // Process pending withdrawals
    for (const internal of (pendingWithdrawals ?? [])) {
      const bw = byBinanceId.get(internal.binance_withdraw_id as string)
               ?? byOurId.get(internal.id as string);

      if (!bw) { skipped++; continue; }

      const { status: newStatus, isFinal, isFailed } = mapStatus(bw.status);

      if (isFailed) {
        // Auto-refund: mark_withdrawal_failed RPC returns locked funds to user
        const { error } = await supabase.rpc('mark_withdrawal_failed', {
          p_withdrawal_id: internal.id,
          p_reason:        bw.info ?? `Binance status: ${bw.status}`,
        });
        if (!error) {
          refunded++;
          // Also store raw data for audit
          await supabase
            .from('withdrawals')
            .update({
              status:              newStatus,
              provider_status:     String(bw.status),
              binance_tx_hash:     bw.txId ?? null,
              raw_provider_data:   bw,
            })
            .eq('id', internal.id);
        }
      } else if (newStatus === 'completed' || isFinal) {
        await supabase
          .from('withdrawals')
          .update({
            status:              newStatus,
            provider_status:     String(bw.status),
            binance_tx_hash:     bw.txId ?? null,
            raw_provider_data:   bw,
          })
          .eq('id', internal.id);
        completed++;
      } else {
        // In-progress status update
        await supabase
          .from('withdrawals')
          .update({
            status:          newStatus,
            provider_status: String(bw.status),
            binance_tx_hash: bw.txId ?? null,
          })
          .eq('id', internal.id);
        updated++;
      }
    }

    await updateSyncState(newMaxTime);

    console.log(`[withdrawal-sync] updated=${updated} completed=${completed} refunded=${refunded} skipped=${skipped}`);
    return new Response(
      JSON.stringify({ ok: true, updated, completed, refunded, skipped }),
      { headers: h },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[withdrawal-sync] fatal:', msg);
    await updateSyncState(0, msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: h });
  }
});
