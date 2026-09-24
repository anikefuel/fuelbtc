// futures-order-cancel Edge Function
// Flow:
//   1. Auth user
//   2. Load order (verify ownership + market_type=futures + cancellable status)
//   3. Cancel on Binance FAPI (if provider_order_id exists)
//   4. Call cancel_futures_order RPC (releases locked margin, updates status)
//   5. Return { orderId, status }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signedDelete, futuresBase, BinanceError } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface CancelRequest { orderId: string; }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const err = (s: number, code: string, msg: string) =>
  new Response(JSON.stringify({ error: { code, message: msg } }), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ok = (d: unknown) =>
  new Response(JSON.stringify(d), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return err(401, 'UNAUTHENTICATED', 'Missing token');
    const userSupa = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return err(401, 'UNAUTHENTICATED', 'Invalid token');
    const userId = user.id;

    // ── 2. Parse body ─────────────────────────────────────────────────────────
    let body: CancelRequest;
    try { body = await req.json(); } catch { return err(400, 'INVALID_JSON', 'Invalid JSON'); }
    const { orderId } = body;
    if (!orderId) return err(400, 'MISSING_FIELDS', 'orderId required');

    // ── 3. Load order ─────────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await svc.from('orders')
      .select('id,user_id,symbol,status_v2,provider_order_id,market_type_v2')
      .eq('id', orderId).eq('user_id', userId).single();

    if (orderErr || !order) return err(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (order.market_type_v2 !== 'futures') return err(400, 'NOT_FUTURES_ORDER', 'Not a futures order');
    if (!['pending','open','partially_filled'].includes(order.status_v2)) {
      return err(400, 'NOT_CANCELLABLE', `Order status is ${order.status_v2}`);
    }

    // ── 4. Cancel on Binance (if submitted) ───────────────────────────────────
    if (order.provider_order_id) {
      const { data: provider } = await svc.from('exchange_provider_configs')
        .select('api_key,api_secret,is_testnet')
        .eq('is_active', true).eq('provider_name', 'binance')
        .order('created_at', { ascending: true }).limit(1).maybeSingle();

      if (provider) {
        const binanceSymbol = (order.symbol as string).replace('_PERP', '');
        const BASE = futuresBase(provider.is_testnet);
        try {
          await signedDelete(
            BASE,
            '/fapi/v1/order',
            { symbol: binanceSymbol, orderId: order.provider_order_id },
            provider.api_key,
            provider.api_secret,
          );
        } catch (e) {
          // ORDER_NOT_FOUND on Binance = already cancelled or filled — continue
          if (e instanceof BinanceError && e.internalCode !== 'ORDER_NOT_FOUND') {
            return err(400, e.internalCode, e.message);
          }
        }
      }
    }

    // ── 5. Cancel via RPC ─────────────────────────────────────────────────────
    const { error: rpcErr } = await svc.rpc('cancel_futures_order', {
      p_order_id: orderId,
      p_user_id:  userId,
      p_reason:   'user_cancelled',
    });

    if (rpcErr) return err(500, 'CANCEL_FAILED', rpcErr.message);

    return ok({ orderId, status: 'cancelled' });

  } catch (e) {
    console.error('[futures-order-cancel] unhandled:', e);
    return err(500, 'INTERNAL_ERROR', (e as Error).message);
  }
});
