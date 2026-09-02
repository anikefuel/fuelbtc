// Binance Provider Adapter — market data, order book, candles, trades
// Public endpoints: no API key required for read-only market data.
// Signed endpoints (trading) require EXPO_PUBLIC_BINANCE_KEY via Edge Function.

import type { ProviderResponse, ExecutionOptions } from '../types';
import type { ProviderAdapter } from '../ProviderManager';
import { getProviderConfig } from '../config';
import type { MarketCoin, OrderBook, OrderBookEntry, Trade, Candle } from '@/types';

type BinanceData = MarketCoin[] | OrderBook | Trade[] | Candle[];

// Primary spot symbols to always include — ordered by priority
const SPOT_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'DOGEUSDT','TRXUSDT','LTCUSDT','USDCUSDT',
];

// Symbol → human readable name
const COIN_NAMES: Record<string, string> = {
  BTC:'Bitcoin', ETH:'Ethereum', BNB:'BNB', SOL:'Solana', XRP:'XRP',
  DOGE:'Dogecoin', TRX:'TRON', LTC:'Litecoin', USDC:'USD Coin',
};

export class BinanceAdapter implements ProviderAdapter<BinanceData> {
  readonly id = 'binance';
  readonly supportedCheckers = ['market_data', 'order_book', 'candles', 'trades', 'futures_market_data'] as const;

  private get baseUrl(): string {
    return getProviderConfig('binance')?.baseUrl ?? 'https://api.binance.com';
  }
  private readonly futuresBase = 'https://fapi.binance.com';

  async execute(options: ExecutionOptions): Promise<ProviderResponse<BinanceData>> {
    const start = Date.now();
    try {
      switch (options.checkerType) {
        case 'market_data':          return await this.fetchMarkets(start, options.symbol);
        case 'futures_market_data':  return await this.fetchFuturesMarkets(start, options.symbol);
        case 'order_book':           return await this.fetchOrderBook(start, options.symbol ?? 'BTCUSDT', options.limit ?? 20);
        case 'candles':              return await this.fetchCandles(start, options.symbol ?? 'BTCUSDT', options.interval ?? '1h', options.limit ?? 100);
        case 'trades':               return await this.fetchTrades(start, options.symbol ?? 'BTCUSDT', options.limit ?? 50);
        default:
          return this.errorResponse('Unsupported checker type for Binance', start);
      }
    } catch (err) {
      return this.errorResponse((err as Error).message, start);
    }
  }

  private async fetchMarkets(start: number, symbolFilter?: string): Promise<ProviderResponse<MarketCoin[]>> {
    // Fetch the required spot symbols in one call using the symbols[] param
    const symbols = symbolFilter
      ? [symbolFilter.endsWith('USDT') ? symbolFilter : `${symbolFilter}USDT`]
      : SPOT_SYMBOLS;

    const symsParam = encodeURIComponent(JSON.stringify(symbols));
    const tickerUrl = `${this.baseUrl}/api/v3/ticker/24hr?symbols=${symsParam}`;
    const bookUrl   = `${this.baseUrl}/api/v3/ticker/bookTicker?symbols=${symsParam}`;

    const [tickerRes, bookRes] = await Promise.all([
      fetch(tickerUrl),
      fetch(bookUrl),
    ]);

    if (!tickerRes.ok) return this.httpErrorResponse(tickerRes.status, start);

    const tickers = await tickerRes.json() as BinanceTicker[];
    const books: BinanceBookTicker[] = bookRes.ok
      ? (await bookRes.json() as BinanceBookTicker[])
      : [];

    const bookMap: Record<string, BinanceBookTicker> = {};
    for (const b of books) bookMap[b.symbol] = b;

    const now = Date.now();
    const coins: MarketCoin[] = tickers.map((t: BinanceTicker) => {
      const asset  = t.symbol.replace('USDT', '');
      const vol    = parseFloat(t.volume);
      const book   = bookMap[t.symbol];
      const bid    = book ? parseFloat(book.bidPrice) : 0;
      const ask    = book ? parseFloat(book.askPrice) : 0;
      return {
        symbol:        asset,
        name:          COIN_NAMES[asset] ?? asset,
        price:         parseFloat(t.lastPrice),
        change24h:     parseFloat(t.priceChangePercent),
        change24hAmt:  parseFloat(t.priceChange),
        volume:        vol >= 1e9 ? `${(vol/1e9).toFixed(1)}B`
                     : vol >= 1e6 ? `${(vol/1e6).toFixed(1)}M`
                     : `${(vol/1e3).toFixed(1)}K`,
        volumeRaw:     vol,
        quoteVolume:   parseFloat(t.quoteVolume),
        high:          parseFloat(t.highPrice),
        low:           parseFloat(t.lowPrice),
        bid,
        ask,
        sparkline:     [],   // populated separately by fetchSparklines if needed
        marketType:    'spot',
        isLive:        false,
        isDelayed:     false,
        lastUpdateMs:  now,
      };
    });

    // Sort by our preferred order
    const orderMap: Record<string, number> = {};
    SPOT_SYMBOLS.forEach((s, i) => { orderMap[s] = i; });
    coins.sort((a, b) => (orderMap[`${a.symbol}USDT`] ?? 99) - (orderMap[`${b.symbol}USDT`] ?? 99));

    return {
      provider: 'binance',
      status: 'success',
      durationMs: Date.now() - start,
      confidence: 0.98,
      data: coins,
      evidence: [`${coins.length} spot pairs from Binance 24h ticker`],
      warnings: [],
      error: null,
      retryCount: 0,
      cacheHit: false,
      metadata: { source: 'binance_ticker_24hr', httpStatus: tickerRes.status },
    };
  }

