// Admin Service — user management, KYC review, withdrawal approval, dispute resolution
import { supabase } from '@/client/supabase';

/** Fetch paginated user list */
export async function getAdminUsers(params?: { search?: string; limit?: number; offset?: number }) {
  let query = supabase
    .from('profiles')
    .select('id, email, username, uid, kyc_tier, kyc_status, is_frozen, role, two_fa_enabled, created_at')
    .order('created_at', { ascending: false })
    .limit(params?.limit ?? 50);

  if (params?.search) {
    query = query.or(`email.ilike.%${params.search}%,username.ilike.%${params.search}%,uid.ilike.%${params.search}%`);
  }
  if (params?.offset) query = query.range(params.offset, params.offset + (params?.limit ?? 50) - 1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Fetch pending KYC submissions */
export async function getPendingKyc(limit = 50) {
  const { data, error } = await supabase
    .from('kyc_submissions')
    .select('*, profiles!user_id(email, username, uid)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Approve KYC */
export async function approveKyc(submissionId: string, userId: string, tier: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase.from('kyc_submissions').update({
    status: 'approved',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', submissionId);

  await supabase.from('profiles').update({
    kyc_tier: tier,
    kyc_status: 'approved',
  }).eq('id', userId);

  await logAdminAction({
    actionType: 'kyc_approve',
    targetUserId: userId,
    entityType: 'kyc',
    entityId: submissionId,
    description: `KYC ${tier} approved for user ${userId}`,
  });
}

/** Reject KYC */
export async function rejectKyc(submissionId: string, userId: string, reason: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase.from('kyc_submissions').update({
    status: 'rejected',
    rejection_reason: reason,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', submissionId);

  await supabase.from('profiles').update({ kyc_status: 'rejected' }).eq('id', userId);

  await logAdminAction({
    actionType: 'kyc_reject',
    targetUserId: userId,
    entityType: 'kyc',
    entityId: submissionId,
    description: `KYC rejected: ${reason}`,
  });
}

/** Fetch pending withdrawals for admin review */
export async function getPendingWithdrawals(limit = 100) {
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*, profiles!user_id(email, username, uid)')
    .in('status', ['pending', 'under_review'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Approve a withdrawal */
export async function approveWithdrawal(withdrawalId: string, targetUserId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase.from('withdrawals').update({
    status: 'approved',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', withdrawalId);

  await logAdminAction({
    actionType: 'withdrawal_approve',
    targetUserId,
    entityType: 'withdrawal',
    entityId: withdrawalId,
    description: `Withdrawal ${withdrawalId} approved`,
  });
}

/** Reject a withdrawal */
export async function rejectWithdrawal(withdrawalId: string, targetUserId: string, reason: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase.from('withdrawals').update({
    status: 'rejected',
    rejection_reason: reason,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', withdrawalId);

  await logAdminAction({
    actionType: 'withdrawal_reject',
    targetUserId,
    entityType: 'withdrawal',
    entityId: withdrawalId,
    description: `Withdrawal rejected: ${reason}`,
  });
}

/** Freeze / unfreeze a user account */
export async function setAccountFrozen(userId: string, frozen: boolean) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase.from('profiles').update({ is_frozen: frozen }).eq('id', userId);
  await logAdminAction({
    actionType: frozen ? 'account_freeze' : 'account_unfreeze',
    targetUserId: userId,
    entityType: 'user',
    entityId: userId,
    description: `Account ${frozen ? 'frozen' : 'unfrozen'}`,
  });
}

/** Suspend / reactivate a user account */
export async function setAccountSuspended(userId: string, suspended: boolean) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase.from('profiles').update({ is_suspended: suspended }).eq('id', userId);
  await logAdminAction({
    actionType: suspended ? 'account_suspend' : 'account_reactivate',
    targetUserId: userId,
    entityType: 'user',
    entityId: userId,
    description: `Account ${suspended ? 'suspended' : 'reactivated'}`,
  });
}

/** Force-logout a user by revoking all their active sessions */
export async function forceLogoutUser(userId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Mark all non-revoked sessions as revoked
  await supabase
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);

  await logAdminAction({
    actionType: 'force_logout',
    targetUserId: userId,
    entityType: 'user',
    entityId: userId,
    description: `All sessions revoked by admin`,
  });
}

/** Reset 2FA: unenroll all TOTP factors and clear profile flags */
export async function adminReset2FA(userId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Clear 2FA flags and TOTP factor ID in profiles
  await supabase
    .from('profiles')
    .update({ two_fa_enabled: false, totp_factor_id: null })
    .eq('id', userId);

  // Revoke backup codes
  await supabase.from('backup_codes').delete().eq('user_id', userId);

  await logAdminAction({
    actionType: 'admin_reset_2fa',
    targetUserId: userId,
    entityType: 'user',
    entityId: userId,
    description: `2FA reset by admin`,
  });
}

/** Get security methods summary for a user (admin view — never reveals secrets) */
export async function adminGetUserSecuritySummary(userId: string): Promise<{
  totp_enabled: boolean;
  passkey_count: number;
  backup_codes_remaining: number;
  email_otp_enabled: boolean;
  last_security_event: string | null;
}> {
  const [profile, passkeys, backupCodes, lastEvent] = await Promise.all([
    supabase.from('profiles').select('two_fa_enabled').eq('id', userId).maybeSingle(),
    supabase.from('passkeys').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('backup_codes').select('*', { count: 'exact', head: true }).eq('user_id', userId).is('used_at', null),
    supabase.from('security_logs').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    totp_enabled:           profile.data?.two_fa_enabled ?? false,
    passkey_count:          passkeys.count ?? 0,
    backup_codes_remaining: backupCodes.count ?? 0,
    email_otp_enabled:      true,
    last_security_event:    lastEvent.data?.created_at ?? null,
  };
}

/** Get passkeys registered for a user (admin view) */
export async function adminGetUserPasskeys(userId: string): Promise<Array<{
  id: string; device_label: string; platform_type: string; created_at: string; last_used_at: string | null;
}>> {
  const { data, error } = await supabase
    .from('passkeys')
    .select('id, device_label, platform_type, created_at, last_used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; device_label: string; platform_type: string; created_at: string; last_used_at: string | null }>;
}

/** Revoke a passkey (admin) */
export async function adminRevokePasskey(passkeyId: string, userId: string) {
  const { error } = await supabase.from('passkeys').delete().eq('id', passkeyId).eq('user_id', userId);
  if (error) throw new Error(error.message);
  await logAdminAction({ actionType: 'admin_revoke_passkey', targetUserId: userId, entityType: 'passkey', entityId: passkeyId, description: 'Passkey revoked by admin' });
}

/** Get recent security events for a user (admin view) */
export async function adminGetSecurityEvents(userId: string, limit = 30): Promise<Array<{
  id: string; event_type: string; ip_address: string | null; metadata: Record<string, unknown>; created_at: string;
}>> {
  const { data, error } = await supabase
    .from('security_logs')
    .select('id, event_type, ip_address, metadata, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; event_type: string; ip_address: string | null; metadata: Record<string, unknown>; created_at: string }>;
}

/** Get open disputes */
export async function getOpenDisputes(limit = 50) {
  // p2p_disputes can reference either trade_id (p2p_trades) or order_id (p2p_orders)
  // Select both FKs and join to whichever exists
  const { data, error } = await supabase
    .from('p2p_disputes')
    .select('*, p2p_trades!trade_id(id, status, asset, amount, buyer_id, seller_id)')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    // Fallback: select without join if relationship not found
    const { data: fallback, error: fbErr } = await supabase
      .from('p2p_disputes')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (fbErr) throw new Error(fbErr.message);
    return fallback ?? [];
  }
  return data ?? [];
}

/** Resolve a dispute */
export async function resolveDispute(
  disputeId: string,
  tradeOrOrderId: string,
  resolution: 'resolved_buyer' | 'resolved_seller',
  note: string,
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase.from('p2p_disputes').update({
    status: resolution,
    resolution_note: note,
    resolved_by: user.id,
    resolved_at: new Date().toISOString(),
  }).eq('id', disputeId);

  // Try p2p_trades first, fallback to p2p_orders
  const tradeStatus = resolution === 'resolved_buyer' ? 'released' : 'cancelled';
  const { error: tradeErr } = await supabase
    .from('p2p_trades').update({ status: tradeStatus }).eq('id', tradeOrOrderId);
  if (tradeErr) {
    await supabase.from('p2p_orders').update({ status: tradeStatus }).eq('id', tradeOrOrderId);
  }

  await logAdminAction({
    actionType: 'dispute_resolve',
    entityType: 'p2p_dispute',
    entityId: disputeId,
    description: `Dispute resolved: ${resolution} — ${note}`,
  });
}

/** Get risk flags */
export async function getRiskFlags(resolved = false, limit = 100) {
  const { data, error } = await supabase
    .from('risk_flags')
    .select('*, profiles!user_id(email, username, uid)')
    .eq('resolved', resolved)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Get admin action log */
export async function getAdminActionLog(limit = 100) {
  const { data, error } = await supabase
    .from('admin_actions')
    .select('*, profiles!admin_id(email, username, uid)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Platform statistics for admin overview — uses SECURITY DEFINER RPC to bypass RLS */
export async function getPlatformStats(): Promise<{
  totalUsers: number;
  profileCount: number;
  pendingKyc: number;
  pendingWithdrawals: number;
  openDisputes: number;
  kycAttempts: number;
  kycVerified: number;
  kycFailed: number;
  profilesMissingAuth: number;
}> {
  const { data, error } = await supabase.rpc('get_admin_stats');
  if (error) throw new Error(`Admin stats RPC failed: ${error.message}`);
  if (!data) throw new Error('Admin stats RPC returned no data');
  const s = data as Record<string, number>;
  return {
    totalUsers:          s.totalUsers          ?? 0,
    profileCount:        s.profileCount        ?? 0,
    pendingKyc:          s.pendingKyc          ?? 0,
    pendingWithdrawals:  s.pendingWithdrawals  ?? 0,
    openDisputes:        s.openDisputes        ?? 0,
    kycAttempts:         s.kycAttempts         ?? 0,
    kycVerified:         s.kycVerified         ?? 0,
    kycFailed:           s.kycFailed           ?? 0,
    profilesMissingAuth: s.profilesMissingAuth ?? 0,
  };
}

/** Admin verification report — structured diagnostic for admin console */
export async function getAdminVerificationReport(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('get_admin_verification_report');
  if (error) throw new Error(`Verification report failed: ${error.message}`);
  return (data as Record<string, unknown>) ?? {};
}

/** Internal: log admin action */
async function logAdminAction(params: {
  actionType: string;
  targetUserId?: string;
  entityType?: string;
  entityId?: string;
  description: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  // admin_actions schema: id, admin_id, action_type, target_id, target_type, details, ip_address, created_at
  await supabase.from('admin_actions').insert({
    admin_id: user.id,
    action_type: params.actionType,
    target_id: params.targetUserId ?? null,
    target_type: params.entityType ?? null,
    details: {
      entity_id: params.entityId,
      description: params.description,
      before_state: params.beforeState,
      after_state: params.afterState,
    },
  });
}
