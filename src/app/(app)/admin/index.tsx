// Admin Dashboard — executive control center
// Business logic fully preserved: AdminService (KYC, withdrawals, disputes, risk flags, users)
// + P2P management tabs (Trades, P2P Disputes, Merchants, Ads)
// + Full KYC review panel with multi-provider support (Sumsub / Dojah)

import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, RefreshControl, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/client/supabase';
import {
  ArrowLeft, AlertTriangle, ArrowUpRight, Zap, AlertCircle, Users,
  ShieldCheck, DollarSign, Search, CheckCircle, XCircle, Scale, Flag,
  ArrowLeftRight, UserCheck, LayoutList, Wallet, Lock, Shield, FileText,
  WifiOff,
  Key, Globe, Plus, Trash2, RefreshCw,
} from 'lucide-react-native';
import { AdminService, WalletService, ProviderAdapter, TradingService } from '@/services';
import {
  adminGetUserSecuritySummary, adminGetUserPasskeys,
  adminGetSecurityEvents, adminRevokePasskey,
} from '@/services/admin.service';
import type { WalletBalance, EscrowRecord, WalletAuditLog, WalletFreeze } from '@/services/wallet.service';
import type { ProviderConfig, ConnectionTestResult, ManualSyncResult, ReconciliationWarning } from '@/services/provider-adapter.service';
import {
  adminGetAllTrades, adminGetAllDisputes, adminGetAllAds,
  adminResolveDispute, adminReleaseTrade, adminRefundTrade, adminSuspendMerchant,
  type P2PTrade, type P2PDispute, type P2PAd,
} from '@/services/p2p.service';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonCard } from '@/components/shared/LoadingState';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import type { RelativePathString } from 'expo-router';
import ReconciliationDashboard from './reconciliation';
import UnmatchedDeposits from './unmatched-deposits';
import {
  adminListAttempts, adminGetAttemptDetail, adminGetProviderEvents,
  adminGetAttemptCounts, adminSyncAttempt,
  adminListSubmissions, adminGetSubmission, adminGetAuditLog,
  adminKycAction, KYC_STATUS_LABEL, KYC_STATUS_ADMIN_LABEL, kycStatusColor,
  KYC_ACTIONABLE_STATUSES, KYC_TERMINAL_STATUSES,
  type KycAttemptAdmin, type KycSubmission, type KycAuditEntry,
} from '@/services/kyc.service';

type AdminTab = 'Overview' | 'Users' | 'Security' | 'KYC' | 'Disputes' | 'Withdrawals' | 'Risk' | 'P2P Trades' | 'P2P Disputes' | 'Merchants' | 'P2P Ads' | 'Wallet Balances' | 'Wallet Freezes' | 'Escrow' | 'Audit Logs' | 'Spot Orders' | 'Futures Orders' | 'Positions' | 'Liquidations' | 'Funding History' | 'Trading Pairs' | 'Trade Settings' | 'Provider APIs' | 'Match Log' | 'Binance Sync' | 'Reconciliation' | 'Unmatched Deposits';
const ADMIN_TABS: AdminTab[] = ['Overview', 'Users', 'Security', 'KYC', 'Disputes', 'Withdrawals', 'Risk', 'P2P Trades', 'P2P Disputes', 'Merchants', 'P2P Ads', 'Wallet Balances', 'Wallet Freezes', 'Escrow', 'Audit Logs', 'Spot Orders', 'Futures Orders', 'Positions', 'Liquidations', 'Funding History', 'Trading Pairs', 'Trade Settings', 'Provider APIs', 'Match Log', 'Binance Sync', 'Reconciliation', 'Unmatched Deposits'];
const SEV_COLOR: Record<string, string> = { high: DS.color.sell, medium: DS.color.warn, low: DS.color.text3 };
const SEV_BG: Record<string, string>    = { high: DS.color.sellBg, medium: DS.color.warnBg, low: DS.color.surface };

function StatCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <View style={{ width: '47%', backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
      <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: color + '20', alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.xs }}>
        {icon}
      </View>
      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 3 }}>{label}</Text>
      <Text style={{ color, fontSize: DS.font.xl, fontWeight: DS.font.extrabold }}>{value}</Text>
    </View>
  );
}

