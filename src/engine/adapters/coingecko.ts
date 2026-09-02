// CoinGecko Provider Adapter — market data (free public API, no key needed for basic tier)

import type { ProviderResponse, ExecutionOptions } from '../types';
import type { ProviderAdapter } from '../ProviderManager';
import { getProviderConfig } from '../config';
import type { MarketCoin } from '@/types';

export class CoinGeckoAdapter implements ProviderAdapter<MarketCoin[]> {
  readonly id = 'coingecko';
  readonly supportedCheckers = ['market_data'] as const;

  private get baseUrl(): string {
    return getProviderConfig('coingecko')?.baseUrl ?? 'https://api.coingecko.com/api/v3';
  }

  async execute(options: ExecutionOptions): Promise<ProviderResponse<MarketCoin[]>> {
    const start = Date.now();
    if (options.checkerType !== 'market_data') {
      return this.errorResponse('Unsupported checker type', start);
    }

    try {
      const params = new URLSearchParams({
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: '50',
        page: '1',
        sparkline: 'true',
        price_change_percentage: '24h',
      });

      const res = await fetch(`${this.baseUrl}/coins/markets?${params}`);
      if (!res.ok) {
        return {
          provider: 'coingecko', status: 'failed', durationMs: Date.now() - start,
          confidence: 0, data: null, evidence: [], warnings: [],
          error: `HTTP ${res.status}`, retryCount: 0, cacheHit: false,
          metadata: { httpStatus: res.status },
        };
      }

      const raw = await res.json() as CoinGeckoMarket[];
      const coins: MarketCoin[] = raw.map(c => ({
        symbol:       c.symbol.toUpperCase(),
        name:         c.name,
        price:        c.current_price,
        change24h:    c.price_change_percentage_24h ?? 0,
        change24hAmt: c.price_change_24h ?? 0,
        volume:       c.total_volume.toLocaleString(),
        volumeRaw:    c.total_volume,
        quoteVolume:  c.total_volume,
        high:         c.high_24h,
        low:          c.low_24h,
        bid:          0,
        ask:          0,
        sparkline:    c.sparkline_in_7d?.price ?? [],
        marketType:   'spot',
        isLive:       false,
        isDelayed:    false,
        lastUpdateMs: Date.now(),
        marketCap:    c.market_cap,
      }));

      return {
        provider: 'coingecko',
        status: 'success',
        durationMs: Date.now() - start,
        confidence: 0.95,
        data: coins,
        evidence: [`${coins.length} coins from CoinGecko markets endpoint`],
        warnings: [],
        error: null,
        retryCount: 0,
        cacheHit: false,
        metadata: { httpStatus: res.status, source: 'coingecko_markets' },
      };
    } catch (err) {
      return this.errorResponse((err as Error).message, start);
    }
  }

  private errorResponse(message: string, start: number): ProviderResponse<MarketCoin[]> {
    return {
      provider: 'coingecko', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: message, retryCount: 0, cacheHit: false, metadata: {},
    };
  }
}

interface CoinGeckoMarket {
  id: string; symbol: string; name: string; current_price: number;
  price_change_percentage_24h: number | null;
  price_change_24h: number | null;
  total_volume: number;
  market_cap: number; high_24h: number; low_24h: number;
  market_cap_rank: number;
  sparkline_in_7d?: { price: number[] };
}
