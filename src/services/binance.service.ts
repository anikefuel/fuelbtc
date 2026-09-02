// Binance API Integration Service
// Purpose: Market data, prices, order book. NEVER used for internal user balances.
// All user balances live exclusively in ExchangeX ledger_accounts table.

import { fetch } from 'expo/fetch';

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com/fapi/v1';

// Binance API is accessed through our Edge Function proxy to avoid
// exposing API keys on the client. Public endpoints (prices, ticker,
// order book) are safe to call directly from the client.
// Signed/private endpoints (actual order execution) MUST go through Edge Functions.

export interface BinanceTicker {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  openTime: number;
  closeTime: number;
}

export interface BinanceOrderBookEntry {
  price: number;
  quantity: number;
}

export interface BinanceOrderBook {
  symbol: string;
  bids: BinanceOrderBookEntry[];
  asks: BinanceOrderBookEntry[];
  lastUpdateId: number;
}

export interface BinanceKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

// ─── Price Data ───────────────────────────────────────────────────────────────

/** Get current price for a single symbol */
export async function getPrice(symbol: string): Promise<number> {
  const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${symbol.toUpperCase()}`);
  if (!res.ok) throw new Error(`Binance price fetch failed: ${res.status}`);
  const data = await res.json() as { price: string };
  return parseFloat(data.price);
}

/** Get prices for multiple symbols in one call */
export async function getPrices(symbols: string[]): Promise<Record<string, number>> {
  const symbolsParam = JSON.stringify(symbols.map(s => s.toUpperCase()));
  const res = await fetch(`${BINANCE_BASE}/ticker/price?symbols=${encodeURIComponent(symbolsParam)}`);
  if (!res.ok) throw new Error(`Binance prices fetch failed: ${res.status}`);
  const data = await res.json() as { symbol: string; price: string }[];
  const result: Record<string, number> = {};
  for (const item of data) {
    result[item.symbol] = parseFloat(item.price);
  }
  return result;
}

/** Get 24h ticker stats for a symbol */
export async function get24hTicker(symbol: string): Promise<BinanceTicker> {
  const res = await fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${symbol.toUpperCase()}`);
  if (!res.ok) throw new Error(`Binance ticker fetch failed: ${res.status}`);
  const d = await res.json() as Record<string, string | number>;
  return {
    symbol: d.symbol as string,
    price: parseFloat(d.lastPrice as string),
    priceChange: parseFloat(d.priceChange as string),
    priceChangePercent: parseFloat(d.priceChangePercent as string),
    highPrice: parseFloat(d.highPrice as string),
    lowPrice: parseFloat(d.lowPrice as string),
    volume: parseFloat(d.volume as string),
    quoteVolume: parseFloat(d.quoteVolume as string),
    openTime: d.openTime as number,
    closeTime: d.closeTime as number,
  };
}

/** Get 24h tickers for all or filtered symbols */
export async function getAllTickers(symbols?: string[]): Promise<BinanceTicker[]> {
  let url = `${BINANCE_BASE}/ticker/24hr`;
  if (symbols && symbols.length > 0) {
    url += `?symbols=${encodeURIComponent(JSON.stringify(symbols.map(s => s.toUpperCase())))}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance tickers fetch failed: ${res.status}`);
  const data = await res.json() as Record<string, string | number>[];
  return data.map(d => ({
    symbol: d.symbol as string,
    price: parseFloat(d.lastPrice as string),
    priceChange: parseFloat(d.priceChange as string),
    priceChangePercent: parseFloat(d.priceChangePercent as string),
    highPrice: parseFloat(d.highPrice as string),
    lowPrice: parseFloat(d.lowPrice as string),
    volume: parseFloat(d.volume as string),
    quoteVolume: parseFloat(d.quoteVolume as string),
    openTime: d.openTime as number,
    closeTime: d.closeTime as number,
  }));
}

// ─── Order Book ───────────────────────────────────────────────────────────────

/** Get order book depth — used for price discovery, NOT for crediting balances */
export async function getOrderBook(symbol: string, limit: 5 | 10 | 20 | 50 | 100 = 20): Promise<BinanceOrderBook> {
  const res = await fetch(`${BINANCE_BASE}/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance order book fetch failed: ${res.status}`);
  const d = await res.json() as { lastUpdateId: number; bids: string[][]; asks: string[][] };
  return {
    symbol: symbol.toUpperCase(),
    lastUpdateId: d.lastUpdateId,
    bids: d.bids.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
    asks: d.asks.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
  };
}

