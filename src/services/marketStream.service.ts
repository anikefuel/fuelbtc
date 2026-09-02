// MarketStream Service — shared WebSocket manager for live market prices
// One managed combined-stream connection for the Markets page.
// Components subscribe by symbol; all updates flow through one socket.
// Automatically reconnects with exponential backoff.
// Falls back to REST polling when WebSocket is unavailable.

import type { MarketCoin } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PriceUpdateCallback = (update: PriceUpdate) => void;

export interface PriceUpdate {
  symbol: string;          // e.g. "BTC" (without USDT suffix)
  price: number;
  change24h: number;       // percent
  change24hAmt: number;    // absolute
  high: number;
  low: number;
  volume: number;          // base asset volume
  quoteVolume: number;
  bid: number;
  ask: number;
  updatedAt: number;       // epoch ms
}

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'rest_fallback' | 'disconnected';

export interface StreamHealth {
  state: ConnectionState;
  lastMessageAt: number | null;
  reconnectCount: number;
  isStale: boolean;        // true if last message > 30s ago
  fallbackActive: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WS_BASE        = 'wss://stream.binance.com:9443/stream';
const REST_BASE      = 'https://api.binance.com/api/v3';
const STALE_THRESHOLD_MS   = 30_000;   // 30s without message → stale
const REST_POLL_INTERVAL   = 15_000;   // REST fallback poll interval
const MAX_RECONNECT_DELAY  = 30_000;   // cap backoff at 30s
const INITIAL_RECONNECT_MS = 1_000;

// Spot symbols to stream (matches BinanceAdapter SPOT_SYMBOLS)
const STREAM_SYMBOLS = [
  'btcusdt','ethusdt','bnbusdt','solusdt','xrpusdt',
  'dogeusdt','trxusdt','ltcusdt','usdcusdt',
];

// ─── Service ──────────────────────────────────────────────────────────────────

class MarketStreamService {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private lastMessageAt: number | null = null;
  private reconnectCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private restPollTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackActive = false;

  // Subscriber registry: symbol → set of callbacks
  private subscribers = new Map<string, Set<PriceUpdateCallback>>();
  // Health subscribers
  private healthSubs = new Set<(h: StreamHealth) => void>();

  // Latest price cache (in-memory)
  private latestPrices = new Map<string, PriceUpdate>();

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Subscribe to live price updates for a symbol (e.g. "BTC") */
  subscribe(symbol: string, cb: PriceUpdateCallback): () => void {
    const key = symbol.toUpperCase();
    if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
    this.subscribers.get(key)!.add(cb);

    // Immediately emit cached price if available
    const cached = this.latestPrices.get(key);
    if (cached) cb(cached);

    // Ensure stream is active
    if (this.state === 'disconnected') this.connect();

    return () => {
      this.subscribers.get(key)?.delete(cb);
    };
  }

  /** Subscribe to connection health state changes */
  subscribeHealth(cb: (h: StreamHealth) => void): () => void {
    this.healthSubs.add(cb);
    cb(this.getHealth());
    return () => this.healthSubs.delete(cb);
  }

  /** Get current health snapshot */
  getHealth(): StreamHealth {
    const isStale = this.lastMessageAt !== null
      && Date.now() - this.lastMessageAt > STALE_THRESHOLD_MS;
    return {
      state: this.state,
      lastMessageAt: this.lastMessageAt,
      reconnectCount: this.reconnectCount,
      isStale,
      fallbackActive: this.fallbackActive,
    };
  }

  /** Get latest cached price for a symbol (or null) */
  getCachedPrice(symbol: string): PriceUpdate | null {
    return this.latestPrices.get(symbol.toUpperCase()) ?? null;
  }

  /** Get all cached prices */
  getAllCachedPrices(): PriceUpdate[] {
    return Array.from(this.latestPrices.values());
  }

  /** Force close — call when completely unmounting (e.g. app background) */
  disconnect(): void {
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }

  // ── Connection management ──────────────────────────────────────────────────

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;

    this.setState('connecting');
    this.clearTimers();

