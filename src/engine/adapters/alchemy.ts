// Alchemy Provider Adapter — EVM wallet balance + transaction history (ETH / Polygon / Arbitrum)
// API key routes through Edge Function — never exposed client-side.

import type { ProviderResponse, ExecutionOptions } from '../types';
import type { ProviderAdapter } from '../ProviderManager';

export interface AlchemyWalletResult {
  address: string;
  ethBalance: number;
  tokenBalances: { contract: string; symbol: string; balance: number; decimals: number }[];
  network: string;
}

export class AlchemyAdapter implements ProviderAdapter<AlchemyWalletResult> {
  readonly id = 'alchemy';
  readonly supportedCheckers = ['wallet_balance', 'transaction_history', 'blockchain_info'] as const;

  // All Alchemy calls are proxied through our Edge Function to protect the API key
  private readonly edgeFnUrl = '/api/alchemy';

  async execute(options: ExecutionOptions): Promise<ProviderResponse<AlchemyWalletResult>> {
    const start = Date.now();

    const address = options.address;
    if (!address) return this.errorResponse('Address required for Alchemy', start);

    try {
      const res = await fetch(`${this.edgeFnUrl}?address=${address}&network=${options.network ?? 'ethereum'}&checker=${options.checkerType}`);

      if (!res.ok) {
        return {
          provider: 'alchemy', status: 'failed', durationMs: Date.now() - start,
          confidence: 0, data: null, evidence: [], warnings: [],
          error: `HTTP ${res.status}`, retryCount: 0, cacheHit: false,
          metadata: { httpStatus: res.status },
        };
      }

      const json = await res.json() as { ethBalance: string; tokenBalances: AlchemyTokenBalance[]; network: string };

      const result: AlchemyWalletResult = {
        address,
        ethBalance: parseInt(json.ethBalance ?? '0x0', 16) / 1e18,
        tokenBalances: (json.tokenBalances ?? []).map((t: AlchemyTokenBalance) => ({
          contract: t.contractAddress,
          symbol: t.metadata?.symbol ?? '???',
          balance: parseInt(t.tokenBalance ?? '0x0', 16) / Math.pow(10, t.metadata?.decimals ?? 18),
          decimals: t.metadata?.decimals ?? 18,
        })),
        network: json.network ?? options.network ?? 'ethereum',
      };

      return {
        provider: 'alchemy', status: 'success', durationMs: Date.now() - start,
        confidence: 0.98,
        data: result,
        evidence: [
          `ETH balance: ${result.ethBalance.toFixed(6)}`,
          `${result.tokenBalances.length} ERC-20 tokens found`,
        ],
        warnings: [],
        error: null,
        retryCount: 0,
        cacheHit: false,
        metadata: { httpStatus: res.status, network: result.network },
      };
    } catch (err) {
      return this.errorResponse((err as Error).message, start);
    }
  }

  private errorResponse(message: string, start: number): ProviderResponse<AlchemyWalletResult> {
    return {
      provider: 'alchemy', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: message, retryCount: 0, cacheHit: false, metadata: {},
    };
  }
}

interface AlchemyTokenBalance {
  contractAddress: string;
  tokenBalance: string;
  metadata?: { symbol: string; decimals: number };
}
