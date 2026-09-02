// WalletService v2 — full ledger-based multi-wallet system
// All balance mutations go through DB RPCs; reads come from wallets + ledger_accounts.
// NEVER call direct balance UPDATE from client — use RPCs only.
import { supabase } from '@/client/supabase';
import { generateDepositAddress } from './blockchain.provider';

// ─── Wallet Types ─────────────────────────────────────────────────────────────
export type WalletType = 'spot' | 'funding' | 'p2p' | 'escrow' | 'futures' | 'margin' | 'earn';
export const WALLET_TYPES: WalletType[] = ['spot', 'funding', 'p2p', 'escrow', 'futures', 'margin', 'earn'];
export const WALLET_LABELS: Record<WalletType, string> = {
  spot: 'Spot Wallet', funding: 'Funding Wallet', p2p: 'P2P Wallet',
  escrow: 'Escrow Wallet', futures: 'Futures Wallet',
  margin: 'Margin Wallet', earn: 'Earn Wallet',
};

// ─── Asset metadata (UI display, not for business logic) ─────────────────────
export const ASSET_META: Record<string, { name: string; decimals: number; color: string }> = {
  BTC:  { name: 'Bitcoin',    decimals: 8, color: '#F7931A' },
  ETH:  { name: 'Ethereum',   decimals: 8, color: '#627EEA' },
  USDT: { name: 'Tether USD', decimals: 2, color: '#26A17B' },
  USDC: { name: 'USD Coin',   decimals: 2, color: '#2775CA' },
  BNB:  { name: 'BNB',        decimals: 4, color: '#F0B90B' },
  SOL:  { name: 'Solana',     decimals: 4, color: '#9945FF' },
  XRP:  { name: 'XRP',        decimals: 4, color: '#346AA9' },
  TRX:  { name: 'TRON',       decimals: 2, color: '#EF0027' },
  LTC:  { name: 'Litecoin',   decimals: 6, color: '#A6A9AA' },
  DOGE: { name: 'Dogecoin',   decimals: 2, color: '#C3A634' },
};

// ─── Core Types ───────────────────────────────────────────────────────────────
export interface WalletBalance {
  id: string;
  userId: string;
  walletType: WalletType;
  asset: string;
  balance: number;
  lockedBalance: number;
  escrowBalance: number;
  pendingDeposit: number;
  pendingWithdraw: number;
  availableBalance: number; // computed: balance - locked - escrow - pendingWithdraw
  updatedAt: string;
}

export interface LedgerAccount {
  id: string;
  userId: string;
  asset: string;
  availableBalance: number;
  lockedBalance: number;
  pendingBalance: number;
  totalBalance: number;
  updatedAt: string;
}

export interface AssetBalance {
  asset: string;
  name: string;
  walletType: WalletType;
  availableBalance: number;
  lockedBalance: number;
  escrowBalance: number;
  totalBalance: number;
  usdValue: number;
  usdPrice: number;
}

export interface WalletSummary {
  totalUsd: number;
  spotUsd: number;
  fundingUsd: number;
  p2pUsd: number;
  assets: AssetBalance[];
}

export interface AssetNetwork {
  id: string;
  asset: string;
  network: string;
  networkLabel: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  minDeposit: number;
  minWithdrawal: number;
  maxWithdrawalDay: number;
  withdrawalFee: number;
  requiredConfs: number;
  estimatedArrival: string;
  hasMemo: boolean;
  memoLabel?: string;
  addressRegex?: string;
  isActive: boolean;
  sortOrder: number;
}

export interface DepositRecord {
  id: string;
  userId: string;
  asset: string;
  network: string;
  amount: number;
  fee: number;
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
  confirmations: number;
  requiredConfs: number;
  status: 'pending' | 'confirming' | 'credited' | 'rejected';
  creditedAt?: string;
  createdAt: string;
}

