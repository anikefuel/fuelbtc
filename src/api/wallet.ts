// Wallet API module — all balance/transaction operations

import { supabase } from '@/client/supabase';
import type { ApiResponse, Transaction, WalletAsset } from '@/types';
import { buildApiError, apiCache } from './client';
import { ASSET_REGISTRY } from '@/constants/assets';
import { CACHE_TTL } from '@/constants/config';

// ─── USD price helper (uses market_data_cache, falls back to stablecoin peg) ──
async function getUsdPrices(assets: string[]): Promise<Record<string, number>> {
  const stablecoins = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD']);
  const prices: Record<string, number> = {};

  // Stablecoins are always $1
  for (const a of assets) {
    if (stablecoins.has(a)) prices[a] = 1;
  }

  const nonStable = assets.filter(a => !stablecoins.has(a));
  if (nonStable.length === 0) return prices;

  try {
    const symbols = nonStable.map(a => `${a}USDT`);
    const { data } = await supabase
      .from('market_data_cache')
      .select('symbol, last_price')
      .in('symbol', symbols);

    for (const row of data ?? []) {
      const asset = (row.symbol as string).replace('USDT', '');
      prices[asset] = Number(row.last_price);
    }
  } catch {
    // price enrichment is best-effort; balances still shown at 0 USD if unavailable
  }

  return prices;
}

// ─── Get wallet balances ──────────────────────────────────────────────────────
export async function fetchWalletBalances(
  userId: string,
  walletType = 'spot',
): Promise<ApiResponse<WalletAsset[]>> {
  const cacheKey = `wallet:${userId}:${walletType}`;
  const cached = apiCache.get<WalletAsset[]>(cacheKey);
  if (cached) return { data: cached, error: null, status: 200 };

  const { data: rows, error } = await supabase
    .from('wallets')
    .select('asset, balance, locked_balance, wallet_type')
    .eq('user_id', userId)
    .eq('wallet_type', walletType);

  if (error) return { data: null, error: buildApiError('WALLET_FETCH_ERROR', error.message), status: 500 };

  const assetList = (rows ?? []).map(r => r.asset as string);
  const prices = assetList.length > 0 ? await getUsdPrices(assetList) : {};

  const assets: WalletAsset[] = (rows ?? []).map(row => {
    const def = ASSET_REGISTRY[row.asset];
    const bal = Number(row.balance);
    return {
      asset: row.asset,
      name: def?.name ?? row.asset,
      balance: bal,
      lockedBalance: Number(row.locked_balance),
      usdValue: bal * (prices[row.asset] ?? 0),
      icon: def?.icon ?? '•',
      logoUrl: undefined,
    };
  });

  apiCache.set(cacheKey, assets, CACHE_TTL.walletBalances);
  return { data: assets, error: null, status: 200 };
}

// ─── Get transaction history ──────────────────────────────────────────────────
export async function fetchTransactions(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<ApiResponse<Transaction[]>> {
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return { data: null, error: buildApiError('TX_FETCH_ERROR', error.message), status: 500 };

  const transactions: Transaction[] = (rows ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    txType: row.tx_type,
    asset: row.asset,
    amount: Number(row.amount),
    fee: Number(row.fee ?? 0),
    status: row.status,
    txHash: row.tx_hash,
    address: row.address,
    network: row.network,
    notes: row.notes,
    createdAt: row.created_at,
  }));

  return { data: transactions, error: null, status: 200 };
}

// ─── Request deposit address ──────────────────────────────────────────────────
export async function requestDepositAddress(
  userId: string,
  asset: string,
  network: string,
): Promise<ApiResponse<{ address: string; memo?: string }>> {
  const { data, error } = await supabase
    .from('deposit_addresses')
    .select('address, memo')
    .eq('user_id', userId)
    .eq('asset', asset)
    .eq('network', network)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return { data: null, error: buildApiError('ADDRESS_ERROR', error.message), status: 500 };

  if (!data) {
    return {
      data: null,
      error: buildApiError('ADDRESS_UNAVAILABLE', 'Deposit address not available. A blockchain provider must be configured by the administrator.'),
      status: 404,
    };
  }

  return { data: { address: data.address, memo: data.memo ?? undefined }, error: null, status: 200 };
}

// ─── Submit withdrawal request ────────────────────────────────────────────────
export async function submitWithdrawal(
  userId: string,
  asset: string,
  network: string,
  address: string,
  amount: number,
  idempotencyKey: string,
): Promise<ApiResponse<{ txId: string }>> {
  const { data, error } = await supabase.rpc('wallet_withdrawal_request', {
    p_user_id: userId,
    p_asset: asset,
    p_network: network,
    p_to_address: address,
    p_amount: amount,
  });

  if (error) return { data: null, error: buildApiError('WITHDRAWAL_ERROR', error.message), status: 500 };

  apiCache.invalidatePrefix(`wallet:${userId}`);
  return { data: { txId: data as string }, error: null, status: 200 };
}

