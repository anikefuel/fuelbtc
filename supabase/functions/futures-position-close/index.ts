// futures-position-close Edge Function
// Flow:
//   1. Auth user
//   2. Load position from DB (verify ownership)
//   3. Validate close size
//   4. Get current mark price from Binance
//   5. Place reduce-only MARKET order on Binance FAPI
//   6. Call settle_futures_close RPC (updates position, returns margin+PnL)
//   7. Return { realizedPnl, closePrice, positionStatus }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signedPost, futuresBase, roundToStep, BinanceError } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface CloseRequest {
  positionId:      string;
  closeSize?:      number;  // omit = full close
  idempotencyKey:  string;
  orderType?:      'market' | 'limit';
  limitPrice?:     number;
}

interface Position {
  id: string; user_id: string; symbol: string; side: string;
  size: number; entry_price: number; leverage: number;
  margin_mode: string; status: string; initial_margin: number;
}

interface TradingPair {
  provider_symbol: string; step_size: number; tick_size: number;
  taker_fee: number; is_testnet?: boolean;
}

interface ProviderConfig {
  api_key: string; api_secret: string; is_testnet: boolean;
}

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
    let body: CloseRequest;
    try { body = await req.json(); } catch { return err(400, 'INVALID_JSON', 'Invalid JSON'); }
    const { positionId, closeSize, idempotencyKey, orderType = 'market', limitPrice } = body;
    if (!positionId || !idempotencyKey) return err(400, 'MISSING_FIELDS', 'positionId and idempotencyKey required');

    // ── 3. Load position ──────────────────────────────────────────────────────
    const { data: pos, error: posErr } = await svc.from('positions')
      .select('id,user_id,symbol,side,size,entry_price,leverage,margin_mode,status,initial_margin')
      .eq('id', positionId).eq('user_id', userId).single();

    if (posErr || !pos) return err(404, 'POSITION_NOT_FOUND', 'Position not found');
    const position = pos as Position;
    if (position.status !== 'open') return err(400, 'POSITION_CLOSED', 'Position is already closed');

    // ── 4. Load pair + provider ───────────────────────────────────────────────
    const [pairRes, provRes] = await Promise.all([
      svc.from('trading_pairs')
        .select('provider_symbol,step_size,tick_size,taker_fee')
        .eq('symbol', position.symbol).single(),
      svc.from('exchange_provider_configs')
        .select('api_key,api_secret,is_testnet')
        .eq('is_active', true).eq('provider_type', 'binance')
        .order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ]);

    if (!pairRes.data) return err(400, 'INVALID_SYMBOL', 'Symbol not found');
    if (!provRes.data) return err(503, 'NO_PROVIDER', 'No active Binance provider');
    const pair     = pairRes.data as TradingPair;
    const provider = provRes.data as ProviderConfig;
    const binanceSymbol = pair.provider_symbol || position.symbol.replace('_PERP', '');
    const BASE = futuresBase(provider.is_testnet);

    // ── 5. Determine close size ───────────────────────────────────────────────
    const rawClose   = closeSize ?? position.size;
    const closeQty   = Math.min(roundToStep(rawClose, pair.step_size ?? 0.001), position.size);
    const isFullClose = closeQty >= position.size;

    // ── 6. Get mark price ─────────────────────────────────────────────────────
    let closePrice: number;
    try {
      const mpRes = await fetch(`${BASE}/fapi/v1/premiumIndex?symbol=${binanceSymbol}`);
      if (!mpRes.ok) throw new Error(`HTTP ${mpRes.status}`);
      const mp = await mpRes.json() as { markPrice: string };
      closePrice = parseFloat(mp.markPrice);
    } catch {
      closePrice = position.entry_price; // fallback — settle_futures_close will handle
    }

    // ── 7. Place reduce-only order on Binance ─────────────────────────────────
    const binanceSide = position.side === 'long' ? 'SELL' : 'BUY';
    const orderParams: Record<string, string> = {
      symbol:           binanceSymbol,
      side:             binanceSide,
      type:             orderType === 'limit' ? 'LIMIT' : 'MARKET',
      quantity:         String(closeQty),
      positionSide:     'BOTH',
      reduceOnly:       'true',
      newClientOrderId: idempotencyKey.slice(0, 36),
    };
    if (orderType === 'limit' && limitPrice) {
      orderParams.price       = String(limitPrice);
      orderParams.timeInForce = 'GTC';
    }

    let providerOrderId: string;
    let fillPrice = closePrice;
    let filledQty = closeQty;

    try {
      const resp = await signedPost<{ orderId: number; avgPrice: string; executedQty: string; status: string }>(
        provider.api_key, provider.api_secret,
        `${BASE}/fapi/v1/order`, orderParams
      );
      providerOrderId = String(resp.orderId);
      if (resp.avgPrice && parseFloat(resp.avgPrice) > 0) fillPrice = parseFloat(resp.avgPrice);
      if (resp.executedQty) filledQty = parseFloat(resp.executedQty);
    } catch (e) {
      if (e instanceof BinanceError) {
        return err(400, e.internalCode, e.message);
      }
      return err(500, 'ORDER_SUBMIT_FAILED', (e as Error).message);
    }

    // ── 8. Settle close via RPC ───────────────────────────────────────────────
    const fee = filledQty * fillPrice * (pair.taker_fee ?? 0.0004);
    const { data: realizedPnl, error: settleErr } = await svc.rpc('settle_futures_close', {
      p_position_id:       positionId,
      p_user_id:           userId,
      p_close_qty:         filledQty,
      p_close_price:       fillPrice,
      p_fee:               fee,
      p_provider_order_id: providerOrderId,
      p_close_type:        'user',
    });

    if (settleErr) {
      console.error('[futures-position-close] settle error:', settleErr.message);
      return err(500, 'SETTLE_FAILED', settleErr.message);
    }

    return ok({
      positionId,
      realizedPnl,
      closePrice:    fillPrice,
      closeQty:      filledQty,
      fee,
      providerOrderId,
      positionStatus: isFullClose ? 'closed' : 'open',
    });

  } catch (e) {
    console.error('[futures-position-close] unhandled:', e);
    return err(500, 'INTERNAL_ERROR', (e as Error).message);
  }
});
