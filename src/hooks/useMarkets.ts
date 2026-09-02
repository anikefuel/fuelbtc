// useMarkets — market data hook with live WS prices, caching, sort, filter, watchlist

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchMarkets } from '@/api/market';
import { CACHE_TTL } from '@/constants/config';
import { marketStream, applyPriceUpdate } from '@/services/marketStream.service';
import * as WatchlistService from '@/services/watchlist.service';
import type { WatchlistEntry } from '@/services/watchlist.service';
import type { MarketCoin, MarketSortKey, MarketTabType } from '@/types';

export type { MarketTabType };

interface UseMarketsOptions {
  autoRefreshMs?: number; // 0 = no auto refresh
}

interface UseMarketsResult {
  coins: MarketCoin[];
  filtered: MarketCoin[];
  isLoading: boolean;
  error: string | null;
  search: string;
  setSearch: (v: string) => void;
  activeTab: MarketTabType;
  setActiveTab: (v: MarketTabType) => void;
  sortKey: MarketSortKey;
  sortAsc: boolean;
  handleSort: (key: MarketSortKey) => void;
  watchlist: WatchlistEntry[];
  favorites: string[];          // symbols in spot watchlist (for backward compat)
  toggleFavorite: (symbol: string) => void;
  isWatchlisted: (symbol: string) => boolean;
  refresh: () => Promise<void>;
  streamState: string;
}

export function useMarkets(options: UseMarketsOptions = {}): UseMarketsResult {
  const { autoRefreshMs = CACHE_TTL.marketData } = options;

  const [coins, setCoins] = useState<MarketCoin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<MarketTabType>('All');
  const [sortKey, setSortKey] = useState<MarketSortKey>('volume');
  const [sortAsc, setSortAsc] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [streamState, setStreamState] = useState<string>('disconnected');

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const coinsRef  = useRef<MarketCoin[]>([]);
  coinsRef.current = coins;

  // ── Load base market data ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setIsLoading(true);
    const [marketsRes, wl] = await Promise.all([
      fetchMarkets(),
      WatchlistService.getWatchlist(),
    ]);
    if (marketsRes.data) {
      // Merge any cached WS prices into freshly loaded coins
      const merged = marketsRes.data.map(coin => {
        const cached = marketStream.getCachedPrice(coin.symbol);
        return cached ? applyPriceUpdate(coin, cached) : coin;
      });
      setCoins(merged);
      setError(null);
    } else {
      setError(marketsRes.error?.message ?? 'Market data temporarily unavailable. Pull to retry.');
    }
    setWatchlist(wl);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    (async () => { await load(); })();
    if (autoRefreshMs > 0) {
      timerRef.current = setInterval(() => { (async () => { await load(); })(); }, autoRefreshMs);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load, autoRefreshMs]);

  // ── WebSocket live price updates ──────────────────────────────────────────
  useEffect(() => {
    // Connect the stream (no-op if already connected)
    marketStream.connect();

    // Subscribe to health state
    const unsubHealth = marketStream.subscribeHealth((h) => {
      setStreamState(h.state);
    });

    // Subscribe to all spot symbols for live updates
    const unsubscribers: Array<() => void> = [];
    const SYMBOLS = ['BTC','ETH','BNB','SOL','XRP','DOGE','TRX','LTC','USDC'];
    for (const sym of SYMBOLS) {
      const unsub = marketStream.subscribe(sym, (update) => {
        setCoins(prev => prev.map(c =>
          c.symbol === sym ? applyPriceUpdate(c, update) : c
        ));
      });
      unsubscribers.push(unsub);
    }

    return () => {
      unsubHealth();
      unsubscribers.forEach(u => u());
    };
  }, []);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const handleSort = useCallback((key: MarketSortKey) => {
    setSortKey(prev => {
      if (prev === key) { setSortAsc(a => !a); return prev; }
      setSortAsc(false);
      return key;
    });
  }, []);

  // ── Watchlist / favorites ─────────────────────────────────────────────────
  const toggleFavorite = useCallback((symbol: string) => {
    (async () => {
      const next = await WatchlistService.toggleWatchlist(symbol, 'spot', watchlist);
      setWatchlist(next);
    })();
  }, [watchlist]);

  const isWatchlisted = useCallback((symbol: string) =>
    WatchlistService.isInWatchlist(symbol, 'spot', watchlist),
  [watchlist]);

  const favorites = useMemo(() =>
    watchlist.filter(e => e.marketType === 'spot').map(e => e.symbol),
  [watchlist]);

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return coins
      .filter(c => {
        if (activeTab === 'Favorites') return favorites.includes(c.symbol);
        if (activeTab === 'Spot')      return c.marketType !== 'futures';
        if (activeTab === 'Futures')   return c.marketType === 'futures';
        return true;
      })
      .filter(c => !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        let va: number, vb: number;
        if (sortKey === 'volume') {
          // Use volumeRaw (numeric) — never sort on the formatted string
          va = a.volumeRaw ?? 0;
          vb = b.volumeRaw ?? 0;
        } else {
          va = a[sortKey] as number;
          vb = b[sortKey] as number;
        }
        return sortAsc ? va - vb : vb - va;
      });
  }, [coins, search, activeTab, favorites, sortKey, sortAsc]);

  return {
    coins, filtered, isLoading, error,
    search, setSearch, activeTab, setActiveTab,
    sortKey, sortAsc, handleSort,
    watchlist, favorites, toggleFavorite, isWatchlisted,
    refresh: load,
    streamState,
  };
}