export interface WithdrawalRecord {
  id: string;
  userId: string;
  asset: string;
  network: string;
  amount: number;
  fee: number;
  netAmount: number;
  toAddress: string;
  memo?: string;
  txHash?: string;
  status: 'pending' | 'security_review' | 'approved' | 'broadcasting' | 'completed' | 'failed' | 'rejected' | 'cancelled';
  rejectionReason?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InternalTransfer {
  id: string;
  senderId: string;
  recipientId: string;
  asset: string;
  walletType: WalletType;
  amount: number;
  fee: number;
  netAmount: number;
  status: string;
  note?: string;
  reference?: string;
  createdAt: string;
}

export interface WalletTransfer {
  id: string;
  userId: string;
  asset: string;
  fromWallet: WalletType;
  toWallet: WalletType;
  amount: number;
  status: string;
  createdAt: string;
}

export interface EscrowRecord {
  id: string;
  tradeId?: string;
  sellerId: string;
  buyerId?: string;
  asset: string;
  amount: number;
  fee: number;
  status: 'locked' | 'released' | 'refunded' | 'frozen' | 'disputed' | 'expired';
  escrowType: string;
  lockedAt: string;
  releasedAt?: string;
  refundedAt?: string;
  expiresAt?: string;
  notes?: string;
  createdAt: string;
}

export interface WalletAuditLog {
  id: string;
  actorId?: string;
  targetUserId?: string;
  action: string;
  asset?: string;
  amount?: number;
  referenceId?: string;
  referenceType?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface WalletFreeze {
  id: string;
  userId: string;
  walletType?: WalletType;
  asset?: string;
  freezeType: 'full' | 'withdrawal' | 'deposit';
  reason: string;
  isActive: boolean;
  expiresAt?: string;
  createdAt: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────
function mapWallet(r: Record<string, unknown>): WalletBalance {
  const balance      = Number(r.balance ?? 0);
  const locked       = Number(r.locked_balance ?? 0);
  const escrow       = Number(r.escrow_balance ?? 0);
  const pendingWd    = Number(r.pending_withdraw ?? 0);
  return {
    id: r.id as string,
    userId: r.user_id as string,
    walletType: r.wallet_type as WalletType,
    asset: r.asset as string,
    balance,
    lockedBalance: locked,
    escrowBalance: escrow,
    pendingDeposit: Number(r.pending_deposit ?? 0),
    pendingWithdraw: pendingWd,
    availableBalance: Math.max(0, balance - locked - escrow - pendingWd),
    updatedAt: r.updated_at as string ?? '',
  };
}

function mapAssetNetwork(r: Record<string, unknown>): AssetNetwork {
  return {
    id: r.id as string,
    asset: r.asset as string,
    network: r.network as string,
    networkLabel: r.network_label as string,
    depositEnabled: Boolean(r.deposit_enabled),
    withdrawEnabled: Boolean(r.withdraw_enabled),
    minDeposit: Number(r.min_deposit ?? 0),
    minWithdrawal: Number(r.min_withdrawal ?? 0),
    maxWithdrawalDay: Number(r.max_withdrawal_day ?? 1000000),
    withdrawalFee: Number(r.withdrawal_fee ?? 0),
    requiredConfs: Number(r.required_confs ?? 1),
    estimatedArrival: r.estimated_arrival as string ?? '~5 min',
    hasMemo: Boolean(r.has_memo),
    memoLabel: r.memo_label as string | undefined,
    addressRegex: r.address_regex as string | undefined,
    isActive: Boolean(r.is_active),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

function mapDeposit(r: Record<string, unknown>): DepositRecord {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    asset: r.asset as string,
    network: r.network as string,
    amount: Number(r.amount),
    fee: Number(r.fee ?? 0),
    txHash: r.tx_hash as string | undefined,
    fromAddress: r.from_address as string | undefined,
    toAddress: r.to_address as string | undefined,
    confirmations: Number(r.confirmations ?? 0),
    requiredConfs: Number(r.required_confs ?? 1),
    status: r.status as DepositRecord['status'],
    creditedAt: r.credited_at as string | undefined,
    createdAt: r.created_at as string,
  };
}

function mapWithdrawal(r: Record<string, unknown>): WithdrawalRecord {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    asset: r.asset as string,
    network: r.network as string,
    amount: Number(r.amount),
    fee: Number(r.fee ?? 0),
    netAmount: Number(r.net_amount ?? 0),
    toAddress: r.to_address as string,
    memo: r.memo as string | undefined,
    txHash: r.tx_hash as string | undefined,
    status: r.status as WithdrawalRecord['status'],
    rejectionReason: r.rejection_reason as string | undefined,
    reviewedAt: r.reviewed_at as string | undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function mapInternalTransfer(r: Record<string, unknown>): InternalTransfer {
  return {
    id: r.id as string,
    senderId: r.sender_id as string,
    recipientId: r.recipient_id as string,
    asset: r.asset as string,
    walletType: r.wallet_type as WalletType,
    amount: Number(r.amount),
    fee: Number(r.fee ?? 0),
    netAmount: Number(r.net_amount),
    status: r.status as string,
    note: r.note as string | undefined,
    reference: r.reference as string | undefined,
    createdAt: r.created_at as string,
  };
}

function mapWalletTransfer(r: Record<string, unknown>): WalletTransfer {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    asset: r.asset as string,
    fromWallet: r.from_wallet as WalletType,
    toWallet: r.to_wallet as WalletType,
    amount: Number(r.amount),
    status: r.status as string,
    createdAt: r.created_at as string,
  };
}

function mapEscrow(r: Record<string, unknown>): EscrowRecord {
  return {
    id: r.id as string,
    tradeId: r.trade_id as string | undefined,
    sellerId: r.seller_id as string,
    buyerId: r.buyer_id as string | undefined,
    asset: r.asset as string,
    amount: Number(r.amount),
    fee: Number(r.fee ?? 0),
    status: r.status as EscrowRecord['status'],
    escrowType: r.escrow_type as string,
    lockedAt: r.locked_at as string,
    releasedAt: r.released_at as string | undefined,
    refundedAt: r.refunded_at as string | undefined,
    expiresAt: r.expires_at as string | undefined,
    notes: r.notes as string | undefined,
    createdAt: r.created_at as string,
  };
}

// ─── Balance Reads ────────────────────────────────────────────────────────────

/** All wallet balances for current user across all wallet types.
 *  Auto-initialises wallets for new users who have no rows yet. */
export async function getWalletBalances(walletType?: WalletType): Promise<WalletBalance[]> {
  // Always filter by authenticated user — prevents UUID confusion and avoids
  // returning all wallets when admin RLS bypass is active on this client.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let q = supabase.from('wallets').select('*').eq('user_id', user.id).order('asset');
  if (walletType) q = q.eq('wallet_type', walletType);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // New user: no wallet rows yet — initialise then reload once
  if (!data || data.length === 0) {
    // Silently swallow init errors so the wallet screen never crashes on first load
    try { await supabase.rpc('ensure_user_wallets', { p_user_id: user.id }); } catch { /* ignore */ }
    let q2 = supabase.from('wallets').select('*').eq('user_id', user.id).order('asset');
    if (walletType) q2 = q2.eq('wallet_type', walletType);
    const { data: data2, error: err2 } = await q2;
    if (err2) throw new Error(err2.message);
    return (data2 ?? []).map(r => mapWallet(r as Record<string, unknown>));
  }

  return (data ?? []).map(r => mapWallet(r as Record<string, unknown>));
}

/** Single wallet balance */
export async function getWalletBalance(asset: string, walletType: WalletType = 'spot'): Promise<WalletBalance | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('wallets').select('*')
    .eq('user_id', user.id).eq('asset', asset).eq('wallet_type', walletType).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapWallet(data as Record<string, unknown>);
}

/** Wallet summary: total USD value across spot+funding+p2p */
export async function getWalletSummary(prices: Record<string, number>): Promise<WalletSummary> {
  const balances = await getWalletBalances();
  let totalUsd = 0, spotUsd = 0, fundingUsd = 0, p2pUsd = 0;
  const assetMap = new Map<string, AssetBalance>();

  for (const w of balances) {
    const price = prices[w.asset] ?? 0;
    const usdValue = w.availableBalance * price;
    totalUsd += usdValue;
    if (w.walletType === 'spot') spotUsd += usdValue;
    if (w.walletType === 'funding') fundingUsd += usdValue;
    if (w.walletType === 'p2p') p2pUsd += usdValue;

    const existing = assetMap.get(w.asset);
    if (existing) {
      existing.availableBalance += w.availableBalance;
      existing.lockedBalance    += w.lockedBalance;
      existing.escrowBalance    += w.escrowBalance;
      existing.totalBalance     += w.balance;
      existing.usdValue         += usdValue;
    } else {
      assetMap.set(w.asset, {
        asset: w.asset,
        name: ASSET_META[w.asset]?.name ?? w.asset,
        walletType: w.walletType,
        availableBalance: w.availableBalance,
        lockedBalance: w.lockedBalance,
        escrowBalance: w.escrowBalance,
        totalBalance: w.balance,
        usdValue,
        usdPrice: price,
      });
    }
  }

  return {
    totalUsd,
    spotUsd,
    fundingUsd,
    p2pUsd,
    assets: Array.from(assetMap.values()).sort((a, b) => b.usdValue - a.usdValue),
  };
}

/** Legacy: ledger_accounts read for backwards compatibility */
export async function getLedgerAccounts(): Promise<LedgerAccount[]> {
  const { data, error } = await supabase.from('ledger_accounts').select('*').order('asset');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id as string,
    userId: r.user_id as string,
    asset: r.asset as string,
    availableBalance: Number(r.available_balance ?? 0),
    lockedBalance: Number(r.locked_balance ?? 0),
    pendingBalance: Number(r.pending_balance ?? 0),
    totalBalance: Number(r.available_balance ?? 0) + Number(r.locked_balance ?? 0) + Number(r.pending_balance ?? 0),
    updatedAt: r.updated_at as string,
  }));
}

