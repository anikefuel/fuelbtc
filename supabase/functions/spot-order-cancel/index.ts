// spot-order-cancel Edge Function
// Flow:
//   1. Authenticate user
//   2. Load internal order + verify ownership + check cancellable status
//   3. Send cancel to Binance (if provider_order_id exists)
//   4. Call cancel_order_release RPC (release locked funds, update status)
//   5. Write audit log entry
//   6. Return { ok, orderId, releasedAmount }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signedDelete, spotBase, BinanceError } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const serviceSupabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CANCELLABLE_STATUSES = ['pending', 'submitted', 'open', 'partially_filled'];

interface BinanceCancelResponse {
  orderId: number; symbol: string; status: string;
  clientOrderId: string; origQty: string; executedQty: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return err(401, 'UNAUTHENTICATED', 'Missing authorization');
    }
    const userSupabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth:   { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userSupabase.auth.getUser();
    if (authErr || !user) return err(401, 'UNAUTHENTICATED', 'Invalid token');
    const userId = user.id;

    // ── 2. Parse body ─────────────────────────────────────────────────────────
    let body: { orderId: string };
    try { body = await req.json(); } catch {
      return err(400, 'INVALID_JSON', 'Invalid request body');
    }
    if (!body.orderId) return err(400, 'MISSING_ORDER_ID', 'orderId is required');

    // ── 3. Load order + ownership check ──────────────────────────────────────
    const { data: order, error: orderErr } = await serviceSupabase
      .from('orders')
      .select('id,user_id,symbol,side,status_v2,status,provider_order_id,locked_amount,filled_qty,quantity,base_asset,quote_asset')
      .eq('id', body.orderId)
      .single();

    if (orderErr || !order) return err(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (order.user_id !== userId) return err(403, 'FORBIDDEN', 'You do not own this order');

    const currentStatus = (order.status_v2 ?? order.status) as string;
    if (!CANCELLABLE_STATUSES.includes(currentStatus)) {
      return err(400, 'NOT_CANCELLABLE', `Order in status "${currentStatus}" cannot be cancelled`);
    }

    // ── 4. Cancel on Binance (if submitted) ───────────────────────────────────
    let binanceConfirmed = false;
    let binanceCancelResp: BinanceCancelResponse | null = null;

    if (order.provider_order_id) {
      const { data: configs } = await serviceSupabase
        .from('exchange_provider_configs')
        .select('api_key,api_secret,is_testnet')
        .eq('provider_name', 'binance')
        .eq('is_active', true)
        .limit(1);

      if (configs && configs.length > 0) {
        const cfg = configs[0] as { api_key: string; api_secret: string; is_testnet: boolean };
        const base = spotBase(cfg.is_testnet);

        try {
          binanceCancelResp = await signedDelete<BinanceCancelResponse>(
            base, '/api/v3/order',
            { symbol: order.symbol, orderId: order.provider_order_id },
            cfg.api_key, cfg.api_secret,
          );
          binanceConfirmed = true;
        } catch (cancelErr) {
          const be = cancelErr instanceof BinanceError ? cancelErr : null;
          // ORDER_NOT_FOUND means Binance already processed/cancelled it — safe to proceed
          if (be?.internalCode === 'ORDER_NOT_FOUND' || be?.binanceCode === -2011) {
            binanceConfirmed = true;
          } else if (be?.internalCode === 'CANCEL_REJECTED') {
            // Order may be filled — need to sync first
            return err(409, 'CANCEL_REJECTED',
              'Order may have been filled. Refresh to get latest status.');
          } else {
            const msg = be?.message ?? String(cancelErr);
            console.error('[spot-order-cancel] Binance cancel error:', msg);
            // Do NOT release funds if Binance cancel uncertain
            return err(503, be?.internalCode ?? 'PROVIDER_ERROR', msg, {
              source: 'provider',
              provider: 'Binance',
              code: be?.binanceCode ?? be?.internalCode ?? 'PROVIDER_ERROR',
            });
          }
        }
      } else {
        // No provider config: order may have been pending-only, safe to cancel internally
        binanceConfirmed = true;
      }
    } else {
      // Never reached Binance: safe to cancel and release
      binanceConfirmed = true;
    }

    if (!binanceConfirmed) {
      return err(503, 'PROVIDER_UNAVAILABLE', 'Could not confirm cancellation with provider');
    }

    // ── 5. Release funds + update order via RPC ───────────────────────────────
    const { error: rpcErr } = await userSupabase.rpc('cancel_order_release', {
      p_order_id: body.orderId,
    });

    if (rpcErr) {
      // If the RPC says already cancelled, that's fine
      if (rpcErr.message.includes('cannot be cancelled')) {
        return ok({ orderId: body.orderId, status: 'already_cancelled' });
      }
      console.error('[spot-order-cancel] cancel_order_release failed:', rpcErr.message);
      return err(500, 'RELEASE_FAILED', rpcErr.message);
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    const remainingLocked = (order.locked_amount ?? 0) *
      (1 - (order.filled_qty ?? 0) / Math.max(order.quantity, 0.000001));

    await serviceSupabase.from('order_audit_logs').insert({
      order_id:          body.orderId,
      user_id:           userId,
      event_type:        'cancelled',
      old_status:        currentStatus,
      new_status:        'cancelled',
      released_amount:   remainingLocked,
      provider_order_id: order.provider_order_id,
      actor:             'user',
      metadata: {
        binance_status:    binanceCancelResp?.status ?? 'N/A',
        binance_order_id:  order.provider_order_id,
      },
    });

    return ok({
      orderId:         body.orderId,
      status:          'cancelled',
      releasedAmount:  remainingLocked,
      releaseAsset:    order.side === 'buy' ? order.quote_asset : order.base_asset,
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[spot-order-cancel] fatal:', msg);
    return err(500, 'INTERNAL_ERROR', 'Unexpected error');
  }
});

interface ErrorOptions {
  source?: 'exchange' | 'edge_function' | 'provider' | 'network' | 'unknown';
  provider?: string;
  code?: string | number;
}

function err(status: number, code: string, message: string, opts?: ErrorOptions) {
  const body: Record<string, unknown> = { ok: false, code, message };
  body.source = opts?.source ?? (status >= 500 ? 'edge_function' : 'exchange');
  if (opts?.provider) body.provider = opts.provider;
  if (opts?.code !== undefined) body.code = opts.code;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
function ok(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
