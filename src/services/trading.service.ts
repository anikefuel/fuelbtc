// TradingService v2 — full order lifecycle + market data + positions
// All balance mutations go through DB RPCs (never direct UPDATE from client)

import { supabase } from '@/client/supabase';
import { invokeEdgeFunction } from '@/lib/errors';
import { getProvider, cachedFetch, INTERVAL_MAP } from './trading.provider';
import { RiskEngine } from './risk.engine';
import type { ProviderCandle, ProviderOrderBook, ProviderTrade, ProviderFundingRate } from './trading.provider';

// ─── Types ────────────────────────────────────────────────────────────────────
export type OrderSide        = 'buy' | 'sell';
export type OrderTypeV2      = 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'take_profit_market' | 'take_profit_limit' | 'stop_loss' | 'oco' | 'trailing_stop';
export type OrderStatusV2    = 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'triggered' | 'failed';
export type MarketTypeV2     = 'spot' | 'futures' | 'margin';
export type PositionSideV2   = 'long' | 'short';
export type MarginModeV2     = 'cross' | 'isolated';

export interface TradingPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  marketType: MarketTypeV2;
  status: string;
  minQty: number;
  maxQty: number;
  stepSize: number;
  minNotional: number;
  tickSize: number;
  makerFee: number;
  takerFee: number;
  maxLeverage: number;
  pricePrecision: number;
  qtyPrecision: number;
  isFuturesOk: boolean;
  providerSymbol: string;
  sortOrder: number;
}

