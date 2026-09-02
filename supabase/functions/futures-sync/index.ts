// futures-sync Edge Function
// Reconciles open orders and positions between Binance FAPI and internal DB
// Called by admin or pg_cron for periodic reconciliation
// Uses provider order IDs for idempotency

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signedGet, futuresBase } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BinancePosition {
  symbol: string; positionSide: string; positionAmt: string;
  entryPrice: string; markPrice: string; unRealizedProfit: string;
  liquidationPrice: string; leverage: string; marginType: string;
  isolatedMargin: string; notional: string;
}

interface BinanceOrder {
  orderId: number; symbol: string; status: string; side: string;
  type: string; origQty: string; executedQty: string; price: string;
  avgPrice: string; clientOrderId: string; reduceOnly: boolean;
}

const BINANCE_STATUS_MAP: Record<string, string> = {
  NEW:              'open',
  PARTIALLY_FILLED: 'partially_filled',
  FILLED:           'filled',
  CANCELED:         'cancelled',
  REJECTED:         'cancelled',
  EXPIRED:          'cancelled',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Admin-only or service-role call
    let isAdmin = false;
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader.startsWith('Bearer ') && authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
      const userSupa = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
      });
      const { data: { user } } = await userSupa.auth.getUser();
      if (user) {
        const { data: profile } = await svc.from('profiles')
          .select('role').eq('id', user.id).single();
        isAdmin = profile?.role === 'admin';
      }
    } else {
      isAdmin = true; // service role
    }

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin only' } }), {
        status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Load Binance provider
    const { data: provider } = await svc.from('exchange_provider_configs')
      .select('api_key,api_secret,is_testnet')
      .eq('is_active', true).eq('provider_type', 'binance')
      .order('created_at', { ascending: true }).limit(1).maybeSingle();

    if (!provider) {
      return new Response(JSON.stringify({ error: 'No provider configured' }), {
        status: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const BASE = futuresBase(provider.is_testnet);

    // ── Sync Binance open orders ──────────────────────────────────────────────
    let binanceOrders: BinanceOrder[] = [];
    try {
      binanceOrders = await signedGet<BinanceOrder[]>(
        provider.api_key, provider.api_secret,
        `${BASE}/fapi/v1/openOrders`, {}
      );
    } catch (e) {
      console.warn('[futures-sync] Could not fetch Binance orders:', (e as Error).message);
    }

    // Load our pending/open futures orders
    const { data: ourOrders } = await svc.from('orders')
      .select('id,provider_order_id,status_v2,symbol,quantity,filled_qty')
      .eq('market_type_v2', 'futures')
      .in('status_v2', ['pending','open','partially_filled']);

    const binanceOrderIds = new Set(binanceOrders.map(o => String(o.orderId)));
    let ordersSynced = 0;

    for (const order of ourOrders ?? []) {
      if (!order.provider_order_id) continue;
      const binOrder = binanceOrders.find(o => String(o.orderId) === order.provider_order_id);

      if (!binOrder && order.status_v2 !== 'pending') {
        // Not found on Binance + not pending = likely filled or cancelled externally
        const newStatus = 'cancelled'; // conservative
        await svc.from('orders').update({
          status_v2:  newStatus,
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);
        ordersSynced++;
        continue;
      }

      if (binOrder) {
        const mappedStatus = BINANCE_STATUS_MAP[binOrder.status] ?? order.status_v2;
        const filledQty    = parseFloat(binOrder.executedQty || '0');
        const avgPrice     = parseFloat(binOrder.avgPrice || '0');
        if (mappedStatus !== order.status_v2 || filledQty !== Number(order.filled_qty)) {
          await svc.from('orders').update({
            status_v2:     mappedStatus,
            filled_qty:    filledQty,
            remaining_qty: Math.max(0, Number(order.quantity) - filledQty),
            avg_fill_price: avgPrice > 0 ? avgPrice : null,
            updated_at:    new Date().toISOString(),
          }).eq('id', order.id);
          ordersSynced++;
        }
      }
    }

    // ── Sync Binance positions ────────────────────────────────────────────────
    let binancePositions: BinancePosition[] = [];
    try {
      binancePositions = await signedGet<BinancePosition[]>(
        provider.api_key, provider.api_secret,
        `${BASE}/fapi/v2/positionRisk`, {}
      );
    } catch (e) {
      console.warn('[futures-sync] Could not fetch Binance positions:', (e as Error).message);
    }

    // Load provider symbols map
    const { data: pairs } = await svc.from('trading_pairs')
      .select('symbol,provider_symbol').eq('is_futures_ok', true);
    const providerToSymbol: Record<string, string> = {};
    for (const p of pairs ?? []) {
      providerToSymbol[p.provider_symbol || p.symbol.replace('_PERP','')] = p.symbol;
    }

    let positionsSynced = 0;
    for (const bp of binancePositions) {
      const posAmt = parseFloat(bp.positionAmt);
      if (Math.abs(posAmt) < 0.000001) continue; // empty position

      const internalSymbol = providerToSymbol[bp.symbol] || `${bp.symbol}_PERP`;
      const markPrice = parseFloat(bp.markPrice);

      // Update mark price in our open positions for this symbol
      const { data: updated } = await svc.from('positions')
        .update({
          mark_price:  markPrice,
          last_sync_at: new Date().toISOString(),
          updated_at:  new Date().toISOString(),
        })
        .eq('symbol', internalSymbol)
        .eq('status', 'open')
        .select('id');

      positionsSynced += (updated?.length ?? 0);
    }

    return new Response(JSON.stringify({
      ordersSynced,
      positionsSynced,
      binanceOrderCount:    binanceOrders.length,
      binancePositionCount: binancePositions.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0).length,
      syncedAt: new Date().toISOString(),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('[futures-sync] unhandled:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
