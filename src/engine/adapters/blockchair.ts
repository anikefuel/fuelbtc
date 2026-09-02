// Blockchair Provider Adapter — multi-chain blockchain explorer
// Covers BTC, ETH, LTC, BCH, BNB, DOGE, ADA, SOL, XRP, MATIC

import type { ProviderResponse, ExecutionOptions } from '../types';
import type { ProviderAdapter } from '../ProviderManager';
import { getProviderConfig } from '../config';

export interface WalletBalanceResult {
  address: string;
  balance: number;
  balanceUsd: number;
  txCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  network: string;
}

export interface TransactionHistoryResult {
  transactions: BlockchairTx[];
  totalCount: number;
}

export interface BlockchairTx {
  hash: string;
  time: string;
  blockHeight: number;
  inputCount: number;
  outputCount: number;
  valueUsd: number;
  fee: number;
  confirmed: boolean;
}

type BlockchairData = WalletBalanceResult | TransactionHistoryResult;

export class BlockchairAdapter implements ProviderAdapter<BlockchairData> {
  readonly id = 'blockchair';
  readonly supportedCheckers = ['wallet_balance', 'transaction_history', 'blockchain_info'] as const;

  private get baseUrl(): string {
    return getProviderConfig('blockchair')?.baseUrl ?? 'https://api.blockchair.com';
  }

  async execute(options: ExecutionOptions): Promise<ProviderResponse<BlockchairData>> {
    const start = Date.now();

    try {
      switch (options.checkerType) {
        case 'wallet_balance':   return await this.fetchBalance(start, options);
        case 'transaction_history': return await this.fetchTxHistory(start, options);
        default:
          return this.errorResponse('Unsupported checker type', start);
      }
    } catch (err) {
      return this.errorResponse((err as Error).message, start);
    }
  }

  private async fetchBalance(start: number, options: ExecutionOptions): Promise<ProviderResponse<WalletBalanceResult>> {
    const address = options.address;
    if (!address) return this.errorResponse('Address required', start) as ProviderResponse<WalletBalanceResult>;

    const chain = this.resolveChain(options.network ?? 'bitcoin');
    const res = await fetch(`${this.baseUrl}/${chain}/dashboards/address/${address}`);
    if (!res.ok) return this.httpError(res.status, start) as ProviderResponse<WalletBalanceResult>;

    const json = await res.json() as BlockchairAddressResponse;
    const d = json.data?.[address]?.address;
    if (!d) return this.errorResponse('Address not found', start) as ProviderResponse<WalletBalanceResult>;

    const result: WalletBalanceResult = {
      address,
      balance: d.balance / 1e8,
      balanceUsd: d.balance_usd,
      txCount: d.transaction_count,
      firstSeen: d.first_seen_receiving,
      lastSeen: d.last_seen_receiving,
      network: chain,
    };

    return {
      provider: 'blockchair', status: 'success', durationMs: Date.now() - start,
      confidence: 0.97, data: result,
      evidence: [`Balance: ${result.balance} ${chain.toUpperCase().split('/')[0]}`, `${result.txCount} transactions`],
      warnings: [], error: null, retryCount: 0, cacheHit: false,
      metadata: { chain, address, httpStatus: res.status },
    };
  }

  private async fetchTxHistory(start: number, options: ExecutionOptions): Promise<ProviderResponse<TransactionHistoryResult>> {
    const address = options.address;
    if (!address) return this.errorResponse('Address required', start) as ProviderResponse<TransactionHistoryResult>;

    const chain = this.resolveChain(options.network ?? 'bitcoin');
    const limit = options.limit ?? 25;
    const res = await fetch(`${this.baseUrl}/${chain}/dashboards/address/${address}?transaction_details=true&limit=${limit}`);
    if (!res.ok) return this.httpError(res.status, start) as ProviderResponse<TransactionHistoryResult>;

    const json = await res.json() as BlockchairAddressResponse;
    const d = json.data?.[address];
    if (!d) return this.errorResponse('Address not found', start) as ProviderResponse<TransactionHistoryResult>;

    const txs: BlockchairTx[] = (d.transactions ?? []).map((t: BlockchairRawTx) => ({
      hash: t.hash,
      time: t.time,
      blockHeight: t.block_id,
      inputCount: t.input_count,
      outputCount: t.output_count,
      valueUsd: t.value_usd,
      fee: t.fee,
      confirmed: t.block_id > 0,
    }));

    return {
      provider: 'blockchair', status: 'success', durationMs: Date.now() - start,
      confidence: 0.97, data: { transactions: txs, totalCount: d.address?.transaction_count ?? 0 },
      evidence: [`${txs.length} transactions fetched`],
      warnings: [], error: null, retryCount: 0, cacheHit: false,
      metadata: { httpStatus: res.status },
    };
  }

  private resolveChain(network: string): string {
    const map: Record<string, string> = {
      bitcoin: 'bitcoin', btc: 'bitcoin',
      ethereum: 'ethereum', eth: 'ethereum',
      bsc: 'bnb', bnb: 'bnb',
      litecoin: 'litecoin', ltc: 'litecoin',
      dogecoin: 'dogecoin', doge: 'dogecoin',
      cardano: 'cardano', ada: 'cardano',
      ripple: 'ripple', xrp: 'ripple',
    };
    return map[network.toLowerCase()] ?? 'bitcoin';
  }

  private httpError(httpStatus: number, start: number): ProviderResponse<never> {
    return {
      provider: 'blockchair', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: `HTTP ${httpStatus}`, retryCount: 0, cacheHit: false,
      metadata: { httpStatus },
    };
  }

  private errorResponse(message: string, start: number): ProviderResponse<never> {
    return {
      provider: 'blockchair', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: message, retryCount: 0, cacheHit: false, metadata: {},
    };
  }
}

interface BlockchairAddressResponse {
  data?: Record<string, {
    address?: { balance: number; balance_usd: number; transaction_count: number; first_seen_receiving: string; last_seen_receiving: string };
    transactions?: BlockchairRawTx[];
  }>;
}
interface BlockchairRawTx {
  hash: string; time: string; block_id: number; input_count: number;
  output_count: number; value_usd: number; fee: number;
}
