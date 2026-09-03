// futures-order-place Edge Function
// Flow:
//   1. Authenticate user from Bearer JWT
//   2. Validate request body server-side (symbol, side, size, leverage, etc.)
//   3. Check futures_trading_enabled + symbol is_futures_ok
//   4. Load provider config (Binance FAPI credentials)
//   5. Get mark price from Binance for market orders
//   6. Call place_futures_order RPC → locks margin, creates order with status=pending
//   7. Set leverage on Binance FAPI (idempotent)
//   8. Submit order to Binance FAPI (signed)
//   9. Call settle_futures_fill RPC → creates/merges position, writes ledger
//  10. Update order status to submitted → handled by settle
//  11. Return { orderId, positionId, providerOrderId, status }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signedPost, signedGet, futuresBase, roundToStep, roundToTick, BinanceError } from '../_shared/binance-signer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface PlaceFuturesOrderRequest {
  symbol:          string;   // e.g. 'BTCUSDT_PERP'
  side:            'long' | 'short';
  orderType:       'market' | 'limit' | 'stop_market' | 'take_profit_market';
  size:            number;   // in contracts (base asset qty)
  price?:          number;   // required for limit
  stopPrice?:      number;   // required for stop_market / take_profit_market
  leverage:        number;
  marginMode:      'cross' | 'isolated';
  tpPrice?:        number;
  slPrice?:        number;
  idempotencyKey:  string;
  reduceOnly?:     boolean;
}

interface TradingPair {
  symbol: string; provider_symbol: string; is_futures_ok: boolean;
  status_v2: string; max_leverage: number;
  tick_size: number; step_size: number;
  min_qty: number; max_qty: number | null; min_notional: number;
  price_precision: number; qty_precision: number;
  maker_fee: number; taker_fee: number;
}

interface ProviderConfig {
  id: string; api_key: string; api_secret: string; is_testnet: boolean;
}

