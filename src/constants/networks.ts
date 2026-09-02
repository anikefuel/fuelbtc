// Blockchain network registry
// Defines supported deposit/withdrawal networks per asset

export interface NetworkDefinition {
  id: string;           // internal network ID  e.g. "eth_erc20"
  name: string;         // display name  e.g. "Ethereum (ERC-20)"
  chainId?: number;     // EVM chain ID
  nativeCoin: string;   // e.g. "ETH"
  symbol: string;       // short label e.g. "ERC-20"
  avgConfirmTime: string; // e.g. "~5 min"
  confirmationsRequired: number;
  isActive: boolean;
  explorerBaseUrl: string;
  addressRegex?: string; // validation pattern
  memoRequired: boolean;
  withdrawalFeeAsset: string; // asset the fee is charged in
}

export const NETWORK_REGISTRY: Record<string, NetworkDefinition> = {
  bitcoin: {
    id: 'bitcoin', name: 'Bitcoin Network', nativeCoin: 'BTC', symbol: 'BTC',
    avgConfirmTime: '~30 min', confirmationsRequired: 3, isActive: true,
    explorerBaseUrl: 'https://blockchair.com/bitcoin/transaction/',
    addressRegex: '^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$',
    memoRequired: false, withdrawalFeeAsset: 'BTC',
  },
  eth_erc20: {
    id: 'eth_erc20', name: 'Ethereum (ERC-20)', chainId: 1, nativeCoin: 'ETH', symbol: 'ERC-20',
    avgConfirmTime: '~5 min', confirmationsRequired: 12, isActive: true,
    explorerBaseUrl: 'https://etherscan.io/tx/',
    addressRegex: '^0x[a-fA-F0-9]{40}$',
    memoRequired: false, withdrawalFeeAsset: 'ETH',
  },
  bsc_bep20: {
    id: 'bsc_bep20', name: 'BNB Smart Chain (BEP-20)', chainId: 56, nativeCoin: 'BNB', symbol: 'BEP-20',
    avgConfirmTime: '~3 min', confirmationsRequired: 15, isActive: true,
    explorerBaseUrl: 'https://bscscan.com/tx/',
    addressRegex: '^0x[a-fA-F0-9]{40}$',
    memoRequired: false, withdrawalFeeAsset: 'BNB',
  },
  tron_trc20: {
    id: 'tron_trc20', name: 'TRON (TRC-20)', nativeCoin: 'TRX', symbol: 'TRC-20',
    avgConfirmTime: '~3 min', confirmationsRequired: 20, isActive: true,
    explorerBaseUrl: 'https://tronscan.org/#/transaction/',
    addressRegex: '^T[a-zA-Z0-9]{33}$',
    memoRequired: false, withdrawalFeeAsset: 'TRX',
  },
  solana: {
    id: 'solana', name: 'Solana', nativeCoin: 'SOL', symbol: 'SOL',
    avgConfirmTime: '~30 sec', confirmationsRequired: 32, isActive: true,
    explorerBaseUrl: 'https://explorer.solana.com/tx/',
    memoRequired: false, withdrawalFeeAsset: 'SOL',
  },
  ripple: {
    id: 'ripple', name: 'Ripple (XRP Ledger)', nativeCoin: 'XRP', symbol: 'XRP',
    avgConfirmTime: '~5 sec', confirmationsRequired: 1, isActive: true,
    explorerBaseUrl: 'https://xrpscan.com/tx/',
    memoRequired: true, withdrawalFeeAsset: 'XRP',
  },
  polygon: {
    id: 'polygon', name: 'Polygon (MATIC)', chainId: 137, nativeCoin: 'MATIC', symbol: 'MATIC',
    avgConfirmTime: '~5 min', confirmationsRequired: 128, isActive: true,
    explorerBaseUrl: 'https://polygonscan.com/tx/',
    addressRegex: '^0x[a-fA-F0-9]{40}$',
    memoRequired: false, withdrawalFeeAsset: 'MATIC',
  },
  bank_transfer_ng: {
    id: 'bank_transfer_ng', name: 'Nigerian Bank Transfer (9PSB)', nativeCoin: 'NGN', symbol: 'NGN',
    avgConfirmTime: '~2 min', confirmationsRequired: 1, isActive: true,
    explorerBaseUrl: '',
    memoRequired: false, withdrawalFeeAsset: 'NGN',
  },
};

/** Networks supported per asset symbol */
export const ASSET_NETWORKS: Record<string, string[]> = {
  BTC: ['bitcoin'],
  ETH: ['eth_erc20'],
  BNB: ['bsc_bep20'],
  SOL: ['solana'],
  USDT: ['eth_erc20', 'bsc_bep20', 'tron_trc20', 'solana'],
  USDC: ['eth_erc20', 'bsc_bep20', 'solana'],
  XRP: ['ripple'],
  DOGE: [],
  ADA: [],
  AVAX: ['eth_erc20'],
  MATIC: ['polygon', 'eth_erc20'],
  LTC: [],
  TRX: ['tron_trc20'],
  EXX: ['bsc_bep20', 'eth_erc20'],
  NGN: ['bank_transfer_ng'],
};

export const getNetworksForAsset = (symbol: string): NetworkDefinition[] => {
  const ids = ASSET_NETWORKS[symbol.toUpperCase()] ?? [];
  return ids.map(id => NETWORK_REGISTRY[id]).filter(Boolean);
};