export async function getLedgerBalance(asset: string): Promise<LedgerAccount | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('ledger_accounts').select('*')
    .eq('user_id', user.id).eq('asset', asset).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    userId: data.user_id as string,
    asset: data.asset as string,
    availableBalance: Number(data.available_balance ?? 0),
    lockedBalance: Number(data.locked_balance ?? 0),
    pendingBalance: Number(data.pending_balance ?? 0),
    totalBalance: Number(data.available_balance ?? 0) + Number(data.locked_balance ?? 0) + Number(data.pending_balance ?? 0),
    updatedAt: data.updated_at as string,
  };
}

// ─── Asset Networks ───────────────────────────────────────────────────────────

export async function getAssetNetworks(asset?: string): Promise<AssetNetwork[]> {
  const { data, error } = await supabase.functions.invoke('wallet-action', {
    body: { action: 'get-networks', asset },
  });
  if (error) {
    // Direct DB query fallback when EF unreachable (e.g. network offline)
    let q = supabase.from('asset_networks').select('*').eq('is_active', true).order('sort_order');
    if (asset) q = q.eq('asset', asset);
    const { data: rows, error: dbErr } = await q;
    if (dbErr) throw new Error(dbErr.message);
    return (rows ?? []).map(r => mapAssetNetwork(r as Record<string, unknown>));
  }
  return (data as Record<string, unknown>[]).map(r => mapAssetNetwork(r));
}

