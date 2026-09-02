// TradingWalletService
// Bridge between the trading engine (spot orders, futures positions) and the
// internal ExchangeX wallet/ledger. All balance mutations use SECURITY DEFINER
// RPCs — no direct UPDATE from client.
//
// Consumers:
//   - spot.tsx     → getSpotBalance, lockSpotBalance (via place_spot_order RPC)
//   - futures.tsx  → getFuturesBalance, spotToFuturesTransfer, applyFundingFee
//   - order-matcher Edge Function → recordSpotFill (service-role call)
//   - liquidation-monitor → recordFundingFee (service-role call)

import { supabase } from '@/client/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TradingBalance {
  asset: string;
  walletType: 'spot' | 'futures' | 'funding';
  available: number;
  locked: number;
  total: number;
}

export interface SpotFillParams {
  buyOrderId:  string;
  sellOrderId: string;
  buyerId:     string;
  sellerId:    string;
  baseAsset:   string;
  quoteAsset:  string;
  fillQty:     number;
  fillPrice:   number;
  buyFee?:     number;
  sellFee?:    number;
  feeAsset?:   string;
}

export interface FundingFeeParams {
  userId:     string;
  positionId: string;
  symbol:     string;
  feeAmount:  number;  // positive = user pays, negative = user receives
  periodTs?:  string;
}

export interface WalletSummary {
  spot:    TradingBalance[];
  futures: TradingBalance[];
  funding: TradingBalance[];
}

// ─── Balance reads ────────────────────────────────────────────────────────────

/** Single asset trading balance for a given wallet type. */
export async function getTradingBalance(
  asset: string,
  walletType: 'spot' | 'futures' | 'funding' = 'spot',
): Promise<TradingBalance> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return zeroBalance(asset, walletType);

  const { data } = await supabase
    .from('wallets')
    .select('available_balance, locked_balance')
    .eq('user_id',    user.id)
    .eq('asset',      asset)
    .eq('wallet_type', walletType)
    .maybeSingle();

  if (!data) return zeroBalance(asset, walletType);
  const avail  = Number(data.available_balance ?? 0);
  const locked = Number(data.locked_balance    ?? 0);
  return { asset, walletType, available: avail, locked, total: avail + locked };
}

/** Full wallet summary: spot + futures + funding balances in one call. */
export async function getWalletSummary(): Promise<WalletSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { spot: [], futures: [], funding: [] };

  const { data, error } = await supabase
    .from('wallets')
    .select('asset, wallet_type, available_balance, locked_balance')
    .eq('user_id', user.id)
    .in('wallet_type', ['spot', 'futures', 'funding'])
    .order('asset');

  if (error || !data) return { spot: [], futures: [], funding: [] };

  const result: WalletSummary = { spot: [], futures: [], funding: [] };
  for (const row of data) {
    const wt    = row.wallet_type as 'spot' | 'futures' | 'funding';
    const avail  = Number(row.available_balance ?? 0);
    const locked = Number(row.locked_balance    ?? 0);
    result[wt].push({ asset: row.asset as string, walletType: wt, available: avail, locked, total: avail + locked });
  }
  return result;
}

/** Spot balances for a trading pair: base + quote. */
export async function getSpotPairBalances(
  baseAsset: string,
  quoteAsset: string,
): Promise<{ base: TradingBalance; quote: TradingBalance }> {
  const [base, quote] = await Promise.all([
    getTradingBalance(baseAsset,  'spot'),
    getTradingBalance(quoteAsset, 'spot'),
  ]);
  return { base, quote };
}

/** Futures USDT balance for margin. */
export async function getFuturesMarginBalance(): Promise<TradingBalance> {
  return getTradingBalance('USDT', 'futures');
}

// ─── Spot → Futures transfer ──────────────────────────────────────────────────

/** Transfer USDT (or other asset) from spot wallet to futures wallet for margin. */
export async function spotToFuturesTransfer(
  amount: number,
  asset = 'USDT',
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (amount <= 0) throw new Error('Transfer amount must be positive');

  const { error } = await supabase.rpc('spot_to_futures_transfer', {
    p_user_id:   user.id,
    p_amount:    amount,
    p_asset:     asset,
    p_direction: 'spot_to_futures',
  });
  if (error) throw new Error(error.message);
}

/** Transfer USDT from futures wallet back to spot (e.g. after closing positions). */
export async function futuresToSpotTransfer(
  amount: number,
  asset = 'USDT',
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (amount <= 0) throw new Error('Transfer amount must be positive');

  const { error } = await supabase.rpc('spot_to_futures_transfer', {
    p_user_id:   user.id,
    p_amount:    amount,
    p_asset:     asset,
    p_direction: 'futures_to_spot',
  });
  if (error) throw new Error(error.message);
}

// ─── Spot fill settlement (called from service role / Edge Function) ──────────

/**
 * Write double-entry ledger entries for a matched spot order fill.
 * Idempotent: safe to call multiple times for the same order pair.
 * Normally called by the order-matcher Edge Function with service role.
 * Exposed here so an admin can trigger manually if a fill was missed.
 */
