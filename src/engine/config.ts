// Provider Execution Engine — Centralized configuration
// All provider settings live here. No provider-specific constants elsewhere.

import type { ProviderConfig } from './types';

// ─── Default timeouts by provider class ──────────────────────────────────────
export const DEFAULT_TIMEOUTS: Record<string, number> = {
  binance:        8_000,
  bybit:          8_000,
  coingecko:      10_000,
  coinmarketcap:  10_000,
  tradingview:    8_000,
  alchemy:        8_000,
  quicknode:      8_000,
  goplus:         8_000,
  blockchair:     8_000,
  ninepsb:        10_000,
  mock:           500,
};

// ─── Default cache TTLs (ms) by provider class ────────────────────────────────
export const DEFAULT_CACHE_TTLS: Record<string, number> = {
  binance:        30_000,      // 30s — live prices
  bybit:          30_000,
  coingecko:      60_000,      // 1 min — slightly slower updates
  coinmarketcap:  60_000,
  tradingview:    300_000,     // 5 min — chart data
  alchemy:        60_000,      // 1 min — on-chain state
  quicknode:      60_000,
  goplus:         300_000,     // 5 min — token security
  blockchair:     120_000,     // 2 min — explorer data
  ninepsb:        30_000,      // 30s — banking rates
  mock:           5_000,
};

// ─── Master provider registry ─────────────────────────────────────────────────
// API keys are read from environment variables — never hardcoded.
// Set EXPO_PUBLIC_XXX_KEY in your .env for client-accessible keys.
// Server-side keys go through Edge Functions (never exposed to client).
export const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: 'mock',
    name: 'Mock Provider',
    enabled: true,                        // always enabled — fallback of last resort
    baseUrl: '',
    timeoutMs: DEFAULT_TIMEOUTS.mock,
    maxRetries: 0,
    cacheTtlMs: DEFAULT_CACHE_TTLS.mock,
    priority: 99,
    supportedCheckers: [
      'market_data', 'order_book', 'candles', 'trades',
      'token_security', 'wallet_balance', 'transaction_history',
    ],
  },
  {
    id: 'binance',
    name: 'Binance',
    enabled: true,
    baseUrl: 'https://api.binance.com',
    timeoutMs: DEFAULT_TIMEOUTS.binance,
    maxRetries: 2,
    cacheTtlMs: DEFAULT_CACHE_TTLS.binance,
    priority: 1,
    supportedCheckers: ['market_data', 'order_book', 'candles', 'trades'],
    rateLimit: { requestsPerMinute: 1200 },
  },
  {
    id: 'bybit',
    name: 'Bybit',
    enabled: true,
    baseUrl: 'https://api.bybit.com',
    timeoutMs: DEFAULT_TIMEOUTS.bybit,
    maxRetries: 2,
    cacheTtlMs: DEFAULT_CACHE_TTLS.bybit,
    priority: 2,
    supportedCheckers: ['market_data', 'order_book', 'candles', 'trades'],
    rateLimit: { requestsPerMinute: 600 },
  },
  {
    id: 'coingecko',
    name: 'CoinGecko',
    enabled: true,
    baseUrl: 'https://api.coingecko.com/api/v3',
    timeoutMs: DEFAULT_TIMEOUTS.coingecko,
    maxRetries: 2,
    cacheTtlMs: DEFAULT_CACHE_TTLS.coingecko,
    priority: 3,
    supportedCheckers: ['market_data'],
    rateLimit: { requestsPerMinute: 50 },
  },
  {
    id: 'coinmarketcap',
    name: 'CoinMarketCap',
    enabled: true,
    baseUrl: 'https://pro-api.coinmarketcap.com/v1',
    timeoutMs: DEFAULT_TIMEOUTS.coinmarketcap,
    maxRetries: 2,
    cacheTtlMs: DEFAULT_CACHE_TTLS.coinmarketcap,
    priority: 4,
    supportedCheckers: ['market_data'],
    rateLimit: { requestsPerMinute: 30, requestsPerDay: 10_000 },
  },
  {
    id: 'goplus',
    name: 'GoPlus Security',
    enabled: true,
    baseUrl: 'https://api.gopluslabs.io/api/v1',
    timeoutMs: DEFAULT_TIMEOUTS.goplus,
    maxRetries: 1,
    cacheTtlMs: DEFAULT_CACHE_TTLS.goplus,
    priority: 1,
    supportedCheckers: ['token_security'],
    rateLimit: { requestsPerMinute: 60 },
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    enabled: true,
    baseUrl: 'https://eth-mainnet.g.alchemy.com/v2',
    timeoutMs: DEFAULT_TIMEOUTS.alchemy,
    maxRetries: 2,
    cacheTtlMs: DEFAULT_CACHE_TTLS.alchemy,
    priority: 1,
    supportedCheckers: ['wallet_balance', 'transaction_history', 'blockchain_info'],
    rateLimit: { requestsPerMinute: 300 },
  },
  {
    id: 'quicknode',
    name: 'QuickNode',
    enabled: true,
    baseUrl: 'https://api.quicknode.com',
    timeoutMs: DEFAULT_TIMEOUTS.quicknode,
    maxRetries: 2,
    cacheTtlMs: DEFAULT_CACHE_TTLS.quicknode,
    priority: 2,
    supportedCheckers: ['wallet_balance', 'transaction_history', 'blockchain_info'],
    rateLimit: { requestsPerMinute: 300 },
  },
  {
    id: 'blockchair',
    name: 'Blockchair',
    enabled: true,
    baseUrl: 'https://api.blockchair.com',
    timeoutMs: DEFAULT_TIMEOUTS.blockchair,
    maxRetries: 2,
    cacheTtlMs: DEFAULT_CACHE_TTLS.blockchair,
    priority: 3,
    supportedCheckers: ['wallet_balance', 'transaction_history', 'blockchain_info'],
    rateLimit: { requestsPerMinute: 30 },
  },
  {
    id: 'ninepsb',
    name: '9PSB Banking',
    enabled: true,
    baseUrl: 'https://api.9psb.com.ng/api',
    timeoutMs: DEFAULT_TIMEOUTS.ninepsb,
    maxRetries: 1,
    cacheTtlMs: DEFAULT_CACHE_TTLS.ninepsb,
    priority: 1,
    supportedCheckers: ['fiat_banking'],
    rateLimit: { requestsPerMinute: 60 },
  },
  {
    id: 'tradingview',
    name: 'TradingView',
    enabled: false,           // requires server-side widget token — disabled until Edge Function ready
    baseUrl: 'https://symbol-search.tradingview.com',
    timeoutMs: DEFAULT_TIMEOUTS.tradingview,
    maxRetries: 1,
    cacheTtlMs: DEFAULT_CACHE_TTLS.tradingview,
    priority: 5,
    supportedCheckers: ['candles'],
  },
];

// ─── Retrieve a single config by id ──────────────────────────────────────────
export function getProviderConfig(id: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS.find(c => c.id === id);
}

// ─── Get all enabled providers for a given checker type ──────────────────────
export function getEnabledProvidersForChecker(checkerType: string): ProviderConfig[] {
  return PROVIDER_CONFIGS
    .filter(c => c.enabled && c.supportedCheckers.includes(checkerType as never))
    .sort((a, b) => a.priority - b.priority);
}
