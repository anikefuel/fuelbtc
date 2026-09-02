// spot-order-sync Edge Function
// Polls Binance for fills on all open/partially_filled spot orders.
// Called every ~30s by pg_cron. Also callable by admin for manual reconcile.
//
// Per-order flow:
//   1. Fetch Binance order status to catch outright cancellations/rejections
//   2. Fetch myTrades for the symbol (filtered by orderId) to get all fills
//   3. For each new fill (not in provider_fill_ids): call settle_binance_fill RPC
//   4. If Binance reports CANCELED/REJECTED/EXPIRED: update internal order + release funds
//
// Idempotency: settle_binance_fill checks provider_fill_ids JSONB array

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signedGet, spotBase, BinanceError } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const OPEN_STATUSES = ['submitted', 'open', 'partially_filled'];
const TERMINAL_MAP: Record<string, string> = {
  CANCELED: 'cancelled', REJECTED: 'rejected', EXPIRED: 'expired', FILLED: 'filled',
};

interface InternalOrder {
  id: string; user_id: string; symbol: string; provider_order_id: string;
  status_v2: string; status: string; filled_qty: number; quantity: number;
  locked_amount: number; side: string; base_asset: string; quote_asset: string;
  provider_fill_ids: string[];
}

interface BinanceOrderStatus {
  orderId: number; symbol: string; status: string;
  executedQty: string; price: string; type: string; side: string;
}

interface BinanceTrade {
  id: number; orderId: number; symbol: string;
  price: string; qty: string; commission: string; commissionAsset: string;
  isMaker: boolean; time: number;
}

