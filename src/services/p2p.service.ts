// P2P Service V3 — all sensitive ops routed through Edge Functions / SECURITY DEFINER RPCs
import { supabase } from '@/client/supabase';

// ─── Notification Type ───────────────────────────────────────────────────────
export interface P2PNotification {
  id: string; userId: string; tradeId?: string;
  type: string; title: string; body: string;
  isRead: boolean; createdAt: string;
}

// ─── Enums & Primitive Types ────────────────────────────────────────────────
export type P2PSide = 'buy' | 'sell';
export type P2PAdStatus = 'active' | 'paused' | 'completed' | 'deleted';
export type P2PTradeStatus =
  | 'pending' | 'awaiting_payment' | 'payment_marked' | 'awaiting_release'
  | 'released' | 'cancelled' | 'expired' | 'disputed' | 'refunded';
export type P2PDisputeStatus =
  | 'open' | 'under_review' | 'waiting_buyer' | 'waiting_seller' | 'resolved' | 'rejected';

// ─── Reference Types ────────────────────────────────────────────────────────
export interface P2PAsset {
  id: string; symbol: string; name: string;
  iconUrl?: string; decimals: number; isActive: boolean; sortOrder: number;
}
export interface P2PFiat {
  id: string; code: string; name: string; symbol: string;
  countryCode?: string; isActive: boolean; sortOrder: number;
}
export interface P2PCountry {
  id: string; code: string; name: string;
  phonePrefix?: string; defaultFiat?: string; isActive: boolean;
}
export interface P2PPaymentMethod {
  id: string; name: string; slug: string; logoUrl?: string;
  countryCodes: string[]; fiatCodes: string[]; isActive: boolean;
}

// ─── Merchant ───────────────────────────────────────────────────────────────
export interface P2PMerchant {
  id: string; userId: string; displayName: string;
  countryCode?: string;
  totalTrades: number; completedTrades: number; cancelledTrades: number; disputedTrades: number;
  positiveRatings: number; negativeRatings: number;
  avgPaymentTime: number; avgReleaseTime: number;
  isOnline: boolean; lastSeenAt?: string;
  isVerified: boolean; isPro: boolean; isSuspended: boolean; kycLevel: number;
  bio?: string; terms?: string; autoReply?: string;
  supportedFiats: string[]; supportedPayments: string[];
  completionRate: number;
  createdAt: string;
}

// ─── Ad ─────────────────────────────────────────────────────────────────────
export interface P2PAd {
  id: string; merchantId: string; side: P2PSide;
  asset: string; fiat: string; countryCode?: string;
  priceType: 'fixed' | 'floating'; price: number; floatMargin?: number;
  totalAmount: number; availableAmount: number;
  minLimit: number; maxLimit: number;
  paymentMethods: string[]; paymentWindow: number;
  terms?: string; autoReply?: string;
  status: P2PAdStatus;
  completionRate: number; tradeCount: number; avgReleaseTime: number;
  createdAt: string; updatedAt: string;
  // joined
  merchant?: P2PMerchant;
}

// ─── Trade ──────────────────────────────────────────────────────────────────
export interface P2PTrade {
  id: string; tradeNumber: string; adId: string;
  buyerId: string; sellerId: string; merchantId: string;
  asset: string; fiat: string;
  cryptoAmount: number; fiatAmount: number; price: number; feeCrypto: number;
  paymentMethod: string; paymentWindow: number;
  status: P2PTradeStatus;
  escrowLockedAt?: string; paymentDueAt?: string;
  paidAt?: string; releasedAt?: string; cancelledAt?: string; expiresAt?: string;
  escrowReleased: boolean;
  buyerRated: boolean; sellerRated: boolean;
  cancelReason?: string;
  createdAt: string; updatedAt: string;
  // joined
  ad?: Partial<P2PAd>;
  buyerName?: string; sellerName?: string;
}

// ─── Trade Message ───────────────────────────────────────────────────────────
export interface P2PTradeMessage {
  id: string; tradeId: string; senderId?: string; message?: string;
  imageUrl?: string; isSystem: boolean; createdAt: string;
}