function ActionRow({ label, count, color, onPress }: { label: string; count: number; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, borderLeftColor: color, borderWidth: 1, borderTopColor: DS.color.border, borderRightColor: DS.color.border, borderBottomColor: DS.color.border }}>
      <Text style={{ color: DS.color.text1, flex: 1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{label}</Text>
      <View style={{ backgroundColor: color + '30', borderRadius: DS.radius.full, minWidth: 26, height: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
        <Text style={{ color, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>{count}</Text>
      </View>
      <ArrowUpRight size={16} color={DS.color.text3} style={{ marginLeft: DS.space.xs }} />
    </Pressable>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>('Overview');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Admin role gate: set to true only once verified server-side
  const [isAdminVerified, setIsAdminVerified] = useState<boolean | null>(null);
  const [stats, setStats] = useState({
    totalUsers: 0, pendingWithdrawals: 0, pendingKyc: 0, openDisputes: 0,
    profileCount: 0, kycAttempts: 0, kycVerified: 0, kycFailed: 0, profilesMissingAuth: 0,
  });
  const [statsError, setStatsError] = useState('');
  const [users, setUsers] = useState<Record<string, unknown>[]>([]);
  const [kycQueue, setKycQueue] = useState<Record<string, unknown>[]>([]);
  const [withdrawals, setWithdrawals] = useState<Record<string, unknown>[]>([]);
  const [disputes, setDisputes] = useState<Record<string, unknown>[]>([]);
  const [riskFlags, setRiskFlags] = useState<Record<string, unknown>[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // P2P state
  const [p2pTrades, setP2pTrades] = useState<P2PTrade[]>([]);
  const [p2pDisputes, setP2pDisputes] = useState<P2PDispute[]>([]);
  const [p2pAds, setP2pAds] = useState<P2PAd[]>([]);

  // Wallet admin state
  const [adminWalletBalances, setAdminWalletBalances] = useState<WalletBalance[]>([]);
  const [adminEscrows, setAdminEscrows] = useState<EscrowRecord[]>([]);
  const [adminAuditLogs, setAdminAuditLogs] = useState<WalletAuditLog[]>([]);
  const [adminFreezes, setAdminFreezes] = useState<WalletFreeze[]>([]);

  // Trading admin state
  const [adminSpotOrders, setAdminSpotOrders] = useState<Record<string,unknown>[]>([]);
  const [adminFutOrders, setAdminFutOrders]   = useState<Record<string,unknown>[]>([]);
  const [adminPositions, setAdminPositions]   = useState<Record<string,unknown>[]>([]);
  const [adminLiquidations, setAdminLiquidations] = useState<Record<string,unknown>[]>([]);
  const [adminFundingHist, setAdminFundingHist]   = useState<Record<string,unknown>[]>([]);
  const [adminTradingPairs, setAdminTradingPairs] = useState<Record<string,unknown>[]>([]);
  const [adminTradingSettings, setAdminTradingSettings] = useState<Record<string,unknown>[]>([]);
  // Futures admin actions
  const [forceClosing, setForceClosing] = useState<string | null>(null);
  const [futSyncing, setFutSyncing]     = useState(false);
  const [futSyncResult, setFutSyncResult] = useState<string | null>(null);
  // Spot order management
  const [spotSyncing, setSpotSyncing] = useState(false);
  const [spotSyncResult, setSpotSyncResult] = useState<{ checked: number; fills_settled: number; errors: string[] } | null>(null);
  const [adminCancellingOrder, setAdminCancellingOrder] = useState<string | null>(null);
  const [spotGlobalPaused, setSpotGlobalPaused] = useState(false);
  const [pairToggling, setPairToggling] = useState<string | null>(null);

  // Provider API configs (typed via ProviderAdapter)
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState('');
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [providerForm, setProviderForm] = useState({ provider_name: '', label: '', api_key: '', api_secret: '', passphrase: '', is_testnet: false, permissions: '', notes: '' });
  const [savingProvider, setSavingProvider] = useState(false);
  // Per-config test/sync state
  const [testingConfigId,  setTestingConfigId]  = useState<string | null>(null);
  const [testResults,      setTestResults]      = useState<Record<string, ConnectionTestResult | { error: string }>>({});
  const [syncingConfigId,  setSyncingConfigId]  = useState<string | null>(null);
  const [syncResults,      setSyncResults]      = useState<Record<string, ManualSyncResult | { error: string }>>({});
  const [reconWarnings,    setReconWarnings]    = useState<ReconciliationWarning[]>([]);

  // Match log + Binance sync
  const [matchLog, setMatchLog] = useState<Record<string,unknown>[]>([]);
  const [binanceSyncRunning, setBinanceSyncRunning] = useState(false);
  const [binanceSyncResult, setBinanceSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // KYC review state — unified on kyc_attempts as source of truth
  const [kycAttempts, setKycAttempts]                 = useState<KycAttemptAdmin[]>([]);
  const [kycSubmissions, setKycSubmissions]           = useState<(KycSubmission & { email?: string; username?: string })[]>([]);
  const [kycFilter, setKycFilter]                     = useState<string>('all');
  const [kycDetail, setKycDetail]                     = useState<KycAttemptAdmin | null>(null);
  const [kycProviderEvents, setKycProviderEvents]     = useState<Record<string, unknown>[]>([]);
  const [kycCounts, setKycCounts]                     = useState<Record<string, number>>({});
  const [kycAuditLog, setKycAuditLog]                 = useState<KycAuditEntry[]>([]);
  const [kycDetailLoading, setKycDetailLoading]       = useState(false);
  const [kycActionReason, setKycActionReason]         = useState('');
  const [kycActionNotes, setKycActionNotes]           = useState('');
  const [kycActioning, setKycActioning]               = useState(false);
  const [kycActionError, setKycActionError]           = useState('');
  const [kycActionSuccess, setKycActionSuccess]       = useState('');
  const [kycSyncing, setKycSyncing]                   = useState(false);

  // Security tab state
  const [secSearchUid, setSecSearchUid] = useState('');
  const [secSummary, setSecSummary] = useState<Awaited<ReturnType<typeof adminGetUserSecuritySummary>> | null>(null);
  const [secPasskeys, setSecPasskeys] = useState<Awaited<ReturnType<typeof adminGetUserPasskeys>>>([]);
  const [secEvents, setSecEvents] = useState<Awaited<ReturnType<typeof adminGetSecurityEvents>>>([]);
  const [secLoading, setSecLoading] = useState(false);
  const [secError, setSecError] = useState('');
  const [secUserId, setSecUserId] = useState('');

  const pt = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8;

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, u, k, w, d, r, pt2, pd2, pa2, wBals, wEscs, wLogs, wFreezes,
             tSpot, tFut, tPos, tLiq, tFundHist, tPairs, tSettings] = await Promise.all([
        AdminService.getPlatformStats().catch((e: Error) => {
          setStatsError(e.message);
          return { totalUsers: -1, pendingWithdrawals: -1, pendingKyc: -1, openDisputes: -1, profileCount: -1, kycAttempts: -1, kycVerified: -1, kycFailed: -1, profilesMissingAuth: -1 };
        }),
        AdminService.getAdminUsers({ search: search || undefined, limit: 50 }).catch(() => []),
        AdminService.getPendingKyc(50).catch(() => []),
        AdminService.getPendingWithdrawals(50).catch(() => []),
        AdminService.getOpenDisputes(50).catch(() => []),
        AdminService.getRiskFlags(false, 50).catch(() => []),
        adminGetAllTrades(50).catch(() => []),
        adminGetAllDisputes(50).catch(() => []),
        adminGetAllAds(50).catch(() => []),
        WalletService.getAdminWalletBalances(200).catch(() => [] as WalletBalance[]),
        WalletService.getAdminEscrows().catch(() => [] as EscrowRecord[]),
        WalletService.getAdminAuditLogs(100).catch(() => [] as WalletAuditLog[]),
        Promise.resolve(supabase.from('wallet_freezes').select('*').order('created_at', { ascending: false }).limit(50))
          .then(r => (r.data ?? []).map(x => ({
            id: x.id as string, userId: x.user_id as string,
            walletType: x.wallet_type as WalletFreeze['walletType'],
            asset: x.asset as string | undefined,
            freezeType: x.freeze_type as WalletFreeze['freezeType'],
            reason: x.reason as string, isActive: Boolean(x.is_active),
            expiresAt: x.expires_at as string | undefined, createdAt: x.created_at as string,
          } as WalletFreeze))).catch(() => [] as WalletFreeze[]),
        // Trading admin data
        (async () => { try { const r = await supabase.from('orders').select('*').eq('market_type_v2','spot').order('created_at',{ascending:false}).limit(100); return (r.data ?? []) as Record<string,unknown>[]; } catch { return [] as Record<string,unknown>[]; } })(),
        (async () => { try { const r = await supabase.from('orders').select('*').eq('market_type_v2','futures').order('created_at',{ascending:false}).limit(100); return (r.data ?? []) as Record<string,unknown>[]; } catch { return [] as Record<string,unknown>[]; } })(),
        (async () => { try { const r = await supabase.from('positions').select('*').eq('status','open').order('opened_at',{ascending:false}).limit(100); return (r.data ?? []) as Record<string,unknown>[]; } catch { return [] as Record<string,unknown>[]; } })(),
        (async () => { try { const r = await supabase.from('futures_liquidation_events').select('*').order('created_at',{ascending:false}).limit(50); return (r.data ?? []) as Record<string,unknown>[]; } catch { return [] as Record<string,unknown>[]; } })(),
        (async () => { try { const r = await supabase.from('futures_funding_history').select('*').order('created_at',{ascending:false}).limit(100); return (r.data ?? []) as Record<string,unknown>[]; } catch { return [] as Record<string,unknown>[]; } })(),
        (async () => { try { const r = await supabase.from('trading_pairs').select('*').order('sort_order',{ascending:true}); return (r.data ?? []) as Record<string,unknown>[]; } catch { return [] as Record<string,unknown>[]; } })(),
        (async () => { try { const r = await supabase.from('trading_settings').select('*').order('key',{ascending:true}); return (r.data ?? []) as Record<string,unknown>[]; } catch { return [] as Record<string,unknown>[]; } })(),
      ]);
      setStatsError('');
      setStats(s); setUsers(u); setKycQueue(k);
      setWithdrawals(w); setDisputes(d); setRiskFlags(r);
      setP2pTrades(pt2); setP2pDisputes(pd2); setP2pAds(pa2);
      setAdminWalletBalances(wBals); setAdminEscrows(wEscs);
      setAdminAuditLogs(wLogs); setAdminFreezes(wFreezes);
      setAdminSpotOrders(tSpot); setAdminFutOrders(tFut);
      setAdminPositions(tPos); setAdminLiquidations(tLiq); setAdminFundingHist(tFundHist);
      setAdminTradingPairs(tPairs); setAdminTradingSettings(tSettings);      // Derive global spot pause state from settings
      const pauseSetting = (tSettings as Record<string,unknown>[]).find(s => s.key === 'spot_trading_enabled');
      setSpotGlobalPaused(pauseSetting ? pauseSetting.value === false || pauseSetting.value === 'false' : false);
      // Load provider API configs via ProviderAdapter (excludes raw api_key/secret from response)
      const provs = await ProviderAdapter.listProviderConfigs().catch(() => [] as ProviderConfig[]);
      setProviderConfigs(provs);
      // Load reconciliation warnings
      const warnings = await ProviderAdapter.listReconWarnings(50).catch(() => [] as ReconciliationWarning[]);
      setReconWarnings(warnings);
      // Load match log (latest 100 entries)
      const mlResult = await supabase.from('order_match_log').select('*').order('created_at', { ascending: false }).limit(100);
      setMatchLog((mlResult.data ?? []) as Record<string,unknown>[]);
    } catch (e) { setError(toUserMessage(e, 'Failed to load admin data')); }
    finally { setLoading(false); }
  }, [search]);

  useFocusEffect(useCallback(() => {
    (async () => {
      // Verify admin role server-side before loading any data
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/(auth)/sign-in' as RelativePathString); return; }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', user.id).single();
      if (!profile || profile.role !== 'admin') {
        setIsAdminVerified(false);
        return;
      }
      setIsAdminVerified(true);
      await loadData();
    })();
  }, [loadData, router]));

  // ── KYC unified helpers (source of truth: kyc_attempts) ────────────────────
  const loadKycAttempts = useCallback(async (statusFilter: string) => {
    setLoading(true);
    try {
      const [{ attempts, count }, counts] = await Promise.all([
        adminListAttempts({ status: statusFilter, limit: 100 }),
        adminGetAttemptCounts(),
      ]);
      setKycAttempts(attempts);
      setKycCounts({ ...counts, total: count });
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load KYC attempts'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Legacy alias kept so any other callers compile
  const loadKycSubmissions = useCallback((statusFilter: string) => loadKycAttempts(statusFilter), [loadKycAttempts]);

  const openKycDetail = async (attemptId: string) => {
    setKycDetailLoading(true); setKycActionError(''); setKycActionSuccess('');
    setKycActionReason(''); setKycActionNotes('');
    try {
      const [detail, audit, events] = await Promise.all([
        adminGetAttemptDetail(attemptId),
        adminGetAuditLog(attemptId),
        adminGetProviderEvents(attemptId),
      ]);
      setKycDetail(detail);
      setKycAuditLog(audit);
      setKycProviderEvents(events);
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load KYC detail'));
    } finally {
      setKycDetailLoading(false);
    }
  };

  const handleKycSyncStatus = async () => {
    if (!kycDetail) return;
    setKycSyncing(true); setKycActionError(''); setKycActionSuccess('');
    try {
      const newStatus = await adminSyncAttempt(kycDetail.id);
      setKycActionSuccess(`Status synced: ${newStatus ?? 'unchanged'}`);
      const [detail, audit] = await Promise.all([
        adminGetAttemptDetail(kycDetail.id),
        adminGetAuditLog(kycDetail.id),
      ]);
      setKycDetail(detail);
      setKycAuditLog(audit);
      await loadKycAttempts(kycFilter);
    } catch (e) {
      setKycActionError(toUserMessage(e, 'Sync failed'));
    } finally {
      setKycSyncing(false);
    }
  };

  const handleKycAdminAction = async (action: 'approve' | 'reject' | 'escalate' | 'request_info' | 'add_note') => {
    if (!kycDetail) return;
    setKycActioning(true); setKycActionError(''); setKycActionSuccess('');
    try {
      await adminKycAction({
        action,
        attemptId: kycDetail.id,
        reason: kycActionReason || undefined,
        notes:  kycActionNotes  || undefined,
        tier:   action === 'approve' ? 'tier2' : undefined,
      });
      setKycActionSuccess(`Action "${action.replace(/_/g, ' ')}" applied successfully.`);
      setKycActionReason(''); setKycActionNotes('');
      const [updated, audit] = await Promise.all([
        adminGetAttemptDetail(kycDetail.id),
        adminGetAuditLog(kycDetail.id),
      ]);
      setKycDetail(updated);
      setKycAuditLog(audit);
      await loadKycAttempts(kycFilter);
    } catch (e) {
      setKycActionError(toUserMessage(e, 'Action failed'));
    } finally {
      setKycActioning(false);
    }
  };
  const handleWithdrawalApprove = async (wId: string, userId: string) => {
    setActionLoading(wId);
    try { await AdminService.approveWithdrawal(wId, userId); await loadData(); }
    catch (e) { setError(toUserMessage(e, 'Action failed')); }
    finally { setActionLoading(null); }
  };
  const handleWithdrawalReject = async (wId: string, userId: string) => {
    setActionLoading(wId);
    try { await AdminService.rejectWithdrawal(wId, userId, 'Failed risk review'); await loadData(); }
    catch (e) { setError(toUserMessage(e, 'Action failed')); }
    finally { setActionLoading(null); }
  };
  const handleFreezeUser = async (userId: string, frozen: boolean) => {
    setActionLoading(userId);
    try { await AdminService.setAccountFrozen(userId, frozen); await loadData(); }
    catch (e) { setError(toUserMessage(e, 'Action failed')); }
    finally { setActionLoading(null); }
  };
  const handleResolveDispute = async (disputeId: string, orderId: string, winner: 'buyer' | 'seller') => {
    setActionLoading(disputeId);
    try { await AdminService.resolveDispute(disputeId, orderId, winner === 'buyer' ? 'resolved_buyer' : 'resolved_seller', `Admin resolved in favor of ${winner}`); await loadData(); }
    catch (e) { setError(toUserMessage(e, 'Action failed')); }
    finally { setActionLoading(null); }
  };
  const handleP2PRelease = async (tradeId: string) => {
    setActionLoading(tradeId);
    try { await adminReleaseTrade(tradeId); await loadData(); }
    catch (e) { setError(toUserMessage(e, 'Release failed')); }
    finally { setActionLoading(null); }
  };
  const handleP2PResolveDispute = async (disputeId: string, status: 'resolved' | 'rejected', note: string) => {
    setActionLoading(disputeId);
    try { await adminResolveDispute(disputeId, status, note); await loadData(); }
    catch (e) { setError(toUserMessage(e, 'Action failed')); }
    finally { setActionLoading(null); }
  };
  const handleSuspendMerchant = async (merchantId: string, suspend: boolean) => {
    setActionLoading(merchantId);
    try { await adminSuspendMerchant(merchantId, suspend); await loadData(); }
    catch (e) { setError(toUserMessage(e, 'Action failed')); }
    finally { setActionLoading(null); }
  };

  // Admin role gate: block non-admins before rendering any data
  if (isAdminVerified === null) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={DS.color.buy} />
        <Text style={{ color: DS.color.text3, marginTop: DS.space.sm, fontSize: DS.font.sm }}>Verifying access…</Text>
      </View>
    );
  }
  if (isAdminVerified === false) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center', padding: DS.space.xl }}>
        <Shield size={48} color={DS.color.sell} />
        <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.lg, marginTop: DS.space.md }}>Access Denied</Text>
        <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, textAlign: 'center', marginTop: DS.space.xs }}>Administrator privileges required.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: DS.space.lg, backgroundColor: DS.color.card, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.lg, paddingVertical: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.extrabold, fontSize: DS.font.lg, flex: 1 }}>Admin Console</Text>
        <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
          <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.extrabold, letterSpacing: 1 }}>ADMIN</Text>
        </View>
      </View>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: 1, borderBottomColor: DS.color.border, flexGrow: 0 }}>
        <View style={{ flexDirection: 'row', paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, gap: DS.space.xs }}>
          {ADMIN_TABS.map(t => (
            <Pressable key={t} onPress={() => {
              setActiveTab(t);
              if (t === 'KYC') { setKycDetail(null); loadKycAttempts(kycFilter); }
            }}
              style={{ paddingHorizontal: DS.space.md, paddingVertical: 7, borderRadius: DS.radius.full, backgroundColor: activeTab === t ? DS.color.gold : 'transparent', borderWidth: 1, borderColor: activeTab === t ? DS.color.gold : DS.color.border }}>
              <Text style={{ color: activeTab === t ? DS.color.bg : DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} tintColor={DS.color.gold} />}
        contentContainerStyle={{ padding: DS.space.md, paddingBottom: DS.space.xxxl }}
      >
        {error ? (
          <View style={{ flexDirection: 'row', gap: DS.space.xs, backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, padding: DS.space.sm, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
            <AlertCircle size={15} color={DS.color.sell} />
            <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
          </View>
        ) : null}

        {/* Stats error banner */}
        {statsError ? (
          <View style={{ flexDirection: 'row', gap: DS.space.xs, backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, padding: DS.space.sm, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
            <AlertCircle size={15} color={DS.color.sell} />
            <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>Stats error: {statsError}</Text>
          </View>
        ) : null}

        {/* ── Overview ── */}
        {activeTab === 'Overview' && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: DS.space.sm, marginBottom: DS.space.md }}>
              <StatCard label="Total Users" value={stats.totalUsers < 0 ? 'ERR' : stats.totalUsers.toLocaleString()} color={stats.totalUsers < 0 ? DS.color.sell : DS.color.info} icon={<Users size={16} color={stats.totalUsers < 0 ? DS.color.sell : DS.color.info} />} />
              <StatCard label="Pending Withdrawals" value={stats.pendingWithdrawals < 0 ? 'ERR' : stats.pendingWithdrawals.toLocaleString()} color={stats.pendingWithdrawals < 0 ? DS.color.sell : DS.color.warn} icon={<DollarSign size={16} color={stats.pendingWithdrawals < 0 ? DS.color.sell : DS.color.warn} />} />
              <StatCard label="Pending KYC" value={stats.pendingKyc < 0 ? 'ERR' : stats.pendingKyc.toLocaleString()} color={stats.pendingKyc < 0 ? DS.color.sell : DS.color.gold} icon={<ShieldCheck size={16} color={stats.pendingKyc < 0 ? DS.color.sell : DS.color.gold} />} />
              <StatCard label="Open Disputes" value={stats.openDisputes < 0 ? 'ERR' : stats.openDisputes.toLocaleString()} color={stats.openDisputes < 0 ? DS.color.sell : DS.color.sell} icon={<Scale size={16} color={DS.color.sell} />} />
            </View>

            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.4, marginBottom: DS.space.xs }}>QUICK ACTIONS</Text>
            <ActionRow label="Manage KYC Submissions" count={Math.max(0, stats.pendingKyc)} color={DS.color.warn} onPress={() => setActiveTab('KYC')} />
            <ActionRow label="Active Disputes" count={Math.max(0, stats.openDisputes)} color={DS.color.sell} onPress={() => setActiveTab('Disputes')} />
            <ActionRow label="Pending Withdrawals" count={Math.max(0, stats.pendingWithdrawals)} color={DS.color.info} onPress={() => setActiveTab('Withdrawals')} />
            <ActionRow label="Risk Flags" count={riskFlags.length} color={DS.color.sell} onPress={() => setActiveTab('Risk')} />

            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.4, marginBottom: DS.space.xs, marginTop: DS.space.md }}>P2P MANAGEMENT</Text>
            <ActionRow label="P2P Trades" count={p2pTrades.length} color={DS.color.gold} onPress={() => setActiveTab('P2P Trades')} />
            <ActionRow label="P2P Disputes" count={p2pDisputes.filter(d => d.status === 'open' || d.status === 'under_review').length} color={DS.color.sell} onPress={() => setActiveTab('P2P Disputes')} />
            <ActionRow label="Merchants" count={Array.from(new Set(p2pAds.map(a => a.merchantId))).length} color={DS.color.info} onPress={() => setActiveTab('Merchants')} />
            <ActionRow label="P2P Ads" count={p2pAds.length} color={DS.color.buy} onPress={() => setActiveTab('P2P Ads')} />

            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.4, marginBottom: DS.space.xs, marginTop: DS.space.md }}>WALLET MANAGEMENT</Text>
            <ActionRow label="Wallet Balances" count={adminWalletBalances.length} color={DS.color.gold} onPress={() => setActiveTab('Wallet Balances')} />
            <ActionRow label="Active Freezes" count={adminFreezes.filter(f => f.isActive).length} color={DS.color.sell} onPress={() => setActiveTab('Wallet Freezes')} />
            <ActionRow label="Escrow Records" count={adminEscrows.filter(e => e.status === 'locked' || e.status === 'disputed').length} color={DS.color.warn} onPress={() => setActiveTab('Escrow')} />
            <ActionRow label="Audit Logs" count={adminAuditLogs.length} color={DS.color.info} onPress={() => setActiveTab('Audit Logs')} />

            <Pressable onPress={() => router.push('/(app)/admin/diagnostics' as RelativePathString)}
              style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginTop: DS.space.sm, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, borderLeftColor: DS.color.gold, borderWidth: 1, borderTopColor: DS.color.border, borderRightColor: DS.color.border, borderBottomColor: DS.color.border, gap: DS.space.sm }}>
              <Zap size={16} color={DS.color.gold} />
              <Text style={{ color: DS.color.text1, flex: 1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Provider Engine</Text>
              <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.gold + '50' }}>
                <Text style={{ color: DS.color.gold, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>DIAGNOSTICS</Text>
              </View>
              <ArrowUpRight size={16} color={DS.color.text3} />
            </Pressable>

            {/* ── Binance API Diagnostics — deep-link to Binance API tab ── */}
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.4, marginBottom: DS.space.xs, marginTop: DS.space.md }}>BINANCE INTEGRATION</Text>
            <Pressable
              onPress={() => router.push(('/(app)/admin/diagnostics?tab=Binance API') as RelativePathString)}
              style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1.5, borderColor: DS.color.sell + '66', gap: DS.space.sm }}>
              {/* Top row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: DS.color.sell + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <WifiOff size={18} color={DS.color.sell} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Binance API Diagnostics</Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>Detect outbound IP · Test wallet endpoints · Fix IP restrictions</Text>
                </View>
                <ArrowUpRight size={16} color={DS.color.text3} />
              </View>
              {/* Action hint */}
              <View style={{ backgroundColor: DS.color.sell + '12', borderRadius: DS.radius.lg, paddingHorizontal: DS.space.md, paddingVertical: DS.space.xs, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Shield size={12} color={DS.color.sell} />
                <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.semibold, flex: 1 }}>
                  {'Tap → open Diagnostics → press "Run Checks" to see the outbound IP'}
                </Text>
              </View>
            </Pressable>
          </>
        )}

        {/* ── Users ── */}
        {activeTab === 'Users' && (
          <>
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.sm, borderWidth: 1.5, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.sm, marginBottom: DS.space.md }}>
              <Search size={15} color={DS.color.text2} />
              <TextInput
                style={{ flex: 1, color: DS.color.text1, fontSize: DS.font.sm, paddingVertical: 11, paddingLeft: 7 }}
                placeholder="Search by email, username, or UID..." placeholderTextColor={DS.color.text3}
                value={search} onChangeText={setSearch} onSubmitEditing={loadData} returnKeyType="search"
              />
              {search.length > 0 && (
                <Pressable onPress={() => { setSearch(''); loadData(); }} style={{ padding: 4 }}>
                  <XCircle size={15} color={DS.color.text3} />
                </Pressable>
              )}
            </View>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: DS.space.sm }}>
              {users.length} user{users.length !== 1 ? 's' : ''} found
            </Text>
            {loading && users.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && users.length === 0 ? <EmptyState icon="👤" title="No users found" subtitle="Try a different search term" /> : null}
            {users.map(u => {
              const uid        = u.id as string;
              const isFrozen   = u.is_frozen as boolean;
              const isSuspended = u.is_suspended as boolean;
              const has2FA     = u.two_fa_enabled as boolean;
              const busy       = actionLoading === uid;

              // Determine status badge
              const statusLabel = isSuspended ? 'suspended' : isFrozen ? 'frozen' : 'active';

              return (
                <View key={uid} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
                  {/* Header row */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
                    <View style={{ flex: 1, marginRight: DS.space.sm }}>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }} numberOfLines={1}>
                        {(u.username as string) || (u.email as string)}
                      </Text>
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }} numberOfLines={1}>{u.email as string}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>UID: {u.uid as string}</Text>
                    </View>
                    <StatusBadge status={statusLabel} size="xs" />
                  </View>

                  {/* Meta row */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: DS.space.sm, marginBottom: DS.space.sm }}>
                    <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.border }}>
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>KYC: <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{(u.kyc_tier as string) ?? '—'}</Text></Text>
                    </View>
                    <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.border }}>
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Role: <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{(u.role as string) ?? 'user'}</Text></Text>
                    </View>
                    <View style={{ backgroundColor: has2FA ? DS.color.buyBg : DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: has2FA ? DS.color.buy + '40' : DS.color.border }}>
                      <Text style={{ color: has2FA ? DS.color.buy : DS.color.text3, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                        2FA: {has2FA ? 'ON' : 'OFF'}
                      </Text>
                    </View>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, alignSelf: 'center' }}>
                      Joined {new Date(u.created_at as string).toLocaleDateString()}
                    </Text>
                  </View>

                  {/* Action row 1: Freeze / Suspend */}
                  <View style={{ flexDirection: 'row', gap: DS.space.xs, marginBottom: DS.space.xs }}>
                    <Pressable
                      onPress={() => handleFreezeUser(uid, !isFrozen)}
                      disabled={busy}
                      style={{ flex: 1, backgroundColor: isFrozen ? DS.color.buyBg : DS.color.warnBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: (isFrozen ? DS.color.buy : DS.color.warn) + '40' }}
                    >
                      {busy ? <ActivityIndicator size="small" color={isFrozen ? DS.color.buy : DS.color.warn} /> :
                        <Text style={{ color: isFrozen ? DS.color.buy : DS.color.warn, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{isFrozen ? 'Unfreeze' : 'Freeze'}</Text>}
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        setActionLoading(uid);
                        try { await AdminService.setAccountSuspended(uid, !isSuspended); await loadData(); }
                        catch (e) { setError(toUserMessage(e, 'Action failed')); }
                        finally { setActionLoading(null); }
                      }}
                      disabled={busy}
                      style={{ flex: 1, backgroundColor: isSuspended ? DS.color.buyBg : DS.color.sellBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: (isSuspended ? DS.color.buy : DS.color.sell) + '40' }}
                    >
                      {busy ? <ActivityIndicator size="small" color={isSuspended ? DS.color.buy : DS.color.sell} /> :
                        <Text style={{ color: isSuspended ? DS.color.buy : DS.color.sell, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{isSuspended ? 'Reactivate' : 'Suspend'}</Text>}
                    </Pressable>
                  </View>

                  {/* Action row 2: Force Logout / Reset 2FA */}
                  <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                    <Pressable
                      onPress={async () => {
                        setActionLoading(uid + '_logout');
                        try { await AdminService.forceLogoutUser(uid); await loadData(); }
                        catch (e) { setError(toUserMessage(e, 'Force logout failed')); }
                        finally { setActionLoading(null); }
                      }}
                      disabled={actionLoading === uid + '_logout'}
                      style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}
                    >
                      {actionLoading === uid + '_logout'
                        ? <ActivityIndicator size="small" color={DS.color.text2} />
                        : <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Force Logout</Text>}
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        if (!has2FA) return;
                        setActionLoading(uid + '_2fa');
                        try { await AdminService.adminReset2FA(uid); await loadData(); }
                        catch (e) { setError(toUserMessage(e, 'Reset 2FA failed')); }
                        finally { setActionLoading(null); }
                      }}
                      disabled={!has2FA || actionLoading === uid + '_2fa'}
                      style={{ flex: 1, backgroundColor: has2FA ? DS.color.warnBg : DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: has2FA ? DS.color.warn + '40' : DS.color.border }}
                    >
                      {actionLoading === uid + '_2fa'
                        ? <ActivityIndicator size="small" color={DS.color.warn} />
                        : <Text style={{ color: has2FA ? DS.color.warn : DS.color.text3, fontSize: DS.font.xs }}>Reset 2FA</Text>}
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ── Security ── */}
        {activeTab === 'Security' && (
          <>
            {/* User lookup */}
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.sm, borderWidth: 1.5, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.sm, marginBottom: DS.space.sm }}>
              <Search size={15} color={DS.color.text2} />
              <TextInput
                style={{ flex: 1, color: DS.color.text1, fontSize: DS.font.sm, paddingVertical: 11, paddingLeft: 7 }}
                placeholder="Enter user UUID to inspect security..." placeholderTextColor={DS.color.text3}
                value={secSearchUid} onChangeText={setSecSearchUid}
                onSubmitEditing={async () => {
                  const uid = secSearchUid.trim();
                  if (!uid) return;
                  setSecLoading(true); setSecError(''); setSecSummary(null); setSecPasskeys([]); setSecEvents([]);
                  try {
                    const [sum, pks, evts] = await Promise.all([
                      adminGetUserSecuritySummary(uid),
                      adminGetUserPasskeys(uid),
                      adminGetSecurityEvents(uid, 20),
                    ]);
                    setSecUserId(uid);
                    setSecSummary(sum);
                    setSecPasskeys(pks);
                    setSecEvents(evts);
                  } catch (e) { setSecError(toUserMessage(e, 'Could not load security data.')); }
                  finally { setSecLoading(false); }
                }}
                returnKeyType="search"
                autoCapitalize="none" autoCorrect={false}
              />
            </View>
            {!!secError && <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>{secError}</Text>}
            {secLoading && <ActivityIndicator color={DS.color.gold} style={{ marginVertical: 24 }} />}

            {secSummary && (
              <>
                {/* Summary cards */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: DS.space.sm, marginBottom: DS.space.md }}>
                  {[
                    { label: 'TOTP', value: secSummary.totp_enabled ? 'Enabled' : 'Disabled', color: secSummary.totp_enabled ? DS.color.buy : DS.color.text3 },
                    { label: 'Passkeys', value: `${secSummary.passkey_count}`, color: secSummary.passkey_count > 0 ? DS.color.buy : DS.color.text3 },
                    { label: 'Backup Codes', value: `${secSummary.backup_codes_remaining} left`, color: secSummary.backup_codes_remaining > 0 ? DS.color.buy : DS.color.warn },
                    { label: 'Email OTP', value: secSummary.email_otp_enabled ? 'On' : 'Off', color: DS.color.buy },
                  ].map(item => (
                    <View key={item.label} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border, minWidth: '22%', alignItems: 'center' }}>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{item.label}</Text>
                      <Text style={{ color: item.color, fontWeight: DS.font.bold, fontSize: DS.font.sm, marginTop: 2 }}>{item.value}</Text>
                    </View>
                  ))}
                </View>

                {/* Admin actions */}
                <View style={{ flexDirection: 'row', gap: DS.space.xs, marginBottom: DS.space.md }}>
                  <Pressable
                    onPress={async () => {
                      setActionLoading(secUserId + '_sec_reset');
                      try { await AdminService.adminReset2FA(secUserId); setSecSummary(prev => prev ? { ...prev, totp_enabled: false, backup_codes_remaining: 0 } : prev); }
                      catch (e) { setSecError(toUserMessage(e, 'Reset 2FA failed.')); }
                      finally { setActionLoading(null); }
                    }}
                    disabled={!secSummary.totp_enabled || actionLoading === secUserId + '_sec_reset'}
                    style={{ flex: 1, backgroundColor: secSummary.totp_enabled ? DS.color.warnBg : DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: secSummary.totp_enabled ? DS.color.warn + '40' : DS.color.border }}
                  >
                    {actionLoading === secUserId + '_sec_reset'
                      ? <ActivityIndicator size="small" color={DS.color.warn} />
                      : <Text style={{ color: secSummary.totp_enabled ? DS.color.warn : DS.color.text3, fontSize: DS.font.xs }}>Reset TOTP</Text>}
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      setActionLoading(secUserId + '_force_out');
                      try { await AdminService.forceLogoutUser(secUserId); }
                      catch (e) { setSecError(toUserMessage(e, 'Force logout failed.')); }
                      finally { setActionLoading(null); }
                    }}
                    disabled={actionLoading === secUserId + '_force_out'}
                    style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}
                  >
                    {actionLoading === secUserId + '_force_out'
                      ? <ActivityIndicator size="small" color={DS.color.text2} />
                      : <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Force Logout</Text>}
                  </Pressable>
                </View>

                {/* Registered passkeys */}
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, marginBottom: DS.space.xs }}>
                  Registered Passkeys ({secPasskeys.length})
                </Text>
                {secPasskeys.length === 0 && <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginBottom: DS.space.md }}>No passkeys registered.</Text>}
                {secPasskeys.map(pk => (
                  <View key={pk.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center' }}>
                    <Key size={14} color={DS.color.text2} style={{ marginRight: DS.space.xs }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{pk.device_label || 'Unnamed device'}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
                        {pk.platform_type} · Registered {new Date(pk.created_at).toLocaleDateString()}
                        {pk.last_used_at ? ` · Last used ${new Date(pk.last_used_at).toLocaleDateString()}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={async () => {
                        setActionLoading('pk_' + pk.id);
                        try {
                          await adminRevokePasskey(pk.id, secUserId);
                          setSecPasskeys(prev => prev.filter(p => p.id !== pk.id));
                          setSecSummary(prev => prev ? { ...prev, passkey_count: Math.max(0, prev.passkey_count - 1) } : prev);
                        } catch (e) { setSecError(toUserMessage(e, 'Revoke failed.')); }
                        finally { setActionLoading(null); }
                      }}
                      disabled={actionLoading === 'pk_' + pk.id}
                      style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: DS.color.sell + '40' }}
                    >
                      {actionLoading === 'pk_' + pk.id
                        ? <ActivityIndicator size="small" color={DS.color.sell} />
                        : <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs }}>Revoke</Text>}
                    </Pressable>
                  </View>
                ))}

                {/* Security events */}
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, marginTop: DS.space.sm, marginBottom: DS.space.xs }}>
                  Recent Security Events
                </Text>
                {secEvents.length === 0 && <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>No events recorded.</Text>}
                {secEvents.map(ev => (
                  <View key={ev.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ color: DS.color.text1, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{ev.event_type.replace(/_/g, ' ')}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{new Date(ev.created_at).toLocaleString()}</Text>
                    </View>
                    {ev.ip_address && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>IP: {ev.ip_address}</Text>}
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {/* ── KYC — full multi-provider review panel ── */}
        {activeTab === 'KYC' && (
          <>
            {/* Settings shortcut */}
            <Pressable onPress={() => router.push('/(app)/admin/kyc-settings' as RelativePathString)}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.infoBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.info + '30', gap: DS.space.xs }}>
              <Shield size={13} color={DS.color.info} />
              <Text style={{ color: DS.color.info, fontSize: DS.font.xs, flex: 1 }}>KYC Settings — configure routing, thresholds & limits</Text>
              <ArrowUpRight size={13} color={DS.color.info} />
            </Pressable>

            {/* Status filter chips — aligned to kyc_attempts.status values */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: DS.space.sm }}>
              <View style={{ flexDirection: 'row', gap: DS.space.xs, paddingHorizontal: 2 }}>
                {['all', 'in_progress', 'submitted', 'pending_review', 'verified', 'failed', 'abandoned', 'manual_review'].map(f => {
                  const cnt = kycCounts[f === 'all' ? 'all' : f];
                  const label = f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f === 'submitted' ? 'Submitted' : f === 'pending_review' ? 'Pending Review' : f === 'verified' ? 'Verified' : f === 'failed' ? 'Failed' : f === 'abandoned' ? 'Abandoned' : 'Manual Review';
                  return (
                    <Pressable key={f} onPress={() => { setKycFilter(f); loadKycAttempts(f); setKycDetail(null); }}
                      style={{ backgroundColor: kycFilter === f ? DS.color.gold : DS.color.card, borderRadius: DS.radius.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: kycFilter === f ? DS.color.goldDark : DS.color.border, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ color: kycFilter === f ? DS.color.bg : DS.color.text2, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{label}</Text>
                      {cnt != null && <Text style={{ color: kycFilter === f ? DS.color.bg + 'cc' : DS.color.text3, fontSize: DS.font.xxs }}>{cnt}</Text>}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {/* Attempt list — source of truth: kyc_attempts */}
            {!kycDetail && (
              <>
                {loading ? <SkeletonCard rows={3} /> : null}
                {!loading && kycAttempts.length === 0 ? (
                  <EmptyState icon="✅" title="No KYC attempts" subtitle="No attempts match the selected filter" />
                ) : null}
                {kycAttempts.map(item => {
                  const statusCol = kycStatusColor(item.status, { buy: DS.color.buy, sell: DS.color.sell, warn: DS.color.warn, gold: DS.color.gold });
                  return (
                    <Pressable key={item.id} onPress={() => openKycDetail(item.id)}
                      style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: statusCol }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <View style={{ flex: 1, marginRight: DS.space.sm }}>
                          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }} numberOfLines={1}>
                            {item.email ?? item.username ?? item.userId}
                          </Text>
                          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
                            {item.countryCode ?? item.profileCountry ?? '—'} · {item.provider ? item.provider.charAt(0).toUpperCase() + item.provider.slice(1) : 'Unknown'} · {item.docType ?? '—'}
                          </Text>
                          {item.providerReference && (
                            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Ref: {item.providerReference}</Text>
                          )}
                          {item.exchangeUserId && (
                            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{item.exchangeUserId}</Text>
                          )}
                        </View>
                        <View>
                          <View style={{ backgroundColor: statusCol + '20', borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center', marginBottom: 4 }}>
                            <Text style={{ color: statusCol, fontSize: DS.font.xxs, fontWeight: DS.font.extrabold, textTransform: 'uppercase' }}>
                              {KYC_STATUS_ADMIN_LABEL[item.status] ?? item.status.replace(/_/g, ' ')}
                            </Text>
                          </View>
                          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, textAlign: 'right' }}>
                            {new Date(item.createdAt).toLocaleDateString()}
                          </Text>
                        </View>
                      </View>
                      {item.manualReviewReasons && item.manualReviewReasons.length > 0 && (
                        <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.xs, padding: DS.space.xs, marginTop: DS.space.xs, borderWidth: 1, borderColor: DS.color.warn + '30' }}>
                          <Text style={{ color: DS.color.warn, fontSize: DS.font.xxs }}>{item.manualReviewReasons.slice(0, 2).join(' · ')}{item.manualReviewReasons.length > 2 ? ` +${item.manualReviewReasons.length - 2} more` : ''}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </>
            )}

            {/* KYC Attempt Detail panel */}
            {kycDetail && (
              <View style={{ gap: DS.space.sm }}>
                {/* Back + Sync header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Pressable onPress={() => setKycDetail(null)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs, paddingVertical: DS.space.xs }}>
                    <ArrowLeft size={16} color={DS.color.text2} />
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Back to list</Text>
                  </Pressable>
                  <Pressable onPress={handleKycSyncStatus} disabled={kycSyncing}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: DS.color.card, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 6, borderWidth: 1, borderColor: DS.color.border }}>
                    {kycSyncing ? <ActivityIndicator size="small" color={DS.color.gold} /> : <RefreshCw size={13} color={DS.color.gold} />}
                    <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>Sync Status</Text>
                  </Pressable>
                </View>

                {kycDetailLoading ? <ActivityIndicator color={DS.color.gold} style={{ marginTop: DS.space.xl }} /> : null}

                {!kycDetailLoading && (
                  <>
                    {/* User info */}
                    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5, marginBottom: DS.space.sm }}>USER</Text>
                      {[
                        ['Name',           kycDetail.fullName ?? kycDetail.displayName],
                        ['Email',          kycDetail.email],
                        ['Customer ID',    kycDetail.exchangeUserId ?? kycDetail.customerReference],
                        ['Supabase UUID',  kycDetail.userId],
                        ['Country',        kycDetail.profileCountry ?? kycDetail.countryCode],
                      ].map(([label, val]) => val ? (
                        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                          <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>{label}</Text>
                          <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.medium, maxWidth: '65%', textAlign: 'right' }} numberOfLines={1}>{val}</Text>
                        </View>
                      ) : null)}
                    </View>

                    {/* Attempt fields */}
                    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5, marginBottom: DS.space.sm }}>ATTEMPT</Text>
                      {[
                        ['Attempt ID',        kycDetail.id],
                        ['Dojah Ref ID',      kycDetail.providerReference ?? kycDetail.referenceId],
                        ['Widget ID',         kycDetail.widgetId],
                        ['Provider',          kycDetail.provider ? kycDetail.provider.charAt(0).toUpperCase() + kycDetail.provider.slice(1) : '—'],
                        ['Document Type',     kycDetail.docType],
                        ['Country',           kycDetail.countryCode],
                        ['Internal Status',   kycDetail.status.replace(/_/g, ' ')],
                        ['Raw Dojah Status',  kycDetail.rawProviderStatus],
                        ['Started',           kycDetail.startedAt ? new Date(kycDetail.startedAt).toLocaleString() : undefined],
                        ['Submitted',         kycDetail.submittedAt ? new Date(kycDetail.submittedAt).toLocaleString() : undefined],
                        ['Completed',         kycDetail.completedAt ? new Date(kycDetail.completedAt).toLocaleString() : undefined],
                        ['Last Webhook',      kycDetail.lastWebhookAt ? new Date(kycDetail.lastWebhookAt).toLocaleString() : undefined],
                        ['Updated',           kycDetail.updatedAt ? new Date(kycDetail.updatedAt).toLocaleString() : undefined],
                      ].map(([label, val]) => val ? (
                        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                          <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>{label}</Text>
                          <Text style={{ color: label === 'Internal Status' ? DS.color.gold : DS.color.text1, fontSize: DS.font.xs, fontWeight: label === 'Internal Status' ? DS.font.bold : DS.font.medium, maxWidth: '60%', textAlign: 'right', textTransform: label === 'Internal Status' ? 'capitalize' : 'none' }} numberOfLines={1}>{val}</Text>
                        </View>
                      ) : null)}
                    </View>

                    {/* Verification checks */}
                    {(kycDetail.resultDocVerify || kycDetail.resultFaceMatch || kycDetail.resultAml) && (
                      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5, marginBottom: DS.space.sm }}>VERIFICATION RESULTS</Text>
                        {[
                          ['Document Verification', kycDetail.resultDocVerify],
                          ['Face Match',            kycDetail.resultFaceMatch],
                          ['Liveness Detection',    kycDetail.resultLiveness],
                          ['AML Screening',         kycDetail.resultAml],
                          ['PEP Screening',         kycDetail.resultPep],
                          ['Sanctions Screening',   kycDetail.resultSanctions],
                          ['Fraud Detection',       kycDetail.resultFraud],
                        ].filter(([, v]) => v && v !== 'not_run').map(([label, result]) => {
                          const passed = result === 'passed';
                          const failed = result === 'failed' || result === 'risk_detected' || result === 'hit';
                          const col = passed ? DS.color.buy : failed ? DS.color.sell : DS.color.warn;
                          return (
                            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{label}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                {passed ? <CheckCircle size={12} color={col} fill={col} /> : <XCircle size={12} color={col} />}
                                <Text style={{ color: col, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'capitalize' }}>
                                  {String(result).replace(/_/g, ' ')}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                        {kycDetail.confidenceScore != null && (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                            <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>Confidence Score</Text>
                            <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{(kycDetail.confidenceScore * 100).toFixed(1)}%</Text>
                          </View>
                        )}
                        {kycDetail.fraudRiskScore != null && (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                            <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>Fraud Risk Score</Text>
                            <Text style={{ color: kycDetail.fraudRiskScore > 0.5 ? DS.color.sell : DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{(kycDetail.fraudRiskScore * 100).toFixed(1)}%</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Manual review flags */}
                    {kycDetail.manualReviewReasons && kycDetail.manualReviewReasons.length > 0 && (
                      <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.warn + '30' }}>
                        <Text style={{ color: DS.color.warn, fontWeight: DS.font.semibold, fontSize: DS.font.xs, marginBottom: DS.space.xs }}>Manual Review Flags</Text>
                        {kycDetail.manualReviewReasons.map((r, i) => (
                          <Text key={i} style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 3 }}>• {r}</Text>
                        ))}
                      </View>
                    )}

                    {/* Failure reason */}
                    {(kycDetail.failureReason || kycDetail.reviewReason) && (
                      <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
                        {kycDetail.failureReason && <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>Failure: {kycDetail.failureReason}</Text>}
                        {kycDetail.reviewReason && <Text style={{ color: DS.color.warn, fontSize: DS.font.xs, marginTop: 4 }}>Review reason: {kycDetail.reviewReason}</Text>}
                      </View>
                    )}

                    {/* Provider events timeline */}
                    {kycProviderEvents.length > 0 && (
                      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5, marginBottom: DS.space.sm }}>WEBHOOK EVENTS</Text>
                        {kycProviderEvents.map((ev, idx) => (
                          <View key={ev.id as string} style={{ paddingVertical: 6, borderBottomWidth: idx < kycProviderEvents.length - 1 ? 1 : 0, borderBottomColor: DS.color.border }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.medium, textTransform: 'capitalize' }}>{String(ev.event_type ?? '').replace(/_/g, ' ')}</Text>
                              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{ev.created_at ? new Date(ev.created_at as string).toLocaleString() : ''}</Text>
                            </View>
                            {Boolean(ev.is_duplicate) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>duplicate</Text>}
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Admin action panel */}
                    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: DS.space.sm }}>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5 }}>ADMIN ACTIONS</Text>

                      {kycActionSuccess ? (
                        <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.sm, padding: DS.space.sm, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.buy + '30' }}>
                          <CheckCircle size={14} color={DS.color.buy} fill={DS.color.buy} />
                          <Text style={{ color: DS.color.buy, fontSize: DS.font.xs }}>{kycActionSuccess}</Text>
                        </View>
                      ) : null}
                      {kycActionError ? (
                        <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
                          <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{kycActionError}</Text>
                        </View>
                      ) : null}

                      <TextInput
                        value={kycActionReason}
                        onChangeText={setKycActionReason}
                        placeholder="Reason (required for approve / reject / escalate)"
                        placeholderTextColor={DS.color.text3}
                        style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: DS.color.border }}
                      />
                      <TextInput
                        value={kycActionNotes}
                        onChangeText={setKycActionNotes}
                        placeholder="Internal notes (optional)"
                        placeholderTextColor={DS.color.text3}
                        multiline
                        numberOfLines={3}
                        style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: DS.color.border, minHeight: 60, textAlignVertical: 'top' }}
                      />

                      {/* Row 1: Approve / Reject */}
                      <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                        <Pressable onPress={() => handleKycAdminAction('approve')} disabled={kycActioning}
                          style={{ flex: 1, backgroundColor: DS.color.buy, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                          {kycActioning ? <ActivityIndicator size="small" color="#fff" /> : <><CheckCircle size={13} color="#fff" /><Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Approve</Text></>}
                        </Pressable>
                        <Pressable onPress={() => handleKycAdminAction('reject')} disabled={kycActioning}
                          style={{ flex: 1, backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
                          <XCircle size={13} color={DS.color.sell} />
                          <Text style={{ color: DS.color.sell, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Reject</Text>
                        </Pressable>
                      </View>
                      {/* Row 2: Escalate / Request Info / Add Note */}
                      <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                        <Pressable onPress={() => handleKycAdminAction('escalate')} disabled={kycActioning}
                          style={{ flex: 1, backgroundColor: DS.color.warnBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.warn + '40' }}>
                          <Text style={{ color: DS.color.warn, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Escalate</Text>
                        </Pressable>
                        <Pressable onPress={() => handleKycAdminAction('request_info')} disabled={kycActioning}
                          style={{ flex: 1, backgroundColor: DS.color.infoBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.info + '40' }}>
                          <Text style={{ color: DS.color.info, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Request Info</Text>
                        </Pressable>
                        <Pressable onPress={() => handleKycAdminAction('add_note')} disabled={kycActioning}
                          style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}>
                          <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Add Note</Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Audit log */}
                    {kycAuditLog.length > 0 && (
                      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5, marginBottom: DS.space.sm }}>AUDIT LOG</Text>
                        {kycAuditLog.map((entry, idx) => (
                          <View key={entry.id} style={{ paddingVertical: DS.space.xs, borderBottomWidth: idx < kycAuditLog.length - 1 ? 1 : 0, borderBottomColor: DS.color.border }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.medium, textTransform: 'capitalize' }}>{entry.action.replace(/_/g, ' ')}</Text>
                              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{new Date(entry.createdAt).toLocaleString()}</Text>
                            </View>
                            {(entry.oldStatus || entry.newStatus) && (
                              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{entry.oldStatus} → {entry.newStatus}</Text>
                            )}
                            {entry.reason && <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Reason: {entry.reason}</Text>}
                            {entry.notes  && <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Notes: {entry.notes}</Text>}
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
          </>
        )}

        {/* ── Disputes ── */}
        {activeTab === 'Disputes' && (
          <>
            {loading && disputes.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && disputes.length === 0 ? <EmptyState icon="⚖️" title="No open disputes" subtitle="All disputes have been resolved" /> : null}
            {disputes.map(d => (
              <View key={d.id as string} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: DS.color.sell }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Dispute #{(d.id as string).slice(0, 8)}</Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{new Date(d.created_at as string).toLocaleDateString()}</Text>
                </View>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 4 }}>Order: {d.order_id as string}</Text>
                <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '20' }}>
                  <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>Reason: {d.reason as string}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                  <Pressable onPress={() => handleResolveDispute(d.id as string, d.order_id as string, 'buyer')} disabled={actionLoading === d.id}
                    style={{ flex: 1, backgroundColor: DS.color.buyBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.buy + '30' }}>
                    {actionLoading === d.id ? <ActivityIndicator size="small" color={DS.color.buy} /> : <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Buyer Wins</Text>}
                  </Pressable>
                  <Pressable onPress={() => handleResolveDispute(d.id as string, d.order_id as string, 'seller')} disabled={actionLoading === d.id}
                    style={{ flex: 1, backgroundColor: DS.color.warnBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.warn + '30' }}>
                    <Text style={{ color: DS.color.warn, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Seller Wins</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Withdrawals ── */}
        {activeTab === 'Withdrawals' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {withdrawals.length} pending withdrawal{withdrawals.length !== 1 ? 's' : ''} awaiting review
            </Text>
            {loading && withdrawals.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && withdrawals.length === 0 ? <EmptyState icon="💸" title="No pending withdrawals" subtitle="All withdrawal requests have been processed" /> : null}
            {withdrawals.map(w => (
              <View key={w.id as string} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{w.user_id as string}</Text>
                  <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.warn + '40' }}>
                    <Text style={{ color: DS.color.warn, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>{String(w.status).toUpperCase()}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: DS.space.md, marginBottom: 5 }}>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Asset <Text style={{ color: DS.color.text1, fontWeight: DS.font.medium }}>{w.asset as string}</Text></Text>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Amount <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold }}>{Number(w.amount).toFixed(8)}</Text></Text>
                </View>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>Network: {w.network as string}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: DS.space.sm }} numberOfLines={1}>To: {w.to_address as string}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: DS.space.sm }}>{new Date(w.created_at as string).toLocaleString()}</Text>
                <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                  <Pressable onPress={() => handleWithdrawalApprove(w.id as string, w.user_id as string)} disabled={actionLoading === w.id}
                    style={{ flex: 1, backgroundColor: DS.color.buy, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
                    {actionLoading === w.id ? <ActivityIndicator size="small" color="#fff" /> : <><CheckCircle size={14} color="#fff" /><Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Approve</Text></>}
                  </Pressable>
                  <Pressable onPress={() => handleWithdrawalReject(w.id as string, w.user_id as string)} disabled={actionLoading === w.id}
                    style={{ flex: 1, backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
                    <XCircle size={14} color={DS.color.sell} />
                    <Text style={{ color: DS.color.sell, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Risk ── */}
        {activeTab === 'Risk' && (
          <>
            {loading && riskFlags.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && riskFlags.length === 0 ? <EmptyState icon="🛡️" title="No active risk flags" subtitle="Platform risk posture is healthy" /> : null}
            {riskFlags.map(flag => {
              const sev = (flag.severity as string) ?? 'low';
              const color = SEV_COLOR[sev] ?? DS.color.text3;
              const bg = SEV_BG[sev] ?? DS.color.surface;
              return (
                <View key={flag.id as string} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: color }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                      <AlertTriangle size={15} color={color} />
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{flag.flag_type as string}</Text>
                    </View>
                    <View style={{ backgroundColor: bg, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: color + '40' }}>
                      <Text style={{ color, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold, textTransform: 'uppercase' }}>{sev}</Text>
                    </View>
                  </View>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 4 }}>User: {flag.user_id as string}</Text>
                  <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>{flag.details as string ?? 'No details available'}</Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: DS.space.sm }}>{new Date(flag.created_at as string).toLocaleString()}</Text>
                  <Pressable onPress={() => {}} style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
                    <Flag size={13} color={DS.color.info} />
                    <Text style={{ color: DS.color.info, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Investigate</Text>
                  </Pressable>
                </View>
              );
            })}
          </>
        )}

        {/* ── P2P Trades ── */}
        {activeTab === 'P2P Trades' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {p2pTrades.length} trades in system
            </Text>
            {loading && p2pTrades.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && p2pTrades.length === 0 ? <EmptyState icon="🔄" title="No P2P trades yet" subtitle="Trades will appear here once users start trading" /> : null}
            {p2pTrades.map(trade => {
              const statusColors: Record<string, string> = {
                released: DS.color.buy, disputed: DS.color.sell, awaiting_payment: DS.color.warn,
                payment_marked: '#8B5CF6', cancelled: DS.color.text3, expired: DS.color.text3,
              };
              const sc = statusColors[trade.status] ?? DS.color.text2;
              return (
                <View key={trade.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: sc }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: DS.space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ArrowLeftRight size={13} color={DS.color.gold} />
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>#{trade.tradeNumber?.slice(-8)}</Text>
                    </View>
                    <View style={{ backgroundColor: sc + '20', borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <Text style={{ color: sc, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold, textTransform: 'uppercase' }}>{trade.status.replace('_', ' ')}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: DS.space.md, marginBottom: 4 }}>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Asset <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold }}>{trade.cryptoAmount.toFixed(4)} {trade.asset}</Text></Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Fiat <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{trade.fiatAmount.toLocaleString()} {trade.fiat}</Text></Text>
                  </View>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: DS.space.sm }}>{new Date(trade.createdAt).toLocaleString()} · {trade.paymentMethod}</Text>
                  {(trade.status === 'payment_marked' || trade.status === 'disputed') && (
                    <Pressable onPress={() => handleP2PRelease(trade.id)} disabled={actionLoading === trade.id}
                      style={{ backgroundColor: DS.color.buy, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
                      {actionLoading === trade.id ? <ActivityIndicator size="small" color="#fff" /> : <><CheckCircle size={13} color="#fff" /><Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Admin Release Crypto</Text></>}
                    </Pressable>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── P2P Disputes ── */}
        {activeTab === 'P2P Disputes' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {p2pDisputes.filter(d => d.status === 'open' || d.status === 'under_review').length} active disputes
            </Text>
            {loading && p2pDisputes.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && p2pDisputes.length === 0 ? <EmptyState icon="⚖️" title="No P2P disputes" subtitle="All P2P trades are running smoothly" /> : null}
            {p2pDisputes.map(disp => {
              const isOpen = disp.status === 'open' || disp.status === 'under_review';
              return (
                <Pressable
                  key={disp.id}
                  onPress={() => router.push(`/(app)/admin/dispute-detail?disputeId=${disp.id}` as RelativePathString)}
                  style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: isOpen ? DS.color.sell : DS.color.text3 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Dispute #{disp.id.slice(0, 8)}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ backgroundColor: isOpen ? DS.color.sellBg : DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
                        <Text style={{ color: isOpen ? DS.color.sell : DS.color.text3, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold, textTransform: 'uppercase' }}>{disp.status.replace('_', ' ')}</Text>
                      </View>
                      <Scale size={14} color={isOpen ? DS.color.sell : DS.color.text3} />
                    </View>
                  </View>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 4 }}>Reason: {disp.reason}</Text>
                  {disp.description && <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 4 }} numberOfLines={2}>{disp.description}</Text>}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{new Date(disp.createdAt).toLocaleString()}</Text>
                    <Text style={{ color: isOpen ? DS.color.gold : DS.color.text3, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                      {isOpen ? 'Tap to Adjudicate →' : 'View Details →'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {/* ── Merchants ── */}
        {activeTab === 'Merchants' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>All registered P2P merchants</Text>
            {loading ? <SkeletonCard rows={3} /> : null}
            {!loading && p2pAds.length === 0 ? <EmptyState icon="🏪" title="No merchants yet" subtitle="Merchant profiles will appear as users start trading" /> : null}
            {/* Show unique merchants from ads */}
            {Array.from(new Map(p2pAds.filter(a => a.merchant).map(a => [a.merchantId, a.merchant!])).values()).map(m => (
              <View key={m.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.gold + '40' }}>
                      <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold }}>{m.displayName[0].toUpperCase()}</Text>
                    </View>
                    <View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>{m.displayName}</Text>
                        {m.isVerified && <ShieldCheck size={13} color={DS.color.buy} />}
                      </View>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>{m.completionRate}% CR · {m.totalTrades} trades</Text>
                    </View>
                  </View>
                  <View>
                    {m.isSuspended
                      ? <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: DS.color.sell, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>SUSPENDED</Text></View>
                      : m.isOnline
                        ? <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: DS.color.buy, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>ONLINE</Text></View>
                        : <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: DS.color.text3, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>OFFLINE</Text></View>
                    }
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: DS.space.md, marginBottom: DS.space.sm }}>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Completed <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{m.completedTrades}</Text></Text>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Disputed <Text style={{ color: DS.color.sell, fontWeight: DS.font.semibold }}>{m.disputedTrades}</Text></Text>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>KYC L{m.kycLevel}</Text>
                </View>
                <Pressable onPress={() => handleSuspendMerchant(m.id, !m.isSuspended)} disabled={actionLoading === m.id}
                  style={{ backgroundColor: m.isSuspended ? DS.color.buyBg : DS.color.sellBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: (m.isSuspended ? DS.color.buy : DS.color.sell) + '30', flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
                  {actionLoading === m.id ? <ActivityIndicator size="small" color={m.isSuspended ? DS.color.buy : DS.color.sell} /> : (
                    <>
                      <UserCheck size={13} color={m.isSuspended ? DS.color.buy : DS.color.sell} />
                      <Text style={{ color: m.isSuspended ? DS.color.buy : DS.color.sell, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{m.isSuspended ? 'Unsuspend' : 'Suspend'} Merchant</Text>
                    </>
                  )}
                </Pressable>
              </View>
            ))}
          </>
        )}

        {/* ── P2P Ads ── */}
        {activeTab === 'P2P Ads' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {p2pAds.length} ads in system · {p2pAds.filter(a => a.status === 'active').length} active
            </Text>
            {loading && p2pAds.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && p2pAds.length === 0 ? <EmptyState icon="📋" title="No P2P ads posted yet" subtitle="Ads will appear once merchants start posting" /> : null}
            {p2pAds.map(ad => {
              const sideColor = ad.side === 'sell' ? DS.color.sell : DS.color.buy;
              return (
                <View key={ad.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <LayoutList size={13} color={DS.color.text2} />
                      <View style={{ backgroundColor: sideColor + '20', borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ color: sideColor, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>{ad.side.toUpperCase()}</Text>
                      </View>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{ad.asset}/{ad.fiat}</Text>
                    </View>
                    <View style={{ backgroundColor: ad.status === 'active' ? DS.color.buyBg : DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ color: ad.status === 'active' ? DS.color.buy : DS.color.text3, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold, textTransform: 'uppercase' }}>{ad.status}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: DS.space.md, marginBottom: 4 }}>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Price <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold }}>{ad.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text></Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Available <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{ad.availableAmount.toLocaleString()} {ad.asset}</Text></Text>
                  </View>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
                    By: {ad.merchant?.displayName ?? ad.merchantId.slice(0, 8)} · {new Date(ad.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              );
            })}
          </>
        )}

        {/* ── Wallet Balances ── */}
        {activeTab === 'Wallet Balances' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {adminWalletBalances.length} wallet balance records (all users)
            </Text>
            {loading && adminWalletBalances.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && adminWalletBalances.length === 0 ? <EmptyState icon="💰" title="No wallet balances" subtitle="User wallets will appear here once users are created" /> : null}
            {(adminWalletBalances as (WalletBalance & { ownerEmail?: string; ownerUid?: string })[]).map((w, i) => (
              <View key={`${w.id}-${i}`} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 32, height: 32, borderRadius: DS.radius.full, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center' }}>
                      <Wallet size={14} color={DS.color.gold} />
                    </View>
                    <View>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{w.asset}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, textTransform: 'capitalize' }}>{w.walletType} wallet</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{w.availableBalance.toFixed(4)}</Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>available</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: DS.space.md, flexWrap: 'wrap' }}>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Total <Text style={{ color: DS.color.text2 }}>{w.balance.toFixed(4)}</Text></Text>
                  {w.lockedBalance > 0 && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Locked <Text style={{ color: DS.color.warn }}>{w.lockedBalance.toFixed(4)}</Text></Text>}
                  {w.escrowBalance > 0 && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Escrow <Text style={{ color: DS.color.info }}>{w.escrowBalance.toFixed(4)}</Text></Text>}
                  {w.pendingDeposit > 0 && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Pending+ <Text style={{ color: DS.color.buy }}>{w.pendingDeposit.toFixed(4)}</Text></Text>}
                </View>
                {w.ownerEmail
                  ? <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 4 }}>{w.ownerEmail} {w.ownerUid ? `· ${w.ownerUid}` : ''}</Text>
                  : <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 4 }}>User: {w.userId.slice(0, 12)}…</Text>
                }
              </View>
            ))}
          </>
        )}

        {/* ── Wallet Freezes ── */}
        {activeTab === 'Wallet Freezes' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {adminFreezes.filter(f => f.isActive).length} active freeze{adminFreezes.filter(f => f.isActive).length !== 1 ? 's' : ''}
            </Text>
            {loading && adminFreezes.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && adminFreezes.length === 0 ? <EmptyState icon="🔓" title="No wallet freezes" subtitle="No wallets are currently frozen" /> : null}
            {adminFreezes.map(f => (
              <View key={f.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: f.isActive ? DS.color.sell : DS.color.text3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Lock size={14} color={f.isActive ? DS.color.sell : DS.color.text3} />
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, textTransform: 'capitalize' }}>{f.freezeType} Freeze</Text>
                  </View>
                  <View style={{ backgroundColor: f.isActive ? DS.color.sellBg : DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
                    <Text style={{ color: f.isActive ? DS.color.sell : DS.color.text3, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>{f.isActive ? 'ACTIVE' : 'INACTIVE'}</Text>
                  </View>
                </View>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>UID: {f.userId.slice(0, 16)}…</Text>
                {f.asset && <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Asset: {f.asset}{f.walletType ? ` (${f.walletType})` : ''}</Text>}
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 2 }}>Reason: {f.reason}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>{new Date(f.createdAt).toLocaleString()}</Text>
                {f.isActive && (
                  <Pressable
                    disabled={actionLoading === f.id}
                    onPress={async () => {
                      setActionLoading(f.id);
                      try {
                        await supabase.from('wallet_freezes').update({ is_active: false }).eq('id', f.id);
                        await loadData();
                      } catch (e) { setError(toUserMessage(e, 'Action failed')); }
                      finally { setActionLoading(null); }
                    }}
                    style={{ marginTop: DS.space.sm, backgroundColor: DS.color.buyBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.buy + '30', flexDirection: 'row', justifyContent: 'center', gap: 5 }}
                  >
                    {actionLoading === f.id ? <ActivityIndicator size="small" color={DS.color.buy} /> : <><CheckCircle size={13} color={DS.color.buy} /><Text style={{ color: DS.color.buy, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Unfreeze Wallet</Text></>}
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}

        {/* ── Escrow ── */}
        {activeTab === 'Escrow' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {adminEscrows.length} escrow record{adminEscrows.length !== 1 ? 's' : ''} · {adminEscrows.filter(e => e.status === 'locked').length} locked
            </Text>
            {loading && adminEscrows.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && adminEscrows.length === 0 ? <EmptyState icon="🔒" title="No escrow records" subtitle="Escrow records will appear here" /> : null}
            {adminEscrows.map(e => {
              const statusColors: Record<string, string> = {
                locked: DS.color.warn, released: DS.color.buy, refunded: DS.color.info,
                frozen: DS.color.sell, disputed: DS.color.sell, expired: DS.color.text3,
              };
              const sc = statusColors[e.status] ?? DS.color.text3;
              const canAct = e.status === 'locked' || e.status === 'disputed' || e.status === 'frozen';
              return (
                <View key={e.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: sc }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Shield size={14} color={sc} />
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
                        {e.amount} {e.asset}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: sc + '18', borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <Text style={{ color: sc, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold, textTransform: 'uppercase' }}>{e.status}</Text>
                    </View>
                  </View>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Type: {e.escrowType}</Text>
                  {e.tradeId && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Trade: {e.tradeId.slice(0, 12)}…</Text>}
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Seller: {e.sellerId.slice(0, 12)}…</Text>
                  {e.buyerId && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Buyer: {e.buyerId.slice(0, 12)}…</Text>}
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>{new Date(e.lockedAt).toLocaleString()}</Text>
                  {canAct && (
                    <View style={{ flexDirection: 'row', gap: DS.space.xs, marginTop: DS.space.sm }}>
                      <Pressable
                        disabled={actionLoading === e.id}
                        onPress={async () => {
                          setActionLoading(e.id);
                          try {
                            await supabase.from('escrows').update({ status: 'released', released_at: new Date().toISOString() }).eq('id', e.id);
                            await loadData();
                          } catch (err) { setError(toUserMessage(err, 'Action failed')); }
                          finally { setActionLoading(null); }
                        }}
                        style={{ flex: 1, backgroundColor: DS.color.buyBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.buy + '30', flexDirection: 'row', justifyContent: 'center', gap: 5 }}
                      >
                        {actionLoading === e.id ? <ActivityIndicator size="small" color={DS.color.buy} /> : <><CheckCircle size={13} color={DS.color.buy} /><Text style={{ color: DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Release</Text></>}
                      </Pressable>
                      <Pressable
                        disabled={actionLoading === e.id}
                        onPress={async () => {
                          setActionLoading(e.id + '_refund');
                          try {
                            await supabase.from('escrows').update({ status: 'refunded', refunded_at: new Date().toISOString() }).eq('id', e.id);
                            await loadData();
                          } catch (err) { setError(toUserMessage(err, 'Action failed')); }
                          finally { setActionLoading(null); }
                        }}
                        style={{ flex: 1, backgroundColor: DS.color.warnBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.warn + '30', flexDirection: 'row', justifyContent: 'center', gap: 5 }}
                      >
                        <XCircle size={13} color={DS.color.warn} />
                        <Text style={{ color: DS.color.warn, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Refund</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── Audit Logs ── */}
        {activeTab === 'Audit Logs' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Last {adminAuditLogs.length} wallet audit events
            </Text>
            {loading && adminAuditLogs.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && adminAuditLogs.length === 0 ? <EmptyState icon="📋" title="No audit logs" subtitle="Wallet audit events will appear here" /> : null}
            {adminAuditLogs.map(log => (
              <View key={log.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <FileText size={13} color={DS.color.info} />
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.xs, flex: 1 }}>
                      {log.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                  </View>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{new Date(log.createdAt).toLocaleString()}</Text>
                </View>
                {log.targetUserId && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>User: {log.targetUserId.slice(0, 12)}…</Text>}
                {log.asset && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Asset: {log.asset}{log.amount != null ? ` · ${log.amount}` : ''}</Text>}
                {log.reason && <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs, marginTop: 2 }}>Reason: {log.reason}</Text>}
              </View>
            ))}
          </>
        )}

        {/* ── Spot Orders ── */}
        {activeTab === 'Spot Orders' && (
          <>
            {/* Global pause + sync controls */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: DS.space.sm, flexWrap: 'wrap' }}>
              {/* Global pause toggle */}
              <Pressable
                onPress={async () => {
                  const next = !spotGlobalPaused;
                  try {
                    await supabase.from('trading_settings')
                      .update({ value: !next })
                      .eq('key', 'spot_trading_enabled');
                    setSpotGlobalPaused(next);
                  } catch { /* ignore */ }
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: DS.radius.md,
                         backgroundColor: spotGlobalPaused ? DS.color.buyBg : DS.color.sellBg,
                         borderWidth: 1, borderColor: spotGlobalPaused ? DS.color.buy : DS.color.sell }}>
                <Text style={{ color: spotGlobalPaused ? DS.color.buy : DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>
                  {spotGlobalPaused ? '▶ Resume Spot' : '⏸ Pause Spot'}
                </Text>
              </Pressable>
              {/* Sync fills */}
              <Pressable
                disabled={spotSyncing}
                onPress={async () => {
                  setSpotSyncing(true); setSpotSyncResult(null);
                  try {
                    const res = await TradingService.triggerOrderSync();
                    setSpotSyncResult(res);
                    await loadData();
                  } catch (e) {
                    setSpotSyncResult({ checked: 0, fills_settled: 0, errors: [(e as Error).message] });
                  } finally { setSpotSyncing(false); }
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: DS.radius.md,
                         backgroundColor: DS.color.surface, borderWidth: 1, borderColor: DS.color.gold,
                         opacity: spotSyncing ? 0.5 : 1 }}>
                <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>
                  {spotSyncing ? '⟳ Syncing…' : '⟳ Sync Fills'}
                </Text>
              </Pressable>
            </View>

            {/* Sync result */}
            {spotSyncResult && (
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.md, padding: DS.space.sm,
                             marginBottom: DS.space.sm, borderWidth: 1,
                             borderColor: spotSyncResult.errors.length > 0 ? DS.color.sell : DS.color.buy }}>
                <Text style={{ color: DS.color.text1, fontSize: DS.font.xxs }}>
                  Sync: checked {spotSyncResult.checked}, settled {spotSyncResult.fills_settled} fill{spotSyncResult.fills_settled !== 1 ? 's' : ''}
                </Text>
                {spotSyncResult.errors.map((err, i) => (
                  <Text key={i} style={{ color: DS.color.sell, fontSize: DS.font.xxs, marginTop: 2 }}>⚠ {err}</Text>
                ))}
              </View>
            )}

            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Last {adminSpotOrders.length} spot orders
            </Text>
            {loading && adminSpotOrders.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && adminSpotOrders.length === 0
              ? <EmptyState icon="📊" title="No spot orders" subtitle="Spot orders will appear here" />
              : null}
            {adminSpotOrders.map((o, i) => {
              const side        = String(o.side ?? '');
              const status      = String(o.status_v2 ?? o.status ?? '');
              const orderId     = String(o.id ?? i);
              const sColor      = status === 'filled' ? DS.color.buy : status === 'cancelled' || status === 'rejected' ? DS.color.sell : DS.color.warn;
              const canCancel   = ['open','partially_filled','pending','submitted'].includes(status);
              const isCancelling = adminCancellingOrder === orderId;
              return (
                <View key={orderId} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: side === 'buy' ? DS.color.buy : DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>{side.toUpperCase()}</Text>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{String(o.symbol ?? '')}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{String(o.order_type_v2 ?? o.order_type ?? '')}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      <View style={{ backgroundColor: sColor + '20', borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: sColor, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{status.replace(/_/g,' ').toUpperCase()}</Text>
                      </View>
                      {canCancel && (
                        <Pressable
                          disabled={isCancelling}
                          onPress={async () => {
                            setAdminCancellingOrder(orderId);
                            try {
                              await supabase.rpc('admin_cancel_spot_order', { p_order_id: orderId, p_reason: 'Admin cancelled' });
                              await loadData();
                            } catch { /* ignore */ } finally { setAdminCancellingOrder(null); }
                          }}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: DS.color.sellBg,
                                   borderRadius: DS.radius.sm, borderWidth: 1, borderColor: DS.color.sell,
                                   opacity: isCancelling ? 0.5 : 1 }}>
                          <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                            {isCancelling ? '…' : 'Cancel'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                  {/* Quantities & fill info */}
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Qty: <Text style={{ color: DS.color.text2 }}>{String(o.quantity ?? '')}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Filled: <Text style={{ color: DS.color.text2 }}>{Number(o.filled_qty ?? o.filled_quantity ?? 0).toFixed(5)}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Remain: <Text style={{ color: DS.color.text2 }}>{Number(o.remaining_qty ?? 0).toFixed(5)}</Text></Text>
                    {Number(o.avg_fill_price ?? 0) > 0 && (
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Avg: <Text style={{ color: DS.color.buy }}>{Number(o.avg_fill_price).toFixed(2)}</Text></Text>
                    )}
                    {Number(o.locked_amount ?? 0) > 0 && (
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Locked: <Text style={{ color: DS.color.gold }}>{Number(o.locked_amount).toFixed(5)}</Text></Text>
                    )}
                    {Boolean(o.price) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>@ <Text style={{ color: DS.color.text2 }}>{String(o.price)}</Text></Text>}
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Fee: <Text style={{ color: DS.color.text2 }}>{Number(o.fee ?? 0).toFixed(6)} {String(o.fee_asset ?? 'USDT')}</Text></Text>
                  </View>
                  {/* Provider & user info */}
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                    {Boolean(o.provider_order_id) && (
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Binance #<Text style={{ color: DS.color.text2 }}>{String(o.provider_order_id)}</Text></Text>
                    )}
                    {Boolean(o.user_id) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>User: {String(o.user_id).slice(0,12)}…</Text>}
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{Boolean(o.created_at) ? new Date(String(o.created_at)).toLocaleString() : ''}</Text>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ── Futures Orders ── */}
        {activeTab === 'Futures Orders' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Last {adminFutOrders.length} futures orders
            </Text>
            {loading && adminFutOrders.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && adminFutOrders.length === 0
              ? <EmptyState icon="📈" title="No futures orders" subtitle="Futures orders will appear here" />
              : null}
            {adminFutOrders.map((o, i) => {
              const side   = String(o.side ?? '');
              const status = String(o.status_v2 ?? o.status ?? '');
              const sColor = status === 'filled' ? DS.color.buy : status === 'cancelled' || status === 'rejected' ? DS.color.sell : DS.color.warn;
              return (
                <View key={String(o.id ?? i)} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: side === 'buy' ? DS.color.buy : DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>{side.toUpperCase()}</Text>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{String(o.symbol ?? '')}</Text>
                      <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs }}>{Number(o.leverage_v2 ?? o.leverage ?? 1)}×</Text>
                    </View>
                    <View style={{ backgroundColor: sColor + '20', borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: sColor, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{status.replace('_',' ').toUpperCase()}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Qty: <Text style={{ color: DS.color.text2 }}>{String(o.quantity ?? '')}</Text></Text>
                    {Boolean(o.price) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>@ <Text style={{ color: DS.color.text2 }}>{String(o.price)}</Text></Text>}
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Mode: <Text style={{ color: DS.color.text2 }}>{String(o.margin_mode ?? 'cross')}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{Boolean(o.created_at) ? new Date(String(o.created_at)).toLocaleDateString() : ''}</Text>
                  </View>
                  {Boolean(o.user_id) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>User: {String(o.user_id).slice(0,12)}…</Text>}
                </View>
              );
            })}
          </>
        )}

        {/* ── Open Positions ── */}
        {activeTab === 'Positions' && (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
                {adminPositions.length} open position{adminPositions.length !== 1 ? 's' : ''}
              </Text>
              <Pressable
                disabled={futSyncing}
                onPress={async () => {
                  setFutSyncing(true); setFutSyncResult(null);
                  try {
                    const { data, error } = await supabase.functions.invoke('futures-sync', { body: { action: 'reconcile' } });
                    setFutSyncResult(error ? `Error: ${error.message}` : `Synced: ${JSON.stringify(data)}`);
                    await loadData();
                  } catch (e) {
                    setFutSyncResult(`Error: ${e instanceof Error ? e.message : 'Unknown'}`);
                  } finally { setFutSyncing(false); }
                }}
                style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: DS.color.gold, opacity: futSyncing ? 0.6 : 1 }}>
                {futSyncing ? <ActivityIndicator size="small" color={DS.color.gold} /> : null}
                <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>Sync Positions</Text>
              </Pressable>
            </View>
            {futSyncResult ? <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: DS.space.sm }}>{futSyncResult}</Text> : null}
            {loading && adminPositions.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && adminPositions.length === 0
              ? <EmptyState icon="📉" title="No open positions" subtitle="Live futures positions will appear here" />
              : null}
            {adminPositions.map((p, i) => {
              const side = String(p.side ?? '');
              const upnl = Number(p.unrealized_pnl ?? 0);
              const posId = String(p.id ?? '');
              return (
                <View key={posId || String(i)} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>{String(p.symbol ?? '').replace('_PERP','')}</Text>
                      <View style={{ backgroundColor: (side === 'long' ? DS.color.buyBg : DS.color.sellBg), borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: side === 'long' ? DS.color.buy : DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{side.toUpperCase()} {Number(p.leverage ?? 1)}×</Text>
                      </View>
                    </View>
                    <Text style={{ color: upnl >= 0 ? DS.color.buy : DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>
                      {upnl >= 0 ? '+' : ''}{upnl.toFixed(2)} USDT
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Entry: <Text style={{ color: DS.color.text2 }}>{Number(p.entry_price ?? 0).toFixed(2)}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Liq: <Text style={{ color: DS.color.sell }}>{Number(p.liq_price ?? 0).toFixed(2)}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Size: <Text style={{ color: DS.color.text2 }}>{String(p.size ?? '')}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Margin: <Text style={{ color: DS.color.text2 }}>{Number(p.initial_margin ?? 0).toFixed(2)}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Ratio: <Text style={{ color: Number(p.margin_ratio ?? 0) > 0.8 ? DS.color.sell : DS.color.text2 }}>{(Number(p.margin_ratio ?? 0) * 100).toFixed(1)}%</Text></Text>
                  </View>
                  {Boolean(p.user_id) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 6 }}>User: {String(p.user_id).slice(0,12)}…</Text>}
                  {/* Admin force-close */}
                  <Pressable
                    disabled={forceClosing === posId}
                    onPress={async () => {
                      setForceClosing(posId);
                      try {
                        const { error } = await supabase.rpc('futures_admin_force_close', { p_position_id: posId, p_reason: 'admin_force_close' });
                        if (error) throw new Error(error.message);
                        await loadData();
                      } catch (e) {
                        setFutSyncResult(`Force-close failed: ${e instanceof Error ? e.message : 'Unknown'}`);
                      } finally { setForceClosing(null); }
                    }}
                    style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, paddingVertical: 7, alignItems: 'center', borderWidth: 1, borderColor: DS.color.sell, opacity: forceClosing === posId ? 0.5 : 1 }}>
                    {forceClosing === posId
                      ? <ActivityIndicator size="small" color={DS.color.sell} />
                      : <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>Force Close</Text>}
                  </Pressable>
                </View>
              );
            })}
          </>
        )}

        {/* ── Liquidations ── */}
        {activeTab === 'Liquidations' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Last {adminLiquidations.length} liquidation event{adminLiquidations.length !== 1 ? 's' : ''}
            </Text>
            {loading && adminLiquidations.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && adminLiquidations.length === 0
              ? <EmptyState icon="⚡" title="No liquidations" subtitle="Liquidation events will appear here" />
              : null}
            {adminLiquidations.map((liq, i) => (
              <View key={String(liq.id ?? i)} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.sellBg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>
                    LIQUIDATED — {String(liq.symbol ?? '').replace('_PERP','')} {String(liq.side ?? '').toUpperCase()}
                  </Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{liq.created_at ? new Date(String(liq.created_at)).toLocaleDateString() : ''}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>PnL: <Text style={{ color: DS.color.sell }}>{Number(liq.realized_pnl ?? 0).toFixed(2)} USDT</Text></Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Liq Fee: <Text style={{ color: DS.color.text2 }}>{Number(liq.liq_fee ?? 0).toFixed(4)}</Text></Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Mark: <Text style={{ color: DS.color.text2 }}>{Number(liq.mark_price ?? 0).toFixed(2)}</Text></Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Size: <Text style={{ color: DS.color.text2 }}>{Number(liq.size ?? 0)}</Text></Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Returned: <Text style={{ color: DS.color.text2 }}>{Number(liq.margin_returned ?? 0).toFixed(2)}</Text></Text>
                </View>
                {Boolean(liq.user_id) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>User: {String(liq.user_id).slice(0,12)}…</Text>}
              </View>
            ))}
          </>
        )}

        {/* ── Funding History ── */}
        {activeTab === 'Funding History' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Last {adminFundingHist.length} funding payment{adminFundingHist.length !== 1 ? 's' : ''}
            </Text>
            {loading && adminFundingHist.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!loading && adminFundingHist.length === 0
              ? <EmptyState icon="💸" title="No funding history" subtitle="Funding payments will appear here after each settlement" />
              : null}
            {adminFundingHist.map((f, i) => {
              const fee = Number(f.fee_amount ?? 0);
              return (
                <View key={String(f.id ?? i)} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>
                        {String(f.symbol ?? '').replace('_PERP','')}
                      </Text>
                      <View style={{ backgroundColor: String(f.side ?? '') === 'long' ? DS.color.buyBg : DS.color.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ color: String(f.side ?? '') === 'long' ? DS.color.buy : DS.color.sell, fontSize: DS.font.xxs }}>{String(f.side ?? '').toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={{ color: fee >= 0 ? DS.color.sell : DS.color.buy, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>
                      {fee >= 0 ? '-' : '+'}{Math.abs(fee).toFixed(4)} USDT
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Rate: <Text style={{ color: DS.color.text2 }}>{(Number(f.funding_rate ?? 0) * 100).toFixed(4)}%</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Size: <Text style={{ color: DS.color.text2 }}>{Number(f.size ?? 0)}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Mark: <Text style={{ color: DS.color.text2 }}>{Number(f.mark_price ?? 0).toFixed(2)}</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{f.period_ts ? new Date(String(f.period_ts)).toLocaleString() : ''}</Text>
                  </View>
                  {Boolean(f.user_id) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>User: {String(f.user_id).slice(0,12)}…</Text>}
                </View>
              );
            })}
          </>
        )}

        {/* ── Trading Pairs ── */}
        {activeTab === 'Trading Pairs' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {adminTradingPairs.length} configured pairs
            </Text>
            {loading && adminTradingPairs.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && adminTradingPairs.length === 0
              ? <EmptyState icon="💱" title="No trading pairs" subtitle="Trading pairs will appear here" />
              : null}
            {adminTradingPairs.map((pair, i) => {
              const isActive = String(pair.status_v2 ?? '') === 'active';
              const key = String(pair.symbol ?? i);
              return (
                <View key={key} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{String(pair.symbol ?? '')}</Text>
                      <View style={{ backgroundColor: isActive ? DS.color.buyBg : DS.color.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: isActive ? DS.color.buy : DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{isActive ? 'ACTIVE' : 'DISABLED'}</Text>
                      </View>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, textTransform: 'uppercase' }}>{String(pair.market_type_v2 ?? '')}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {String(pair.market_type_v2 ?? '') === 'spot' && (
                        <Pressable
                          disabled={pairToggling === `spot_${key}`}
                          onPress={async () => {
                            setPairToggling(`spot_${key}`);
                            try {
                              await supabase.from('trading_pairs').update({ is_spot_ok: !Boolean(pair.is_spot_ok) }).eq('symbol', pair.symbol);
                              await loadData();
                            } finally { setPairToggling(null); }
                          }}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: DS.radius.md,
                                   backgroundColor: Boolean(pair.is_spot_ok) ? DS.color.sellBg : DS.color.buyBg,
                                   borderWidth: 1, borderColor: Boolean(pair.is_spot_ok) ? DS.color.sell : DS.color.buy,
                                   opacity: pairToggling === `spot_${key}` ? 0.5 : 1 }}>
                          <Text style={{ color: Boolean(pair.is_spot_ok) ? DS.color.sell : DS.color.buy, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                            {pairToggling === `spot_${key}` ? '…' : Boolean(pair.is_spot_ok) ? 'Spot Off' : 'Spot On'}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        disabled={pairToggling === key}
                        onPress={async () => {
                          setPairToggling(key);
                          try {
                            const newStatus = isActive ? 'suspended' : 'active';
                            await supabase.from('trading_pairs').update({ status_v2: newStatus }).eq('symbol', pair.symbol);
                            await loadData();
                          } finally { setPairToggling(null); }
                        }}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: DS.radius.md,
                                 backgroundColor: isActive ? DS.color.sellBg : DS.color.buyBg,
                                 borderWidth: 1, borderColor: isActive ? DS.color.sell : DS.color.buy,
                                 opacity: pairToggling === key ? 0.5 : 1 }}>
                        <Text style={{ color: isActive ? DS.color.sell : DS.color.buy, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                          {pairToggling === key ? '…' : isActive ? 'Disable' : 'Enable'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Maker: <Text style={{ color: DS.color.text2 }}>{(Number(pair.maker_fee ?? 0) * 100).toFixed(2)}%</Text></Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Taker: <Text style={{ color: DS.color.text2 }}>{(Number(pair.taker_fee ?? 0) * 100).toFixed(2)}%</Text></Text>
                    {Number(pair.max_leverage ?? 0) > 1 && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Max Lev: <Text style={{ color: DS.color.gold }}>{Number(pair.max_leverage)}×</Text></Text>}
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Min Qty: <Text style={{ color: DS.color.text2 }}>{String(pair.min_qty ?? '')}</Text></Text>
                    {String(pair.market_type_v2 ?? '') === 'spot' && (
                      <View style={{ backgroundColor: Boolean(pair.is_spot_ok) ? DS.color.buyBg : DS.color.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ color: Boolean(pair.is_spot_ok) ? DS.color.buy : DS.color.sell, fontSize: DS.font.xxs }}>
                          {Boolean(pair.is_spot_ok) ? 'Spot ✓' : 'Spot ✗'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ── Trade Settings ── */}
        {activeTab === 'Trade Settings' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              {adminTradingSettings.length} global trading settings
            </Text>
            {loading && adminTradingSettings.length === 0 ? <SkeletonCard rows={4} /> : null}
            {!loading && adminTradingSettings.length === 0
              ? <EmptyState icon="⚙️" title="No settings" subtitle="Trading settings will appear here" />
              : null}
            {adminTradingSettings.map((s, i) => {
              const key       = String(s.key ?? i);
              const val       = s.value;
              const isBool    = typeof val === 'boolean';
              const isEnabled = isBool ? Boolean(val) : null;
              return (
                <View key={key} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>
                        {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </Text>
                      {Boolean(s.description) && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>{String(s.description)}</Text>}
                    </View>
                    {isBool ? (
                      <Pressable
                        disabled={togglingKey === key}
                        onPress={async () => {
                          setTogglingKey(key);
                          try {
                            await supabase.from('trading_settings').update({ value: !isEnabled }).eq('key', key);
                            await loadData();
                          } finally { setTogglingKey(null); }
                        }}
                        style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: DS.radius.md,
                                 backgroundColor: isEnabled ? DS.color.buyBg : DS.color.sellBg,
                                 borderWidth: 1, borderColor: isEnabled ? DS.color.buy : DS.color.sell,
                                 opacity: togglingKey === key ? 0.5 : 1 }}>
                        <Text style={{ color: isEnabled ? DS.color.buy : DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                          {togglingKey === key ? '…' : isEnabled ? 'ON' : 'OFF'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={{ color: DS.color.gold, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>
                        {val !== null && val !== undefined ? String(val) : '—'}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ── Provider APIs ── */}
        {activeTab === 'Provider APIs' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Exchange API credentials — stored securely server-side, never returned to the client
            </Text>

            {/* Global provider-tab error */}
            {providerError ? (
              <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{providerError}</Text>
                <Pressable onPress={async () => { setProviderError(''); setProviderLoading(true); try { const p = await ProviderAdapter.listProviderConfigs(); setProviderConfigs(p); } catch (e) { setProviderError(toUserMessage(e, 'Failed to load providers')); } finally { setProviderLoading(false); } }}><Text style={{ color: DS.color.sell, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>Retry</Text></Pressable>
              </View>
            ) : null}

            {/* Add / Edit form */}
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.md, borderWidth: 1, borderColor: DS.color.gold + '40' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: DS.space.sm }}>
                <Key size={16} color={DS.color.gold} />
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>
                  {editingProvider ? `Edit: ${editingProvider.label}` : 'Add Provider API'}
                </Text>
              </View>

              {[
                { field: 'provider_name', label: 'Provider',                          placeholder: 'binance' },
                { field: 'label',         label: 'Label',                             placeholder: 'Binance Main' },
                { field: 'api_key',       label: 'API Key',                           placeholder: editingProvider ? '(leave blank to keep existing)' : 'Enter API key' },
                { field: 'api_secret',    label: 'API Secret',                        placeholder: editingProvider ? '(leave blank to keep existing)' : 'Enter API secret' },
                { field: 'passphrase',    label: 'Passphrase (OKX/KuCoin only)',      placeholder: 'optional' },
                { field: 'permissions',   label: 'Permissions (comma-separated)',     placeholder: 'read,trade' },
                { field: 'notes',         label: 'Notes',                             placeholder: 'Optional notes' },
              ].map(({ field, label, placeholder }) => (
                <View key={field} style={{ marginBottom: DS.space.xs }}>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 3 }}>{label}</Text>
                  <TextInput
                    value={String(providerForm[field as keyof typeof providerForm] ?? '')}
                    onChangeText={v => setProviderForm(f => ({ ...f, [field]: v }))}
                    placeholder={placeholder}
                    placeholderTextColor={DS.color.text3}
                    secureTextEntry={field === 'api_key' || field === 'api_secret' || field === 'passphrase'}
                    style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, color: DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: DS.color.border }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}

              {/* Testnet toggle */}
              <Pressable
                onPress={() => setProviderForm(f => ({ ...f, is_testnet: !f.is_testnet }))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: DS.space.xs }}
              >
                <View style={{ width: 36, height: 20, borderRadius: 10, backgroundColor: providerForm.is_testnet ? DS.color.warn : DS.color.surface, borderWidth: 1, borderColor: providerForm.is_testnet ? DS.color.warn : DS.color.border, justifyContent: 'center', paddingHorizontal: 2 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: providerForm.is_testnet ? '#fff' : DS.color.text3, alignSelf: providerForm.is_testnet ? 'flex-end' : 'flex-start' }} />
                </View>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Testnet / Sandbox mode</Text>
              </Pressable>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: DS.space.xs }}>
                <Pressable
                  onPress={async () => {
                    if (!providerForm.provider_name.trim()) return;
                    setSavingProvider(true);
                    try {
                      const perms = providerForm.permissions.split(',').map(s => s.trim()).filter(Boolean);
                      await ProviderAdapter.upsertProviderConfig({
                        id:          editingProvider?.id,
                        providerName: providerForm.provider_name.trim(),
                        label:       providerForm.label.trim() || providerForm.provider_name.trim(),
                        apiKey:      providerForm.api_key,
                        apiSecret:   providerForm.api_secret,
                        passphrase:  providerForm.passphrase,
                        isTestnet:   providerForm.is_testnet,
                        permissions: perms,
                        notes:       providerForm.notes,
                      });
                      setEditingProvider(null);
                      setProviderForm({ provider_name: '', label: '', api_key: '', api_secret: '', passphrase: '', is_testnet: false, permissions: '', notes: '' });
                      setProviderLoading(true);
                      const fresh = await ProviderAdapter.listProviderConfigs();
                      setProviderConfigs(fresh);
                    } catch (e) { setProviderError(toUserMessage(e, 'Save failed')); }
                    finally { setSavingProvider(false); setProviderLoading(false); }
                  }}
                  style={{ flex: 1, backgroundColor: DS.color.gold, borderRadius: DS.radius.md, padding: DS.space.sm, alignItems: 'center', opacity: savingProvider ? 0.6 : 1 }}
                >
                  <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: DS.font.sm }}>
                    {savingProvider ? 'Saving…' : editingProvider ? 'Update' : 'Add API Key'}
                  </Text>
                </Pressable>
                {editingProvider && (
                  <Pressable
                    onPress={() => { setEditingProvider(null); setProviderForm({ provider_name: '', label: '', api_key: '', api_secret: '', passphrase: '', is_testnet: false, permissions: '', notes: '' }); }}
                    style={{ paddingHorizontal: 16, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}
                  >
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Cancel</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Provider list */}
            {providerLoading && providerConfigs.length === 0 ? <SkeletonCard rows={3} /> : null}
            {!providerLoading && !loading && providerConfigs.length === 0
              ? <EmptyState icon="🔑" title="No provider APIs configured" subtitle="Add your first exchange API key above" />
              : null}

            {providerConfigs.map(cfg => {
              const isActive    = cfg.isActive;
              const hColor      = { active: DS.color.buy, degraded: DS.color.warn, rate_limited: DS.color.warn, failed: DS.color.sell, disabled: DS.color.text3, unknown: DS.color.text3 }[cfg.healthStatus] ?? DS.color.text3;
              const testResult  = testResults[cfg.id];
              const syncResult  = syncResults[cfg.id];
              const isTesting   = testingConfigId === cfg.id;
              const isSyncing   = syncingConfigId === cfg.id;

              return (
                <View key={cfg.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.sm, borderWidth: 1, borderColor: isActive ? DS.color.buy + '40' : DS.color.border }}>
                  {/* Header row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <Globe size={15} color={isActive ? DS.color.buy : DS.color.text3} />
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm, flex: 1 }} numberOfLines={1}>{cfg.label}</Text>
                      <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: hColor + '60' }}>
                        <Text style={{ color: hColor, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{cfg.healthStatus.toUpperCase().replace('_', ' ')}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <Pressable
                        onPress={() => {
                          setEditingProvider(cfg);
                          setProviderForm({ provider_name: cfg.providerName, label: cfg.label, api_key: '', api_secret: '', passphrase: '', is_testnet: cfg.isTestnet, permissions: cfg.permissions.join(','), notes: cfg.notes });
                        }}
                        style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, paddingHorizontal: 10, paddingVertical: 5 }}
                      >
                        <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>Edit</Text>
                      </Pressable>
                      <Pressable
                        onPress={async () => { try { await ProviderAdapter.toggleProviderActive(cfg.id, !isActive); const p = await ProviderAdapter.listProviderConfigs(); setProviderConfigs(p); } catch (e) { setProviderError(toUserMessage(e, 'Toggle failed')); } }}
                        style={{ backgroundColor: isActive ? DS.color.sellBg : DS.color.buyBg, borderRadius: DS.radius.md, paddingHorizontal: 10, paddingVertical: 5 }}
                      >
                        <Text style={{ color: isActive ? DS.color.sell : DS.color.buy, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{isActive ? 'Disable' : 'Enable'}</Text>
                      </Pressable>
                      <Pressable
                        onPress={async () => { try { await ProviderAdapter.deleteProviderConfig(cfg.id); const p = await ProviderAdapter.listProviderConfigs(); setProviderConfigs(p); } catch (e) { setProviderError(toUserMessage(e, 'Delete failed')); } }}
                        style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, paddingHorizontal: 8, paddingVertical: 5 }}
                      >
                        <Trash2 size={12} color={DS.color.sell} />
                      </Pressable>
                    </View>
                  </View>

                  {/* Metadata */}
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
                    Provider: <Text style={{ color: DS.color.gold }}>{cfg.providerName}</Text>
                    {'  '}Key: <Text style={{ color: cfg.hasKey ? DS.color.text2 : DS.color.sell }}>{cfg.hasKey ? '••••••••' : 'Not set'}</Text>
                    {cfg.isTestnet ? <Text style={{ color: DS.color.warn }}>  TESTNET</Text> : null}
                  </Text>
                  {cfg.permissions.length > 0 && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Permissions: <Text style={{ color: DS.color.text2 }}>{cfg.permissions.join(', ')}</Text></Text>}
                  {cfg.avgResponseMs != null && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Avg latency: <Text style={{ color: DS.color.text2 }}>{cfg.avgResponseMs}ms</Text></Text>}
                  {cfg.errorCount > 0 && <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs }}>Errors: {cfg.errorCount}</Text>}
                  {cfg.lastSuccessAt && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>✓ <Text style={{ color: DS.color.buy }}>{new Date(cfg.lastSuccessAt).toLocaleString()}</Text></Text>}
                  {cfg.lastFailureAt && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>✗ <Text style={{ color: DS.color.sell }}>{new Date(cfg.lastFailureAt).toLocaleString()}</Text></Text>}
                  {cfg.syncError ? <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, marginTop: 2 }} numberOfLines={2}>⚠ {cfg.syncError}</Text> : null}
                  {cfg.lastSyncAt && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Last sync: {new Date(cfg.lastSyncAt).toLocaleString()}</Text>}
                  {cfg.notes ? <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>{cfg.notes}</Text> : null}

                  {/* Action buttons: Test + Sync */}
                  {cfg.hasKey && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: DS.space.sm }}>
                      <Pressable
                        disabled={isTesting || !isActive}
                        onPress={async () => {
                          setTestingConfigId(cfg.id);
                          setTestResults(r => ({ ...r, [cfg.id]: { error: '' } as { error: string } }));
                          try {
                            const res = await ProviderAdapter.testConnection(cfg.id);
                            setTestResults(r => ({ ...r, [cfg.id]: res }));
                            // Refresh health status
                            const p = await ProviderAdapter.listProviderConfigs();
                            setProviderConfigs(p);
                          } catch (e) {
                            setTestResults(r => ({ ...r, [cfg.id]: { error: toUserMessage(e, 'Connection test failed') } }));
                          } finally { setTestingConfigId(null); }
                        }}
                        style={{ flex: 1, backgroundColor: DS.color.infoBg, borderRadius: DS.radius.md, padding: DS.space.xs, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: (isTesting || !isActive) ? 0.5 : 1 }}
                      >
                        {isTesting ? <ActivityIndicator size="small" color={DS.color.info} /> : null}
                        <Text style={{ color: DS.color.info, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>Test Connection</Text>
                      </Pressable>
                    </View>
                  )}
                  {!cfg.hasKey && (
                    <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.sm }}>
                      <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>⚠ No API credentials — tap Edit to add keys</Text>
                    </View>
                  )}

                  {/* Test result */}
                  {testResult && (
                    <View style={{ backgroundColor: 'error' in testResult ? DS.color.sellBg : DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.xs }}>
                      {'error' in testResult && testResult.error
                        ? <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>✗ {testResult.error}</Text>
                        : !('error' in testResult) && testResult.ok
                          ? <>
                              <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>✓ Connection successful</Text>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Account: {testResult.accountType} · Latency: {testResult.latencyMs}ms</Text>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Permissions: {(testResult.permissions ?? []).join(', ') || 'none returned'}</Text>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Can trade: {testResult.canTrade ? 'Yes' : 'No'} · Can withdraw: {testResult.canWithdraw ? 'Yes' : 'No'}</Text>
                            </>
                          : null}
                    </View>
                  )}

                  {/* Sync result */}
                  {syncResult && (
                    <View style={{ backgroundColor: 'error' in syncResult ? DS.color.sellBg : DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.xs }}>
                      {'error' in syncResult && syncResult.error
                        ? <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>✗ {syncResult.error}</Text>
                        : !('error' in syncResult)
                          ? <>
                              <Text style={{ color: syncResult.ok ? DS.color.buy : DS.color.warn, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>{syncResult.ok ? '✓ Sync complete' : '⚠ Sync with warnings'}</Text>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Balances: {syncResult.balancesSynced} · Orders: {syncResult.ordersSynced} · Positions: {syncResult.positionsSynced}</Text>
                              {syncResult.warningsCreated > 0 && <Text style={{ color: DS.color.warn, fontSize: DS.font.xxs }}>⚠ {syncResult.warningsCreated} reconciliation warning{syncResult.warningsCreated !== 1 ? 's' : ''} created</Text>}
                              {syncResult.errors?.map((e, i) => <Text key={i} style={{ color: DS.color.sell, fontSize: DS.font.xxs }}>✗ {e}</Text>)}
                            </>
                          : null}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Reconciliation Warnings */}
            {reconWarnings.filter(w => !w.resolved).length > 0 && (
              <View style={{ marginTop: DS.space.sm }}>
                <Text style={{ color: DS.color.warn, fontSize: DS.font.xs, fontWeight: DS.font.bold, marginBottom: DS.space.xs }}>
                  ⚠ {reconWarnings.filter(w => !w.resolved).length} Unresolved Reconciliation Warning{reconWarnings.filter(w => !w.resolved).length !== 1 ? 's' : ''}
                </Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: DS.space.sm }}>
                  Provider balance differs from internal ledger. Ledger is the financial source of truth. These are observations only — no balance was changed.
                </Text>
                {reconWarnings.filter(w => !w.resolved).map(w => (
                  <View key={w.id} style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.warn + '40' }}>
                    <Text style={{ color: DS.color.warn, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>{w.asset} — {w.warningType.replace('_', ' ')}</Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Ledger: {w.ledgerBalance.toFixed(8)}  ·  Provider: {w.providerBalance.toFixed(8)}</Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Δ {w.delta > 0 ? '+' : ''}{w.delta.toFixed(8)}{w.deltaPct != null ? ` (${w.deltaPct.toFixed(2)}%)` : ''}</Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Provider: {w.providerName}  ·  {new Date(w.createdAt).toLocaleString()}</Text>
                    <Pressable
                      onPress={async () => { try { await ProviderAdapter.resolveReconWarning(w.id, 'Acknowledged by admin'); const fresh = await ProviderAdapter.listReconWarnings(50); setReconWarnings(fresh); } catch (e) { setProviderError(toUserMessage(e, 'Failed to resolve')); } }}
                      style={{ alignSelf: 'flex-start', backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4, borderWidth: 1, borderColor: DS.color.border }}
                    >
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Mark resolved</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── Match Log ── */}
        {activeTab === 'Match Log' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Last 100 order-matcher settlements • Engine runs every ~15 seconds via pg_cron
            </Text>
            {loading && matchLog.length === 0 ? <SkeletonCard rows={5} /> : null}
            {!loading && matchLog.length === 0
              ? <EmptyState icon="🔄" title="No matched orders yet" subtitle="The order-matcher engine is running. Matched limit orders will appear here." />
              : null}
            {matchLog.map((m, i) => {
              const qty   = Number(m.matched_qty ?? 0);
              const price = Number(m.match_price ?? 0);
              const notional = qty * price;
              const ts = m.created_at ? new Date(m.created_at as string).toLocaleString() : '—';
              return (
                <View key={String(m.id ?? i)} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{String(m.symbol ?? '—')}</Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{ts}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <View>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Qty</Text>
                      <Text style={{ color: DS.color.buy, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{qty.toFixed(6)}</Text>
                    </View>
                    <View>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Price</Text>
                      <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{price.toFixed(4)}</Text>
                    </View>
                    <View>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Notional</Text>
                      <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>${notional.toFixed(2)}</Text>
                    </View>
                    <View>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Fee (buy/sell)</Text>
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>{Number(m.fee_buy ?? 0).toFixed(6)} / {Number(m.fee_sell ?? 0).toFixed(4)}</Text>
                    </View>
                  </View>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 4 }}>
                    Buy: <Text style={{ color: DS.color.text2 }}>{String(m.buy_order_id ?? '').slice(0, 8)}…</Text>
                    {'  '}Sell: <Text style={{ color: DS.color.text2 }}>{String(m.sell_order_id ?? '').slice(0, 8)}…</Text>
                  </Text>
                </View>
              );
            })}
          </>
        )}

        {/* ── Reconciliation ── */}
        {activeTab === 'Reconciliation' && (
          <ReconciliationDashboard />
        )}

        {/* ── Unmatched Deposits ── */}
        {activeTab === 'Unmatched Deposits' && (
          <UnmatchedDeposits />
        )}

        {/* ── Binance Sync ── */}
        {activeTab === 'Binance Sync' && (
          <>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
              Reconcile provider data against internal ledger. Sync creates warnings — never overwrites user balances.
            </Text>

            {/* No credentials notice */}
            {!loading && providerConfigs.filter(c => c.providerName === 'binance').length === 0 && (
              <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.md, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
                <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.sm, marginBottom: 4 }}>No Binance API keys configured</Text>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
                  To enable Binance sync, go to the Provider APIs tab and add a Binance API key with read permission.
                </Text>
                <Pressable
                  onPress={() => setActiveTab('Provider APIs')}
                  style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, padding: DS.space.sm, alignItems: 'center' }}
                >
                  <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Go to Provider APIs →</Text>
                </Pressable>
              </View>
            )}

            {/* Per-config sync cards */}
            {providerConfigs.filter(c => c.providerName === 'binance').map(cfg => {
              const isSyncing  = syncingConfigId === cfg.id;
              const isTesting  = testingConfigId === cfg.id;
              const syncResult = syncResults[cfg.id];
              const testResult = testResults[cfg.id];
              const hColor     = { active: DS.color.buy, degraded: DS.color.warn, rate_limited: DS.color.warn, failed: DS.color.sell, disabled: DS.color.text3, unknown: DS.color.text3 }[cfg.healthStatus] ?? DS.color.text3;

              return (
                <View key={cfg.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.sm, borderWidth: 1, borderColor: cfg.syncError ? DS.color.sell + '40' : cfg.isActive ? DS.color.buy + '30' : DS.color.border }}>
                  {/* Header */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{cfg.label}</Text>
                      {cfg.isTestnet && <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ color: DS.color.warn, fontSize: DS.font.xxs }}>TESTNET</Text></View>}
                    </View>
                    <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: hColor + '60' }}>
                      <Text style={{ color: hColor, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{cfg.healthStatus.toUpperCase().replace('_', ' ')}</Text>
                    </View>
                  </View>

                  {/* Status rows */}
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Key: <Text style={{ color: cfg.hasKey ? DS.color.text2 : DS.color.sell }}>{cfg.hasKey ? '••••••••' : 'Not set'}</Text>
                    {'  '}Active: <Text style={{ color: cfg.isActive ? DS.color.buy : DS.color.sell }}>{cfg.isActive ? 'Yes' : 'No'}</Text>
                  </Text>
                  {cfg.lastSyncAt    && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Last sync:    <Text style={{ color: DS.color.text2 }}>{new Date(cfg.lastSyncAt).toLocaleString()}</Text></Text>}
                  {cfg.lastSuccessAt && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Last success: <Text style={{ color: DS.color.buy  }}>{new Date(cfg.lastSuccessAt).toLocaleString()}</Text></Text>}
                  {cfg.lastFailureAt && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Last failure: <Text style={{ color: DS.color.sell }}>{new Date(cfg.lastFailureAt).toLocaleString()}</Text></Text>}
                  {cfg.avgResponseMs != null && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Avg response: <Text style={{ color: DS.color.text2 }}>{cfg.avgResponseMs}ms</Text></Text>}
                  {cfg.errorCount > 0 && <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs }}>Error count: {cfg.errorCount}</Text>}
                  {cfg.syncError     && <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, marginTop: 2 }} numberOfLines={2}>⚠ {cfg.syncError}</Text>}

                  {cfg.hasKey ? (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: DS.space.sm }}>
                      {/* Test connection */}
                      <Pressable
                        disabled={isTesting || !cfg.isActive}
                        onPress={async () => {
                          setTestingConfigId(cfg.id);
                          try {
                            const res = await ProviderAdapter.testConnection(cfg.id);
                            setTestResults(r => ({ ...r, [cfg.id]: res }));
                            const fresh = await ProviderAdapter.listProviderConfigs();
                            setProviderConfigs(fresh);
                          } catch (e) {
                            setTestResults(r => ({ ...r, [cfg.id]: { error: toUserMessage(e, 'Test failed') } }));
                          } finally { setTestingConfigId(null); }
                        }}
                        style={{ flex: 1, backgroundColor: DS.color.infoBg, borderRadius: DS.radius.md, padding: DS.space.sm, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: (isTesting || !cfg.isActive) ? 0.5 : 1 }}
                      >
                        {isTesting ? <ActivityIndicator size="small" color={DS.color.info} /> : null}
                        <Text style={{ color: DS.color.info, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{isTesting ? 'Testing…' : 'Test Connection'}</Text>
                      </Pressable>
                      {/* Manual sync */}
                      <Pressable
                        disabled={isSyncing || !cfg.isActive || binanceSyncRunning}
                        onPress={async () => {
                          setSyncingConfigId(cfg.id); setBinanceSyncRunning(true);
                          try {
                            const res = await ProviderAdapter.runManualSync(cfg.id);
                            setSyncResults(r => ({ ...r, [cfg.id]: res }));
                            setBinanceSyncResult({ ok: res.ok, msg: `${cfg.label}: ${res.balancesSynced} bal, ${res.ordersSynced} orders, ${res.positionsSynced} pos${res.warningsCreated > 0 ? `, ${res.warningsCreated} warnings` : ''}` });
                            const [fresh, warns] = await Promise.all([
                              ProviderAdapter.listProviderConfigs(),
                              ProviderAdapter.listReconWarnings(50),
                            ]);
                            setProviderConfigs(fresh); setReconWarnings(warns);
                          } catch (e) {
                            const msg = toUserMessage(e, 'Sync failed');
                            setSyncResults(r => ({ ...r, [cfg.id]: { error: msg } }));
                            setBinanceSyncResult({ ok: false, msg });
                          } finally { setSyncingConfigId(null); setBinanceSyncRunning(false); }
                        }}
                        style={{ flex: 1, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, padding: DS.space.sm, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: (isSyncing || !cfg.isActive || binanceSyncRunning) ? 0.5 : 1 }}
                      >
                        {isSyncing ? <ActivityIndicator size="small" color={DS.color.gold} /> : null}
                        <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{isSyncing ? 'Syncing…' : 'Manual Sync'}</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.sm }}>
                      <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>⚠ No API credentials — tap Edit in Provider APIs tab to add keys</Text>
                    </View>
                  )}

                  {/* Test result inline */}
                  {testResult && (
                    <View style={{ backgroundColor: 'error' in testResult ? DS.color.sellBg : DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.xs }}>
                      {'error' in testResult && testResult.error
                        ? <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>✗ {testResult.error}</Text>
                        : !('error' in testResult) && testResult.ok
                          ? <>
                              <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>✓ Connected — {testResult.accountType} · {testResult.latencyMs}ms</Text>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Permissions: {(testResult.permissions ?? []).join(', ') || 'none returned'}</Text>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Trade: {testResult.canTrade ? 'Yes' : 'No'} · Withdraw: {testResult.canWithdraw ? 'Yes' : 'No'}</Text>
                            </>
                          : null}
                    </View>
                  )}

                  {/* Sync result inline */}
                  {syncResult && (
                    <View style={{ backgroundColor: 'error' in syncResult ? DS.color.sellBg : DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.xs }}>
                      {'error' in syncResult && syncResult.error
                        ? <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>✗ {syncResult.error}</Text>
                        : !('error' in syncResult)
                          ? <>
                              <Text style={{ color: syncResult.ok ? DS.color.buy : DS.color.warn, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>
                                {syncResult.ok ? '✓ Sync complete' : '⚠ Sync completed with errors'}
                              </Text>
                              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Balances: {syncResult.balancesSynced} · Orders: {syncResult.ordersSynced} · Positions: {syncResult.positionsSynced}</Text>
                              {syncResult.warningsCreated > 0 && (
                                <Text style={{ color: DS.color.warn, fontSize: DS.font.xxs }}>
                                  ⚠ {syncResult.warningsCreated} reconciliation warning{syncResult.warningsCreated !== 1 ? 's' : ''} — see Provider APIs tab
                                </Text>
                              )}
                              {syncResult.errors?.map((e, i) => <Text key={i} style={{ color: DS.color.sell, fontSize: DS.font.xxs }}>✗ {e}</Text>)}
                            </>
                          : null}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Last sync summary banner */}
            {binanceSyncResult && (
              <View style={{ backgroundColor: binanceSyncResult.ok ? DS.color.buyBg : DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm, borderWidth: 1, borderColor: binanceSyncResult.ok ? DS.color.buy + '40' : DS.color.sell + '40' }}>
                <Text style={{ color: binanceSyncResult.ok ? DS.color.buy : DS.color.sell, fontSize: DS.font.xs }}>{binanceSyncResult.msg}</Text>
              </View>
            )}

            {/* Reconciliation warning summary */}
            {reconWarnings.filter(w => !w.resolved).length > 0 && (
              <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.xl, padding: DS.space.md, marginTop: DS.space.sm, borderWidth: 1, borderColor: DS.color.warn + '40' }}>
                <Text style={{ color: DS.color.warn, fontWeight: DS.font.bold, fontSize: DS.font.sm, marginBottom: 4 }}>
                  ⚠ {reconWarnings.filter(w => !w.resolved).length} unresolved reconciliation warning{reconWarnings.filter(w => !w.resolved).length !== 1 ? 's' : ''}
                </Text>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs, marginBottom: DS.space.xs }}>
                  Ledger is source of truth. These warnings are observations only — no user balances were changed. Review and resolve in Provider APIs tab.
                </Text>
                {reconWarnings.filter(w => !w.resolved).slice(0, 5).map(w => (
                  <Text key={w.id} style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>
                    • {w.asset}: ledger {w.ledgerBalance.toFixed(6)} vs provider {w.providerBalance.toFixed(6)} (Δ {w.delta > 0 ? '+' : ''}{w.delta.toFixed(6)})
                  </Text>
                ))}
              </View>
            )}

            {/* Scheduled jobs */}
            <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xl, padding: DS.space.md, marginTop: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm, marginBottom: 6 }}>Scheduled Jobs (pg_cron)</Text>
              {[
                { fn: 'liquidation-monitor', freq: 'Every 30 seconds' },
                { fn: 'order-matcher',        freq: 'Every 15 seconds' },
                { fn: 'binance-sync',         freq: 'Every 1 minute'  },
              ].map(job => (
                <View key={job.fn} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                  <View>
                    <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{job.fn}</Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{job.freq}</Text>
                  </View>
                  <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: DS.color.buy, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>RUNNING</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

      </ScrollView>
    </View>
  );
}