export async function getNetworkConfig(asset: string, network: string): Promise<AssetNetwork | null> {
  const { data, error } = await supabase.from('asset_networks').select('*')
    .eq('asset', asset).eq('network', network).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapAssetNetwork(data as Record<string, unknown>);
}

// ─── Deposit Address ──────────────────────────────────────────────────────────

/** Resolve the active Binance provider config ID (first active Binance config). */
async function getActiveBinanceConfigId(): Promise<string | null> {
  const { data } = await supabase
    .from('exchange_provider_configs')
    .select('id')
    .eq('provider_name', 'binance')
    .eq('is_active', true)
    .not('api_key', 'is', null)
    .not('api_secret', 'is', null)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function getOrCreateDepositAddress(
  asset: string, network: string
): Promise<{ address: string; memo?: string; source: string }> {
  // All address logic lives in the wallet-action Edge Function (server-side only).
  const { data, error } = await supabase.functions.invoke('wallet-action', {
    body: { action: 'get-deposit-address', asset, network },
  });

  if (error) {
    // supabase-js wraps non-2xx responses: try to parse the JSON body for a clean message
    let msg = 'Failed to load deposit address';
    if (error.message) {
      try {
        // error.message sometimes IS the JSON body already
        const parsed = JSON.parse(error.message) as { error?: string };
        if (parsed?.error) msg = parsed.error;
        else msg = error.message;
      } catch {
        msg = error.message;
      }
    }
    // FunctionsHttpError has a `context` Response — extract body if present
    const ctx = (error as unknown as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json() as { error?: string };
        if (body?.error) msg = body.error;
      } catch { /* keep msg */ }
    }
    throw new Error(msg);
  }

  if (!data?.address) throw new Error('Deposit address unavailable — please try again');

  return {
    address: data.address as string,
    memo:    data.memo as string | undefined,
    source:  (data.source as string | undefined) ?? 'binance',
  };
}