/** Get best bid/ask spread */
export async function getBestPrice(symbol: string): Promise<{ bid: number; ask: number; spread: number }> {
  const res = await fetch(`${BINANCE_BASE}/ticker/bookTicker?symbol=${symbol.toUpperCase()}`);
  if (!res.ok) throw new Error(`Binance book ticker failed: ${res.status}`);
  const d = await res.json() as { bidPrice: string; askPrice: string };
  const bid = parseFloat(d.bidPrice);
  const ask = parseFloat(d.askPrice);
  return { bid, ask, spread: ask - bid };
}

// ─── Candlestick / Kline Data ────────────────────────────────────────────────

export type KlineInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/** Get kline (candlestick) data for charting */
export async function getKlines(symbol: string, interval: KlineInterval = '1h', limit = 100): Promise<BinanceKline[]> {
  const res = await fetch(
    `${BINANCE_BASE}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`Binance klines fetch failed: ${res.status}`);
  const data = await res.json() as unknown[][];
  return data.map(k => ({
    openTime: k[0] as number,
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
    closeTime: k[6] as number,
  }));
}

/** Get sparkline data (last N close prices) for a symbol */
export async function getSparkline(symbol: string, points = 20): Promise<number[]> {
  const klines = await getKlines(symbol, '1h', points);
  return klines.map(k => k.close);
}

// ─── Exchange Info ────────────────────────────────────────────────────────────

export interface BinanceSymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  minQty: number;
  maxQty: number;
  stepSize: number;
  minNotional: number;
}

/** Get trading rules for a symbol */
export async function getSymbolInfo(symbol: string): Promise<BinanceSymbolInfo | null> {
  const res = await fetch(`${BINANCE_BASE}/exchangeInfo?symbol=${symbol.toUpperCase()}`);
  if (!res.ok) return null;
  const data = await res.json() as { symbols: Record<string, unknown>[] };
  const s = data.symbols[0];
  if (!s) return null;

  const filters = (s.filters as Record<string, unknown>[]) ?? [];
  const lotFilter = filters.find(f => f.filterType === 'LOT_SIZE') as Record<string, string> | undefined;
  const notionalFilter = filters.find(f => f.filterType === 'MIN_NOTIONAL') as Record<string, string> | undefined;

  return {
    symbol: s.symbol as string,
    baseAsset: s.baseAsset as string,
    quoteAsset: s.quoteAsset as string,
    status: s.status as string,
    minQty: parseFloat(lotFilter?.minQty ?? '0.00001'),
    maxQty: parseFloat(lotFilter?.maxQty ?? '9000000'),
    stepSize: parseFloat(lotFilter?.stepSize ?? '0.00001'),
    minNotional: parseFloat(notionalFilter?.minNotional ?? '10'),
  };
}

// ─── Price Estimation for Internal Orders ────────────────────────────────────
// Used to calculate order total before placing. Actual fill price comes back
// from the executed trade record. NEVER used to credit user balances directly.

/** Estimate buy cost: how much USDT needed to buy `qty` of base asset */
export async function estimateBuyCost(symbol: string, quantity: number): Promise<{ estimatedPrice: number; estimatedCost: number; fee: number }> {
  const { ask } = await getBestPrice(symbol);
  const estimatedCost = ask * quantity;
  const fee = estimatedCost * 0.001; // 0.1% taker fee
  return { estimatedPrice: ask, estimatedCost, fee };
}

/** Estimate sell proceeds: how much USDT received for selling `qty` of base */
export async function estimateSellProceeds(symbol: string, quantity: number): Promise<{ estimatedPrice: number; estimatedProceeds: number; fee: number }> {
  const { bid } = await getBestPrice(symbol);
  const estimatedProceeds = bid * quantity;
  const fee = estimatedProceeds * 0.001;
  return { estimatedPrice: bid, estimatedProceeds, fee };
}

// ─── Market Cap / Asset List ─────────────────────────────────────────────────

/** Supported ExchangeX trading pairs mapped to Binance symbols */
export const EXCHANGE_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT',
  'XRPUSDT', 'TRXUSDT', 'USDCUSDT',
] as const;

export type ExchangePair = typeof EXCHANGE_PAIRS[number];