export async function recordSpotFill(params: SpotFillParams): Promise<void> {
  const { error } = await supabase.rpc('record_spot_fill', {
    p_buy_order_id:  params.buyOrderId,
    p_sell_order_id: params.sellOrderId,
    p_buyer_id:      params.buyerId,
    p_seller_id:     params.sellerId,
    p_base_asset:    params.baseAsset,
    p_quote_asset:   params.quoteAsset,
    p_fill_qty:      params.fillQty,
    p_fill_price:    params.fillPrice,
    p_buy_fee:       params.buyFee  ?? 0,
    p_sell_fee:      params.sellFee ?? 0,
    p_fee_asset:     params.feeAsset ?? params.quoteAsset,
  });
  if (error) throw new Error(error.message);
}

// ─── Futures funding fee ──────────────────────────────────────────────────────

/**
 * Apply a funding fee to a user's futures wallet.
 * Positive feeAmount = user pays (debit). Negative = user receives (credit).
 * Idempotent per position + period hour.
 */
export async function applyFundingFee(params: FundingFeeParams): Promise<void> {
  const { error } = await supabase.rpc('record_futures_funding_fee', {
    p_user_id:     params.userId,
    p_position_id: params.positionId,
    p_symbol:      params.symbol,
    p_fee_amount:  params.feeAmount,
    p_period_ts:   params.periodTs ?? new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

// ─── Spot order balance lock validation ───────────────────────────────────────

/**
 * Validate a spot order can be placed given current available balance.
 * Does NOT lock the balance (place_spot_order RPC does that atomically).
 * Returns { ok, shortfall } for UI to show before submitting.
 */
export async function validateSpotOrderBalance(params: {
  side: 'buy' | 'sell';
  baseAsset: string;
  quoteAsset: string;
  quantity: number;
  price: number;
}): Promise<{ ok: boolean; shortfall: number; asset: string; available: number; required: number }> {
  const assetNeeded  = params.side === 'buy' ? params.quoteAsset : params.baseAsset;
  const amountNeeded = params.side === 'buy'
    ? params.quantity * params.price * 1.001  // include 0.1% fee buffer
    : params.quantity;

  const balance = await getTradingBalance(assetNeeded, 'spot');
  const shortfall = Math.max(0, amountNeeded - balance.available);
  return {
    ok:        shortfall === 0,
    shortfall,
    asset:     assetNeeded,
    available: balance.available,
    required:  amountNeeded,
  };
}

/**
 * Validate a futures position open can be funded from futures wallet.
 */
export async function validateFuturesMargin(params: {
  size: number;
  entryPrice: number;
  leverage: number;
}): Promise<{ ok: boolean; shortfall: number; available: number; required: number }> {
  const required = (params.size * params.entryPrice) / params.leverage;
  const balance  = await getFuturesMarginBalance();
  const shortfall = Math.max(0, required - balance.available);
  return { ok: shortfall === 0, shortfall, available: balance.available, required };
}

// ─── P2P Escrow helpers ───────────────────────────────────────────────────────

/** Get escrow record for a P2P trade. */
export async function getEscrowForTrade(tradeId: string): Promise<{
  id: string; status: string; asset: string; amount: number; lockedAt: string | null;
} | null> {
  const { data, error } = await supabase
    .from('escrows')
    .select('id, status, asset, amount, created_at')
    .eq('p2p_trade_id', tradeId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id:       data.id as string,
    status:   data.status as string,
    asset:    data.asset as string,
    amount:   Number(data.amount),
    lockedAt: data.created_at as string | null,
  };
}

/** Get all active escrow locks for the current user. */
export async function getMyEscrows(): Promise<{ id: string; status: string; asset: string; amount: number; tradeId: string | null }[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('escrows')
    .select('id, status, asset, amount, p2p_trade_id')
    .eq('seller_id', user.id)
    .in('status', ['locked', 'pending'])
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map(r => ({
    id:      r.id as string,
    status:  r.status as string,
    asset:   r.asset as string,
    amount:  Number(r.amount),
    tradeId: r.p2p_trade_id as string | null,
  }));
}

// ─── Ledger history ───────────────────────────────────────────────────────────

/** Recent ledger entries for the current user (trading events). */
export async function getTradingLedger(limit = 30): Promise<{
  id: string; asset: string; entryType: string; credit: number; debit: number;
  description: string; referenceType: string | null; createdAt: string;
}[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('ledger_entries')
    .select('id, asset, entry_type, credit, debit, description, reference_type, created_at')
    .eq('user_id', user.id)
    .in('entry_type', [
      'spot_fill_credit', 'spot_fill_debit', 'spot_fee',
      'futures_margin_lock', 'futures_pnl_credit', 'futures_pnl_debit',
      'futures_funding_fee', 'futures_funding_income',
      'internal_transfer_credit', 'internal_transfer_debit',
      'p2p_escrow_lock', 'p2p_escrow_release_credit', 'p2p_escrow_release_debit',
    ])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(r => ({
    id:            r.id as string,
    asset:         r.asset as string,
    entryType:     r.entry_type as string,
    credit:        Number(r.credit  ?? 0),
    debit:         Number(r.debit   ?? 0),
    description:   (r.description as string) ?? '',
    referenceType: r.reference_type as string | null,
    createdAt:     r.created_at as string,
  }));
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function zeroBalance(asset: string, walletType: 'spot' | 'futures' | 'funding'): TradingBalance {
  return { asset, walletType, available: 0, locked: 0, total: 0 };
}
