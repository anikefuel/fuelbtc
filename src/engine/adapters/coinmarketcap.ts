// CoinMarketCap Provider Adapter — market data (requires API key via Edge Function)
// API key must NEVER be exposed on client — all CMC requests go through /api/cmc Edge Function.

import type { ProviderResponse, ExecutionOptions } from '../types';
import type { ProviderAdapter } from '../ProviderManager';
import type { MarketCoin } from '@/types';

export class CoinMarketCapAdapter implements ProviderAdapter<MarketCoin[]> {
  readonly id = 'coinmarketcap';
  readonly supportedCheckers = ['market_data'] as const;

  // Route through Edge Function to protect API key
  private readonly edgeFnUrl = '/api/cmc';

  async execute(options: ExecutionOptions): Promise<ProviderResponse<MarketCoin[]>> {
    const start = Date.now();
    if (options.checkerType !== 'market_data') {
      return this.errorResponse('Unsupported checker type', start);
    }

    try {
      // In production, call the Edge Function which holds the CMC API key server-side
      const res = await fetch(`${this.edgeFnUrl}?limit=50&convert=USD`);
      if (!res.ok) {
        return {
          provider: 'coinmarketcap', status: 'failed', durationMs: Date.now() - start,
          confidence: 0, data: null, evidence: [], warnings: [],
          error: `HTTP ${res.status}`, retryCount: 0, cacheHit: false,
          metadata: { httpStatus: res.status },
        };
      }

      const raw = await res.json() as { data: CMCCoin[] };
      const coins: MarketCoin[] = (raw.data ?? []).map(c => ({
        symbol:       c.symbol,
        name:         c.name,
        price:        c.quote.USD.price,
        change24h:    c.quote.USD.percent_change_24h,
        change24hAmt: 0,
        volume:       c.quote.USD.volume_24h.toLocaleString(),
        volumeRaw:    c.quote.USD.volume_24h,
        quoteVolume:  c.quote.USD.volume_24h,
        high:         0,
        low:          0,
        bid:          0,
        ask:          0,
        sparkline:    [],
        marketType:   'spot',
        isLive:       false,
        isDelayed:    false,
        lastUpdateMs: Date.now(),
        marketCap:    c.quote.USD.market_cap,
      }));

      return {
        provider: 'coinmarketcap',
        status: 'success',
        durationMs: Date.now() - start,
        confidence: 0.96,
        data: coins,
        evidence: [`${coins.length} coins from CoinMarketCap`],
        warnings: [],
        error: null,
        retryCount: 0,
        cacheHit: false,
        metadata: { httpStatus: res.status },
      };
    } catch (err) {
      return this.errorResponse((err as Error).message, start);
    }
  }

  private errorResponse(message: string, start: number): ProviderResponse<MarketCoin[]> {
    return {
      provider: 'coinmarketcap', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: message, retryCount: 0, cacheHit: false, metadata: {},
    };
  }
}

interface CMCCoin {
  id: number; symbol: string; name: string; cmc_rank: number;
  quote: { USD: { price: number; percent_change_24h: number; volume_24h: number; market_cap: number } };
}
