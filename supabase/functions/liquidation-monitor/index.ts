// liquidation-monitor Edge Function
// Runs on a schedule (every 30s via cron or direct HTTP POST from admin)
// Scans all open futures positions, recalculates margin ratio using live
// mark prices, and liquidates positions whose margin ratio >= maintenance threshold.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BINANCE_BASE_URL = 'https://fapi.binance.com';

// Maintenance margin rates by leverage tier
const MAINT_MARGIN_RATES: { notional: number; rate: number; }[] = [
  { notional: 50_000,     rate: 0.004  },
  { notional: 250_000,    rate: 0.005  },
  { notional: 1_000_000,  rate: 0.01   },
  { notional: 10_000_000, rate: 0.025  },
  { notional: Infinity,   rate: 0.05   },
];

function getMaintRate(notional: number): number {
  return (MAINT_MARGIN_RATES.find(t => notional <= t.notional) ?? MAINT_MARGIN_RATES.at(-1)!).rate;
}

async function getBinanceMarkPrice(symbol: string): Promise<number | null> {
  try {
    const providerSymbol = symbol.replace('_PERP', '').replace('/', '');
    const res = await fetch(`${BINANCE_BASE_URL}/fapi/v1/premiumIndex?symbol=${providerSymbol}`);
    if (!res.ok) return null;
    const d = await res.json() as { markPrice: string };
    return parseFloat(d.markPrice);
  } catch {
    return null;
  }
}

interface Position {
  id: string;
  user_id: string;
  symbol: string;
  side: 'long' | 'short';
  entry_price: number;
  size: number;
  leverage: number;
  initial_margin: number;
  margin_mode: 'cross' | 'isolated';
}

Deno.serve(async (req: Request) => {
  // Allow CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Fetch all open futures positions
    const { data: positions, error: posErr } = await supabase
      .from('positions')
      .select('id, user_id, symbol, side, entry_price, size, leverage, initial_margin, margin_mode')
      .eq('status', 'open');

    if (posErr) throw new Error(posErr.message);
    if (!positions || positions.length === 0) {
      return new Response(JSON.stringify({ processed: 0, liquidated: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Group positions by symbol to batch mark price fetches
    const symbolSet = new Set((positions as Position[]).map(p => p.symbol));
    const markPrices: Record<string, number> = {};
    await Promise.all(
      Array.from(symbolSet).map(async (sym) => {
        const mp = await getBinanceMarkPrice(sym);
        if (mp !== null) markPrices[sym] = mp;
      })
    );

    // 3. Evaluate each position
    const liquidations: string[] = [];
    const updates: { id: string; margin_ratio: number; mark_price: number; liq_price: number; unrealized_pnl: number }[] = [];

    for (const pos of positions as Position[]) {
      const markPrice = markPrices[pos.symbol];
      if (!markPrice || markPrice <= 0) continue;

      const notional      = pos.size * markPrice;
      const maintMargin   = notional * getMaintRate(notional);
      const initMargin    = pos.initial_margin > 0 ? pos.initial_margin : notional / pos.leverage;

      // Unrealized PnL
      const priceDiff = markPrice - pos.entry_price;
      const pnl       = pos.side === 'long' ? pos.size * priceDiff : -pos.size * priceDiff;

      // Equity = initial margin + pnl
      const equity      = initMargin + pnl;
      const marginRatio = equity > 0 ? maintMargin / equity : 1;

      // Liquidation price (simplified)
      const liqPrice = pos.side === 'long'
        ? pos.entry_price * (1 - 1 / pos.leverage + getMaintRate(notional))
        : pos.entry_price * (1 + 1 / pos.leverage - getMaintRate(notional));

      updates.push({ id: pos.id, margin_ratio: marginRatio, mark_price: markPrice, liq_price: liqPrice, unrealized_pnl: pnl });

      // Liquidate if margin ratio >= 1.0 (equity <= maintenance margin)
      if (marginRatio >= 1.0) {
        liquidations.push(pos.id);
      }
    }

    // 4. Bulk update mark prices, margin ratios, PnL, and risk_level
    for (const u of updates) {
      const riskLevel =
        u.margin_ratio >= 1.0   ? 'liquidation' :
        u.margin_ratio >= 0.9   ? 'high_risk'   :
        u.margin_ratio >= 0.75  ? 'warning'     : 'normal';
      await supabase.rpc('update_position_risk_level', {
        p_position_id: u.id,
        p_mark_price:  u.mark_price,
        p_risk_level:  riskLevel,
      }).catch(e => console.warn(`update_position_risk_level ${u.id}:`, e.message));
      // Also update computed fields directly (margin_ratio, unrealized_pnl, liq_price)
      await supabase.from('positions').update({
        margin_ratio:   u.margin_ratio,
        unrealized_pnl: u.unrealized_pnl,
        liq_price:      u.liq_price,
        updated_at:     new Date().toISOString(),
      }).eq('id', u.id);
    }

    // 5. Trigger liquidations via settle_futures_close RPC
    let liquidatedCount = 0;
    const LIQ_FEE_RATE = 0.0125; // 1.25%

    for (const posId of liquidations) {
      const pos = (positions as Position[]).find(p => p.id === posId)!;
      const markPrice = markPrices[pos.symbol] ?? pos.entry_price;

      // Prevent duplicate liquidation — check if already being processed
      const { data: existing } = await supabase.from('futures_liquidation_events')
        .select('id').eq('position_id', posId).maybeSingle();
      if (existing) continue;

      const liqFee = pos.size * markPrice * LIQ_FEE_RATE;

      // Settle the close via atomic RPC
      const { data: realizedPnl, error: liqErr } = await supabase.rpc('settle_futures_close', {
        p_position_id:       posId,
        p_user_id:           pos.user_id,
        p_close_qty:         pos.size,
        p_close_price:       markPrice,
        p_fee:               liqFee,
        p_provider_order_id: `liq_${posId}_${Date.now()}`,
        p_close_type:        'liquidation',
      });

      if (!liqErr) {
        // Record liquidation event in new table
        await supabase.from('futures_liquidation_events').insert({
          position_id:     posId,
          user_id:         pos.user_id,
          symbol:          pos.symbol,
          side:            pos.side,
          size:            pos.size,
          entry_price:     pos.entry_price,
          liq_price:       markPrice,
          mark_price:      markPrice,
          realized_pnl:    realizedPnl ?? 0,
          liq_fee:         liqFee,
          margin_returned: Math.max(0, pos.initial_margin + (realizedPnl ?? 0) - liqFee),
          status:          'completed',
        });
        liquidatedCount++;
        console.log(`Liquidated position ${posId}: pnl=${realizedPnl}, fee=${liqFee}`);
      } else {
        console.error(`Liquidation RPC failed for position ${posId}:`, liqErr.message);
      }
    }

    return new Response(
      JSON.stringify({ processed: updates.length, liquidated: liquidatedCount, timestamp: new Date().toISOString() }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );

  } catch (err) {
    console.error('Liquidation monitor error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
