// Portfolio Service — single source of truth for all portfolio calculations.
// ALL balance totals in the app MUST use this service — never compute inline.
//
// Financial source of truth: internal wallets + ledger_accounts tables.
// Provider (Binance) balances are NEVER used for portfolio display.

import { supabase } from '@/client/supabase';
import { ASSET_META } from './wallet.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssetPrice {
  asset:       string;
  priceUsd:    number;
  change24hPct: number;
}

export interface PortfolioAsset {
  asset:            string;
  name:             string;
  totalBalance:     number;   // sum across all wallet types
  availableBalance: number;   // spot available
  lockedBalance:    number;   // locked across all types
  usdValue:         number;
  priceUsd:         number;
  change24hPct:     number;
  allocationPct:    number;   // % of total portfolio USD
  color:            string;
}

export interface PortfolioSummary {
  totalUsd:      number;
  spotUsd:       number;
  fundingUsd:    number;
  p2pUsd:        number;
  futuresUsd:    number;
  earnUsd:       number;
  assets:        PortfolioAsset[];
  updatedAt:     string;
}

const ASSET_COLORS: Record<string, string> = {
  BTC:  '#F7931A', ETH:  '#627EEA', USDT: '#26A17B',
  USDC: '#2775CA', BNB:  '#F3BA2F', SOL:  '#9945FF',
  XRP:  '#346AA9', TRX:  '#E50914', LTC:  '#A6A9AA',
  DOGE: '#C3A634',
};

// Binance symbols for price fetching (USDT pairs)
const PRICE_SYMBOLS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','TRXUSDT','LTCUSDT','DOGEUSDT'];
const STABLECOINS   = new Set(['USDT','USDC','BUSD','DAI','TUSD']);

// ─── Price fetching (public Binance endpoint — no API key needed) ─────────────

let priceCache: { prices: Record<string,number>; ts: number } | null = null;
const PRICE_TTL_MS = 30_000; // 30 second cache

export async function fetchPrices(): Promise<Record<string, number>> {
  if (priceCache && Date.now() - priceCache.ts < PRICE_TTL_MS) return priceCache.prices;

  const prices: Record<string, number> = {};
  // Stablecoins are always $1
  for (const s of STABLECOINS) prices[s] = 1;

  try {
    const symsParam = encodeURIComponent(JSON.stringify(PRICE_SYMBOLS));
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symsParam}`);
    if (res.ok) {
      const data = await res.json() as { symbol: string; price: string }[];
      for (const d of data) {
        const asset = d.symbol.replace('USDT', '');
        prices[asset] = parseFloat(d.price);
      }
    }
  } catch { /* use stablecoins only on failure */ }

  priceCache = { prices, ts: Date.now() };
  return prices;
}

/** Invalidate price cache (call after any event that may affect prices) */
export function invalidatePriceCache(): void {
  priceCache = null;
}

// ─── Core aggregation ─────────────────────────────────────────────────────────

export async function getPortfolio(): Promise<PortfolioSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Fetch all wallets for the current user + prices in parallel
  const [{ data: walletRows, error: walletErr }, prices] = await Promise.all([
    supabase.from('wallets').select('*').eq('user_id', user.id),
    fetchPrices(),
  ]);
  if (walletErr) throw new Error(walletErr.message);

  const rows = walletRows ?? [];

  // Aggregate per-asset across all wallet types
  type AssetAgg = {
    totalBalance: number; availableBalance: number; lockedBalance: number;
    byType: Record<string, number>; // walletType -> balance
  };
  const byAsset = new Map<string, AssetAgg>();

  let spotUsd = 0, fundingUsd = 0, p2pUsd = 0, futuresUsd = 0, earnUsd = 0;

  for (const row of rows) {
    const asset     = row.asset as string;
    const wtype     = row.wallet_type as string;
    const avail     = Number(row.balance ?? 0);
    const locked    = Number(row.locked_balance ?? 0) + Number(row.escrow_balance ?? 0);
    const total     = avail + locked;
    const price     = prices[asset] ?? 0;
    const usd       = total * price;

    if (!byAsset.has(asset)) {
      byAsset.set(asset, { totalBalance: 0, availableBalance: 0, lockedBalance: 0, byType: {} });
    }
    const agg = byAsset.get(asset)!;
    agg.totalBalance     += total;
    agg.availableBalance += avail;
    agg.lockedBalance    += locked;
    agg.byType[wtype]     = (agg.byType[wtype] ?? 0) + total;

    switch (wtype) {
      case 'spot':    spotUsd    += usd; break;
      case 'funding': fundingUsd += usd; break;
      case 'p2p':     p2pUsd     += usd; break;
      case 'futures': futuresUsd += usd; break;
      case 'earn':    earnUsd    += usd; break;
    }
  }

  const totalUsd = spotUsd + fundingUsd + p2pUsd + futuresUsd + earnUsd;

  const assets: PortfolioAsset[] = Array.from(byAsset.entries())
    .map(([asset, agg]) => {
      const price  = prices[asset] ?? 0;
      const usdVal = agg.totalBalance * price;
      const meta   = ASSET_META[asset];
      return {
        asset,
        name:             meta?.name ?? asset,
        totalBalance:     agg.totalBalance,
        availableBalance: agg.availableBalance,
        lockedBalance:    agg.lockedBalance,
        usdValue:         usdVal,
        priceUsd:         price,
        change24hPct:     0, // fetched separately when needed
        allocationPct:    totalUsd > 0 ? (usdVal / totalUsd) * 100 : 0,
        color:            ASSET_COLORS[asset] ?? '#888',
      };
    })
    .filter(a => a.totalBalance > 0)
    .sort((a, b) => b.usdValue - a.usdValue);

  return {
    totalUsd,
    spotUsd,
    fundingUsd,
    p2pUsd,
    futuresUsd,
    earnUsd,
    assets,
    updatedAt: new Date().toISOString(),
  };
}

/** Lightweight: just total USD (for home screen hero) */
export async function getTotalUsd(): Promise<number> {
  try {
    const p = await getPortfolio();
    return p.totalUsd;
  } catch { return 0; }
}