export interface OrderRecord {
  id: string;
  userId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: OrderSide;
  orderType: OrderTypeV2;
  marketType: MarketTypeV2;
  status: OrderStatusV2;
  price?: number;
  stopPrice?: number;
  quantity: number;
  filledQty: number;
  remainingQty: number;
  avgFillPrice?: number;
  fee: number;
  feeAsset?: string;
  leverage: number;
  marginMode: MarginModeV2;
  reduceOnly: boolean;
  tpPrice?: number;
  slPrice?: number;
  lockedAmount: number;
  providerOrderId?: string;
  providerName: string;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PositionRecord {
  id: string;
  userId: string;
  symbol: string;
  side: PositionSideV2;
  status: string;
  marginMode: MarginModeV2;
  leverage: number;
  entryPrice: number;
  markPrice?: number;
  liqPrice?: number;
  size: number;
  notional: number;
  initialMargin: number;
  maintMargin: number;
  marginRatio?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  cumFundingFee: number;
  tpPrice?: number;
  slPrice?: number;
  openedAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface PlaceSpotOrderParams {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: OrderSide;
  orderType: OrderTypeV2;
  quantity?: number;        // base asset qty (omit when quoteOrderQty is used)
  quoteOrderQty?: number;   // for market-buy by quote amount
  price?: number;
  stopPrice?: number;
  tif?: string;
  idempotencyKey: string;   // required — prevents double-submission
}

export interface SpotPlaceResult {
  orderId: string;
  providerOrderId: string | null;
  status: string;
  duplicate?: boolean;
}

export interface TradeFill {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  fillQty: number;
  fillPrice: number;
  fee: number;
  feeAsset: string;
  isMaker: boolean;
  providerFillId: string;
  createdAt: string;
}

export interface PlaceFuturesOrderParams {
  symbol:       string;
  side:         PositionSideV2;
  size:         number;
  entryPrice:   number;
  leverage:     number;
  marginMode?:  MarginModeV2;
  orderType?:   'market' | 'limit' | 'stop_market' | 'take_profit_market';
  tpPrice?:     number;
  slPrice?:     number;
  idempotencyKey?: string;
  reduceOnly?:  boolean;
}

export interface PlaceFuturesOrderResult {
  orderId:        string;
  positionId:     string | null;
  providerOrderId: string;
  status:         string;
  filledQty:      number;
  fillPrice:      number | null;
  fee:            number;
}

export interface FundingHistoryRecord {
  id:          string;
  positionId?: string;
  symbol:      string;
  side:        string;
  size:        number;
  markPrice:   number;
  fundingRate: number;
  feeAmount:   number;
  periodTs:    string;
  createdAt:   string;
}

export interface MarketTicker {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  fundingRate?: number;
  nextFundingTime?: number;
  markPrice?: number;
}

// ─── Helper: map DB row → OrderRecord ─────────────────────────────────────────
function mapOrder(r: Record<string, unknown>): OrderRecord {
  return {
    id:              r.id as string,
    userId:          r.user_id as string,
    symbol:          r.symbol as string,
    baseAsset:       (r.base_asset ?? '') as string,
    quoteAsset:      (r.quote_asset ?? '') as string,
    side:            r.side as OrderSide,
    orderType:       ((r.order_type_v2 ?? r.order_type) ?? 'market') as OrderTypeV2,
    marketType:      ((r.market_type_v2 ?? r.market_type) ?? 'spot') as MarketTypeV2,
    status:          ((r.status_v2 ?? r.status) ?? 'open') as OrderStatusV2,
    price:           r.price ? Number(r.price) : undefined,
    stopPrice:       r.stop_price ? Number(r.stop_price) : undefined,
    quantity:        Number(r.quantity),
    filledQty:       Number(r.filled_qty ?? 0),
    remainingQty:    Number(r.remaining_qty ?? (Number(r.quantity) - Number(r.filled_qty ?? 0))),
    avgFillPrice:    r.avg_fill_price ? Number(r.avg_fill_price) : undefined,
    fee:             Number(r.fee ?? 0),
    feeAsset:        r.fee_asset as string | undefined,
    leverage:        Number(r.leverage_v2 ?? r.leverage ?? 1),
    marginMode:      (r.margin_mode ?? 'cross') as MarginModeV2,
    reduceOnly:      Boolean(r.reduce_only),
    tpPrice:         r.tp_price ? Number(r.tp_price) : undefined,
    slPrice:         r.sl_price ? Number(r.sl_price) : undefined,
    lockedAmount:    Number(r.locked_amount ?? 0),
    providerOrderId: r.provider_order_id as string | undefined,
    providerName:    (r.provider_name ?? 'internal') as string,
    rejectReason:    r.reject_reason as string | undefined,
    createdAt:       r.created_at as string,
    updatedAt:       r.updated_at as string,
  };
}

function mapPosition(r: Record<string, unknown>): PositionRecord {
  return {
    id:            r.id as string,
    userId:        r.user_id as string,
    symbol:        r.symbol as string,
    side:          r.side as PositionSideV2,
    status:        r.status as string,
    marginMode:    (r.margin_mode ?? 'cross') as MarginModeV2,
    leverage:      Number(r.leverage ?? 10),
    entryPrice:    Number(r.entry_price),
    markPrice:     r.mark_price ? Number(r.mark_price) : undefined,
    liqPrice:      r.liq_price ? Number(r.liq_price) : undefined,
    size:          Number(r.size),
    notional:      Number(r.notional),
    initialMargin: Number(r.initial_margin),
    maintMargin:   Number(r.maint_margin ?? 0),
    marginRatio:   r.margin_ratio ? Number(r.margin_ratio) : undefined,
    unrealizedPnl: Number(r.unrealized_pnl ?? 0),
    realizedPnl:   Number(r.realized_pnl ?? 0),
    cumFundingFee: Number(r.cum_funding_fee ?? 0),
    tpPrice:       r.tp_price ? Number(r.tp_price) : undefined,
    slPrice:       r.sl_price ? Number(r.sl_price) : undefined,
    openedAt:      r.opened_at as string,
    updatedAt:     r.updated_at as string,
    closedAt:      r.closed_at as string | undefined,
  };
}

function mapPair(r: Record<string, unknown>): TradingPair {
  return {
    symbol:         r.symbol as string,
    baseAsset:      r.base_asset as string,
    quoteAsset:     r.quote_asset as string,
    marketType:     ((r.market_type_v2 ?? r.market_type) ?? 'spot') as MarketTypeV2,
    status:         ((r.status_v2 ?? 'active') as string),
    minQty:         Number(r.min_qty),
    maxQty:         Number(r.max_qty ?? 9999999),
    stepSize:       Number(r.step_size),
    minNotional:    Number(r.min_notional ?? 5),
    tickSize:       Number(r.tick_size),
    makerFee:       Number(r.maker_fee),
    takerFee:       Number(r.taker_fee),
    maxLeverage:    Number(r.max_leverage ?? 1),
    pricePrecision: Number(r.price_precision ?? 2),
    qtyPrecision:   Number(r.qty_precision ?? 5),
    isFuturesOk:    Boolean(r.is_futures_ok),
    providerSymbol: (r.provider_symbol ?? r.symbol) as string,
    sortOrder:      Number(r.sort_order ?? 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADING PAIRS
// ═══════════════════════════════════════════════════════════════════════════════
export async function getSpotPairs(): Promise<TradingPair[]> {
  return cachedFetch('spot_pairs', 60_000, async () => {
    const { data, error } = await supabase
      .from('trading_pairs')
      .select('*')
      .eq('market_type_v2', 'spot')
      .eq('status_v2', 'active')
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(r => mapPair(r as Record<string, unknown>));
  });
}

export async function getFuturesPairs(): Promise<TradingPair[]> {
  return cachedFetch('futures_pairs', 60_000, async () => {
    const { data, error } = await supabase
      .from('trading_pairs')
      .select('*')
      .eq('market_type_v2', 'futures')
      .eq('status_v2', 'active')
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(r => mapPair(r as Record<string, unknown>));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET DATA (via provider with local cache fallback)
// ═══════════════════════════════════════════════════════════════════════════════
export async function getTicker(symbol: string, providerSymbol?: string): Promise<MarketTicker> {
  const pSym = providerSymbol ?? symbol.replace('_PERP','');
  return cachedFetch(`ticker_${symbol}`, 3_000, async () => {
    try {
      const t = await getProvider().getTicker(pSym);
      return { symbol, price: t.price, priceChange: t.priceChange, priceChangePct: t.priceChangePct,
               high24h: t.high24h, low24h: t.low24h, volume24h: t.volume24h, quoteVolume24h: t.quoteVolume24h };
    } catch {
      // Fallback to DB cache
      const { data } = await supabase.from('market_data_cache').select('*').eq('symbol', symbol).single();
      if (!data) throw new Error(`No ticker for ${symbol}`);
      const d = data as Record<string, unknown>;
      return {
        symbol, price: Number(d.price), priceChange: Number(d.price_change),
        priceChangePct: Number(d.price_change_pct), high24h: Number(d.high_24h),
        low24h: Number(d.low_24h), volume24h: Number(d.volume_24h), quoteVolume24h: Number(d.quote_volume_24h),
      };
    }
  });
}

export async function getOrderBook(symbol: string, providerSymbol?: string, limit = 20): Promise<ProviderOrderBook> {
  const pSym = providerSymbol ?? symbol.replace('_PERP','');
  return cachedFetch(`ob_${symbol}_${limit}`, 1_500, () => getProvider().getOrderBook(pSym, limit));
}

export async function getRecentTrades(symbol: string, providerSymbol?: string, limit = 50): Promise<ProviderTrade[]> {
  const pSym = providerSymbol ?? symbol.replace('_PERP','');
  return cachedFetch(`trades_${symbol}`, 2_000, () => getProvider().getRecentTrades(pSym, limit));
}

export async function getCandles(symbol: string, interval: string, limit = 100, providerSymbol?: string): Promise<ProviderCandle[]> {
  const pSym = providerSymbol ?? symbol.replace('_PERP','');
  const iv   = INTERVAL_MAP[interval] ?? '1h';
  return cachedFetch(`candles_${symbol}_${iv}`, 10_000, () => getProvider().getCandles(pSym, iv, limit));
}

export async function getFundingRate(symbol: string): Promise<ProviderFundingRate> {
  return cachedFetch(`fr_${symbol}`, 30_000, () => getProvider().getFundingRate(symbol));
}

export async function getMarkPrice(symbol: string): Promise<{ markPrice: number; indexPrice: number }> {
  return cachedFetch(`mp_${symbol}`, 3_000, () => getProvider().getMarkPrice(symbol));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPOT ORDERS — all signed Binance calls routed via Edge Functions
// ═══════════════════════════════════════════════════════════════════════════════
export async function placeSpotOrder(params: PlaceSpotOrderParams): Promise<SpotPlaceResult> {
  const res = await invokeEdgeFunction<{
    ok: boolean; code?: string; message?: string; orderId?: string;
    providerOrderId?: string; status?: string; duplicate?: boolean;
  }>('spot-order-place', {
    symbol:         params.symbol,
    side:           params.side,
    orderType:      params.orderType,
    quantity:       (params.quantity ?? 0) > 0 ? params.quantity : undefined,
    quoteOrderQty:  params.quoteOrderQty,
    price:          params.price,
    stopPrice:      params.stopPrice,
    idempotencyKey: params.idempotencyKey,
  });
  return {
    orderId:         res.orderId!,
    providerOrderId: res.providerOrderId ?? null,
    status:          res.status ?? 'open',
    duplicate:       res.duplicate ?? false,
  };
}

export async function cancelOrder(orderId: string): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean; code?: string; message?: string }>('spot-order-cancel', { orderId });
}

/** Fetch individual trade fills for a user (trade history) */
export async function getTradeFills(params?: { symbol?: string; orderId?: string; limit?: number }): Promise<TradeFill[]> {
  let q = supabase
    .from('order_fills')
    .select('id,order_id,symbol,side,fill_qty,fill_price,fee,fee_asset,is_maker,provider_fill_id,created_at')
    .order('created_at', { ascending: false })
    .limit(params?.limit ?? 50);
  if (params?.symbol)  q = q.eq('symbol', params.symbol);
  if (params?.orderId) q = q.eq('order_id', params.orderId);
  const { data, error } = await q;
  if (error) {
    // order_fills table may not exist yet — fall back to order_audit_logs
    const { data: fallback } = await supabase
      .from('order_audit_logs')
      .select('id,order_id,fill_qty,fill_price,provider_fill_id,created_at,new_status')
      .in('event_type', ['fill','partial_fill'])
      .order('created_at', { ascending: false })
      .limit(params?.limit ?? 50);
    return (fallback ?? []).map(r => ({
      id:             r.id as string,
      orderId:        r.order_id as string,
      symbol:         params?.symbol ?? '',
      side:           'buy' as OrderSide,
      fillQty:        Number(r.fill_qty ?? 0),
      fillPrice:      Number(r.fill_price ?? 0),
      fee:            0,
      feeAsset:       'USDT',
      isMaker:        false,
      providerFillId: r.provider_fill_id as string ?? '',
      createdAt:      r.created_at as string,
    }));
  }
  return (data ?? []).map(r => ({
    id:             r.id as string,
    orderId:        r.order_id as string,
    symbol:         r.symbol as string,
    side:           r.side as OrderSide,
    fillQty:        Number(r.fill_qty),
    fillPrice:      Number(r.fill_price),
    fee:            Number(r.fee ?? 0),
    feeAsset:       r.fee_asset as string ?? 'USDT',
    isMaker:        Boolean(r.is_maker),
    providerFillId: r.provider_fill_id as string ?? '',
    createdAt:      r.created_at as string,
  }));
}

/** Admin: trigger order sync (poll Binance fills for all open orders) */
export async function triggerOrderSync(): Promise<{ checked: number; fills_settled: number; errors: string[] }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  const { data, error } = await supabase.functions.invoke('spot-order-sync', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) throw new Error(error.message);
  return data as { checked: number; fills_settled: number; errors: string[] };
}

export async function getOpenOrders(symbol?: string): Promise<OrderRecord[]> {
  let q = supabase.from('orders').select('*')
    .in('status', ['pending','open','partially_filled'])
    .order('created_at', { ascending: false });
  if (symbol) q = q.eq('symbol', symbol);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapOrder(r as Record<string, unknown>));
}

export async function getOrderHistory(params?: { symbol?: string; marketType?: MarketTypeV2; limit?: number }): Promise<OrderRecord[]> {
  let q = supabase.from('orders').select('*')
    .order('created_at', { ascending: false })
    .limit(params?.limit ?? 50);
  if (params?.symbol)     q = q.eq('symbol', params.symbol);
  if (params?.marketType) q = q.eq('market_type_v2', params.marketType);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapOrder(r as Record<string, unknown>));
}

export async function getOrderById(orderId: string): Promise<OrderRecord | null> {
  const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (error || !data) return null;
  return mapOrder(data as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUTURES POSITIONS — All ops route through Edge Functions (never direct RPC)
// ═══════════════════════════════════════════════════════════════════════════════

/** Place a futures order via futures-order-place Edge Function */
export async function openFuturesPosition(params: PlaceFuturesOrderParams): Promise<PlaceFuturesOrderResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const idempotencyKey = params.idempotencyKey ?? `fo_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
  const body = {
    symbol:          params.symbol,
    side:            params.side,
    orderType:       params.orderType ?? 'market',
    size:            params.size,
    price:           params.entryPrice,
    leverage:        params.leverage,
    marginMode:      params.marginMode ?? 'cross',
    tpPrice:         params.tpPrice,
    slPrice:         params.slPrice,
    idempotencyKey,
    reduceOnly:      params.reduceOnly ?? false,
  };

  const { data, error } = await supabase.functions.invoke<PlaceFuturesOrderResult>('futures-order-place', { body });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No response from futures-order-place');
  return data;
}

/** Close a futures position (full or partial) via futures-position-close Edge Function */
export async function closeFuturesPosition(
  positionId: string,
  _closePrice: number,
  closeSize?: number,
): Promise<number> {
  const idempotencyKey = `fc_${positionId.slice(0,8)}_${Date.now()}`;
  const { data, error } = await supabase.functions.invoke<{ realizedPnl: number }>('futures-position-close', {
    body: { positionId, closeSize, idempotencyKey, orderType: 'market' },
  });
  if (error) throw new Error(error.message);
  return data?.realizedPnl ?? 0;
}

/** Cancel an open futures order via futures-order-cancel Edge Function */
export async function cancelFuturesOrder(orderId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('futures-order-cancel', { body: { orderId } });
  if (error) throw new Error(error.message);
}

/** Transfer USDT between spot ↔ futures wallets via futures-transfer Edge Function */
export async function transferFuturesMargin(
  direction: 'spot_to_futures' | 'futures_to_spot',
  amount: number,
): Promise<{ spotBalance: { available: number }; futuresBalance: { available: number } }> {
  const { data, error } = await supabase.functions.invoke<{
    spotBalance: { available: number }; futuresBalance: { available: number };
  }>('futures-transfer', { body: { direction, amount, asset: 'USDT' } });
  if (error) throw new Error(error.message);
  return data ?? { spotBalance: { available: 0 }, futuresBalance: { available: 0 } };
}

/** Add margin to an isolated position via add_futures_margin RPC */
export async function addFuturesMargin(positionId: string, amount: number): Promise<void> {
  const { error } = await supabase.rpc('add_futures_margin', {
    p_position_id: positionId,
    p_amount:      amount,
  });
  if (error) throw new Error(error.message);
}

/** Reduce margin from an isolated position via reduce_futures_margin RPC */
export async function reduceFuturesMargin(positionId: string, amount: number): Promise<void> {
  const { error } = await supabase.rpc('reduce_futures_margin', {
    p_position_id: positionId,
    p_amount:      amount,
  });
  if (error) throw new Error(error.message);
}

/** Get all open futures positions for the current user */
export async function getOpenPositions(): Promise<PositionRecord[]> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('status', 'open')
    .order('opened_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapPosition(r as Record<string, unknown>));
}

/** Get open futures orders (pending / partially filled) */
export async function getOpenFuturesOrders(): Promise<OrderRecord[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', user.id)
    .eq('market_type_v2', 'futures')
    .in('status_v2', ['pending', 'open', 'partially_filled'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapOrder(r as Record<string, unknown>));
}

/** Get futures order history */
export async function getFuturesOrderHistory(limit = 50): Promise<OrderRecord[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', user.id)
    .eq('market_type_v2', 'futures')
    .in('status_v2', ['filled', 'cancelled', 'rejected', 'expired'])
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapOrder(r as Record<string, unknown>));
}

/** Get funding fee history for the current user */
export async function getFundingHistory(limit = 50): Promise<FundingHistoryRecord[]> {
  const { data, error } = await supabase
    .from('futures_funding_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => {
    const d = r as Record<string, unknown>;
    return {
      id:          d.id as string,
      positionId:  d.position_id as string | undefined,
      symbol:      d.symbol as string,
      side:        d.side as string,
      size:        Number(d.size),
      markPrice:   Number(d.mark_price),
      fundingRate: Number(d.funding_rate),
      feeAmount:   Number(d.fee_amount),
      periodTs:    d.period_ts as string,
      createdAt:   d.created_at as string,
    };
  });
}

export async function getPositionHistory(limit = 50): Promise<PositionRecord[]> {
  const { data, error } = await supabase
    .from('position_history')
    .select('*')
    .order('closed_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapPosition({
    ...r as Record<string, unknown>,
    status:        'closed',
    updated_at:    (r as Record<string, unknown>).closed_at,
    initial_margin: 0, maint_margin: 0, unrealized_pnl: 0, cum_funding_fee: 0,
  }));
}

/** Update mark price and recalculate PnL/margin ratio for open position */
export async function refreshPositionRisk(positionId: string, markPrice: number): Promise<void> {
  const { data: pos } = await supabase.from('positions').select('*').eq('id', positionId).single();
  if (!pos) return;
  const p    = mapPosition(pos as Record<string, unknown>);
  const risk = RiskEngine.assessRisk({
    side: p.side, size: p.size, entryPrice: p.entryPrice, markPrice,
    initialMargin: p.initialMargin, leverage: p.leverage,
    maintMarginRate: 0.005, cumFundingFee: p.cumFundingFee,
  });
  await supabase.from('positions').update({
    mark_price:     markPrice,
    unrealized_pnl: risk.unrealizedPnl,
    margin_ratio:   risk.marginRatio,
    liq_price:      risk.liqPrice,
    updated_at:     new Date().toISOString(),
  }).eq('id', positionId);
}

/** Get/set margin account preference for futures pair */
export async function getMarginAccount(symbol: string): Promise<{ leverage: number; marginMode: MarginModeV2 }> {
  const { data } = await supabase.from('margin_accounts').select('*').eq('symbol', symbol).single();
  if (!data) return { leverage: 10, marginMode: 'cross' };
  const d = data as Record<string, unknown>;
  return { leverage: Number(d.leverage ?? 10), marginMode: (d.margin_mode ?? 'cross') as MarginModeV2 };
}

export async function setMarginAccount(symbol: string, leverage: number, marginMode: MarginModeV2): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  await supabase.from('margin_accounts').upsert({
    user_id: user.id, symbol, leverage, margin_mode: marginMode, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,symbol' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WALLET BALANCE for trading
// ═══════════════════════════════════════════════════════════════════════════════
export async function getTradingBalance(asset: string, walletType: 'spot' | 'futures' = 'spot'): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data } = await supabase
    .from('wallets')
    .select('balance, locked_balance, escrow_balance, pending_withdraw')
    .eq('user_id', user.id)
    .eq('asset', asset)
    .eq('wallet_type', walletType)
    .single();
  if (!data) return 0;
  const r = data as Record<string, unknown>;
  const balance   = Number(r.balance        ?? 0);
  const locked    = Number(r.locked_balance  ?? 0);
  const escrow    = Number(r.escrow_balance  ?? 0);
  const pendingWd = Number(r.pending_withdraw ?? 0);
  return Math.max(0, balance - locked - escrow - pendingWd);
}

export async function ensureFuturesWallet(): Promise<void> {
  await supabase.rpc('get_or_create_futures_wallet', { p_asset: 'USDT' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEVERAGE BRACKETS
// ═══════════════════════════════════════════════════════════════════════════════
export async function getLeverageBrackets(symbol: string) {
  return cachedFetch(`brackets_${symbol}`, 300_000, async () => {
    const { data } = await supabase
      .from('leverage_brackets')
      .select('*')
      .eq('symbol', symbol)
      .order('bracket', { ascending: true });
    return (data ?? []).map(r => {
      const d = r as Record<string, unknown>;
      return {
        bracket: Number(d.bracket),
        initialLeverage: Number(d.initial_leverage),
        notionalCap: Number(d.notional_cap),
        notionalFloor: Number(d.notional_floor),
        maintMarginRate: Number(d.maint_margin_rate),
      };
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADING SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
export async function getSetting(key: string): Promise<unknown> {
  const { data } = await supabase.from('trading_settings').select('value').eq('key', key).single();
  return data ? (data as Record<string, unknown>).value : null;
}

export async function isTradingEnabled(marketType: 'spot' | 'futures' = 'spot'): Promise<boolean> {
  const [global, specific] = await Promise.all([
    getSetting('maintenance_mode'),
    getSetting(`${marketType}_trading_enabled`),
  ]);
  return global !== true && specific !== false;
}
