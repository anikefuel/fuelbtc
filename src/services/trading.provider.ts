// Trading Provider Abstraction Layer
// Binance is default; architecture supports Bybit, OKX, Kraken, Coinbase, KuCoin, Bitget, Hyperliquid

import { fetch } from 'expo/fetch';

// ─── Provider Interface ───────────────────────────────────────────────────────
export interface ProviderTicker {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
}

export interface ProviderOrderBookEntry { price: number; qty: number }
export interface ProviderOrderBook {
  symbol: string;
  bids: ProviderOrderBookEntry[];
  asks: ProviderOrderBookEntry[];
  lastUpdateId: number;
}

export interface ProviderTrade {
  id: string;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean;
}

export interface ProviderCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface ProviderFundingRate {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number;
  indexPrice: number;
}

export interface TradingProvider {
  name: string;
  getTicker(symbol: string): Promise<ProviderTicker>;
  getOrderBook(symbol: string, limit?: number): Promise<ProviderOrderBook>;
  getRecentTrades(symbol: string, limit?: number): Promise<ProviderTrade[]>;
  getCandles(symbol: string, interval: string, limit?: number): Promise<ProviderCandle[]>;
  getFundingRate(symbol: string): Promise<ProviderFundingRate>;
  getMarkPrice(symbol: string): Promise<{ markPrice: number; indexPrice: number }>;
}

// ─── Binance Public Provider (market data only — no API key) ─────────────────
class BinancePublicProvider implements TradingProvider {
  name = 'binance';
  private spotBase  = 'https://api.binance.com/api/v3';
  private futBase   = 'https://fapi.binance.com/fapi/v1';

  async getTicker(symbol: string): Promise<ProviderTicker> {
    const res = await fetch(`${this.spotBase}/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) {
      if (res.status === 400) throw new Error(`Symbol ${symbol} not found on Binance`);
      if (res.status === 429 || res.status === 418) throw new Error(`Rate limit reached. Slow down requests.`);
      throw new Error(`Market data unavailable (${res.status})`);
    }
    const d = await res.json() as {
      symbol:string; lastPrice:string; priceChange:string; priceChangePercent:string;
      highPrice:string; lowPrice:string; volume:string; quoteVolume:string;
    };
    return {
      symbol: d.symbol,
      price: parseFloat(d.lastPrice),
      priceChange: parseFloat(d.priceChange),
      priceChangePct: parseFloat(d.priceChangePercent),
      high24h: parseFloat(d.highPrice),
      low24h: parseFloat(d.lowPrice),
      volume24h: parseFloat(d.volume),
      quoteVolume24h: parseFloat(d.quoteVolume),
    };
  }

  async getOrderBook(symbol: string, limit = 20): Promise<ProviderOrderBook> {
    const res = await fetch(`${this.spotBase}/depth?symbol=${symbol}&limit=${limit}`);
    if (!res.ok) throw new Error(`Order book unavailable (${res.status})`);
    const d = await res.json() as { lastUpdateId:number; bids:string[][]; asks:string[][] };
    return {
      symbol,
      lastUpdateId: d.lastUpdateId,
      bids: d.bids.map(([p,q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
      asks: d.asks.map(([p,q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
    };
  }

  async getRecentTrades(symbol: string, limit = 50): Promise<ProviderTrade[]> {
    const res = await fetch(`${this.spotBase}/trades?symbol=${symbol}&limit=${limit}`);
    if (!res.ok) throw new Error(`Recent trades unavailable (${res.status})`);
    const d = await res.json() as Array<{ id:number; price:string; qty:string; time:number; isBuyerMaker:boolean }>;
    return d.map(t => ({ id: String(t.id), price: parseFloat(t.price), qty: parseFloat(t.qty), time: t.time, isBuyerMaker: t.isBuyerMaker }));
  }

  async getCandles(symbol: string, interval: string, limit = 100): Promise<ProviderCandle[]> {
    const res = await fetch(`${this.spotBase}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`Chart data unavailable (${res.status})`);
    const d = await res.json() as Array<[number,string,string,string,string,string,number]>;
    return d.map(c => ({
      openTime: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]), closeTime: c[6],
    }));
  }

  async getFundingRate(symbol: string): Promise<ProviderFundingRate> {
    // Map spot symbol to futures
    const futSym = symbol.replace('_PERP','');
    const res = await fetch(`${this.futBase}/premiumIndex?symbol=${futSym}`);
    if (!res.ok) throw new Error(`Funding rate unavailable (${res.status})`);

    const d = await res.json() as { symbol:string; markPrice:string; indexPrice:string; lastFundingRate:string; nextFundingTime:number };
    return {
      symbol,
      fundingRate: parseFloat(d.lastFundingRate),
      fundingTime: d.nextFundingTime,
      markPrice: parseFloat(d.markPrice),
      indexPrice: parseFloat(d.indexPrice),
    };
  }

  async getMarkPrice(symbol: string): Promise<{ markPrice: number; indexPrice: number }> {
    const futSym = symbol.replace('_PERP','');
    const res = await fetch(`${this.futBase}/premiumIndex?symbol=${futSym}`);
    if (!res.ok) throw new Error(`Mark price unavailable (${res.status})`);

    const d = await res.json() as { markPrice:string; indexPrice:string };
    return { markPrice: parseFloat(d.markPrice), indexPrice: parseFloat(d.indexPrice) };
  }
}

// ─── Provider registry + factory ─────────────────────────────────────────────
const PROVIDERS: Record<string, TradingProvider> = {
  binance: new BinancePublicProvider(),
};

export function getProvider(name = 'binance'): TradingProvider {
  return PROVIDERS[name] ?? PROVIDERS.binance;
}

// ─── Candle interval normalisation ───────────────────────────────────────────
export const INTERVAL_MAP: Record<string, string> = {
  '1m':'1m','5m':'5m','15m':'15m','30m':'30m',
  '1h':'1h','4h':'4h','1D':'1d','1W':'1w',
};

// ─── In-memory cache + in-flight deduplication ───────────────────────────────
type CacheEntry<T> = { data: T; ts: number };
const cache: Record<string, CacheEntry<unknown>> = {};
const inflight: Record<string, Promise<unknown>> = {};

export async function cachedFetch<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  // Return cached if still fresh
  const entry = cache[key] as CacheEntry<T> | undefined;
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;

  // Deduplicate in-flight requests for the same key
  const existing = inflight[key];
  if (existing !== undefined) return existing as Promise<T>;

  const p = fn().then(data => {
    cache[key] = { data, ts: Date.now() };
    delete inflight[key];
    return data;
  }).catch(err => {
    delete inflight[key];
    throw err;
  });
  inflight[key] = p;
  return p;
}

/** Invalidate a cache entry (e.g. after placing an order) */
export function invalidateCache(key: string): void {
  delete cache[key];
}

// ─── Normalised user-friendly error messages ──────────────────────────────────
export function normaliseProviderError(err: unknown, context = 'market data'): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('429')) return new Error(`Rate limit reached. Please wait a moment.`);
  if (raw.includes('451') || raw.includes('403')) return new Error(`${context} not available in your region.`);
  if (raw.includes('418')) return new Error(`Too many requests. IP temporarily banned by provider.`);
  if (raw.includes('5')) return new Error(`Market data provider temporarily unavailable.`);
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('network')) {
    return new Error(`Network error. Check your connection.`);
  }
  return new Error(`${context} unavailable. Pull down to retry.`);
}
