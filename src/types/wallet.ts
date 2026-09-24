// Wallet & balance types

export type WalletType = 'spot' | 'futures' | 'earn' | 'fiat' | 'funding' | 'margin' | 'p2p';

export interface WalletBalance {
  id?: string;
  userId?: string;
  walletType: WalletType;
  asset: string;
  balance: number;
  lockedBalance: number;
  usdValue: number;
}

export interface WalletAsset {
  asset: string;
  name: string;
  balance: number;
  lockedBalance: number;
  usdValue: number;
  icon: string;
  depositAddress?: string;
  network?: string;
  logoUrl?: string;
}

export type TxType = 'deposit' | 'withdrawal' | 'trade' | 'transfer' | 'reward' | 'fee';
export type TxStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface Transaction {
  id: string;
  userId?: string;
  txType: TxType;
  asset: string;
  amount: number;
  fee?: number;
  status: TxStatus;
  txHash?: string;
  address?: string;
  network?: string;
  notes?: string;
  createdAt: string;
}

export interface DepositRequest {
  asset: string;
  network: string;
  walletType: WalletType;
}

export interface WithdrawRequest {
  asset: string;
  network: string;
  address: string;
  amount: number;
  walletType: WalletType;
}

export interface WalletSummary {
  totalUsd: number;
  spotUsd: number;
  futuresUsd: number;
  earnUsd: number;
  fiatUsd: number;
}
