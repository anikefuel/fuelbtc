// spot-order-place Edge Function
// Flow:
//   1. Authenticate user from Bearer JWT
//   2. Validate request body server-side
//   3. Check pair is enabled + spot trading not paused
//   4. Call place_spot_order RPC (locks balance, creates internal order with status=pending)
//   5. Submit order to Binance (signed REST call via provider credentials)
//   6. On success: call submit_spot_order_provider RPC (status=open, records provider_order_id)
//   7. On Binance failure: call fail_spot_order RPC (release lock, status=failed)
//   8. Return { orderId, providerOrderId, status }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signedPost, spotBase, roundToStep, roundToTick, BinanceError } from '../_shared/binance-signer.ts';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!;

const serviceSupabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface PlaceOrderRequest {
  symbol:          string;
  side:            'buy' | 'sell';
  orderType:       'market' | 'limit' | 'stop_limit' | 'stop_market';
  quantity?:       number;   // base asset qty (required for sell + limit buy)
  quoteOrderQty?:  number;   // quote amount for market buy (alternative to quantity)
  price?:          number;   // required for limit
  stopPrice?:      number;   // for stop orders
  idempotencyKey:  string;   // client-generated UUID to prevent double submission
}

interface TradingPair {
  symbol: string; base_asset: string; quote_asset: string;
  binance_symbol: string; is_spot_ok: boolean; spot_paused: boolean;
  status_v2: string; min_qty: number; max_qty: number | null;
  min_notional: number; price_precision: number; qty_precision: number;
  tick_size: number | null; step_size: number | null;
  maker_fee: number; taker_fee: number;
}

interface ProviderConfig {
  id: string; api_key: string; api_secret: string; is_testnet: boolean;
}

interface BinanceOrderResponse {
  orderId: number; clientOrderId: string; symbol: string;
  status: string; executedQty: string; cummulativeQuoteQty: string;
  fills?: { price: string; qty: string; commission: string; commissionAsset: string; tradeId: number }[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsPrelight();
  }

  try {
    // ── 1. Authenticate user ──────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Missing authorization header');
    }

