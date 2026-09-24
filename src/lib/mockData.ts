// Mock data for ExchangeX prototype — used only as final fallback (priority 99)
// Real market data comes from Binance (priority 1). These values are never shown
// in production when Binance is reachable.

import type { MarketCoin } from '@/types';

const now = Date.now();

export const MARKET_DATA: MarketCoin[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: 67842.50, change24h: 2.34, change24hAmt: 1553.5, volume: '28.5B', volumeRaw: 28500000000, quoteVolume: 28500000000, high: 68900, low: 66200, bid: 67840, ask: 67845, sparkline: [62000, 63500, 64200, 65800, 66900, 67200, 67842], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'ETH', name: 'Ethereum', price: 3521.80, change24h: -1.12, change24hAmt: -39.9, volume: '14.2B', volumeRaw: 14200000000, quoteVolume: 14200000000, high: 3620, low: 3480, bid: 3521, ask: 3522.5, sparkline: [3400, 3450, 3520, 3490, 3600, 3550, 3521], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'BNB', name: 'BNB', price: 598.40, change24h: 0.87, change24hAmt: 5.2, volume: '2.1B', volumeRaw: 2100000000, quoteVolume: 2100000000, high: 608, low: 588, bid: 598, ask: 598.8, sparkline: [575, 582, 590, 595, 601, 598, 598], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'SOL', name: 'Solana', price: 182.60, change24h: 4.21, change24hAmt: 7.4, volume: '3.8B', volumeRaw: 3800000000, quoteVolume: 3800000000, high: 189, low: 174, bid: 182.4, ask: 182.8, sparkline: [165, 170, 175, 178, 183, 181, 182], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'XRP', name: 'XRP', price: 0.6234, change24h: -0.43, change24hAmt: -0.003, volume: '1.9B', volumeRaw: 1900000000, quoteVolume: 1900000000, high: 0.645, low: 0.612, bid: 0.623, ask: 0.624, sparkline: [0.61, 0.625, 0.63, 0.618, 0.640, 0.635, 0.623], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'DOGE', name: 'Dogecoin', price: 0.1842, change24h: 3.56, change24hAmt: 0.006, volume: '0.9B', volumeRaw: 900000000, quoteVolume: 900000000, high: 0.192, low: 0.177, bid: 0.1840, ask: 0.1843, sparkline: [0.170, 0.175, 0.180, 0.183, 0.189, 0.187, 0.184], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'TRX', name: 'TRON', price: 0.1234, change24h: -1.34, change24hAmt: -0.002, volume: '0.5B', volumeRaw: 500000000, quoteVolume: 500000000, high: 0.128, low: 0.120, bid: 0.1233, ask: 0.1235, sparkline: [0.122, 0.124, 0.126, 0.123, 0.125, 0.124, 0.123], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'LTC', name: 'Litecoin', price: 88.32, change24h: 0.54, change24hAmt: 0.48, volume: '0.3B', volumeRaw: 300000000, quoteVolume: 300000000, high: 90.5, low: 86.8, bid: 88.2, ask: 88.4, sparkline: [85, 86, 87, 88, 89, 88.5, 88.3], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
  { symbol: 'USDC', name: 'USD Coin', price: 1.0, change24h: 0.01, change24hAmt: 0.0001, volume: '0.2B', volumeRaw: 200000000, quoteVolume: 200000000, high: 1.001, low: 0.999, bid: 0.9998, ask: 1.0002, sparkline: [1, 1, 1, 1, 1, 1, 1], marketType: 'spot', isLive: false, isDelayed: true, lastUpdateMs: now },
];

export const TRADING_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT',
  'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'EXX/USDT', 'LTC/USDT',
];

export const MOCK_ORDER_BOOK_ASKS = [
  { price: 67912.00, amount: 0.2341, total: 1.245 },
  { price: 67905.50, amount: 0.5820, total: 1.011 },
  { price: 67898.20, amount: 1.1200, total: 0.429 },
  { price: 67891.00, amount: 0.3450, total: 0.309 },
  { price: 67884.80, amount: 0.8900, total: 0.891 },
  { price: 67878.40, amount: 0.2100, total: 0.210 },
  { price: 67871.20, amount: 0.4560, total: 0.456 },
  { price: 67864.90, amount: 0.6780, total: 0.678 },
];