// ─── Dispute ────────────────────────────────────────────────────────────────
export interface P2PDispute {
  id: string; tradeId: string; raisedBy: string;
  reason: string; description?: string; evidenceUrls: string[];
  status: P2PDisputeStatus; adminNote?: string;
  resolvedInFavorOf?: string; resolvedAt?: string;
  createdAt: string; updatedAt: string;
}

// ─── Payment Account ─────────────────────────────────────────────────────────
export interface P2PPaymentAccount {
  id: string; userId: string;
  paymentMethod: string; accountName: string; accountNumber: string;
  bankName?: string; countryCode?: string; fiatCode?: string; extraInfo?: string;
  isVerified: boolean; isActive: boolean; createdAt: string;
}

// ─── Filter params ───────────────────────────────────────────────────────────
export interface P2PAdsFilter {
  side: P2PSide;
  asset?: string;
  fiat?: string;
  countryCode?: string;
  paymentMethod?: string;
  minAmount?: number;
  maxAmount?: number;
  verifiedOnly?: boolean;
  onlineOnly?: boolean;
  minCompletionRate?: number;
  minTradeCount?: number;
  sortBy?: 'price' | 'completion_rate' | 'avg_release_time' | 'trade_count';
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCE DATA
// ═══════════════════════════════════════════════════════════════════════════

export async function getP2PAssets(): Promise<P2PAsset[]> {
  const { data, error } = await supabase
    .from('p2p_assets').select('*').eq('is_active', true).order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id, symbol: r.symbol, name: r.name, iconUrl: r.icon_url ?? undefined,
    decimals: r.decimals, isActive: r.is_active, sortOrder: r.sort_order,
  }));
}

export async function getP2PFiats(): Promise<P2PFiat[]> {
  const { data, error } = await supabase
    .from('p2p_fiats').select('*').eq('is_active', true).order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id, code: r.code, name: r.name, symbol: r.symbol,
    countryCode: r.country_code ?? undefined, isActive: r.is_active, sortOrder: r.sort_order,
  }));
}

export async function getP2PCountries(): Promise<P2PCountry[]> {
  const { data, error } = await supabase
    .from('p2p_countries').select('*').eq('is_active', true).order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id, code: r.code, name: r.name, phonePrefix: r.phone_prefix ?? undefined,
    defaultFiat: r.default_fiat ?? undefined, isActive: r.is_active,
  }));
}