interface BinanceFuturesOrderResp {
  orderId: number; clientOrderId: string; symbol: string;
  status: string; executedQty: string; avgPrice: string;
  cumQuote: string; price: string;
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function err(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── 1. Authenticate ───────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return err(401, 'UNAUTHENTICATED', 'Missing token');

    const userSupa = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return err(401, 'UNAUTHENTICATED', 'Invalid token');
    const userId = user.id;

    // ── 2. Parse body ─────────────────────────────────────────────────────────
    let body: PlaceFuturesOrderRequest;
    try { body = await req.json(); } catch { return err(400, 'INVALID_JSON', 'Invalid JSON'); }

    const {
      symbol, side, orderType, size, price, stopPrice,
      leverage, marginMode, tpPrice, slPrice, idempotencyKey, reduceOnly = false,
    } = body;

    if (!symbol || !side || !orderType || !size || !leverage || !marginMode || !idempotencyKey) {
      return err(400, 'MISSING_FIELDS', 'symbol, side, orderType, size, leverage, marginMode, idempotencyKey required');
    }
    if (!['long','short'].includes(side)) return err(400, 'INVALID_SIDE', 'side must be long or short');
    if (!['market','limit','stop_market','take_profit_market'].includes(orderType)) {
      return err(400, 'INVALID_ORDER_TYPE', 'Unsupported order type');
    }
    if (size <= 0) return err(400, 'INVALID_SIZE', 'size must be > 0');
    if (leverage < 1 || leverage > 125) return err(400, 'INVALID_LEVERAGE', 'leverage 1–125');
    if (!['cross','isolated'].includes(marginMode)) return err(400, 'INVALID_MARGIN_MODE', 'cross or isolated');
    if (orderType === 'limit' && !price) return err(400, 'PRICE_REQUIRED', 'price required for limit orders');
    if (idempotencyKey.length < 8 || idempotencyKey.length > 64) {
      return err(400, 'INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must be 8–64 chars');
    }

    // ── 3. Kill-switch check ──────────────────────────────────────────────────
    const { data: settings } = await svc.from('trading_settings')
      .select('key,value').in('key', ['futures_trading_enabled','futures_paused']);
    const settingMap = Object.fromEntries((settings ?? []).map(s => [s.key, s.value]));
    if (settingMap['futures_trading_enabled'] === false || settingMap['futures_trading_enabled'] === 'false') {
      return err(503, 'FUTURES_DISABLED', 'Futures trading is currently disabled');
    }
    if (settingMap['futures_paused'] === true || settingMap['futures_paused'] === 'true') {
      return err(503, 'FUTURES_PAUSED', 'Futures trading is temporarily paused');
    }

    // ── 4. Load pair ──────────────────────────────────────────────────────────
    const { data: pair, error: pairErr } = await svc.from('trading_pairs')
      .select('symbol,provider_symbol,is_futures_ok,status_v2,max_leverage,tick_size,step_size,min_qty,max_qty,min_notional,price_precision,qty_precision,maker_fee,taker_fee')
      .eq('symbol', symbol.toUpperCase())
      .single();

    if (pairErr || !pair) return err(400, 'INVALID_SYMBOL', `Symbol ${symbol} not supported`);
    const p = pair as TradingPair;
    if (!p.is_futures_ok || p.status_v2 !== 'active') {
      return err(400, 'PAIR_DISABLED', `Futures trading disabled for ${symbol}`);
    }
    if (leverage > p.max_leverage) {
      return err(400, 'LEVERAGE_EXCEEDS_MAX', `Max leverage for ${symbol} is ${p.max_leverage}x`);
    }

    // ── 5. Load provider config ───────────────────────────────────────────────
    const { data: provider } = await svc.from('exchange_provider_configs')
      .select('id,api_key,api_secret,is_testnet')
      .eq('is_active', true).eq('provider_name', 'binance')
      .order('created_at', { ascending: true }).limit(1).maybeSingle();

    if (!provider) return err(503, 'NO_PROVIDER', 'No active Binance provider configured');
    const prov = provider as ProviderConfig;
    const binanceSymbol = p.provider_symbol || symbol.replace('_PERP', '');
    const BASE = futuresBase(prov.is_testnet);

    // ── 6. Get mark price (for market orders or validation) ───────────────────
    let markPrice: number;
    try {
      const mpRes = await fetch(`${BASE}/fapi/v1/premiumIndex?symbol=${binanceSymbol}`);
      if (!mpRes.ok) throw new Error(`HTTP ${mpRes.status}`);
      const mp = await mpRes.json() as { markPrice: string };
      markPrice = parseFloat(mp.markPrice);
      if (!markPrice || isNaN(markPrice)) throw new Error('Invalid mark price');
    } catch (e) {
      return err(503, 'MARK_PRICE_UNAVAILABLE', `Cannot fetch mark price: ${(e as Error).message}`);
    }

    // For market orders use mark price as reference; for limit use requested price
    const orderPrice = orderType === 'market' ? markPrice : (price ?? markPrice);

    // ── 7. Validate size precision ────────────────────────────────────────────
    const roundedSize  = roundToStep(size, p.step_size ?? 0.001);
    const roundedPrice = roundToTick(orderPrice, p.tick_size ?? 0.01);

    if (roundedSize < (p.min_qty ?? 0)) {
      return err(400, 'SIZE_TOO_SMALL', `Min size for ${symbol} is ${p.min_qty}`);
    }
    if (p.max_qty && roundedSize > p.max_qty) {
      return err(400, 'SIZE_TOO_LARGE', `Max size for ${symbol} is ${p.max_qty}`);
    }
    const notional = roundedSize * roundedPrice;
    if (notional < (p.min_notional ?? 5)) {
      return err(400, 'BELOW_MIN_NOTIONAL', `Min notional is ${p.min_notional} USDT`);
    }

    // ── 8. Ensure futures wallet exists ───────────────────────────────────────
    await svc.rpc('get_or_create_futures_wallet', { p_user_id: userId, p_asset: 'USDT' });

    // ── 9. Call place_futures_order RPC (locks margin, creates order) ─────────
    const { data: orderId, error: rpcErr } = await svc.rpc('place_futures_order', {
      p_user_id:         userId,
      p_symbol:          symbol.toUpperCase(),
      p_side:            side,
      p_order_type:      orderType,
      p_size:            roundedSize,
      p_price:           roundedPrice,
      p_leverage:        leverage,
      p_margin_mode:     marginMode,
      p_tp_price:        tpPrice ?? 0,
      p_sl_price:        slPrice ?? 0,
      p_idempotency_key: idempotencyKey,
      p_reduce_only:     reduceOnly,
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      if (msg.includes('Insufficient')) return err(400, 'INSUFFICIENT_MARGIN', msg);
      if (msg.includes('Invalid leverage')) return err(400, 'INVALID_LEVERAGE', msg);
      return err(500, 'ORDER_CREATE_FAILED', msg);
    }

    // ── 10. Set leverage on Binance ───────────────────────────────────────────
    try {
      await signedPost(
        BASE, '/fapi/v1/leverage',
        { symbol: binanceSymbol, leverage: String(leverage) },
        prov.api_key, prov.api_secret,
      );
    } catch {
      // Non-fatal — Binance might already have this leverage set
    }

    // Set margin type (CROSSED / ISOLATED)
    try {
      await signedPost(
        BASE, '/fapi/v1/marginType',
        { symbol: binanceSymbol, marginType: marginMode === 'cross' ? 'CROSSED' : 'ISOLATED' },
        prov.api_key, prov.api_secret,
      );
    } catch {
      // Non-fatal — might already be set
    }

    // ── 11. Build Binance order params ────────────────────────────────────────
    const binanceSide = side === 'long' ? 'BUY' : 'SELL';
    const binanceOrderType = {
      market: 'MARKET',
      limit: 'LIMIT',
      stop_market: 'STOP_MARKET',
      take_profit_market: 'TAKE_PROFIT_MARKET',
    }[orderType];

    const orderParams: Record<string, string> = {
      symbol:           binanceSymbol,
      side:             binanceSide,
      type:             binanceOrderType,
      quantity:         String(roundedSize),
      positionSide:     'BOTH',  // hedge mode = BOTH; one-way mode uses BOTH
      newClientOrderId: idempotencyKey.slice(0, 36),
    };

    if (orderType === 'limit') {
      orderParams.price        = String(roundedPrice);
      orderParams.timeInForce  = 'GTC';
    }
    if (['stop_market','take_profit_market'].includes(orderType) && stopPrice) {
      orderParams.stopPrice = String(roundToTick(stopPrice, p.tick_size ?? 0.01));
    }
    if (reduceOnly) {
      orderParams.reduceOnly = 'true';
    }

    // ── 12. Submit to Binance ─────────────────────────────────────────────────
    let binanceResp: BinanceFuturesOrderResp;
    try {
      binanceResp = await signedPost<BinanceFuturesOrderResp>(
        BASE, '/fapi/v1/order', orderParams,
        prov.api_key, prov.api_secret,
      );
    } catch (e) {
      // Mark order as failed, release locked margin
      await svc.rpc('cancel_futures_order', {
        p_order_id: orderId,
        p_user_id:  userId,
        p_reason:   `binance_error: ${(e as Error).message}`,
      }).catch(() => {});

      if (e instanceof BinanceError) {
        const codeMap: Record<string, string> = {
          INSUFFICIENT_BALANCE: 'INSUFFICIENT_MARGIN',
          MIN_NOTIONAL:         'BELOW_MIN_NOTIONAL',
          INVALID_PRECISION:    'INVALID_PRECISION',
          INVALID_SYMBOL:       'INVALID_SYMBOL',
          RATE_LIMITED:         'RATE_LIMITED',
        };
        return err(400, codeMap[e.internalCode] ?? 'BINANCE_ERROR', e.message);
      }
      return err(500, 'ORDER_SUBMIT_FAILED', (e as Error).message);
    }

    const providerOrderId = String(binanceResp.orderId);
    const fillPrice  = parseFloat(binanceResp.avgPrice || String(roundedPrice));
    const filledQty  = parseFloat(binanceResp.executedQty || '0');
    const feeRate    = side === 'long' ? p.taker_fee : p.taker_fee;
    const fee        = filledQty * fillPrice * feeRate;

    // ── 13. Update order to submitted ─────────────────────────────────────────
    await svc.from('orders').update({
      status_v2:        'open',
      provider_order_id: providerOrderId,
      updated_at:       new Date().toISOString(),
    }).eq('id', orderId);

    // ── 14. Settle fill if market order (instant fill) ────────────────────────
    let positionId: string | null = null;
    if ((orderType === 'market' || binanceResp.status === 'FILLED') && filledQty > 0) {
      const { data: posId, error: settleErr } = await svc.rpc('settle_futures_fill', {
        p_order_id:          orderId,
        p_user_id:           userId,
        p_fill_qty:          filledQty,
        p_fill_price:        fillPrice,
        p_fee:               fee,
        p_provider_order_id: providerOrderId,
        p_provider_fill_id:  `${providerOrderId}_fill`,
        p_position_side:     side,
      });
      if (settleErr) {
        console.error('[futures-order-place] settle_futures_fill error:', settleErr.message);
      } else {
        positionId = posId;
      }
    }

    return ok({
      orderId,
      positionId,
      providerOrderId,
      status: binanceResp.status,
      filledQty,
      fillPrice: fillPrice > 0 ? fillPrice : null,
      fee,
    });

  } catch (e) {
    console.error('[futures-order-place] unhandled:', e);
    return err(500, 'INTERNAL_ERROR', (e as Error).message);
  }
});