export const MOCK_ORDER_BOOK_BIDS = [
  { price: 67842.50, amount: 0.4120, total: 0.412 },
  { price: 67835.80, amount: 0.9340, total: 1.346 },
  { price: 67829.20, amount: 0.2890, total: 0.289 },
  { price: 67822.60, amount: 0.7650, total: 0.765 },
  { price: 67816.10, amount: 0.3210, total: 0.321 },
  { price: 67809.50, amount: 1.4500, total: 1.771 },
  { price: 67803.80, amount: 0.5670, total: 0.567 },
  { price: 67797.20, amount: 0.2340, total: 0.234 },
];

export const MOCK_RECENT_TRADES = [
  { price: 67842.50, amount: 0.124, time: '14:32:01', isBuy: true },
  { price: 67839.80, amount: 0.056, time: '14:31:58', isBuy: false },
  { price: 67845.20, amount: 0.234, time: '14:31:55', isBuy: true },
  { price: 67848.60, amount: 0.089, time: '14:31:52', isBuy: true },
  { price: 67835.40, amount: 0.412, time: '14:31:49', isBuy: false },
  { price: 67831.90, amount: 0.167, time: '14:31:46', isBuy: false },
  { price: 67838.20, amount: 0.302, time: '14:31:43', isBuy: true },
  { price: 67842.10, amount: 0.091, time: '14:31:40', isBuy: true },
];

export const MOCK_CANDLES = [
  { o: 65800, h: 66500, l: 65200, c: 66200 },
  { o: 66200, h: 67100, l: 65900, c: 66800 },
  { o: 66800, h: 67500, l: 66400, c: 67200 },
  { o: 67200, h: 68100, l: 66900, c: 67600 },
  { o: 67600, h: 68500, l: 67200, c: 67900 },
  { o: 67900, h: 68800, l: 67500, c: 68200 },
  { o: 68200, h: 68900, l: 67800, c: 67842 },
  { o: 67842, h: 68300, l: 67500, c: 67900 },
  { o: 67900, h: 68100, l: 67600, c: 67842 },
  { o: 67600, h: 67950, l: 67200, c: 67720 },
  { o: 67720, h: 68200, l: 67500, c: 67842 },
  { o: 67842, h: 68100, l: 67600, c: 68000 },
];

export const MOCK_P2P_ADS = [
  {
    id: '1',
    merchantName: 'CryptoKing_NG',
    completionRate: 98.5,
    tradeCount: 1240,
    price: 1820.50,
    available: 5000,
    minLimit: 10000,
    maxLimit: 500000,
    paymentMethods: ['Bank Transfer', 'Opay'],
    asset: 'USDT',
    fiat: 'NGN',
    side: 'sell' as const,
    isOnline: true,
  },
  {
    id: '2',
    merchantName: 'FastTrader_Abuja',
    completionRate: 96.2,
    tradeCount: 875,
    price: 1818.00,
    available: 2500,
    minLimit: 5000,
    maxLimit: 300000,
    paymentMethods: ['Bank Transfer', 'Palmpay'],
    asset: 'USDT',
    fiat: 'NGN',
    side: 'sell' as const,
    isOnline: true,
  },
  {
    id: '3',
    merchantName: 'NGN_Exchange_Pro',
    completionRate: 99.1,
    tradeCount: 3200,
    price: 1822.00,
    available: 10000,
    minLimit: 20000,
    maxLimit: 1000000,
    paymentMethods: ['Bank Transfer'],
    asset: 'USDT',
    fiat: 'NGN',
    side: 'sell' as const,
    isOnline: false,
  },
  {
    id: '4',
    merchantName: 'TrustMerchant',
    completionRate: 97.8,
    tradeCount: 654,
    price: 1815.00,
    available: 8000,
    minLimit: 50000,
    maxLimit: 2000000,
    paymentMethods: ['Bank Transfer', 'Kuda'],
    asset: 'USDT',
    fiat: 'NGN',
    side: 'buy' as const,
    isOnline: true,
  },
];

