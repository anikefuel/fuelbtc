// useWallet — wallet balances + transactions hook (real data only)

import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchWalletBalances, fetchTransactions } from '@/api/wallet';
import type { WalletAsset, Transaction, WalletType } from '@/types';

interface UseWalletResult {
  assets: WalletAsset[];
  transactions: Transaction[];
  summary: { totalUsd: number; spotUsd: number };
  isLoading: boolean;
  error: string | null;
  activeWalletType: WalletType;
  setActiveWalletType: (t: WalletType) => void;
  refresh: () => Promise<void>;
}

function summariseAssets(assets: WalletAsset[]) {
  const totalUsd = assets.reduce((sum, a) => sum + a.usdValue, 0);
  return { totalUsd, spotUsd: totalUsd };
}

export function useWallet(userId?: string): UseWalletResult {
  const [assets, setAssets] = useState<WalletAsset[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWalletType, setActiveWalletType] = useState<WalletType>('spot');

  const load = useCallback(async () => {
    if (!userId) { setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      const [balRes, txRes] = await Promise.all([
        fetchWalletBalances(userId, activeWalletType),
        fetchTransactions(userId),
      ]);
      if (balRes.data) setAssets(balRes.data);
      else setError(balRes.error?.message ?? 'Failed to load balances');
      if (txRes.data) setTransactions(txRes.data);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load wallet');
    } finally {
      setIsLoading(false);
    }
  }, [userId, activeWalletType]);

  useFocusEffect(useCallback(() => {
    (async () => { await load(); })();
  }, [load]));

  const displayAssets = activeWalletType === 'fiat'
    ? assets.filter(a => a.asset === 'NGN')
    : assets.filter(a => a.asset !== 'NGN');

  return {
    assets: displayAssets,
    transactions,
    summary: summariseAssets(assets),
    isLoading,
    error,
    activeWalletType,
    setActiveWalletType,
    refresh: load,
  };
}
