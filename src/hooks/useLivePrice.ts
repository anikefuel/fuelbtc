// useLivePrice — React hook for live price updates from MarketStream service
// Subscribes one symbol to the shared WebSocket stream.
// Returns the latest price update and connection health.

import { useState, useEffect, useRef } from 'react';
import { marketStream } from '@/services/marketStream.service';
import type { PriceUpdate, StreamHealth } from '@/services/marketStream.service';

interface UseLivePriceResult {
  price: number | null;
  update: PriceUpdate | null;
  health: StreamHealth;
  isLive: boolean;
}

export function useLivePrice(symbol: string | null | undefined): UseLivePriceResult {
  const [update, setUpdate] = useState<PriceUpdate | null>(
    symbol ? marketStream.getCachedPrice(symbol.toUpperCase()) : null,
  );
  const [health, setHealth] = useState<StreamHealth>(marketStream.getHealth());
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  useEffect(() => {
    if (!symbol) return;
    const key = symbol.toUpperCase();

    // Subscribe to price updates
    const unsubPrice = marketStream.subscribe(key, (u) => {
      if (symbolRef.current?.toUpperCase() === key) setUpdate(u);
    });

    // Subscribe to health
    const unsubHealth = marketStream.subscribeHealth(setHealth);

    return () => {
      unsubPrice();
      unsubHealth();
    };
  }, [symbol]);

  return {
    price:  update?.price ?? null,
    update,
    health,
    isLive: health.state === 'live' && !health.isStale,
  };
}
