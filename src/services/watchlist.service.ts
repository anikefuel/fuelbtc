// Watchlist Service — Supabase-persisted user watchlist
// Authenticated users: stored in user_watchlist table
// Unauthenticated users: stored in-memory only

import { supabase } from '@/client/supabase';

export type WatchlistMarketType = 'spot' | 'futures';

export interface WatchlistEntry {
  symbol: string;
  marketType: WatchlistMarketType;
}

// In-memory fallback for unauthenticated sessions
const memoryWatchlist: WatchlistEntry[] = [
  { symbol: 'BTC', marketType: 'spot' },
  { symbol: 'ETH', marketType: 'spot' },
];

async function isAuthenticated(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

/** Load watchlist for the current user */
export async function getWatchlist(): Promise<WatchlistEntry[]> {
  if (!(await isAuthenticated())) return [...memoryWatchlist];

  const { data, error } = await supabase
    .from('user_watchlist')
    .select('symbol, market_type')
    .order('created_at', { ascending: true });

  if (error) return [...memoryWatchlist];

  return (data ?? []).map(r => ({
    symbol:     r.symbol as string,
    marketType: (r.market_type ?? 'spot') as WatchlistMarketType,
  }));
}

/** Add a symbol to the watchlist */
export async function addToWatchlist(symbol: string, marketType: WatchlistMarketType = 'spot'): Promise<void> {
  if (!(await isAuthenticated())) {
    if (!memoryWatchlist.find(e => e.symbol === symbol && e.marketType === marketType)) {
      memoryWatchlist.push({ symbol, marketType });
    }
    return;
  }

  await supabase
    .from('user_watchlist')
    .upsert({ symbol: symbol.toUpperCase(), market_type: marketType }, { onConflict: 'user_id,symbol,market_type' });
}

/** Remove a symbol from the watchlist */
export async function removeFromWatchlist(symbol: string, marketType: WatchlistMarketType = 'spot'): Promise<void> {
  if (!(await isAuthenticated())) {
    const idx = memoryWatchlist.findIndex(e => e.symbol === symbol && e.marketType === marketType);
    if (idx !== -1) memoryWatchlist.splice(idx, 1);
    return;
  }

  await supabase
    .from('user_watchlist')
    .delete()
    .eq('symbol', symbol.toUpperCase())
    .eq('market_type', marketType);
}

/** Toggle a symbol in the watchlist */
export async function toggleWatchlist(
  symbol: string,
  marketType: WatchlistMarketType = 'spot',
  currentList: WatchlistEntry[],
): Promise<WatchlistEntry[]> {
  const exists = currentList.some(e => e.symbol === symbol && e.marketType === marketType);
  if (exists) {
    await removeFromWatchlist(symbol, marketType);
    return currentList.filter(e => !(e.symbol === symbol && e.marketType === marketType));
  } else {
    await addToWatchlist(symbol, marketType);
    return [...currentList, { symbol, marketType }];
  }
}

/** Check if a symbol is in the watchlist */
export function isInWatchlist(
  symbol: string,
  marketType: WatchlistMarketType = 'spot',
  list: WatchlistEntry[],
): boolean {
  return list.some(e => e.symbol === symbol && e.marketType === marketType);
}