// ─── Deposits ─────────────────────────────────────────────────────────────────

export async function getDeposits(limit = 30, asset?: string): Promise<DepositRecord[]> {
  let q = supabase.from('deposits').select('*').order('created_at', { ascending: false }).limit(limit);
  if (asset) q = q.eq('asset', asset);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapDeposit(r as Record<string, unknown>));
}

// ─── Withdrawals ──────────────────────────────────────────────────────────────

export async function submitWithdrawal(params: {
  asset: string; network: string; toAddress: string; memo?: string; amount: number;
  stepUpTokenId?: string;
}): Promise<{ id: string; status: string; binanceSubmitted: boolean }> {
  // All withdrawal logic is in the wallet-action Edge Function.
  // Balance lock, Binance submission and ledger records are all server-side.
  const { data, error } = await supabase.functions.invoke('wallet-action', {
    body: {
      action:          'submit-withdrawal',
      asset:           params.asset,
      network:         params.network,
      toAddress:       params.toAddress,
      memo:            params.memo,
      amount:          params.amount,
      stepUpTokenId:   params.stepUpTokenId,
    },
  });

  if (error) {
    let msg = 'Withdrawal failed';
    if (error.message) {
      try {
        const parsed = JSON.parse(error.message) as { error?: string };
        msg = parsed?.error ?? error.message;
      } catch {
        msg = error.message;
      }
    }
    const ctx = (error as unknown as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json() as { error?: string };
        if (body?.error) msg = body.error;
      } catch { /* keep */ }
    }
    throw new Error(msg);
  }

  return {
    id:               data.id as string,
    status:           data.status as string ?? 'submitted',
    binanceSubmitted: data.source === 'binance',
  };
}

export async function cancelWithdrawal(withdrawalId: string): Promise<void> {
  const { error } = await supabase.rpc('wallet_withdrawal_cancel', {
    p_withdrawal_id: withdrawalId,
    p_reason: 'Cancelled by user',
  });
  if (error) throw new Error(error.message);
}

export async function getWithdrawals(limit = 30, asset?: string): Promise<WithdrawalRecord[]> {
  let q = supabase.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(limit);
  if (asset) q = q.eq('asset', asset);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapWithdrawal(r as Record<string, unknown>));
}

// ─── Internal Transfers (user → user) ────────────────────────────────────────

export interface InternalTransferParams {
  recipientIdentifier: string; // email, username, or user ID
  asset: string;
  amount: number;
  walletType?: WalletType;
  note?: string;
}

export async function lookupRecipient(identifier: string): Promise<{ id: string; displayName: string; email: string } | null> {
  // UUID regex — only try direct ID lookup if identifier looks like a UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  if (isUuid) {
    const { data: byId } = await supabase.from('profiles').select('id, email, username')
      .eq('id', identifier).maybeSingle();
    if (byId) return { id: byId.id as string, displayName: (byId.username as string) || identifier, email: byId.email as string };
  }

  // Try by short display UID (profiles.uid TEXT field)
  const { data: byUid } = await supabase.from('profiles').select('id, email, username')
    .eq('uid', identifier).maybeSingle();
  if (byUid) return { id: byUid.id as string, displayName: (byUid.username as string) || identifier, email: byUid.email as string };

  // Try by email
  const { data: byEmail } = await supabase.from('profiles').select('id, email, username')
    .eq('email', identifier).maybeSingle();
  if (byEmail) return { id: byEmail.id as string, displayName: (byEmail.username as string) || identifier, email: byEmail.email as string };

  // Try by username (case-insensitive)
  const { data: byUsername } = await supabase.from('profiles').select('id, email, username')
    .ilike('username', identifier).maybeSingle();
  if (byUsername) return { id: byUsername.id as string, displayName: (byUsername.username as string) || identifier, email: byUsername.email as string };

  return null;
}

