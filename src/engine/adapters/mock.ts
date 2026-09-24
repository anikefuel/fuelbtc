// Mock Provider Adapter — always active, used as final fallback
// Returns realistic simulated data for all checker types.

import type { ProviderResponse, ExecutionOptions } from '../types';
import type { ProviderAdapter } from '../ProviderManager';
import { MARKET_DATA, MOCK_ORDER_BOOK_BIDS, MOCK_ORDER_BOOK_ASKS, MOCK_RECENT_TRADES, MOCK_CANDLES } from '@/lib/mockData';
import type { MarketCoin, OrderBook, Trade, Candle } from '@/types';

type MockData = MarketCoin[] | OrderBook | Trade[] | Candle[] | Record<string, unknown>;

export class MockProviderAdapter implements ProviderAdapter<MockData> {
  readonly id = 'mock';
  readonly supportedCheckers = ['market_data', 'order_book', 'candles', 'trades', 'token_security', 'wallet_balance', 'transaction_history', 'blockchain_info', 'fiat_banking', 'launchpad'] as const;

  async execute(options: ExecutionOptions): Promise<ProviderResponse<MockData>> {
    const start = Date.now();

    let data: MockData;
    switch (options.checkerType) {
      case 'order_book':
        data = { asks: MOCK_ORDER_BOOK_ASKS, bids: MOCK_ORDER_BOOK_BIDS, lastUpdateId: 1, timestamp: Date.now() } satisfies OrderBook;
        break;
      case 'candles':
        data = MOCK_CANDLES;
        break;
      case 'trades':
        data = MOCK_RECENT_TRADES.map((t, i) => ({ id: String(i), ...t })) as Trade[];
        break;
      case 'token_security':
        data = {
          isHoneypot: false,
          isMintable: false,
          isProxy: false,
          transferTax: 0,
          holderCount: 12450,
          lpLockedPct: 92,
          ownerAddress: '0x0000000000000000000000000000000000000000',
          score: 85,
        };
        break;
      case 'wallet_balance':
        data = { balances: [{ asset: 'ETH', amount: 1.25, usdValue: 4375 }, { asset: 'USDT', amount: 500, usdValue: 500 }] };
        break;
      case 'transaction_history':
        data = { transactions: [], cursor: null };
        break;
      default:
        data = MARKET_DATA as MarketCoin[];
    }

    return {
      provider: 'mock',
      status: 'success',
      durationMs: Date.now() - start,
      confidence: 0.7,  // mock data is never 1.0 confidence
      data,
      evidence: ['Simulated mock data — replace with live provider'],
      warnings: ['Data is simulated'],
      error: null,
      retryCount: 0,
      cacheHit: false,
      metadata: { checkerType: options.checkerType },
    };
  }
}