    // Build combined stream URL for all symbols with @miniTicker
    const streams = STREAM_SYMBOLS.map(s => `${s}@miniTicker`).join('/');
    const url = `${WS_BASE}?streams=${streams}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectCount = 0;
      this.fallbackActive = false;
      this.stopRestFallback();
      this.setState('live');
      this.startStaleCheck();
    };

    this.ws.onmessage = (e) => {
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(e.data as string) as {
          stream: string;
          data: BinanceMiniTicker;
        };
        if (msg.stream && msg.data) {
          this.handleMiniTicker(msg.data);
        }
      } catch { /* malformed frame — ignore */ }
    };

    this.ws.onerror = () => {
      // onclose fires right after — handle reconnect there
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.stopStaleCheck();
      if (this.state !== 'disconnected') {
        this.scheduleReconnect();
      }
    };
  }

  private handleMiniTicker(d: BinanceMiniTicker): void {
    const asset = d.s.replace('USDT', '');
    const update: PriceUpdate = {
      symbol:       asset,
      price:        parseFloat(d.c),
      change24h:    ((parseFloat(d.c) - parseFloat(d.o)) / parseFloat(d.o)) * 100,
      change24hAmt: parseFloat(d.c) - parseFloat(d.o),
      high:         parseFloat(d.h),
      low:          parseFloat(d.l),
      volume:       parseFloat(d.v),
      quoteVolume:  parseFloat(d.q),
      bid:          0,  // not in miniTicker — use bookTicker subscription for bid/ask
      ask:          0,
      updatedAt:    Date.now(),
    };
    this.latestPrices.set(asset, update);
    // Notify subscribers
    const subs = this.subscribers.get(asset);
    if (subs) for (const cb of subs) cb(update);
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    this.startRestFallback();

    const delay = Math.min(INITIAL_RECONNECT_MS * Math.pow(2, this.reconnectCount), MAX_RECONNECT_DELAY);
    this.reconnectCount++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  // ── Stale-data detection ───────────────────────────────────────────────────

  private startStaleCheck(): void {
    this.staleCheckTimer = setInterval(() => {
      if (this.lastMessageAt && Date.now() - this.lastMessageAt > STALE_THRESHOLD_MS) {
        // WS connected but no messages — reconnect
        this.ws?.close();
      }
      this.emitHealth();
    }, 5_000);
  }

  private stopStaleCheck(): void {
    if (this.staleCheckTimer) { clearInterval(this.staleCheckTimer); this.staleCheckTimer = null; }
  }

  // ── REST fallback ──────────────────────────────────────────────────────────

  private startRestFallback(): void {
    if (this.restPollTimer) return;
    this.fallbackActive = true;
    this.emitHealth();
    // Immediate poll
    void this.pollRest();
    this.restPollTimer = setInterval(() => { void this.pollRest(); }, REST_POLL_INTERVAL);
  }

  private stopRestFallback(): void {
    if (this.restPollTimer) { clearInterval(this.restPollTimer); this.restPollTimer = null; }
    this.fallbackActive = false;
  }

  private async pollRest(): Promise<void> {
    try {
      const symsParam = encodeURIComponent(JSON.stringify(STREAM_SYMBOLS.map(s => s.toUpperCase())));
      const res = await fetch(`${REST_BASE}/ticker/24hr?symbols=${symsParam}`);
      if (!res.ok) return;
      const tickers = await res.json() as BinanceRestTicker[];
      const now = Date.now();
      for (const t of tickers) {
        const asset = t.symbol.replace('USDT', '');
        const update: PriceUpdate = {
          symbol:       asset,
          price:        parseFloat(t.lastPrice),
          change24h:    parseFloat(t.priceChangePercent),
          change24hAmt: parseFloat(t.priceChange),
          high:         parseFloat(t.highPrice),
          low:          parseFloat(t.lowPrice),
          volume:       parseFloat(t.volume),
          quoteVolume:  parseFloat(t.quoteVolume),
          bid:          parseFloat(t.bidPrice ?? '0'),
          ask:          parseFloat(t.askPrice ?? '0'),
          updatedAt:    now,
        };
        this.latestPrices.set(asset, update);
        const subs = this.subscribers.get(asset);
        if (subs) for (const cb of subs) cb(update);
      }
      this.lastMessageAt = now;
    } catch { /* network error — will retry */ }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private setState(s: ConnectionState): void {
    this.state = s;
    this.emitHealth();
  }

  private emitHealth(): void {
    const h = this.getHealth();
    for (const cb of this.healthSubs) cb(h);
  }

  private clearTimers(): void {
    if (this.reconnectTimer)  { clearTimeout(this.reconnectTimer);   this.reconnectTimer  = null; }
    this.stopStaleCheck();
    this.stopRestFallback();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const marketStream = new MarketStreamService();

// ─── Convenience: apply a PriceUpdate onto a MarketCoin ──────────────────────
export function applyPriceUpdate(coin: MarketCoin, update: PriceUpdate): MarketCoin {
  const vol = update.volume;
  return {
    ...coin,
    price:        update.price,
    change24h:    update.change24h,
    change24hAmt: update.change24hAmt,
    high:         update.high,
    low:          update.low,
    volume:       vol >= 1e9 ? `${(vol/1e9).toFixed(1)}B`
                : vol >= 1e6 ? `${(vol/1e6).toFixed(1)}M`
                : `${(vol/1e3).toFixed(1)}K`,
    volumeRaw:    vol,
    quoteVolume:  update.quoteVolume,
    bid:          update.bid || coin.bid,
    ask:          update.ask || coin.ask,
    isLive:       true,
    isDelayed:    false,
    lastUpdateMs: update.updatedAt,
  };
}

// ─── Raw Binance types ────────────────────────────────────────────────────────
interface BinanceMiniTicker {
  e: string; // event type: "24hrMiniTicker"
  E: number; // event time
  s: string; // symbol e.g. "BTCUSDT"
  c: string; // close price
  o: string; // open price
  h: string; // high price
  l: string; // low price
  v: string; // base asset volume
  q: string; // quote asset volume
}

interface BinanceRestTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  bidPrice?: string;
  askPrice?: string;
}