export const MOCK_WALLET_ASSETS = [
  { asset: 'USDT', name: 'Tether', balance: 4521.82, usdValue: 4521.82, icon: '💵', depositAddress: '0x742d35Cc6634C0532925a3b8D4C9Ce3' },
  { asset: 'BTC', name: 'Bitcoin', balance: 0.08432, usdValue: 5717.24, icon: '₿', depositAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
  { asset: 'ETH', name: 'Ethereum', balance: 1.2340, usdValue: 4345.90, icon: 'Ξ', depositAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' },
  { asset: 'BNB', name: 'BNB', balance: 5.8200, usdValue: 3482.89, icon: '⬡', depositAddress: 'bnb1jxfh2g85q3v0tdq56fnevx6xcxtcnhtsmcu64m' },
  { asset: 'SOL', name: 'Solana', balance: 12.500, usdValue: 2282.50, icon: '◎', depositAddress: '4Nd1mBQtrMJVYVfKf2PX98ej9DkXTQ3ADkAoGbqQV5n' },
  { asset: 'EXX', name: 'ExchangeX', balance: 2500.00, usdValue: 7117.50, icon: '✦', depositAddress: '0x742d35Cc6634C0532925a3b8D4C9Ce3abcd1234' },
  { asset: 'NGN', name: 'Nigerian Naira', balance: 125000, usdValue: 83.33, icon: '₦', depositAddress: '' },
];

export const MOCK_TRANSACTIONS = [
  { id: '1', type: 'deposit' as const, asset: 'USDT', amount: 1000, status: 'completed' as const, time: '2024-06-20 14:32', txHash: '0x1a2b3c...' },
  { id: '2', type: 'trade' as const, asset: 'BTC', amount: 0.05, status: 'completed' as const, time: '2024-06-20 11:15', txHash: 'internal' },
  { id: '3', type: 'reward' as const, asset: 'USDT', amount: 12.45, status: 'completed' as const, time: '2024-06-19 08:00', txHash: 'earn_reward' },
  { id: '4', type: 'withdrawal' as const, asset: 'ETH', amount: 0.5, status: 'pending' as const, time: '2024-06-19 16:40', txHash: '0x4d5e6f...' },
  { id: '5', type: 'deposit' as const, asset: 'BNB', amount: 2.0, status: 'completed' as const, time: '2024-06-18 09:22', txHash: '0x7g8h9i...' },
  { id: '6', type: 'trade' as const, asset: 'SOL', amount: 5.0, status: 'completed' as const, time: '2024-06-18 13:05', txHash: 'internal' },
];

export const MOCK_EARN_PRODUCTS = [
  // Flexible
  { id: 'f1', name: 'USDT Flexible', asset: 'USDT', type: 'flexible' as const, apy: 4.5, minAmount: 10, userBalance: 1200 },
  { id: 'f2', name: 'BTC Flexible', asset: 'BTC', type: 'flexible' as const, apy: 1.2, minAmount: 0.001, userBalance: 0 },
  { id: 'f3', name: 'ETH Flexible', asset: 'ETH', type: 'flexible' as const, apy: 2.8, minAmount: 0.01, userBalance: 0.5 },
  { id: 'f4', name: 'EXX Flexible', asset: 'EXX', type: 'flexible' as const, apy: 12.0, minAmount: 100, userBalance: 500 },
  // Fixed
  { id: 'fx1', name: 'USDT 7-Day', asset: 'USDT', type: 'fixed' as const, apy: 6.0, minAmount: 100, days: 7 },
  { id: 'fx2', name: 'USDT 30-Day', asset: 'USDT', type: 'fixed' as const, apy: 8.5, minAmount: 100, days: 30 },
  { id: 'fx3', name: 'USDT 60-Day', asset: 'USDT', type: 'fixed' as const, apy: 10.0, minAmount: 100, days: 60 },
  { id: 'fx4', name: 'USDT 90-Day', asset: 'USDT', type: 'fixed' as const, apy: 12.5, minAmount: 100, days: 90 },
  // Staking
  { id: 's1', name: 'ETH Staking', asset: 'ETH', type: 'staking' as const, apy: 4.0, minAmount: 0.1 },
  { id: 's2', name: 'SOL Staking', asset: 'SOL', type: 'staking' as const, apy: 6.5, minAmount: 1 },
];

export const MOCK_OPEN_POSITIONS = [
  { symbol: 'BTC/USDT', side: 'Long' as const, size: 0.1, leverage: 10, entryPrice: 66800, markPrice: 67842, liqPrice: 60500, pnl: 104.2, pnlPct: 1.56 },
  { symbol: 'ETH/USDT', side: 'Short' as const, size: 1.0, leverage: 5, entryPrice: 3600, markPrice: 3521, liqPrice: 3960, pnl: 79.0, pnlPct: 2.19 },
];

export const MOCK_ADMIN_USERS = [
  { id: '1', uid: 'EXX1A2B3C', email: 'alice@example.com', status: 'active' as const, kycTier: 2, joined: '2024-01-15', volume: '$245K' },
  { id: '2', uid: 'EXX4D5E6F', email: 'bob@example.com', status: 'frozen' as const, kycTier: 1, joined: '2024-02-20', volume: '$12K' },
  { id: '3', uid: 'EXX7G8H9I', email: 'carol@example.com', status: 'active' as const, kycTier: 3, joined: '2024-03-05', volume: '$1.2M' },
  { id: '4', uid: 'EXXJ0K1L2', email: 'dave@example.com', status: 'active' as const, kycTier: 0, joined: '2024-06-10', volume: '$0' },
  { id: '5', uid: 'EXXM3N4O5', email: 'eve@example.com', status: 'active' as const, kycTier: 2, joined: '2024-04-18', volume: '$89K' },
];

export const MOCK_KYC_QUEUE = [
  { id: '1', uid: 'EXXP6Q7R8', email: 'frank@example.com', tier: 2, submitted: '2024-06-20 09:15', type: 'Government ID' },
  { id: '2', uid: 'EXXS9T0U1', email: 'grace@example.com', tier: 1, submitted: '2024-06-20 11:40', type: 'Email + Phone' },
  { id: '3', uid: 'EXXV2W3X4', email: 'henry@example.com', tier: 3, submitted: '2024-06-19 16:22', type: 'Face Verification' },
];

export const MOCK_DISPUTES = [
  { id: 'D001', orderId: 'P2P20240620ABC123', buyer: 'EXX1A2B3C', seller: 'EXX4D5E6F', amount: '500 USDT', fiat: '₦910,250', reason: 'Seller not responding', created: '2024-06-20 13:45' },
  { id: 'D002', orderId: 'P2P20240619DEF456', buyer: 'EXX7G8H9I', seller: 'EXXJ0K1L2', amount: '200 USDT', fiat: '₦363,600', reason: 'Payment sent but crypto not released', created: '2024-06-19 18:30' },
];

export const MOCK_RISK_ALERTS = [
  { id: '1', type: 'Unusual Withdrawal', uid: 'EXX1A2B3C', detail: 'Withdrawal of 10 BTC in 24h — 5x above average', time: '14:22', severity: 'high' as const },
  { id: '2', type: 'Multiple Devices', uid: 'EXX4D5E6F', detail: 'Login from 6 different IPs in 1 hour', time: '13:05', severity: 'medium' as const },
  { id: '3', type: 'AML Flag', uid: 'EXXM3N4O5', detail: 'Transaction pattern matches known layering behavior', time: '11:48', severity: 'high' as const },
  { id: '4', type: 'Failed Login', uid: 'EXXP6Q7R8', detail: '20 failed login attempts detected', time: '10:30', severity: 'low' as const },
];

export const COLORS = {
  // ── Backgrounds ──────────────────────────────────────────────────
  background:    '#0B0E12',   // deepest bg
  backgroundAlt: '#111827',   // slightly elevated bg
  card:          '#161B22',   // card surface
  cardSecondary: '#1A2030',   // elevated card / inner surface
  surface:       '#202630',   // interactive surface
  // ── Brand ────────────────────────────────────────────────────────
  primary:       '#F0B90B',   // ExchangeX Gold
  primaryDark:   '#C99A09',   // pressed gold
  // ── Semantic ─────────────────────────────────────────────────────
  success:       '#0ECB81',   // buy / positive
  successBg:     '#0ECB8118',
  danger:        '#F6465D',   // sell / negative
  dangerBg:      '#F6465D18',
  warning:       '#FFA726',   // warning amber
  warningBg:     '#FFA72618',
  info:          '#1E90FF',   // info blue
  infoBg:        '#1E90FF18',
  // ── Text ─────────────────────────────────────────────────────────
  textPrimary:   '#F0F2F5',   // primary text
  textSecondary: '#848E9C',   // secondary / muted
  textTertiary:  '#4B5563',   // disabled / hints
  // ── Border ───────────────────────────────────────────────────────
  border:        '#1E2530',   // default border
  borderBold:    '#2B3444',   // emphasized border
  // ── Gradients (start / end pairs) ────────────────────────────────
  gradientGold:  ['#F0B90B', '#C99A09'] as const,
  gradientGreen: ['#0ECB81', '#089B62'] as const,
  gradientCard:  ['#1A2030', '#161B22'] as const,
};
