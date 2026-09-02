// Cryptocurrency asset registry
// Every asset the platform supports — database-driven in production, seeded from here

export interface AssetDefinition {
  symbol: string;
  name: string;
  coinGeckoId?: string;   // CoinGecko API identifier
  binanceSymbol?: string; // Binance ticker identifier
  decimals: number;       // on-chain decimal places
  displayDecimals: number; // UI decimal places
  icon: string;           // emoji fallback (replace with image URLs in production)
  color: string;          // brand color for charts/UI
  isFiat: boolean;
  isActive: boolean;
  canDeposit: boolean;
  canWithdraw: boolean;
  minWithdrawal: number;
  withdrawalFee: number;
  tags: string[];         // e.g. ['layer1', 'defi', 'stablecoin']
  explorerUrl?: string;
}

export const ASSET_REGISTRY: Record<string, AssetDefinition> = {
  BTC: {
    symbol: 'BTC', name: 'Bitcoin', coinGeckoId: 'bitcoin', binanceSymbol: 'BTC',
    decimals: 8, displayDecimals: 6, icon: '₿', color: '#F7931A',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 0.0005, withdrawalFee: 0.0001,
    tags: ['layer1', 'store-of-value'],
    explorerUrl: 'https://blockchair.com/bitcoin/transaction/',
  },
  ETH: {
    symbol: 'ETH', name: 'Ethereum', coinGeckoId: 'ethereum', binanceSymbol: 'ETH',
    decimals: 18, displayDecimals: 4, icon: 'Ξ', color: '#627EEA',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 0.01, withdrawalFee: 0.004,
    tags: ['layer1', 'smart-contract'],
    explorerUrl: 'https://etherscan.io/tx/',
  },
  BNB: {
    symbol: 'BNB', name: 'BNB', coinGeckoId: 'binancecoin', binanceSymbol: 'BNB',
    decimals: 18, displayDecimals: 4, icon: '⬡', color: '#F3BA2F',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 0.01, withdrawalFee: 0.0005,
    tags: ['layer1', 'exchange-token'],
    explorerUrl: 'https://bscscan.com/tx/',
  },
  SOL: {
    symbol: 'SOL', name: 'Solana', coinGeckoId: 'solana', binanceSymbol: 'SOL',
    decimals: 9, displayDecimals: 4, icon: '◎', color: '#9945FF',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 0.1, withdrawalFee: 0.01,
    tags: ['layer1', 'high-speed'],
    explorerUrl: 'https://explorer.solana.com/tx/',
  },
  USDT: {
    symbol: 'USDT', name: 'Tether USD', coinGeckoId: 'tether', binanceSymbol: 'USDT',
    decimals: 6, displayDecimals: 2, icon: '₮', color: '#26A17B',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 10, withdrawalFee: 1,
    tags: ['stablecoin', 'usd-pegged'],
    explorerUrl: 'https://etherscan.io/tx/',
  },
  USDC: {
    symbol: 'USDC', name: 'USD Coin', coinGeckoId: 'usd-coin', binanceSymbol: 'USDC',
    decimals: 6, displayDecimals: 2, icon: '$', color: '#2775CA',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 10, withdrawalFee: 1,
    tags: ['stablecoin', 'usd-pegged', 'regulated'],
    explorerUrl: 'https://etherscan.io/tx/',
  },
  XRP: {
    symbol: 'XRP', name: 'XRP', coinGeckoId: 'ripple', binanceSymbol: 'XRP',
    decimals: 6, displayDecimals: 4, icon: '✕', color: '#00AAE4',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 5, withdrawalFee: 0.25,
    tags: ['layer1', 'payments', 'remittance'],
    explorerUrl: 'https://xrpscan.com/tx/',
  },
  DOGE: {
    symbol: 'DOGE', name: 'Dogecoin', coinGeckoId: 'dogecoin', binanceSymbol: 'DOGE',
    decimals: 8, displayDecimals: 2, icon: 'Ð', color: '#C2A633',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 50, withdrawalFee: 2,
    tags: ['meme', 'payments'],
    explorerUrl: 'https://blockchair.com/dogecoin/transaction/',
  },
  ADA: {
    symbol: 'ADA', name: 'Cardano', coinGeckoId: 'cardano', binanceSymbol: 'ADA',
    decimals: 6, displayDecimals: 4, icon: '₳', color: '#0033AD',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 5, withdrawalFee: 1,
    tags: ['layer1', 'smart-contract', 'academic'],
    explorerUrl: 'https://cardanoscan.io/transaction/',
  },
  AVAX: {
    symbol: 'AVAX', name: 'Avalanche', coinGeckoId: 'avalanche-2', binanceSymbol: 'AVAX',
    decimals: 18, displayDecimals: 4, icon: '△', color: '#E84142',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 0.1, withdrawalFee: 0.01,
    tags: ['layer1', 'smart-contract', 'high-speed'],
    explorerUrl: 'https://snowtrace.io/tx/',
  },
  MATIC: {
    symbol: 'MATIC', name: 'Polygon', coinGeckoId: 'matic-network', binanceSymbol: 'MATIC',
    decimals: 18, displayDecimals: 4, icon: '⬟', color: '#8247E5',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 5, withdrawalFee: 0.1,
    tags: ['layer2', 'ethereum-scaling'],
    explorerUrl: 'https://polygonscan.com/tx/',
  },
  LTC: {
    symbol: 'LTC', name: 'Litecoin', coinGeckoId: 'litecoin', binanceSymbol: 'LTC',
    decimals: 8, displayDecimals: 4, icon: 'Ł', color: '#BFBBBB',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 0.05, withdrawalFee: 0.001,
    tags: ['layer1', 'payments', 'bitcoin-fork'],
    explorerUrl: 'https://blockchair.com/litecoin/transaction/',
  },
  TRX: {
    symbol: 'TRX', name: 'TRON', coinGeckoId: 'tron', binanceSymbol: 'TRX',
    decimals: 6, displayDecimals: 2, icon: '⟁', color: '#FF0013',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 100, withdrawalFee: 1,
    tags: ['layer1', 'entertainment'],
    explorerUrl: 'https://tronscan.org/#/transaction/',
  },
  EXX: {
    symbol: 'EXX', name: 'ExchangeX Token', coinGeckoId: undefined, binanceSymbol: undefined,
    decimals: 18, displayDecimals: 4, icon: '✦', color: '#0EA5E9',
    isFiat: false, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 10, withdrawalFee: 1,
    tags: ['exchange-token', 'native'],
    explorerUrl: undefined,
  },
  NGN: {
    symbol: 'NGN', name: 'Nigerian Naira', coinGeckoId: undefined, binanceSymbol: undefined,
    decimals: 2, displayDecimals: 2, icon: '₦', color: '#008751',
    isFiat: true, isActive: true, canDeposit: true, canWithdraw: true,
    minWithdrawal: 1000, withdrawalFee: 50,
    tags: ['fiat', 'ngn', 'africa'],
    explorerUrl: undefined,
  },
};

/** Quick lookup helpers */
export const getAsset = (symbol: string): AssetDefinition | undefined =>
  ASSET_REGISTRY[symbol.toUpperCase()];

export const getActiveAssets = (): AssetDefinition[] =>
  Object.values(ASSET_REGISTRY).filter(a => a.isActive);

export const getCryptoAssets = (): AssetDefinition[] =>
  Object.values(ASSET_REGISTRY).filter(a => !a.isFiat && a.isActive);

export const getFiatAssets = (): AssetDefinition[] =>
  Object.values(ASSET_REGISTRY).filter(a => a.isFiat && a.isActive);

export const COIN_EMOJI_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ASSET_REGISTRY).map(([k, v]) => [k, v.icon])
);