export async function sendInternalTransfer(params: InternalTransferParams): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const recipient = await lookupRecipient(params.recipientIdentifier);
  if (!recipient) throw new Error('Recipient not found. Check the email, username, or UID.');
  if (recipient.id === user.id) throw new Error('You cannot transfer to yourself.');

  const { data, error } = await supabase.rpc('wallet_internal_transfer', {
    p_sender_id: user.id,
    p_recipient_id: recipient.id,
    p_asset: params.asset,
    p_amount: params.amount,
    p_wallet_type: params.walletType ?? 'spot',
    p_note: params.note ?? null,
    p_fee: 0,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getInternalTransfers(limit = 30): Promise<InternalTransfer[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('internal_transfers').select('*')
    .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapInternalTransfer(r as Record<string, unknown>));
}

// ─── Wallet-to-Wallet Transfers (own wallets) ─────────────────────────────────

export async function selfTransfer(params: {
  asset: string; fromWallet: WalletType; toWallet: WalletType; amount: number;
}): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (params.fromWallet === params.toWallet) throw new Error('Source and destination wallets must differ.');

  const { data, error } = await supabase.rpc('wallet_self_transfer', {
    p_user_id: user.id,
    p_asset: params.asset,
    p_amount: params.amount,
    p_from_wallet: params.fromWallet,
    p_to_wallet: params.toWallet,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getWalletTransfers(limit = 30): Promise<WalletTransfer[]> {
  const { data, error } = await supabase.from('wallet_transfers').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapWalletTransfer(r as Record<string, unknown>));
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

export async function getEscrows(status?: EscrowRecord['status']): Promise<EscrowRecord[]> {
  let q = supabase.from('escrows').select('*').order('created_at', { ascending: false }).limit(50);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapEscrow(r as Record<string, unknown>));
}

/** Admin-only: fetch ALL wallet balances across all users (no user_id filter).
 *  Uses profiles join to show owner email/uid alongside each balance row.
 *  Never calls ensure_user_wallets — admin reads only. */
export async function getAdminWalletBalances(limit = 200): Promise<(WalletBalance & { ownerEmail?: string; ownerUid?: string })[]> {
  const { data, error } = await supabase
    .from('wallets')
    .select('*, profiles!user_id(email, uid)')
    .order('user_id')
    .order('asset')
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => {
    const row = r as Record<string, unknown>;
    const profile = row['profiles'] as Record<string, unknown> | null;
    return {
      ...mapWallet(row),
      ownerEmail: profile?.email as string | undefined,
      ownerUid:   profile?.uid   as string | undefined,
    };
  });
}

/** Admin-only: fetch ALL escrows across all users */
export async function getAdminEscrows(status?: EscrowRecord['status']): Promise<EscrowRecord[]> {
  let q = supabase.from('escrows')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapEscrow(r as Record<string, unknown>));
}

/** Admin-only: fetch ALL wallet audit logs across all users */
export async function getAdminAuditLogs(limit = 100): Promise<WalletAuditLog[]> {
  const { data, error } = await supabase
    .from('wallet_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id:            r.id            as string,
    actorId:       r.actor_id      as string | undefined,
    targetUserId:  r.target_user_id as string | undefined,
    action:        r.action        as string,
    asset:         r.asset         as string | undefined,
    amount:        r.amount  != null ? Number(r.amount) : undefined,
    referenceId:   r.reference_id  as string | undefined,
    referenceType: r.reference_type as string | undefined,
    reason:        r.reason        as string | undefined,
    metadata:      r.metadata      as Record<string, unknown> | undefined,
    createdAt:     r.created_at    as string,
  }));
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function getWalletAuditLogs(limit = 30): Promise<WalletAuditLog[]> {
  const { data, error } = await supabase.from('wallet_audit_logs').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id as string,
    actorId: r.actor_id as string | undefined,
    targetUserId: r.target_user_id as string | undefined,
    action: r.action as string,
    asset: r.asset as string | undefined,
    amount: r.amount != null ? Number(r.amount) : undefined,
    referenceId: r.reference_id as string | undefined,
    referenceType: r.reference_type as string | undefined,
    reason: r.reason as string | undefined,
    metadata: r.metadata as Record<string, unknown> | undefined,
    createdAt: r.created_at as string,
  }));
}

