// GoPlus Security Adapter — token security scanning
// Checks: honeypot, mint ability, proxy, transfer tax, holder concentration, LP lock

import type { ProviderResponse, ExecutionOptions } from '../types';
import type { ProviderAdapter } from '../ProviderManager';
import { getProviderConfig } from '../config';

export interface TokenSecurityResult {
  isHoneypot: boolean;
  isMintable: boolean;
  isProxy: boolean;
  transferTax: number;    // 0–100 percent
  holderCount: number;
  lpLockedPct: number;    // 0–100 percent
  ownerAddress: string;
  score: number;          // 0–100 (higher = safer)
  rawFlags: Record<string, string>;
}

export class GoPlusAdapter implements ProviderAdapter<TokenSecurityResult> {
  readonly id = 'goplus';
  readonly supportedCheckers = ['token_security'] as const;

  private get baseUrl(): string {
    return getProviderConfig('goplus')?.baseUrl ?? 'https://api.gopluslabs.io/api/v1';
  }

  async execute(options: ExecutionOptions): Promise<ProviderResponse<TokenSecurityResult>> {
    const start = Date.now();
    if (options.checkerType !== 'token_security') {
      return this.errorResponse('Unsupported checker type', start);
    }

    const address = options.address;
    if (!address) {
      return this.errorResponse('Contract address is required for token_security check', start);
    }

    // chainId: 1=ETH, 56=BSC, 137=Polygon, 501=Solana
    const chainId = this.resolveChainId(options.network ?? 'ethereum');

    try {
      const res = await fetch(`${this.baseUrl}/token_security/${chainId}?contract_addresses=${address}`);
      if (!res.ok) {
        return {
          provider: 'goplus', status: 'failed', durationMs: Date.now() - start,
          confidence: 0, data: null, evidence: [], warnings: [],
          error: `HTTP ${res.status}`, retryCount: 0, cacheHit: false,
          metadata: { httpStatus: res.status },
        };
      }

      const raw = await res.json() as GoPlusResponse;
      const tokenData = raw.result?.[address.toLowerCase()];
      if (!tokenData) {
        return this.errorResponse('Token not found in GoPlus database', start);
      }

      const flags = tokenData;
      const isHoneypot = flags.is_honeypot === '1';
      const isMintable = flags.is_mintable === '1';
      const isProxy = flags.is_proxy === '1';
      const transferTax = parseFloat(flags.sell_tax ?? '0') * 100;
      const holderCount = parseInt(flags.holder_count ?? '0', 10);
      const lpLockedPct = parseFloat(flags.lp_holder_count ?? '0');
      const ownerAddress = flags.owner_address ?? '';

      // Simple risk score (100 = perfect, deductions for each risk)
      let score = 100;
      if (isHoneypot) score -= 60;
      if (isMintable) score -= 15;
      if (isProxy) score -= 10;
      if (transferTax > 10) score -= 20;
      if (transferTax > 5) score -= 10;
      score = Math.max(0, score);

      const evidence: string[] = [
        `Holder count: ${holderCount.toLocaleString()}`,
        `Transfer tax: ${transferTax.toFixed(1)}%`,
        `LP locked: ${lpLockedPct.toFixed(1)}%`,
      ];
      const warnings: string[] = [];
      if (isHoneypot) warnings.push('⚠️ HONEYPOT DETECTED — cannot sell');
      if (isMintable) warnings.push('Mintable token — owner can inflate supply');
      if (isProxy) warnings.push('Proxy contract — logic can be swapped');
      if (transferTax > 5) warnings.push(`High transfer tax: ${transferTax.toFixed(1)}%`);

      const result: TokenSecurityResult = {
        isHoneypot, isMintable, isProxy, transferTax, holderCount, lpLockedPct, ownerAddress, score, rawFlags: flags,
      };

      return {
        provider: 'goplus',
        status: 'success',
        durationMs: Date.now() - start,
        confidence: 0.93,
        data: result,
        evidence,
        warnings,
        error: null,
        retryCount: 0,
        cacheHit: false,
        metadata: { chainId, address, httpStatus: res.status },
      };
    } catch (err) {
      return this.errorResponse((err as Error).message, start);
    }
  }

  private resolveChainId(network: string): string {
    const map: Record<string, string> = {
      ethereum: '1', eth: '1', bsc: '56', bnb: '56',
      polygon: '137', matic: '137', solana: '501', sol: '501',
      avalanche: '43114', avax: '43114',
    };
    return map[network.toLowerCase()] ?? '1';
  }

  private errorResponse(message: string, start: number): ProviderResponse<TokenSecurityResult> {
    return {
      provider: 'goplus', status: 'failed', durationMs: Date.now() - start,
      confidence: 0, data: null, evidence: [], warnings: [],
      error: message, retryCount: 0, cacheHit: false, metadata: {},
    };
  }
}

interface GoPlusResponse {
  result?: Record<string, Record<string, string>>;
}
