// Market data API module
// All market data flows through here — never call providers directly from screens

import type { MarketCoin, OrderBook, Trade, Candle, ApiResponse } from '@/types';
import { getMarketDataFromProviders } from './providers';
import { apiCache, buildApiError } from './client';
import { CACHE_TTL } from '@/constants/config';

// ─── Market list ──────────────────────────────────────────────────────────────
export async function fetchMarkets(symbols?: string[]): Promise<ApiResponse<MarketCoin[]>> {
  const cacheKey = `markets:${symbols?.join(',') ?? 'all'}`;
  const cached = apiCache.get<MarketCoin[]>(cacheKey);
  if (cached) return { data: cached, error: null, status: 200 };

  try {
    const data = await getMarketDataFromProviders(p => p.getMarketData(symbols ?? []));
    apiCache.set(cacheKey, data, CACHE_TTL.marketData);
    return { data, error: null, status: 200 };
  } catch (err) {
    return { data: null, error: buildApiError('MARKET_FETCH_ERROR', (err as Error).message), status: 500 };
  }
}

// ─── Single coin price ────────────────────────────────────────────────────────
export async function fetchCoinPrice(symbol: string): Promise<ApiResponse<number>> {
  const markets = await fetchMarkets([symbol]);
  if (!markets.data) return { data: null, error: markets.error, status: markets.status };
  const coin = markets.data.find(c => c.symbol === symbol.toUpperCase());
  if (!coin) return { data: null, error: buildApiError('NOT_FOUND', `${symbol} not found`), status: 404 };
  return { data: coin.price, error: null, status: 200 };
}

// ─── Order book ───────────────────────────────────────────────────────────────
export async function fetchOrderBook(symbol: string, depth = 8): Promise<ApiResponse<OrderBook>> {
  const cacheKey = `orderbook:${symbol}:${depth}`;
  const cached = apiCache.get<OrderBook>(cacheKey);
  if (cached) return { data: cached, error: null, status: 200 };

  try {
    const data = await getMarketDataFromProviders(p => p.getOrderBook(symbol, depth) as any);
    apiCache.set(cacheKey, data, CACHE_TTL.orderBook);
    return { data: data as unknown as OrderBook, error: null, status: 200 };
  } catch (err) {
    return { data: null, error: buildApiError('ORDER_BOOK_ERROR', (err as Error).message), status: 500 };
  }
}

// ─── Recent trades ────────────────────────────────────────────────────────────
export async function fetchRecentTrades(symbol: string, limit = 20): Promise<ApiResponse<Trade[]>> {
  try {
    const data = await getMarketDataFromProviders(p => p.getRecentTrades(symbol, limit) as any);
    return { data: data as unknown as Trade[], error: null, status: 200 };
  } catch (err) {
    return { data: null, error: buildApiError('TRADES_ERROR', (err as Error).message), status: 500 };
  }
}

// ─── Candlestick data ─────────────────────────────────────────────────────────
export async function fetchCandles(
  symbol: string,
  interval = '1h',
  limit = 50,
): Promise<ApiResponse<Candle[]>> {
  const cacheKey = `candles:${symbol}:${interval}:${limit}`;
  const cached = apiCache.get<Candle[]>(cacheKey);
  if (cached) return { data: cached, error: null, status: 200 };

  try {
    const data = await getMarketDataFromProviders(p => p.getCandles(symbol, interval, limit) as any);
    apiCache.set(cacheKey, data, 30_000);
    return { data: data as unknown as Candle[], error: null, status: 200 };
  } catch (err) {
    return { data: null, error: buildApiError('CANDLES_ERROR', (err as Error).message), status: 500 };
  }
}