// ─── Provider Status ──────────────────────────────────────────────────────────

export interface ProviderStatus {
  configId: string;
  status: 'connected' | 'auth_failed' | 'missing_permission' | 'rate_limited' | 'degraded' | 'disabled' | 'unknown';
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  spotEnabled: boolean;
  futuresEnabled: boolean;
  permissions: string[];
  latencyMs: number | null;
  lastCheckedAt: string;
  errorMessage: string | null;
}

/** Read the cached provider status from DB (set by provider-action test-connection). */
export async function getProviderStatus(): Promise<ProviderStatus | null> {
  const { data, error } = await supabase
    .from('wallet_provider_status')
    .select('*, exchange_provider_configs!config_id(id, label, provider_name, is_active)')
    .order('last_checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    configId:       r.config_id as string,
    status:         (r.status as ProviderStatus['status']) ?? 'unknown',
    depositEnabled: Boolean(r.deposit_enabled),
    withdrawEnabled: Boolean(r.withdraw_enabled),
    spotEnabled:    Boolean(r.spot_enabled),
    futuresEnabled: Boolean(r.futures_enabled),
    permissions:    Array.isArray(r.permissions) ? r.permissions as string[] : [],
    latencyMs:      r.latency_ms != null ? Number(r.latency_ms) : null,
    lastCheckedAt:  r.last_checked_at as string,
    errorMessage:   r.error_message as string | null,
  };
}

/** Admin: trigger a sync of deposit+withdrawal history for all active Binance configs. */
export async function triggerProviderSync(configId: string): Promise<{ deposits: unknown; withdrawals: unknown }> {
  const [depResult, wdResult] = await Promise.allSettled([
    supabase.functions.invoke('provider-action', { body: { action: 'sync-deposits', configId } }),
    supabase.functions.invoke('provider-action', { body: { action: 'sync-withdrawals', configId } }),
  ]);
  return {
    deposits:    depResult.status === 'fulfilled' ? depResult.value.data : { error: String((depResult as PromiseRejectedResult).reason) },
    withdrawals: wdResult.status  === 'fulfilled' ? wdResult.value.data  : { error: String((wdResult  as PromiseRejectedResult).reason) },
  };
}

// ─── Freeze check ─────────────────────────────────────────────────────────────

export async function checkWalletFrozen(asset?: string): Promise<WalletFreeze | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  let q = supabase.from('wallet_freezes').select('*').eq('user_id', user.id).eq('is_active', true);
  if (asset) q = q.or(`asset.eq.${asset},asset.is.null`);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    userId: data.user_id as string,
    walletType: data.wallet_type as WalletType | undefined,
    asset: data.asset as string | undefined,
    freezeType: data.freeze_type as WalletFreeze['freezeType'],
    reason: data.reason as string,
    isActive: Boolean(data.is_active),
    expiresAt: data.expires_at as string | undefined,
    createdAt: data.created_at as string,
  };
}

// ─── Payment Methods (legacy compat) ─────────────────────────────────────────

export async function getPaymentMethods(currency?: string) {
  let q = supabase.from('payment_methods').select('*').eq('is_active', true);
  if (currency) q = q.eq('currency', currency);
  const { data, error } = await q.order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function addPaymentMethod(params: {
  methodName: string; bankName?: string; accountNumber?: string;
  accountName?: string; bankCode?: string; currency: string; instructions?: string;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase.from('payment_methods').insert({
    user_id: user.id,
    method_name: params.methodName,
    bank_name: params.bankName ?? null,
    account_number: params.accountNumber ?? null,
    account_name: params.accountName ?? null,
    bank_code: params.bankCode ?? null,
    currency: params.currency,
    instructions: params.instructions ?? null,
  }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