  private async fetchFuturesMarkets(start: number, symbolFilter?: string): Promise<ProviderResponse<MarketCoin[]>> {
    const futureSymbols = symbolFilter
      ? [symbolFilter.endsWith('USDT') ? symbolFilter : `${symbolFilter}USDT`]
      : ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','LTCUSDT'];

    const symsParam = encodeURIComponent(JSON.stringify(futureSymbols));

    const [tickerRes, markRes] = await Promise.all([
      fetch(`${this.futuresBase}/fapi/v1/ticker/24hr?symbols=${symsParam}`),
      fetch(`${this.futuresBase}/fapi/v1/premiumIndex?symbols=${symsParam}`),
    ]);

    if (!tickerRes.ok) return this.httpErrorResponse(tickerRes.status, start);

    const tickers = await tickerRes.json() as BinanceFuturesTicker[];
    const marks: BinanceMarkPrice[] = markRes.ok ? (await markRes.json() as BinanceMarkPrice[]) : [];
    const markMap: Record<string, BinanceMarkPrice> = {};
    for (const m of marks) markMap[m.symbol] = m;

    const now = Date.now();
    const coins: MarketCoin[] = tickers.map((t: BinanceFuturesTicker) => {
      const asset = t.symbol.replace('USDT', '');
      const vol   = parseFloat(t.volume);
      const mark  = markMap[t.symbol];
      return {
        symbol:        asset,
        name:          COIN_NAMES[asset] ?? asset,
        price:         parseFloat(t.lastPrice),
        change24h:     parseFloat(t.priceChangePercent),
        change24hAmt:  parseFloat(t.priceChange),
        volume:        vol >= 1e9 ? `${(vol/1e9).toFixed(1)}B`
                     : vol >= 1e6 ? `${(vol/1e6).toFixed(1)}M`
                     : `${(vol/1e3).toFixed(1)}K`,
        volumeRaw:     vol,
        quoteVolume:   parseFloat(t.quoteVolume),
        high:          parseFloat(t.highPrice),
        low:           parseFloat(t.lowPrice),
        bid:           0,
        ask:           0,
        sparkline:     [],
        marketType:    'futures',
        isLive:        false,
        isDelayed:     false,
        lastUpdateMs:  now,
        // extras stored in metadata-like fields
        marketCap:     mark ? parseFloat(mark.markPrice) : undefined,  // markPrice stored here
      };
    });

    return {
      provider: 'binance',
      status: 'success',
      durationMs: Date.now() - start,
      confidence: 0.98,
      data: coins,
      evidence: [`${coins.length} futures pairs from Binance futures 24h ticker`],
      warnings: [],
      error: null,
      retryCount: 0,
      cacheHit: false,
      metadata: { source: 'binance_futures_ticker', httpStatus: tickerRes.status },
    };
  }