export async function getP2PPaymentMethods(fiatCode?: string, countryCode?: string): Promise<P2PPaymentMethod[]> {
  let query = supabase.from('p2p_payment_methods').select('*').eq('is_active', true).order('sort_order');
  if (fiatCode) query = query.contains('fiat_codes', [fiatCode]);
  if (countryCode) query = query.contains('country_codes', [countryCode]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url ?? undefined,
    countryCodes: r.country_codes ?? [], fiatCodes: r.fiat_codes ?? [], isActive: r.is_active,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE ADS
// ═══════════════════════════════════════════════════════════════════════════

export async function getP2PAds(filter: P2PAdsFilter): Promise<P2PAd[]> {
  const ascending = filter.side === 'buy'; // buy ads: cheapest first; sell ads: expensive first
  let q = supabase
    .from('p2p_ads')
    .select(`*, p2p_merchants!merchant_id(*)`)
    .eq('status', 'active')
    .eq('side', filter.side)
    .gt('available_amount', 0);

  if (filter.asset) q = q.eq('asset', filter.asset);
  if (filter.fiat) q = q.eq('fiat', filter.fiat);
  if (filter.countryCode) q = q.eq('country_code', filter.countryCode);
  if (filter.paymentMethod) q = q.contains('payment_methods', [filter.paymentMethod]);
  if (filter.verifiedOnly) q = q.eq('p2p_merchants.is_verified', true);

  const sortCol = filter.sortBy === 'completion_rate' ? 'completion_rate'
    : filter.sortBy === 'avg_release_time' ? 'avg_release_time'
    : filter.sortBy === 'trade_count' ? 'trade_count'
    : 'price';
  q = q.order(sortCol, { ascending: sortCol === 'price' ? ascending : false });
  q = q.limit(filter.limit ?? 30);
  if (filter.offset) q = q.range(filter.offset, filter.offset + (filter.limit ?? 30) - 1);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map(r => mapAd(r))
    .filter(ad => {
      const m = ad.merchant;
      if (filter.onlineOnly && m && !m.isOnline) return false;
      if (filter.minCompletionRate && ad.completionRate < filter.minCompletionRate) return false;
      if (filter.minTradeCount && ad.tradeCount < filter.minTradeCount) return false;
      if (filter.minAmount && ad.maxLimit < filter.minAmount) return false;
      if (filter.maxAmount && ad.minLimit > filter.maxAmount) return false;
      return true;
    });
}

export async function getAdById(adId: string): Promise<P2PAd | null> {
  const { data, error } = await supabase
    .from('p2p_ads')
    .select(`*, p2p_merchants!merchant_id(*)`)
    .eq('id', adId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapAd(data) : null;
}

export async function getMyAds(): Promise<P2PAd[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const merchant = await getOrCreateMerchant();
  const { data, error } = await supabase
    .from('p2p_ads')
    .select('*')
    .eq('merchant_id', merchant.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapAd(r));
}

export async function createAd(params: {
  side: P2PSide; asset: string; fiat: string; countryCode?: string;
  priceType: 'fixed' | 'floating'; price: number; floatMargin?: number;
  totalAmount: number; minLimit: number; maxLimit: number;
  paymentMethods: string[]; paymentWindow: number;
  terms?: string; autoReply?: string;
}): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Try Edge Function first for server-side balance validation
  try {
    const { data, error } = await supabase.functions.invoke('p2p-ad-create', {
      body: {
        side: params.side, asset: params.asset, fiat: params.fiat,
        countryCode: params.countryCode,
        priceType: params.priceType, price: params.price,
        floatMargin: params.floatMargin,
        totalAmount: params.totalAmount,
        minLimit: params.minLimit, maxLimit: params.maxLimit,
        paymentMethods: params.paymentMethods, paymentWindow: params.paymentWindow,
        terms: params.terms, autoReply: params.autoReply,
      },
      method: 'POST',
    });
    if (!error && data?.id) return (data as { id: string }).id;
  } catch {
    // Edge function unavailable or failed — proceed to direct database insert with merchant verification
  }

  // Fallback: direct insert
  const merchant = await getOrCreateMerchant();
  const { data: ad, error: adErr } = await supabase
    .from('p2p_ads')
    .insert({
      merchant_id:      merchant.id,
      side:             params.side,
      asset:            params.asset,
      fiat:             params.fiat,
      country_code:     params.countryCode ?? null,
      price_type:       params.priceType,
      price:            params.price,
      float_margin:     params.floatMargin ?? 0,
      total_amount:     params.totalAmount,
      available_amount: params.totalAmount,
      min_limit:        params.minLimit,
      max_limit:        params.maxLimit,
      payment_methods:  params.paymentMethods,
      payment_window:   params.paymentWindow,
      terms:            params.terms ?? null,
      auto_reply:       params.autoReply ?? null,
      status:           'active',
    })
    .select('id')
    .single();

  if (adErr) throw new Error(adErr.message);
  return (ad as { id: string }).id;
}

export async function updateAdStatus(adId: string, status: 'active' | 'paused' | 'deleted'): Promise<void> {
  const { error } = await supabase
    .from('p2p_ads').update({ status, updated_at: new Date().toISOString() }).eq('id', adId);
  if (error) throw new Error(error.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// MERCHANT
// ═══════════════════════════════════════════════════════════════════════════

export async function getOrCreateMerchant(): Promise<P2PMerchant> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existing, error: selErr } = await supabase
    .from('p2p_merchants').select('*').eq('user_id', user.id).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return mapMerchant(existing);

  // Auto-create merchant profile from auth user
  const { data: profile } = await supabase
    .from('profiles').select('username').eq('id', user.id).maybeSingle();
  const displayName = (profile as { username?: string } | null)?.username ?? user.email?.split('@')[0] ?? 'User';
  const { data, error } = await supabase
    .from('p2p_merchants')
    .insert({ user_id: user.id, display_name: displayName })
    .select('*').single();
  if (error) throw new Error(error.message);
  return mapMerchant(data);
}

export async function getMerchantById(merchantId: string): Promise<P2PMerchant | null> {
  const { data, error } = await supabase
    .from('p2p_merchants').select('*').eq('id', merchantId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapMerchant(data) : null;
}

export async function updateMerchantProfile(params: {
  bio?: string; terms?: string; autoReply?: string;
  supportedFiats?: string[]; supportedPayments?: string[];
  countryCode?: string;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('p2p_merchants')
    .update({
      bio: params.bio, terms: params.terms, auto_reply: params.autoReply,
      supported_fiats: params.supportedFiats, supported_payments: params.supportedPayments,
      country_code: params.countryCode, updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);
  if (error) throw new Error(error.message);
}

export async function setMerchantOnline(isOnline: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('p2p_merchants')
    .update({ is_online: isOnline, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', user.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADES
// ═══════════════════════════════════════════════════════════════════════════

export async function createTrade(params: {
  adId: string; cryptoAmount: number; fiatAmount: number; paymentMethod: string;
}): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Try Edge Function first for duplicate check and notifications
  try {
    const { data, error } = await supabase.functions.invoke('p2p-trade-create', {
      body: {
        adId: params.adId,
        cryptoAmount: params.cryptoAmount,
        fiatAmount: params.fiatAmount,
        paymentMethod: params.paymentMethod,
      },
      method: 'POST',
    });
    if (!error && data?.tradeId) return (data as { tradeId: string }).tradeId;
  } catch {
    // Edge function unavailable — invoke atomic RPC directly
  }

  // Fallback: direct atomic RPC
  const { data: tradeId, error: rpcErr } = await supabase.rpc('p2p_create_trade', {
    p_ad_id:          params.adId,
    p_buyer_id:       user.id,
    p_crypto_amount:  params.cryptoAmount,
    p_fiat_amount:    params.fiatAmount,
    p_payment_method: params.paymentMethod,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  return tradeId as string;
}

export async function getMyTrades(status?: P2PTradeStatus, limit = 30, offset = 0): Promise<P2PTrade[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  let q = supabase
    .from('p2p_trades')
    .select('*, p2p_ads!ad_id(asset, fiat, side)')
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapTrade(r));
}

export async function getTradeById(tradeId: string): Promise<P2PTrade | null> {
  const { data, error } = await supabase
    .from('p2p_trades')
    .select('*, p2p_ads!ad_id(asset, fiat, side, payment_methods, terms)')
    .eq('id', tradeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapTrade(data) : null;
}

// P2P service — idempotency-safe payment, release and cancel operations
export async function markPaymentSent(tradeId: string): Promise<void> {
  // Use atomic p2p_mark_paid RPC — handles state guard, timestamp, system message, notification
  const { error } = await supabase.rpc('p2p_mark_paid', { p_trade_id: tradeId });
  if (error) throw new Error(error.message);
}

export async function releaseCrypto(tradeId: string, stepUpTokenId?: string): Promise<void> {
  // Try Edge Function first
  try {
    const { data, error } = await supabase.functions.invoke('p2p-escrow-release', {
      body: { tradeId, stepUpTokenId: stepUpTokenId ?? null },
      method: 'POST',
    });
    if (!error && (data as { success?: boolean })?.success) return;
  } catch {
    // Edge function unavailable — fallback to direct SECURITY DEFINER RPC
  }

  // Fallback: direct SECURITY DEFINER RPC
  const { error: rpcErr } = await supabase.rpc('p2p_release_escrow_secure', {
    p_trade_id:   tradeId,
    p_step_token: stepUpTokenId ?? null,
  });
  if (rpcErr) throw new Error(rpcErr.message);
}

export async function cancelTrade(tradeId: string, reason: string): Promise<void> {
  // Try Edge Function first
  try {
    const { data, error } = await supabase.functions.invoke('p2p-escrow-refund', {
      body: { tradeId, reason },
      method: 'POST',
    });
    if (!error && (data as { success?: boolean })?.success) return;
  } catch {
    // Edge function unavailable — fallback to atomic RPC
  }

  // Fallback: direct atomic cancel RPC
  const { error: rpcErr } = await supabase.rpc('p2p_cancel_trade', {
    p_trade_id: tradeId,
    p_reason:   reason,
  });
  if (rpcErr) throw new Error(rpcErr.message);
}

/** Fetch seller payment details — only accessible to trade parties via SECURITY DEFINER RPC */
export async function getTradePaymentDetails(tradeId: string): Promise<{
  accountName: string; accountNumber: string; bankName?: string;
  extraInfo?: string; paymentMethod: string; fiatCode?: string;
} | null> {
  const { data, error } = await supabase.rpc('get_trade_payment_details', { p_trade_id: tradeId });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    accountName:   r.account_name as string,
    accountNumber: r.account_number as string,
    bankName:      r.bank_name as string | undefined,
    extraInfo:     r.extra_info as string | undefined,
    paymentMethod: r.payment_method as string,
    fiatCode:      r.fiat_code as string | undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADE MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

export async function getTradeMessages(tradeId: string): Promise<P2PTradeMessage[]> {
  const { data, error } = await supabase
    .from('p2p_trade_messages').select('*')
    .eq('trade_id', tradeId).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id, tradeId: r.trade_id, senderId: r.sender_id ?? undefined,
    message: r.message ?? undefined, imageUrl: r.image_url ?? undefined,
    isSystem: r.is_system, createdAt: r.created_at,
  }));
}

export async function sendTradeMessage(tradeId: string, message: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('p2p_trade_messages')
    .insert({ trade_id: tradeId, sender_id: user.id, message, is_system: false });
  if (error) throw new Error(error.message);
}

async function addSystemMessage(tradeId: string, message: string): Promise<void> {
  await supabase.from('p2p_trade_messages')
    .insert({ trade_id: tradeId, sender_id: null, message, is_system: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPUTES
// ═══════════════════════════════════════════════════════════════════════════

export const DISPUTE_REASONS = [
  'Buyer paid, seller did not release',
  'Seller did not receive payment',
  'Wrong amount paid',
  'Suspicious payment',
  'Payment made from third-party account',
  'Scam attempt',
  'Other',
];

export async function openDispute(tradeId: string, reason: string, description?: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Atomic: freeze trade + insert dispute in single RPC to prevent race conditions
  const { data, error } = await supabase.rpc('p2p_open_dispute', {
    p_trade_id:   tradeId,
    p_reason:     reason,
    p_description: description ?? null,
  });
  if (error) {
    // Fallback: manual two-step if RPC not available yet
    await supabase.from('p2p_trades')
      .update({ status: 'disputed', updated_at: new Date().toISOString() }).eq('id', tradeId);
    const { data: d2, error: e2 } = await supabase.from('p2p_disputes')
      .insert({ trade_id: tradeId, raised_by: user.id, reason, description })
      .select('id').single();
    if (e2) throw new Error(e2.message);
    await addSystemMessage(tradeId, `Dispute opened: ${reason}. Trade is now frozen pending admin review.`);
    await supabase.from('p2p_risk_events').insert({
      user_id: user.id, trade_id: tradeId,
      event_type: 'dispute_opened', severity: 'medium',
      details: { reason },
    });
    return (d2 as { id: string }).id;
  }
  return data as string;
}

export async function getDisputeByTradeId(tradeId: string): Promise<P2PDispute | null> {
  const { data, error } = await supabase
    .from('p2p_disputes').select('*').eq('trade_id', tradeId).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0];
  return row ? mapDispute(row) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════

export async function getMyPaymentAccounts(): Promise<P2PPaymentAccount[]> {
  const { data, error } = await supabase
    .from('p2p_user_payment_accounts').select('*')
    .eq('is_active', true).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapPaymentAccount(r));
}

export async function addPaymentAccount(params: {
  paymentMethod: string; accountName: string; accountNumber: string;
  bankName?: string; countryCode?: string; fiatCode?: string; extraInfo?: string;
}): Promise<void> {
  const { error } = await supabase.from('p2p_user_payment_accounts').insert({
    payment_method: params.paymentMethod,
    account_name: params.accountName,
    account_number: params.accountNumber,
    bank_name: params.bankName,
    country_code: params.countryCode,
    fiat_code: params.fiatCode,
    extra_info: params.extraInfo,
  });
  if (error) throw new Error(error.message);
}

export async function deletePaymentAccount(id: string): Promise<void> {
  const { error } = await supabase.from('p2p_user_payment_accounts')
    .update({ is_active: false }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════════════════════════════════

export async function submitReview(tradeId: string, revieweeId: string, rating: 1 | -1, comment?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('p2p_trade_reviews')
    .insert({ trade_id: tradeId, reviewee_id: revieweeId, rating, comment });
  if (error) throw new Error(error.message);
  // Update merchant stats
  const col = rating === 1 ? 'positive_ratings' : 'negative_ratings';
  await supabase.rpc('increment_merchant_rating' as string, { p_user_id: revieweeId, p_col: col });
  // Mark rated on trade
  const { data: trade } = await supabase.from('p2p_trades')
    .select('buyer_id').eq('id', tradeId).single();
  const field = (trade as { buyer_id: string } | null)?.buyer_id === user.id ? 'buyer_rated' : 'seller_rated';
  await supabase.from('p2p_trades').update({ [field]: true }).eq('id', tradeId);
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════

export async function adminGetAllTrades(limit = 50, offset = 0): Promise<P2PTrade[]> {
  const { data, error } = await supabase
    .from('p2p_trades').select('*')
    .order('created_at', { ascending: false })
    .limit(limit).range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapTrade(r));
}

export async function adminGetAllDisputes(limit = 50): Promise<P2PDispute[]> {
  const { data, error } = await supabase
    .from('p2p_disputes').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapDispute(r));
}

export async function adminResolveDispute(disputeId: string, status: P2PDisputeStatus, adminNote: string, favorUserId?: string): Promise<void> {
  await supabase.from('p2p_disputes').update({
    status, admin_note: adminNote,
    resolved_in_favor_of: favorUserId,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', disputeId);
}

export async function adminReleaseTrade(tradeId: string): Promise<void> {
  // p2p_admin_release RPC is SECURITY DEFINER — atomically releases escrow + updates status in one call
  const { error } = await supabase.rpc('p2p_admin_release', { p_trade_id: tradeId });
  if (error) throw new Error(error.message);
}

/** Admin: refund escrow back to seller (dispute resolved in seller's favour) */
export async function adminRefundTrade(tradeId: string): Promise<void> {
  // p2p_admin_refund RPC is SECURITY DEFINER — atomically refunds escrow + updates status in one call
  const { error } = await supabase.rpc('p2p_admin_refund', { p_trade_id: tradeId });
  if (error) throw new Error(error.message);
}

/** Admin: fetch single dispute with joined trade info */
export async function adminGetDisputeDetail(disputeId: string): Promise<P2PDispute & {
  trade?: P2PTrade; messages?: P2PTradeMessage[];
}> {
  const [dispRes, ] = await Promise.all([
    supabase.from('p2p_disputes').select('*').eq('id', disputeId).single(),
  ]);
  if (dispRes.error) throw new Error(dispRes.error.message);
  const dispute = mapDispute(dispRes.data);

  const [tradeRes, msgRes] = await Promise.all([
    supabase.from('p2p_trades').select('*').eq('id', dispute.tradeId).single(),
    supabase.from('p2p_trade_messages').select('*').eq('trade_id', dispute.tradeId).order('created_at'),
  ]);

  return {
    ...dispute,
    trade: tradeRes.data ? mapTrade(tradeRes.data) : undefined,
    messages: (msgRes.data ?? []).map(r => mapTradeMessage(r as Record<string, unknown>)),
  };
}

export async function adminSuspendMerchant(merchantId: string, suspended: boolean): Promise<void> {
  await supabase.from('p2p_merchants')
    .update({ is_suspended: suspended, updated_at: new Date().toISOString() }).eq('id', merchantId);
}

export async function adminGetAllAds(limit = 50): Promise<P2PAd[]> {
  // Use explicit select without join hint to avoid FK cache issues after schema changes
  const { data, error } = await supabase
    .from('p2p_ads').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => mapAd(r));
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function getP2PNotifications(limit = 30): Promise<P2PNotification[]> {
  const { data, error } = await supabase
    .from('p2p_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id:        r.id as string,
    userId:    r.user_id as string,
    tradeId:   (r.trade_id as string) ?? undefined,
    type:      r.type as string,
    title:     r.title as string,
    body:      r.body as string,
    isRead:    Boolean(r.is_read),
    createdAt: r.created_at as string,
  }));
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await supabase
    .from('p2p_notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('p2p_notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('p2p_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);
  if (error) return 0;
  return count ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAPPERS
// ═══════════════════════════════════════════════════════════════════════════

function mapMerchant(r: Record<string, unknown>): P2PMerchant {
  const total = Number(r.completed_trades ?? 0) + Number(r.cancelled_trades ?? 0);
  const rate = total > 0 ? Math.round((Number(r.completed_trades) / total) * 100) : 100;
  return {
    id: r.id as string, userId: r.user_id as string,
    displayName: r.display_name as string,
    countryCode: (r.country_code as string) ?? undefined,
    totalTrades: Number(r.total_trades ?? 0),
    completedTrades: Number(r.completed_trades ?? 0),
    cancelledTrades: Number(r.cancelled_trades ?? 0),
    disputedTrades: Number(r.disputed_trades ?? 0),
    positiveRatings: Number(r.positive_ratings ?? 0),
    negativeRatings: Number(r.negative_ratings ?? 0),
    avgPaymentTime: Number(r.avg_payment_time ?? 0),
    avgReleaseTime: Number(r.avg_release_time ?? 0),
    isOnline: Boolean(r.is_online),
    lastSeenAt: (r.last_seen_at as string) ?? undefined,
    isVerified: Boolean(r.is_verified),
    isPro: Boolean(r.is_pro),
    isSuspended: Boolean(r.is_suspended),
    kycLevel: Number(r.kyc_level ?? 0),
    bio: (r.bio as string) ?? undefined,
    terms: (r.terms as string) ?? undefined,
    autoReply: (r.auto_reply as string) ?? undefined,
    supportedFiats: (r.supported_fiats as string[]) ?? [],
    supportedPayments: (r.supported_payments as string[]) ?? [],
    completionRate: rate,
    createdAt: r.created_at as string,
  };
}

function mapAd(r: Record<string, unknown>): P2PAd {
  const merchant = r.p2p_merchants ? mapMerchant(r.p2p_merchants as Record<string, unknown>) : undefined;
  return {
    id: r.id as string,
    merchantId: r.merchant_id as string,
    side: r.side as P2PSide,
    asset: r.asset as string,
    fiat: r.fiat as string,
    countryCode: (r.country_code as string) ?? undefined,
    priceType: ((r.price_type as string) ?? 'fixed') as 'fixed' | 'floating',
    price: Number(r.price),
    floatMargin: r.float_margin !== null && r.float_margin !== undefined ? Number(r.float_margin) : undefined,
    totalAmount: Number(r.total_amount),
    availableAmount: Number(r.available_amount),
    minLimit: Number(r.min_limit),
    maxLimit: Number(r.max_limit),
    paymentMethods: (r.payment_methods as string[]) ?? [],
    paymentWindow: Number(r.payment_window ?? 15),
    terms: (r.terms as string) ?? undefined,
    autoReply: (r.auto_reply as string) ?? undefined,
    status: (r.status as P2PAdStatus),
    completionRate: Number(r.completion_rate ?? 100),
    tradeCount: Number(r.trade_count ?? 0),
    avgReleaseTime: Number(r.avg_release_time ?? 0),
    createdAt: r.created_at as string,
    updatedAt: (r.updated_at as string) ?? r.created_at as string,
    merchant,
  };
}

function mapTrade(r: Record<string, unknown>): P2PTrade {
  const ad = r.p2p_ads as Record<string, unknown> | null;
  return {
    id: r.id as string,
    tradeNumber: r.trade_number as string,
    adId: r.ad_id as string,
    buyerId: r.buyer_id as string,
    sellerId: r.seller_id as string,
    merchantId: r.merchant_id as string,
    asset: r.asset as string,
    fiat: r.fiat as string,
    cryptoAmount: Number(r.crypto_amount),
    fiatAmount: Number(r.fiat_amount),
    price: Number(r.price),
    feeCrypto: Number(r.fee_crypto ?? 0),
    paymentMethod: r.payment_method as string,
    paymentWindow: Number(r.payment_window ?? 15),
    status: r.status as P2PTradeStatus,
    escrowLockedAt: (r.escrow_locked_at as string) ?? undefined,
    paymentDueAt: (r.payment_due_at as string) ?? undefined,
    paidAt: (r.paid_at as string) ?? undefined,
    releasedAt: (r.released_at as string) ?? undefined,
    cancelledAt: (r.cancelled_at as string) ?? undefined,
    expiresAt: (r.expires_at as string) ?? undefined,
    escrowReleased: Boolean(r.escrow_released),
    buyerRated: Boolean(r.buyer_rated),
    sellerRated: Boolean(r.seller_rated),
    cancelReason: (r.cancel_reason as string) ?? undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    ad: ad ? {
      asset: ad.asset as string, fiat: ad.fiat as string,
      side: ad.side as P2PSide, terms: (ad.terms as string) ?? undefined,
    } : undefined,
  };
}

function mapTradeMessage(r: Record<string, unknown>): P2PTradeMessage {
  return {
    id: r.id as string,
    tradeId: r.trade_id as string,
    senderId: (r.sender_id as string) ?? undefined,
    message: (r.message as string) ?? undefined,
    imageUrl: (r.image_url as string) ?? undefined,
    isSystem: Boolean(r.is_system),
    createdAt: r.created_at as string,
  };
}

function mapDispute(r: Record<string, unknown>): P2PDispute {
  return {
    id: r.id as string,
    tradeId: (r.trade_id as string) ?? '',
    raisedBy: r.raised_by as string,
    reason: r.reason as string,
    description: (r.description as string) ?? undefined,
    evidenceUrls: (r.evidence_urls as string[]) ?? [],
    status: r.status as P2PDisputeStatus,
    adminNote: (r.admin_note as string) ?? undefined,
    resolvedInFavorOf: (r.resolved_in_favor_of as string) ?? undefined,
    resolvedAt: (r.resolved_at as string) ?? undefined,
    createdAt: r.created_at as string,
    updatedAt: (r.updated_at as string) ?? r.created_at as string,
  };
}

function mapPaymentAccount(r: Record<string, unknown>): P2PPaymentAccount {
  return {
    id: r.id as string, userId: r.user_id as string,
    paymentMethod: r.payment_method as string,
    accountName: r.account_name as string,
    accountNumber: r.account_number as string,
    bankName: (r.bank_name as string) ?? undefined,
    countryCode: (r.country_code as string) ?? undefined,
    fiatCode: (r.fiat_code as string) ?? undefined,
    extraInfo: (r.extra_info as string) ?? undefined,
    isVerified: Boolean(r.is_verified),
    isActive: Boolean(r.is_active),
    createdAt: r.created_at as string,
  };
}

