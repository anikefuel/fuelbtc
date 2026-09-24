// Market & trading pair types

export interface MarketCoin {
  symbol: string;
  name: string;
  price: number;
  change24h: number;         // percent change (e.g. 2.34 = +2.34%)
  change24hAmt: number;      // absolute price change
  volume: string;            // human-readable base volume string
  volumeRaw: number;         // raw numeric volume for sorting
  quoteVolume: number;       // 24h quote asset (USDT) volume
  high: number;
  low: number;
  bid: number;
  ask: number;
  sparkline: number[];
  marketType: 'spot' | 'futures';
  isLive: boolean;           // true = WS-backed live price
  isDelayed: boolean;        // true = cached/stale data
  lastUpdateMs: number;      // epoch ms of last price update
  marketCap?: number;
  circulatingSupply?: number;
  logoUrl?: string;
}

export interface TradingPair {
  base: string;       // e.g. "BTC"
  quote: string;      // e.g. "USDT"
  symbol: string;     // e.g. "BTCUSDT"
  displaySymbol: string; // e.g. "BTC/USDT"
  minOrderSize: number;
  tickSize: number;
  stepSize: number;
  makerFee: number;
  takerFee: number;
  isActive: boolean;
}

export interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
}

export interface OrderBook {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
  lastUpdateId: number;
  timestamp: number;
}

export interface Trade {
  id: string;
  price: number;
  amount: number;
  time: string;
  isBuy: boolean;
}

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  t?: number; // timestamp
}

export type MarketSortKey = 'price' | 'change24h' | 'volume';
export type MarketTabType = 'All' | 'Spot' | 'Futures' | 'Favorites';
