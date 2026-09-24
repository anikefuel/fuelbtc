// Platform-wide constants

export const APP_NAME = 'ExchangeX';
export const APP_TAGLINE = 'Trade Without Limits';
export const NATIVE_TOKEN = 'EXX';
export const DEFAULT_QUOTE_ASSET = 'USDT';
export const DEFAULT_FIAT_CURRENCY = 'NGN';
export const DEFAULT_LANGUAGE = 'en';

// Fee structure (displayed to users; enforced server-side)
export const FEE_STRUCTURE = {
  spot: { maker: 0.001, taker: 0.001 },          // 0.10%
  futures: { maker: 0.0002, taker: 0.0005 },      // 0.02% / 0.05%
  p2p: { buyer: 0.0, seller: 0.001 },             // 0% / 0.10%
  withdrawal: 'network-dependent',
  exxDiscount: 0.25,                               // 25% discount when paying fees with EXX
} as const;

// VIP level thresholds (30-day volume in USD)
export const VIP_LEVELS = [
  { level: 0, label: 'Regular', minVolume: 0, spotMaker: 0.001, spotTaker: 0.001 },
  { level: 1, label: 'VIP 1', minVolume: 50_000, spotMaker: 0.0009, spotTaker: 0.001 },
  { level: 2, label: 'VIP 2', minVolume: 250_000, spotMaker: 0.0008, spotTaker: 0.0009 },
  { level: 3, label: 'VIP 3', minVolume: 1_000_000, spotMaker: 0.0006, spotTaker: 0.0008 },
  { level: 4, label: 'VIP 4', minVolume: 5_000_000, spotMaker: 0.0004, spotTaker: 0.0007 },
  { level: 5, label: 'VIP 5', minVolume: 20_000_000, spotMaker: 0.0002, spotTaker: 0.0005 },
] as const;

// Futures leverage limits per tier
export const FUTURES_MAX_LEVERAGE: Record<string, number> = {
  'BTCUSDT': 125,
  'ETHUSDT': 100,
  'BNBUSDT': 75,
  'SOLUSDT': 50,
  'default': 20,
};

// P2P order expiry windows
export const P2P_WINDOWS = {
  paymentWindowMinutes: 15,
  disputeWindowHours: 48,
  autoReleaseHours: 1,
  maxActiveAdsPerMerchant: 5,
} as const;

// KYC withdrawal limits (USD per day)
export const KYC_LIMITS = {
  tier0: { withdrawalUsd: 0,        depositUsd: 0 },
  tier1: { withdrawalUsd: 10_000,   depositUsd: 50_000 },
  tier2: { withdrawalUsd: 100_000,  depositUsd: 500_000 },
  tier3: { withdrawalUsd: Infinity, depositUsd: Infinity },
} as const;

// Earn product config
export const EARN_CONFIG = {
  flexibleMinAmount: 10,
  fixedMinAmount: 100,
  stakingMinAmount: 0.01,
  rewardFrequency: 'daily',
} as const;

// Referral program
export const REFERRAL_CONFIG = {
  defaultCommissionRate: 0.20,   // 20% of referee's trading fees
  premiumCommissionRate: 0.40,   // 40% for VIP 3+
  maxReferralDepth: 1,           // single-level referral
  cookieExpiryDays: 30,
} as const;

// Pagination defaults
export const PAGINATION = {
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

// Cache TTLs (milliseconds)
export const CACHE_TTL = {
  marketData: 5_000,          // 5 seconds
  orderBook: 1_000,           // 1 second
  walletBalances: 10_000,     // 10 seconds
  userProfile: 60_000,        // 1 minute
  notifications: 30_000,      // 30 seconds
  earnProducts: 300_000,      // 5 minutes
} as const;

// Route deep-links
export const ROUTES = {
  home: '/(app)/(tabs)/home',
  markets: '/(app)/(tabs)/markets',
  trade: '/(app)/(tabs)/trade',
  p2p: '/(app)/(tabs)/p2p',
  wallet: '/(app)/(tabs)/wallet',
  earn: '/(app)/(tabs)/earn',
  profile: '/(app)/profile',
  signIn: '/(auth)/sign-in',
  signUp: '/(auth)/sign-up',
} as const;
