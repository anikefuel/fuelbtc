// Blockchain Provider Abstraction Layer
// Implements a provider-agnostic interface that can be backed by:
// Alchemy, QuickNode, GetBlock, Blockchair, TronGrid, Solana RPC,
// Fireblocks, BitGo, Copper, Binance Custody, etc.
// All external calls MUST go through Edge Functions — never call directly from client.
import { supabase } from '@/client/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ProviderName =
  | 'alchemy' | 'quicknode' | 'getblock' | 'blockchair'
  | 'trongrid' | 'solana_rpc' | 'fireblocks' | 'bitgo' | 'binance_custody' | 'internal';

export interface AddressValidation {
  isValid: boolean;
  network: string;
  requiresMemo: boolean;
  format?: string;
}

export interface FeeEstimate {
  fast:    number;
  standard: number;
  slow:    number;
  currency: string;
  estimatedTime: string;
}

export interface TxStatus {
  txHash:        string;
  status:        'pending' | 'confirming' | 'confirmed' | 'failed';
  confirmations: number;
  requiredConfs: number;
  blockHeight?:  number;
  fee?:          number;
  amount?:       number;
  from?:         string;
  to?:           string;
  timestamp?:    string;
}

export interface DepositMonitorResult {
  found:         boolean;
  txHash?:       string;
  amount?:       number;
  confirmations?: number;
  status?:       'pending' | 'confirming' | 'confirmed';
}

// ─── Provider Interface ───────────────────────────────────────────────────────
export interface BlockchainProvider {
  readonly name: ProviderName;
  readonly supportedAssets: string[];
  readonly supportedNetworks: string[];

  /** Generate or assign a deposit address for a user */
  generateAddress(asset: string, network: string, userId: string): Promise<{ address: string; memo?: string }>;

  /** Validate a recipient address */
  validateAddress(address: string, asset: string, network: string): Promise<AddressValidation>;

  /** Estimate network fee */
  estimateFee(asset: string, network: string, amount: number): Promise<FeeEstimate>;

  /** Broadcast a signed transaction */
  broadcastTransaction(signedTx: string, asset: string, network: string): Promise<{ txHash: string }>;

  /** Get transaction status */
  getTransactionStatus(txHash: string, network: string): Promise<TxStatus>;

  /** Get on-chain balance for an address */
  getAddressBalance(address: string, asset: string, network: string): Promise<number>;

  /** Check for new deposits to an address */
  monitorDeposit(address: string, asset: string, network: string, since?: string): Promise<DepositMonitorResult>;
}

// ─── Internal Stub Provider (development / test) ──────────────────────────────
class InternalStubProvider implements BlockchainProvider {
  readonly name: ProviderName = 'internal';
  readonly supportedAssets  = ['BTC','ETH','USDT','USDC','BNB','SOL','XRP','TRX','LTC','DOGE'];
  readonly supportedNetworks = ['bitcoin','ethereum','tron','bsc','solana','xrp','litecoin','dogecoin'];

  async generateAddress(asset: string, network: string, userId: string) {
    // In production this calls an Edge Function that invokes the custody provider
    const base = userId.replace(/-/g, '').slice(0, 12);
    const prefixes: Record<string, string> = {
      bitcoin: 'bc1q', ethereum: '0x', tron: 'T', bsc: '0x',
      solana: '', xrp: 'r', litecoin: 'ltc1q', dogecoin: 'D',
    };
    const prefix = prefixes[network] ?? '';
    const hasMemo = asset === 'XRP' || asset === 'XLM';
    return {
      address: `${prefix}${asset.toLowerCase()}${base}${network.slice(0,4)}stub`,
      memo: hasMemo ? String(Math.floor(Math.random() * 9000000 + 1000000)) : undefined,
    };
  }

  async validateAddress(address: string, _asset: string, _network: string): Promise<AddressValidation> {
    return { isValid: address.length > 10, network: _network, requiresMemo: false };
  }