interface ProviderConfig {
  id: string; api_key: string; api_secret: string; is_testnet: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' } });
  }

  const startTime = Date.now();
  const summary = { checked: 0, fills_settled: 0, orders_closed: 0, errors: [] as string[] };

  try {
    // ── 1. Load active Binance provider config ─────────────────────────────
    const { data: configs, error: cfgErr } = await supabase
      .from('exchange_provider_configs')
      .select('id,api_key,api_secret,is_testnet')
      .eq('provider_name', 'binance')
      .eq('is_active', true)
      .not('api_key', 'is', null)
      .not('api_secret', 'is', null)
      .limit(1);

    if (cfgErr || !configs || configs.length === 0) {
      return resp({ ok: false, source: 'edge_function', code: 'PROVIDER_NOT_CONFIGURED', error: 'No active Binance config', ...summary });
    }
    const cfg = configs[0] as ProviderConfig;
    const base = spotBase(cfg.is_testnet);

    // ── 2. Load all open spot orders with provider_order_id ────────────────
    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('id,user_id,symbol,provider_order_id,status_v2,status,filled_qty,quantity,locked_amount,side,base_asset,quote_asset,provider_fill_ids')
      .eq('market_type_v2', 'spot')
      .in('status_v2', OPEN_STATUSES)
      .not('provider_order_id', 'is', null)
      .limit(200);

    if (ordersErr) {
      return resp({ ok: false, error: ordersErr.message, ...summary });
    }

    const openOrders = (orders ?? []) as InternalOrder[];
    summary.checked = openOrders.length;

    // ── 3. Process each order ──────────────────────────────────────────────
    // Group by symbol to batch myTrades requests
    const bySymbol = new Map<string, InternalOrder[]>();
    for (const o of openOrders) {
      const list = bySymbol.get(o.symbol) ?? [];
      list.push(o);
      bySymbol.set(o.symbol, list);
    }

    for (const [symbol, symbolOrders] of bySymbol) {
      // Fetch Binance open orders for this symbol to detect cancellations
      let binanceOpenIds = new Set<string>();
      try {
        const binanceOpen = await signedGet<BinanceOrderStatus[]>(
          base, '/api/v3/openOrders', { symbol }, cfg.api_key, cfg.api_secret,
        );
        binanceOpenIds = new Set((binanceOpen ?? []).map(o => String(o.orderId)));
      } catch (e) {
        const be = e instanceof BinanceError ? e : null;
        const msg = be ? `[Binance ${be.binanceCode ?? be.internalCode}] ${be.message}` : String(e);
        summary.errors.push(`fetchOpenOrders(${symbol}): ${msg}`);
        continue;
      }

      for (const order of symbolOrders) {
        try {
          await syncOrder(base, cfg, order, binanceOpenIds, summary);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          summary.errors.push(`order ${order.id.slice(0,8)}: ${msg}`);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[spot-order-sync] checked=${summary.checked} fills=${summary.fills_settled} closed=${summary.orders_closed} errors=${summary.errors.length} ms=${elapsed}`);

    return resp({ ok: true, elapsed_ms: elapsed, ...summary });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[spot-order-sync] fatal:', msg);
    return resp({ ok: false, error: msg, ...summary }, 500);
  }
});

async function syncOrder(
  base: string,
  cfg: ProviderConfig,
  order: InternalOrder,
  binanceOpenIds: Set<string>,
  summary: { fills_settled: number; orders_closed: number; errors: string[] },
): Promise<void> {
  const provId = order.provider_order_id;

  // ── A. Fetch order status from Binance ──────────────────────────────────
  let binanceOrder: BinanceOrderStatus;
  try {
    binanceOrder = await signedGet<BinanceOrderStatus>(
      base, '/api/v3/order',
      { symbol: order.symbol, orderId: provId },
      cfg.api_key, cfg.api_secret,
    );
  } catch (e) {
    const be = e instanceof BinanceError ? e : null;
    if (be?.binanceCode === -2013) {
      // Order not found on Binance — treat as cancelled
      await releaseAndClose(order, 'cancelled', 'Order not found on Binance');
      summary.orders_closed++;
      return;
    }
    throw e;
  }

  // ── B. Fetch trade fills for this order ──────────────────────────────────
  let trades: BinanceTrade[] = [];
  try {
    trades = await signedGet<BinanceTrade[]>(
      base, '/api/v3/myTrades',
      { symbol: order.symbol, orderId: provId, limit: 100 },
      cfg.api_key, cfg.api_secret,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[spot-order-sync] myTrades failed for ${order.id.slice(0,8)}: ${msg}`);
    // Non-fatal: will retry next cycle
  }

  // ── C. Settle new fills ──────────────────────────────────────────────────
  const settledIds = new Set<string>(order.provider_fill_ids ?? []);
  for (const trade of trades) {
    const fillId = String(trade.id);
    if (settledIds.has(fillId)) continue; // already settled

    const result = await supabase.rpc('settle_binance_fill', {
      p_order_id:         order.id,
      p_provider_fill_id: fillId,
      p_fill_qty:         parseFloat(trade.qty),
      p_fill_price:       parseFloat(trade.price),
      p_fee:              parseFloat(trade.commission),
      p_fee_asset:        trade.commissionAsset,
      p_is_maker:         trade.isMaker,
    });

    if (result.error) {
      console.error(`[spot-order-sync] settle_binance_fill error for fill ${fillId}:`, result.error.message);
    } else {
      const r = result.data as { duplicate?: boolean };
      if (!r?.duplicate) {
        settledIds.add(fillId);
        summary.fills_settled++;
      }
    }
  }

  // ── D. Handle terminal states ────────────────────────────────────────────
  const terminalStatus = TERMINAL_MAP[binanceOrder.status];
  if (terminalStatus) {
    const currentInternalStatus = (order.status_v2 ?? order.status) as string;
    if (currentInternalStatus !== terminalStatus && currentInternalStatus !== 'filled') {
      if (terminalStatus === 'cancelled' || terminalStatus === 'expired' || terminalStatus === 'rejected') {
        await releaseAndClose(order, terminalStatus, `Binance status: ${binanceOrder.status}`);
        summary.orders_closed++;
      } else if (terminalStatus === 'filled' && currentInternalStatus !== 'filled') {
        // Mark as filled if all fills settled but status not yet updated
        await supabase.from('orders').update({
          status:    'filled',
          status_v2: 'filled',
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);
        summary.orders_closed++;
      }
    }
  }
}

/** Release locked funds and update order to terminal status */
async function releaseAndClose(
  order: InternalOrder, newStatus: string, reason: string,
): Promise<void> {
  const releaseAsset = order.side === 'buy' ? order.quote_asset : order.base_asset;
  const filledRatio  = Math.min(1, (order.filled_qty ?? 0) / Math.max(order.quantity, 0.000001));
  const releaseAmt   = (order.locked_amount ?? 0) * (1 - filledRatio);

  // Update order status
  await supabase.from('orders').update({
    status:    newStatus,
    status_v2: newStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id);

  // Release locked balance atomically via RPC if available, otherwise direct update
  if (releaseAmt > 0 && releaseAsset) {
    const rpcResult = await supabase.rpc('release_order_lock', {
      p_user_id:     order.user_id,
      p_asset:       releaseAsset,
      p_wallet_type: 'spot',
      p_amount:      releaseAmt,
      p_reference_id: order.id,
      p_reason:      `${newStatus}: ${reason}`,
    });

    if (rpcResult.error) {
      // Fallback: direct wallet update for non-pending statuses (best-effort)
      const { data: wallet } = await supabase
        .from('wallets')
        .select('locked_balance, available_balance')
        .eq('user_id', order.user_id)
        .eq('asset', releaseAsset)
        .eq('wallet_type', 'spot')
        .single();

      if (wallet) {
        const newLocked = Math.max(0, (wallet.locked_balance as number) - releaseAmt);
        const newAvail  = Math.max(0, (wallet.available_balance as number) + releaseAmt);
        await supabase.from('wallets').update({
          locked_balance:    newLocked,
          available_balance: newAvail,
          updated_at:        new Date().toISOString(),
        })
        .eq('user_id', order.user_id)
        .eq('asset', releaseAsset)
        .eq('wallet_type', 'spot');
      }
    }
  }

  // Audit log
  await supabase.from('order_audit_logs').insert({
    order_id:   order.id,
    user_id:    order.user_id,
    event_type: newStatus,
    old_status: order.status_v2 ?? order.status,
    new_status: newStatus,
    released_amount: releaseAmt,
    error_message:   reason,
    actor:           'system',
  });
}

function resp(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