  private async fetchOrderBook(start: number, symbol: string, limit: number): Promise<ProviderResponse<OrderBook>> {
    // Auto-detect whether this is a futures symbol to use correct base URL
    const isFutures = symbol.endsWith('_PERP') || symbol.includes('PERP');
    const cleanSym = symbol.replace('_PERP','').replace('/','');
    const baseForBook = isFutures ? `${this.futuresBase}/fapi/v1` : `${this.baseUrl}/api/v3`;

    const res = await fetch(`${baseForBook}/depth?symbol=${cleanSym}&limit=${limit}`);
    if (!res.ok) return this.httpErrorResponse(res.status, start) as ProviderResponse<OrderBook>;

    const raw = await res.json() as { asks: [string, string][]; bids: [string, string][]; lastUpdateId: number };
    const toEntry = ([price, qty]: [string, string]): OrderBookEntry => {
      const p = parseFloat(price);
      const a = parseFloat(qty);
      return { price: p, amount: a, total: p * a };
    };
    const book: OrderBook = {
      asks: raw.asks.map(toEntry),
      bids: raw.bids.map(toEntry),
      lastUpdateId: raw.lastUpdateId,
      timestamp: Date.now(),
    };
    return {
      provider: 'binance', status: 'success', durationMs: Date.now() - start,
      confidence: 0.99, data: book, evidence: [`Order book for ${symbol}`], warnings: [],
      error: null, retryCount: 0, cacheHit: false, metadata: { httpStatus: res.status },
    };
  }

  private async fetchCandles(start: number, symbol: string, interval: string, limit: number): Promise<ProviderResponse<Candle[]>> {
    const isFutures = symbol.endsWith('_PERP') || symbol.includes('PERP');
    const cleanSym = symbol.replace('_PERP','').replace('/','');
    const base = isFutures ? `${this.futuresBase}/fapi/v1` : `${this.baseUrl}/api/v3`;
    const res = await fetch(`${base}/klines?symbol=${cleanSym}&interval=${interval}&limit=${limit}`);
    if (!res.ok) return this.httpErrorResponse(res.status, start) as ProviderResponse<Candle[]>;

    const raw = await res.json() as [number, string, string, string, string, string, number][];
    const candles: Candle[] = raw.map(c => ({
      t: c[0],
      o: parseFloat(c[1]),
      h: parseFloat(c[2]),
      l: parseFloat(c[3]),
      c: parseFloat(c[4]),
      v: parseFloat(c[5]),
    }));
    return {
      provider: 'binance', status: 'success', durationMs: Date.now() - start,
      confidence: 0.99, data: candles, evidence: [`${candles.length} candles for ${symbol} @ ${interval}`],
      warnings: [], error: null, retryCount: 0, cacheHit: false, metadata: { httpStatus: res.status },
    };
  }

  private async fetchTrades(start: number, symbol: string, limit: number): Promise<ProviderResponse<Trade[]>> {
    const isFutures = symbol.endsWith('_PERP') || symbol.includes('PERP');
    const cleanSym = symbol.replace('_PERP','').replace('/','');
    const base = isFutures ? `${this.futuresBase}/fapi/v1` : `${this.baseUrl}/api/v3`;
    const res = await fetch(`${base}/trades?symbol=${cleanSym}&limit=${limit}`);
    if (!res.ok) return this.httpErrorResponse(res.status, start) as ProviderResponse<Trade[]>;

    const raw = await res.json() as BinanceTrade[];
    const trades: Trade[] = raw.map(t => {
      const d = new Date(t.time);
      return {
        id: String(t.id),
        price: parseFloat(t.price),
        amount: parseFloat(t.qty),
        time: `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`,
        isBuy: !t.isBuyerMaker,
      };
    });
    return {
      provider: 'binance', status: 'success', durationMs: Date.now() - start,
      confidence: 0.99, data: trades, evidence: [`${trades.length} recent trades for ${symbol}`],
      warnings: [], error: null, retryCount: 0, cacheHit: false, metadata: { httpStatus: res.status },
    };
  }

  private httpErrorResponse(httpStatus: number, start: number): ProviderResponse<never> {
    return {
      provider: 'binance', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: `HTTP ${httpStatus}`, retryCount: 0, cacheHit: false,
      metadata: { httpStatus },
    };
  }

  private errorResponse(message: string, start: number): ProviderResponse<never> {
    return {
      provider: 'binance', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: message, retryCount: 0, cacheHit: false, metadata: {},
    };
  }
}

// ─── Binance raw types ────────────────────────────────────────────────────────
interface BinanceTicker {
  symbol: string; lastPrice: string; priceChange: string; priceChangePercent: string;
  volume: string; quoteVolume: string; highPrice: string; lowPrice: string;
}
interface BinanceFuturesTicker {
  symbol: string; lastPrice: string; priceChange: string; priceChangePercent: string;
  volume: string; quoteVolume: string; highPrice: string; lowPrice: string;
}
interface BinanceMarkPrice {
  symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string; nextFundingTime: number;
}
interface BinanceBookTicker {
  symbol: string; bidPrice: string; bidQty: string; askPrice: string; askQty: string;
}
interface BinanceTrade {
  id: number; price: string; qty: string; isBuyerMaker: boolean; time: number;
}
