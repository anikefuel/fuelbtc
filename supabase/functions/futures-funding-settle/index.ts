// futures-funding-settle Edge Function
// Runs every 8 hours via pg_cron
// Fetches latest Binance funding rates, applies them to all open positions
// Idempotent per position+period to prevent duplicate settlement

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const BINANCE_BASE = 'https://fapi.binance.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OpenPosition {
  id: string; user_id: string; symbol: string; side: string;
  size: number; mark_price: number;
}

interface FundingRate {
  symbol: string; fundingRate: string; fundingTime: number; markPrice: string;
}

async function getBinanceFundingRates(symbols: string[]): Promise<Map<string, { rate: number; markPrice: number; periodTs: string }>> {
  const result = new Map<string, { rate: number; markPrice: number; periodTs: string }>();
  await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await fetch(`${BINANCE_BASE}/fapi/v1/premiumIndex?symbol=${sym}`);
      if (!res.ok) return;
      const d = await res.json() as FundingRate;
      result.set(sym, {
        rate:      parseFloat(d.fundingRate),
        markPrice: parseFloat(d.markPrice),
        periodTs:  new Date(d.fundingTime || Date.now()).toISOString(),
      });
    } catch {
      // skip symbol on error
    }
  }));
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Check kill-switch
    const { data: pausedRow } = await svc.from('trading_settings')
      .select('value').eq('key', 'futures_paused').single();
    if (pausedRow?.value === true || pausedRow?.value === 'true') {
      return new Response(JSON.stringify({ skipped: true, reason: 'futures_paused' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Load all open positions
    const { data: positions, error: posErr } = await svc
      .from('positions')
      .select('id,user_id,symbol,side,size,mark_price')
      .eq('status', 'open');

    if (posErr) throw new Error(posErr.message);
    if (!positions || positions.length === 0) {
      return new Response(JSON.stringify({ processed: 0, settled: 0 }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Group by binance symbol
    const symbolSet = new Set<string>();
    for (const p of positions as OpenPosition[]) {
      symbolSet.add(p.symbol.replace('_PERP', ''));
    }

    // Load provider symbols from DB
    const { data: pairs } = await svc.from('trading_pairs')
      .select('symbol,provider_symbol')
      .in('symbol', Array.from(positions.map((p: OpenPosition) => p.symbol)));

    const symbolToProvider: Record<string, string> = {};
    for (const pair of pairs ?? []) {
      symbolToProvider[pair.symbol] = pair.provider_symbol || pair.symbol.replace('_PERP', '');
    }

    const binanceSymbols = [...new Set(
      (positions as OpenPosition[]).map(p => symbolToProvider[p.symbol] || p.symbol.replace('_PERP', ''))
    )];

    const fundingMap = await getBinanceFundingRates(binanceSymbols);

    // Save funding rates to DB cache
    for (const [sym, data] of fundingMap.entries()) {
      await svc.from('funding_rates').upsert({
        symbol:       sym + '_PERP',
        funding_rate: data.rate,
        mark_price:   data.markPrice,
        next_funding_time: data.periodTs,
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'symbol' }).select().maybeSingle();
    }

    let settled = 0;
    let errors  = 0;

    for (const pos of positions as OpenPosition[]) {
      const binSym   = symbolToProvider[pos.symbol] || pos.symbol.replace('_PERP', '');
      const funding  = fundingMap.get(binSym);
      if (!funding) continue;

      const markPrice  = funding.markPrice || pos.mark_price;
      const feeAmount  = pos.side === 'long'
        ? pos.size * markPrice * funding.rate
        : -pos.size * markPrice * funding.rate;  // shorts receive when rate > 0

      // Idempotency key: positionId + period hour
      const hourStr = new Date(funding.periodTs).toISOString().slice(0, 13).replace('T', '_');
      const idempotencyKey = `${pos.id}_${hourStr}`;

      // Check if already settled
      const { data: existing } = await svc.from('futures_funding_history')
        .select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
      if (existing) continue;

      // Apply funding fee via RPC
      const { error: feeErr } = await svc.rpc('record_futures_funding_fee', {
        p_user_id:    pos.user_id,
        p_position_id: pos.id,
        p_symbol:     pos.symbol,
        p_fee_amount: feeAmount,
        p_period_ts:  funding.periodTs,
      });

      if (feeErr) {
        console.error(`[futures-funding] fee error for pos ${pos.id}:`, feeErr.message);
        errors++;
        continue;
      }

      // Record in futures_funding_history
      await svc.from('futures_funding_history').insert({
        user_id:         pos.user_id,
        position_id:     pos.id,
        symbol:          pos.symbol,
        side:            pos.side,
        size:            pos.size,
        mark_price:      markPrice,
        funding_rate:    funding.rate,
        fee_amount:      feeAmount,
        period_ts:       funding.periodTs,
        idempotency_key: idempotencyKey,
      }).select().maybeSingle();

      settled++;
    }

    return new Response(JSON.stringify({
      processed: (positions as OpenPosition[]).length,
      settled,
      errors,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('[futures-funding-settle] unhandled:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