    const userSupabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth:   { persistSession: false },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Invalid or expired token');
    }
    const userId = user.id;

    // ── 2. Parse & validate request ───────────────────────────────────────────
    let body: PlaceOrderRequest;
    try { body = await req.json(); } catch {
      return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    const { symbol, side, orderType, quantity, quoteOrderQty, price, stopPrice, idempotencyKey } = body;

    if (!symbol || !side || !orderType || !idempotencyKey) {
      return errorResponse(400, 'MISSING_FIELDS', 'symbol, side, orderType, idempotencyKey are required');
    }
    if (!['buy','sell'].includes(side)) {
      return errorResponse(400, 'INVALID_SIDE', 'side must be buy or sell');
    }
    if (!['market','limit','stop_limit','stop_market'].includes(orderType)) {
      return errorResponse(400, 'INVALID_ORDER_TYPE', 'Unsupported order type');
    }
    if (orderType !== 'market' && !price) {
      return errorResponse(400, 'PRICE_REQUIRED', 'price is required for limit orders');
    }
    if (!quantity && !quoteOrderQty) {
      return errorResponse(400, 'QUANTITY_REQUIRED', 'quantity or quoteOrderQty required');
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 64) {
      return errorResponse(400, 'INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must be 8-64 characters');
    }

    // ── 3. Check global spot trading kill-switch ──────────────────────────────
    const { data: settingRow } = await serviceSupabase
      .from('trading_settings').select('value').eq('key', 'spot_trading_enabled').single();
    if (settingRow?.value === false || settingRow?.value === 'false') {
      return errorResponse(503, 'SPOT_PAUSED', 'Spot trading is temporarily paused');
    }

    // ── 4. Load & validate pair ───────────────────────────────────────────────
    const { data: pair, error: pairErr } = await serviceSupabase
      .from('trading_pairs')
      .select('symbol,base_asset,quote_asset,binance_symbol,is_spot_ok,spot_paused,status_v2,min_qty,max_qty,min_notional,price_precision,qty_precision,tick_size,step_size,maker_fee,taker_fee')
      .eq('symbol', symbol.toUpperCase())
      .single();

    if (pairErr || !pair) {
      return errorResponse(400, 'INVALID_SYMBOL', `Symbol ${symbol} not supported`);
    }
    const p = pair as TradingPair;
    if (!p.is_spot_ok || p.status_v2 !== 'active') {
      return errorResponse(400, 'PAIR_DISABLED', `Spot trading disabled for ${symbol}`);
    }
    if (p.spot_paused) {
      return errorResponse(503, 'PAIR_PAUSED', `${symbol} spot trading temporarily paused`);
    }

    // ── 5. Get market price for market buy lock estimation ────────────────────
    let marketPrice: number | null = null;
    if (orderType === 'market') {
      try {
        const tickerRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${p.binance_symbol}`);
        if (tickerRes.ok) {
          const td = await tickerRes.json() as { price: string };
          marketPrice = parseFloat(td.price);
        }
      } catch { /* non-fatal: RPC will handle insufficient balance */ }
    }

    // ── 6. Compute final quantity / price with precision snapping ─────────────
    let finalQty   = quantity ?? 0;
    let finalPrice = price ?? 0;

    if (p.step_size && finalQty > 0) {
      finalQty = roundToStep(finalQty, p.step_size);
    }
    if (p.tick_size && finalPrice > 0) {
      finalPrice = roundToTick(finalPrice, p.tick_size);
    }

    // Quantity / notional validation
    if (finalQty > 0) {
      if (finalQty < p.min_qty) {
        return errorResponse(400, 'MIN_QTY',
          `Quantity ${finalQty} below minimum ${p.min_qty} ${p.base_asset}`);
      }
      if (p.max_qty && finalQty > p.max_qty) {
        return errorResponse(400, 'MAX_QTY',
          `Quantity ${finalQty} above maximum ${p.max_qty} ${p.base_asset}`);
      }
    }

    const checkPrice = orderType === 'limit' ? finalPrice : (marketPrice ?? 0);
    if (checkPrice > 0 && finalQty > 0) {
      const notional = finalQty * checkPrice;
      if (notional < p.min_notional) {
        return errorResponse(400, 'MIN_NOTIONAL',
          `Order value $${notional.toFixed(2)} below minimum $${p.min_notional}`);
      }
    }

    // quoteOrderQty validation (market buy only)
    if (orderType === 'market' && side === 'buy' && quoteOrderQty) {
      if (quoteOrderQty < p.min_notional) {
        return errorResponse(400, 'MIN_NOTIONAL',
          `Quote amount $${quoteOrderQty.toFixed(2)} below minimum $${p.min_notional}`);
      }
    }

    // ── 7. Check duplicate idempotency key ────────────────────────────────────
    const { data: existingOrder } = await serviceSupabase
      .from('orders')
      .select('id, status_v2, provider_order_id')
      .eq('user_id', userId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingOrder) {
      // Return existing order (idempotent success)
      return successResponse({
        orderId: existingOrder.id,
        providerOrderId: existingOrder.provider_order_id,
        status: existingOrder.status_v2,
        duplicate: true,
      });
    }

    // ── 8. Lock balance + create internal order via RPC ───────────────────────
    // For market buy with quoteOrderQty: use spot_market_price_buffer
    const { data: bufferSetting } = await serviceSupabase
      .from('trading_settings').select('value').eq('key', 'spot_market_price_buffer').single();
    const buffer = parseFloat(String(bufferSetting?.value ?? 0.01));

    let lockQty    = finalQty;
    let lockPrice  = finalPrice;

    // For market buy by quote amount: estimate base qty
    if (orderType === 'market' && side === 'buy' && quoteOrderQty && marketPrice) {
      lockQty   = quoteOrderQty / (marketPrice * (1 + buffer));
      if (p.step_size) lockQty = roundToStep(lockQty, p.step_size);
      lockPrice = marketPrice * (1 + buffer);
    } else if (orderType === 'market' && side === 'buy' && marketPrice) {
      lockPrice = marketPrice * (1 + buffer);
    }

    const { data: orderId, error: rpcErr } = await userSupabase.rpc('place_spot_order', {
      p_symbol:     p.symbol,
      p_base_asset: p.base_asset,
      p_quote_asset: p.quote_asset,
      p_side:       side,
      p_order_type: orderType === 'stop_limit' ? 'stop_limit' : orderType,
      p_quantity:   lockQty,
      p_price:      lockPrice > 0 ? lockPrice : null,
      p_stop_price: stopPrice ?? null,
      p_tif:        'GTC',
      p_client_oid: idempotencyKey,
    });

    if (rpcErr || !orderId) {
      const msg = rpcErr?.message ?? 'Failed to create order';
      if (msg.includes('Insufficient')) {
        return errorResponse(400, 'INSUFFICIENT_BALANCE', msg);
      }
      return errorResponse(500, 'ORDER_CREATE_FAILED', msg);
    }

    // Store idempotency_key on order
    await serviceSupabase.from('orders')
      .update({ idempotency_key: idempotencyKey })
      .eq('id', orderId);

    // ── 9. Get provider credentials ───────────────────────────────────────────
    const { data: configs, error: cfgErr } = await serviceSupabase
      .from('exchange_provider_configs')
      .select('id,api_key,api_secret,is_testnet')
      .eq('provider_name', 'binance')
      .eq('is_active', true)
      .not('api_key', 'is', null)
      .not('api_secret', 'is', null)
      .limit(1);

    if (cfgErr || !configs || configs.length === 0) {
      await serviceSupabase.rpc('fail_spot_order', {
        p_order_id: orderId, p_user_id: userId,
        p_reason: 'No active Binance provider configuration',
      });
      return errorResponse(503, 'PROVIDER_UNAVAILABLE', 'Trading provider not configured');
    }

    const cfg = configs[0] as ProviderConfig;
    const base = spotBase(cfg.is_testnet);

    // ── 10. Build Binance order params ────────────────────────────────────────
    const binanceParams: Record<string, string | number | boolean> = {
      symbol:           p.binance_symbol,
      side:             side.toUpperCase(),
      newClientOrderId: idempotencyKey.slice(0, 36),
      newOrderRespType: 'FULL',
    };

    if (orderType === 'market') {
      binanceParams.type = 'MARKET';
      if (side === 'buy' && quoteOrderQty) {
        // quoteOrderQty must match quote asset precision (e.g. USDT = 2 decimals)
        const quoteStep = Math.pow(10, -(p.price_precision ?? 2));
        binanceParams.quoteOrderQty = roundToStep(quoteOrderQty, quoteStep);
      } else {
        binanceParams.quantity = finalQty;
      }
    } else if (orderType === 'limit') {
      binanceParams.type     = 'LIMIT';
      binanceParams.timeInForce = 'GTC';
      binanceParams.quantity = finalQty;
      binanceParams.price    = finalPrice.toFixed(p.price_precision);
    } else if (orderType === 'stop_limit') {
      binanceParams.type     = 'STOP_LOSS_LIMIT';
      binanceParams.timeInForce = 'GTC';
      binanceParams.quantity = finalQty;
      binanceParams.price    = finalPrice.toFixed(p.price_precision);
      binanceParams.stopPrice = stopPrice!.toFixed(p.price_precision);
    } else if (orderType === 'stop_market') {
      binanceParams.type     = 'STOP_LOSS';
      binanceParams.quantity = finalQty;
      binanceParams.stopPrice = stopPrice!.toFixed(p.price_precision);
    }

    // ── 11. Submit to Binance ─────────────────────────────────────────────────
    let binanceOrder: BinanceOrderResponse;
    try {
      binanceOrder = await signedPost<BinanceOrderResponse>(
        base, '/api/v3/order', binanceParams, cfg.api_key, cfg.api_secret,
      );
    } catch (err) {
      const be = err instanceof BinanceError ? err : null;
      const reason = be ? `${be.internalCode}: ${be.message}` : String(err);
      const internalCode = be?.internalCode ?? 'PROVIDER_ERROR';

      // Release lock, mark order failed
      await serviceSupabase.rpc('fail_spot_order', {
        p_order_id: orderId, p_user_id: userId, p_reason: reason,
      });

      // Return a structured provider error so the UI can display Binance details
      return errorResponse(400, internalCode, be?.message ?? String(err), {
        source: 'provider',
        provider: 'Binance',
        code: be?.binanceCode ?? internalCode,
      });
    }

    // ── 12. Record provider acceptance ───────────────────────────────────────
    await serviceSupabase.rpc('submit_spot_order_provider', {
      p_order_id:          orderId,
      p_user_id:           userId,
      p_provider_order_id: String(binanceOrder.orderId),
      p_provider_name:     'binance',
      p_provider_status:   binanceOrder.status,
      p_response:          binanceOrder,
    });

    // ── 13. If market order already filled, settle fills immediately ──────────
    let immediateStatus = 'open';
    if (binanceOrder.status === 'FILLED' && binanceOrder.fills?.length) {
      immediateStatus = 'filled';
      for (const fill of binanceOrder.fills) {
        await serviceSupabase.rpc('settle_binance_fill', {
          p_order_id:         orderId,
          p_provider_fill_id: String(fill.tradeId),
          p_fill_qty:         parseFloat(fill.qty),
          p_fill_price:       parseFloat(fill.price),
          p_fee:              parseFloat(fill.commission),
          p_fee_asset:        fill.commissionAsset,
          p_is_maker:         false,
        });
      }
    }

    return successResponse({
      orderId,
      providerOrderId: String(binanceOrder.orderId),
      status: immediateStatus,
      binanceStatus: binanceOrder.status,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[spot-order-place] fatal:', msg);
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function corsPrelight() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}
interface ErrorOptions {
  source?: 'exchange' | 'edge_function' | 'provider' | 'network' | 'unknown';
  provider?: string;
  code?: string | number;
}

function errorResponse(status: number, code: string, message: string, opts?: ErrorOptions) {
  const body: Record<string, unknown> = { ok: false, code, message };
  // Default source by status family: 4xx = ExchangeX validation, 5xx = Edge Function/internal
  body.source = opts?.source ?? (status >= 500 ? 'edge_function' : 'exchange');
  if (opts?.provider) body.provider = opts.provider;
  if (opts?.code !== undefined) body.code = opts.code;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
function successResponse(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