  async estimateFee(asset: string, _network: string, _amount: number): Promise<FeeEstimate> {
    const fees: Record<string, number> = { BTC:0.00005, ETH:0.003, USDT:1, USDC:1, BNB:0.0005, SOL:0.01 };
    const fee = fees[asset] ?? 0.001;
    return { fast: fee, standard: fee * 1.2, slow: fee * 1.5, currency: asset, estimatedTime: '~5 min' };
  }

  async broadcastTransaction(_signedTx: string, _asset: string, _network: string) {
    return { txHash: '0xstub' + Math.random().toString(36).slice(2, 18) };
  }

  async getTransactionStatus(txHash: string, _network: string): Promise<TxStatus> {
    return { txHash, status: 'confirmed', confirmations: 12, requiredConfs: 12 };
  }

  async getAddressBalance(_address: string, _asset: string, _network: string): Promise<number> {
    return 0;
  }

  async monitorDeposit(_address: string, _asset: string, _network: string): Promise<DepositMonitorResult> {
    return { found: false };
  }
}

// ─── Edge-Function-backed Provider (production) ───────────────────────────────
// All real blockchain calls go through Supabase Edge Functions to keep private
// keys and API credentials off the client.
class EdgeFunctionProvider implements BlockchainProvider {
  readonly name: ProviderName = 'internal';
  readonly supportedAssets  = ['BTC','ETH','USDT','USDC','BNB','SOL','XRP','TRX','LTC','DOGE'];
  readonly supportedNetworks = ['bitcoin','ethereum','tron','bsc','solana','xrp','litecoin','dogecoin'];

  private async call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) {
      const msg = await error?.context?.text?.().catch(() => error.message);
      throw new Error(msg ?? error.message);
    }
    return data as T;
  }

  async generateAddress(asset: string, network: string, userId: string) {
    return this.call<{ address: string; memo?: string }>('wallet-generate-address', { asset, network, userId });
  }
  async validateAddress(address: string, asset: string, network: string) {
    return this.call<AddressValidation>('wallet-validate-address', { address, asset, network });
  }
  async estimateFee(asset: string, network: string, amount: number) {
    return this.call<FeeEstimate>('wallet-estimate-fee', { asset, network, amount });
  }
  async broadcastTransaction(signedTx: string, asset: string, network: string) {
    return this.call<{ txHash: string }>('wallet-broadcast-tx', { signedTx, asset, network });
  }
  async getTransactionStatus(txHash: string, network: string) {
    return this.call<TxStatus>('wallet-tx-status', { txHash, network });
  }
  async getAddressBalance(address: string, asset: string, network: string) {
    const res = await this.call<{ balance: number }>('wallet-address-balance', { address, asset, network });
    return res.balance;
  }
  async monitorDeposit(address: string, asset: string, network: string, since?: string) {
    return this.call<DepositMonitorResult>('wallet-monitor-deposit', { address, asset, network, since });
  }
}

// ─── Provider Registry ────────────────────────────────────────────────────────
class ProviderRegistry {
  private readonly stub = new InternalStubProvider();
  private readonly edge = new EdgeFunctionProvider();

  /** Returns edge provider in production, stub in dev/test */
  getProvider(_asset: string, _network: string): BlockchainProvider {
    // In a real deployment, select provider based on asset+network routing config
    // e.g. ETH/ERC20 → Alchemy, TRX → TronGrid, etc.
    // For now route everything through stub (Edge Functions not yet deployed)
    return this.stub;
  }

  /** Force stub for testing */
  getStub() { return this.stub; }
}

export const providerRegistry = new ProviderRegistry();

// ─── Convenience helpers ──────────────────────────────────────────────────────
export async function validateWithdrawalAddress(
  address: string, asset: string, network: string
): Promise<AddressValidation> {
  return providerRegistry.getProvider(asset, network).validateAddress(address, asset, network);
}

export async function estimateWithdrawalFee(
  asset: string, network: string, amount: number
): Promise<FeeEstimate> {
  return providerRegistry.getProvider(asset, network).estimateFee(asset, network, amount);
}

export async function generateDepositAddress(
  asset: string, network: string, userId: string
): Promise<{ address: string; memo?: string }> {
  return providerRegistry.getProvider(asset, network).generateAddress(asset, network, userId);
}
