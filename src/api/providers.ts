// Provider abstraction layer — now powered by the Provider Execution Engine
// All external data sources run through the central ProviderManager.
// This module re-exports convenient wrappers that the existing hooks/API modules use.

import type { MarketCoin, OrderBook, Trade, Candle } from '@/types';

// ─── Bootstrap the execution engine (registers all adapters) ─────────────────
import '@/engine';
import { providerManager } from '@/engine';

// ─── Legacy interface — kept for backwards compatibility with hooks ────────────
export interface MarketDataProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  getMarketData(symbols: string[]): Promise<MarketCoin[]>;
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
  getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>;
  getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]>;
}

export interface LiquidityProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  placeOrder(symbol: string, side: 'buy' | 'sell', type: string, qty: number, price?: number): Promise<{ orderId: string }>;
  cancelOrder(orderId: string): Promise<void>;
  getBalance(asset: string): Promise<number>;
}

// ─── Engine-backed implementations of the legacy interfaces ───────────────────
// Hooks and UI modules call these — they route through the ProviderManager.

export const EngineMarketProvider: MarketDataProvider = {
  name: 'engine',
  isAvailable: async () => true,

  getMarketData: async (_symbols: string[]): Promise<MarketCoin[]> => {
    const result = await providerManager.executeWithFallback<MarketCoin[]>({
      checkerType: 'market_data',
    });
    return result.data ?? [];
  },

  getOrderBook: async (symbol: string, depth = 20): Promise<OrderBook> => {
    const result = await providerManager.executeWithFallback<OrderBook>({
      checkerType: 'order_book',
      symbol: symbol.replace('/', '').toUpperCase(),
      limit: depth,
    });
    return result.data ?? { asks: [], bids: [], lastUpdateId: 0, timestamp: Date.now() };
  },

  getRecentTrades: async (symbol: string, limit = 50): Promise<Trade[]> => {
    const result = await providerManager.executeWithFallback<Trade[]>({
      checkerType: 'trades',
      symbol: symbol.replace('/', '').toUpperCase(),
      limit,
    });
    return result.data ?? [];
  },

  getCandles: async (symbol: string, interval: string, limit = 100): Promise<Candle[]> => {
    const result = await providerManager.executeWithFallback<Candle[]>({
      checkerType: 'candles',
      symbol: symbol.replace('/', '').toUpperCase(),
      interval,
      limit,
    });
    return result.data ?? [];
  },
};

// ─── Backward-compat registry (single entry — the engine provider) ────────────
const marketProviders: MarketDataProvider[] = [EngineMarketProvider];
const liquidityProviders: LiquidityProvider[] = [];

export function registerMarketProvider(provider: MarketDataProvider): void {
  marketProviders.push(provider);
}

export function registerLiquidityProvider(provider: LiquidityProvider): void {
  liquidityProviders.push(provider);
}

export async function getMarketDataFromProviders(
  fn: (p: MarketDataProvider) => Promise<MarketCoin[]>
): Promise<MarketCoin[]> {
  for (const provider of marketProviders) {
    try {
      if (!(await provider.isAvailable())) continue;
      return await fn(provider);
    } catch { /* continue to next */ }
  }
  return [];
}
