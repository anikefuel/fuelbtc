// Admin Reconciliation Dashboard
// Shows Binance vs internal ledger mismatches, provider status, and resolve actions.
// Reachable from admin/index.tsx "Reconciliation" tab → router.push.

import { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  AlertTriangle, CheckCircle, RefreshCw, XCircle, Wifi, WifiOff,
  Clock, ChevronDown, ChevronUp, Filter, Play, Shield,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { ProviderAdapter } from '@/services';
import type { ReconciliationWarning } from '@/services/provider-adapter.service';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ProviderStatusRow {
  configId: string;
  label: string;
  status: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  spotEnabled: boolean;
  futuresEnabled: boolean;
  latencyMs: number | null;
  lastCheckedAt: string;
  errorMessage: string | null;
}

type WarningFilter = 'all' | 'unresolved' | 'balance_mismatch' | 'unknown_deposit' | 'withdrawal_status_mismatch' | 'missing_transaction';

const WARNING_TYPE_LABELS: Record<string, string> = {
  balance_mismatch:              'Balance Mismatch',
  unknown_deposit:               'Unknown Deposit',
  withdrawal_status_mismatch:    'Withdrawal Mismatch',
  missing_transaction:           'Missing Transaction',
  duplicate_transaction:         'Duplicate Transaction',
  order_mismatch:                'Order Mismatch',
  position_mismatch:             'Position Mismatch',
};

const STATUS_COLOR: Record<string, string> = {
  connected:          DS.color.buy,
  auth_failed:        DS.color.sell,
  missing_permission: DS.color.warn,
  rate_limited:       DS.color.warn,
  degraded:           DS.color.warn,
  disabled:           DS.color.text3,
  unknown:            DS.color.text3,
};

function fmt(n: number, decimals = 4) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
function fmtPct(n: number | null) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Provider Status Card ─────────────────────────────────────────────────────
function ProviderStatusCard({
  row, onTestConnection,
}: { row: ProviderStatusRow; onTestConnection: () => void }) {
  const color = STATUS_COLOR[row.status] ?? DS.color.text3;
  const Icon  = row.status === 'connected' ? Wifi : WifiOff;
  return (
    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: DS.space.sm }}>
        <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: color + '20', alignItems: 'center', justifyContent: 'center', marginRight: DS.space.sm }}>
          <Icon size={18} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{row.label}</Text>
          <Text style={{ color, fontSize: DS.font.xxs, textTransform: 'capitalize', marginTop: 2 }}>
            {row.status.replace(/_/g, ' ')}
            {row.latencyMs != null && ` · ${row.latencyMs}ms`}
          </Text>
        </View>
        <Pressable onPress={onTestConnection} style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingHorizontal: DS.space.sm, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={13} color={DS.color.text2} />
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Test</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[
          { label: 'Deposit',  enabled: row.depositEnabled },
          { label: 'Withdraw', enabled: row.withdrawEnabled },
          { label: 'Spot',     enabled: row.spotEnabled },
          { label: 'Futures',  enabled: row.futuresEnabled },
        ].map(p => (
          <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: p.enabled ? DS.color.buyBg : DS.color.surface, borderRadius: DS.radius.full, paddingHorizontal: 8, paddingVertical: 3 }}>
            {p.enabled
              ? <CheckCircle size={11} color={DS.color.buy} />
              : <XCircle    size={11} color={DS.color.text3} />}
            <Text style={{ color: p.enabled ? DS.color.buy : DS.color.text3, fontSize: DS.font.xxs }}>{p.label}</Text>
          </View>
        ))}
      </View>
      {row.errorMessage && (
        <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, marginTop: DS.space.xs }}>⚠ {row.errorMessage}</Text>
      )}
      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 4 }}>
        Last checked {timeAgo(row.lastCheckedAt)}
      </Text>
    </View>
  );
}

// ─── Warning Row ──────────────────────────────────────────────────────────────
function WarningRow({
  w, onResolve,
}: { w: ReconciliationWarning; onResolve: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const deltaColor = Math.abs(w.delta) > 0
    ? (w.delta > 0 ? DS.color.buy : DS.color.sell)
    : DS.color.text3;

  return (
    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, marginBottom: DS.space.xs, borderWidth: 1, borderColor: w.resolved ? DS.color.border : DS.color.sell + '40', overflow: 'hidden' }}>
      <Pressable onPress={() => setExpanded(e => !e)} style={{ padding: DS.space.md, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: w.resolved ? DS.color.buy : DS.color.sell, marginRight: DS.space.sm }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>
            {WARNING_TYPE_LABELS[w.warningType] ?? w.warningType}
            {' · '}<Text style={{ color: DS.color.text2 }}>{w.asset}</Text>
          </Text>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>{timeAgo(w.createdAt)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', marginRight: DS.space.sm }}>
          <Text style={{ color: deltaColor, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>
            {fmtPct(w.deltaPct)}
          </Text>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Δ {fmt(Math.abs(w.delta), 6)}</Text>
        </View>
        {expanded ? <ChevronUp size={15} color={DS.color.text3} /> : <ChevronDown size={15} color={DS.color.text3} />}
      </Pressable>

      {expanded && (
        <View style={{ paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, borderTopWidth: 1, borderTopColor: DS.color.border }}>
          <View style={{ flexDirection: 'row', gap: DS.space.md, marginTop: DS.space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Internal Ledger</Text>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>{fmt(w.ledgerBalance, 8)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Provider Balance</Text>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>{fmt(w.providerBalance, 8)}</Text>
            </View>
          </View>
          {w.details && (
            <View style={{ marginTop: DS.space.sm, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, fontFamily: 'monospace' }} numberOfLines={4}>
                {JSON.stringify(w.details, null, 2)}
              </Text>
            </View>
          )}
          {!w.resolved && (
            <Pressable onPress={() => onResolve(w.id)} style={{ marginTop: DS.space.sm, backgroundColor: DS.color.buy + '20', borderRadius: DS.radius.md, paddingVertical: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              <CheckCircle size={14} color={DS.color.buy} />
              <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Mark Resolved</Text>
            </Pressable>
          )}
          {w.resolved && (
            <View style={{ marginTop: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CheckCircle size={12} color={DS.color.buy} />
              <Text style={{ color: DS.color.buy, fontSize: DS.font.xxs }}>Resolved</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Resolve Modal ────────────────────────────────────────────────────────────
function ResolveModal({
  warningId, onClose, onDone,
}: { warningId: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!note.trim()) { setErr('Resolution note is required'); return; }
    setSaving(true); setErr('');
    try {
      await ProviderAdapter.resolveReconWarning(warningId, note.trim());
      onDone();
    } catch (e) {
      setErr(toUserMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: '#000000aa', justifyContent: 'center', paddingHorizontal: DS.space.lg } as never}>
      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.lg }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.md, marginBottom: DS.space.sm }}>Resolve Warning</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add resolution note..."
          placeholderTextColor={DS.color.text3}
          multiline
          numberOfLines={3}
          style={{ backgroundColor: DS.color.surface, color: DS.color.text1, borderRadius: DS.radius.md, padding: DS.space.sm, fontSize: DS.font.sm, minHeight: 80, textAlignVertical: 'top', marginBottom: DS.space.sm }}
        />
        {err !== '' && <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>{err}</Text>}
        <View style={{ flexDirection: 'row', gap: DS.space.sm }}>
          <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingVertical: 11, alignItems: 'center' }}>
            <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={submit} disabled={saving} style={{ flex: 1, backgroundColor: DS.color.buy, borderRadius: DS.radius.md, paddingVertical: 11, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: DS.font.bold }}>Confirm</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ReconciliationDashboard() {
  const [loading, setLoading]                   = useState(true);
  const [refreshing, setRefreshing]             = useState(false);
  const [warnings, setWarnings]                 = useState<ReconciliationWarning[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatusRow[]>([]);
  const [filter, setFilter]                     = useState<WarningFilter>('unresolved');
  const [resolveId, setResolveId]               = useState<string | null>(null);
  const [syncLoading, setSyncLoading]           = useState(false);
  const [syncMsg, setSyncMsg]                   = useState('');
  const [error, setError]                       = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [warningData, statusData] = await Promise.allSettled([
        ProviderAdapter.listReconWarnings(100),
        loadProviderStatuses(),
      ]);
      if (warningData.status === 'fulfilled') setWarnings(warningData.value);
      if (statusData.status  === 'fulfilled') setProviderStatuses(statusData.value);
    } catch (e) { setError(toUserMessage(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const filtered = warnings.filter(w => {
    if (filter === 'unresolved') return !w.resolved;
    if (filter === 'all') return true;
    return w.warningType === filter;
  });

  const unresolvedCount = warnings.filter(w => !w.resolved).length;

  const runSync = async () => {
    setSyncLoading(true); setSyncMsg('');
    try {
      // Trigger provider-action sync-deposits + sync-withdrawals for each config
      const { data: configs } = await supabase
        .from('exchange_provider_configs')
        .select('id, label')
        .eq('provider_name', 'binance')
        .eq('is_active', true);

      if (!configs || configs.length === 0) {
        setSyncMsg('No active Binance configs found'); return;
      }

      let totalDeposits = 0; let totalWithdrawals = 0;
      for (const cfg of configs as { id: string; label: string }[]) {
        const [dep, wd] = await Promise.allSettled([
          supabase.functions.invoke('provider-action', { body: { action: 'sync-deposits',    configId: cfg.id } }),
          supabase.functions.invoke('provider-action', { body: { action: 'sync-withdrawals', configId: cfg.id } }),
        ]);
        if (dep.status === 'fulfilled' && dep.value.data?.credited) totalDeposits    += dep.value.data.credited;
        if (wd.status  === 'fulfilled' && wd.value.data?.updated)   totalWithdrawals += wd.value.data.updated;
      }

      // Run internal reconciliation RPC — use then/catch pattern (no .catch on RPC builder)
      for (const cfg of configs as { id: string; label: string }[]) {
        const reconResult = supabase.rpc('run_reconciliation', { p_config_id: cfg.id, p_provider_name: 'binance' });
        await reconResult.then(() => null, () => null);
      }

      setSyncMsg(`Sync complete · ${totalDeposits} deposits credited · ${totalWithdrawals} withdrawals updated`);
      await load();
    } catch (e) {
      setSyncMsg(toUserMessage(e));
    } finally { setSyncLoading(false); }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={DS.color.buy} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={DS.color.buy} />}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: DS.space.md, paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: DS.space.md }}>
          <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.buy + '20', alignItems: 'center', justifyContent: 'center', marginRight: DS.space.sm }}>
            <Shield size={18} color={DS.color.buy} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.extrabold, fontSize: DS.font.lg }}>Reconciliation</Text>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
              Binance vs internal ledger · {unresolvedCount} unresolved warning{unresolvedCount !== 1 ? 's' : ''}
            </Text>
          </View>
          <Pressable
            onPress={runSync}
            disabled={syncLoading}
            style={{ backgroundColor: DS.color.buy, borderRadius: DS.radius.md, paddingHorizontal: DS.space.sm, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: syncLoading ? 0.6 : 1 }}
          >
            {syncLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Play size={13} color="#fff" />}
            <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Sync</Text>
          </Pressable>
        </View>

        {syncMsg !== '' && (
          <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.lg, padding: DS.space.sm, marginBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CheckCircle size={14} color={DS.color.buy} />
            <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, flex: 1 }}>{syncMsg}</Text>
          </View>
        )}

        {error !== '' && (
          <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.lg, padding: DS.space.sm, marginBottom: DS.space.sm }}>
            <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
          </View>
        )}

        {/* Provider Status */}
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: DS.space.sm, textTransform: 'uppercase', letterSpacing: 0.8 }}>Provider Status</Text>
        {providerStatuses.length === 0 && (
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.md, alignItems: 'center' }}>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.sm }}>No provider status available — run a connection test first</Text>
          </View>
        )}
        {providerStatuses.map(row => (
          <ProviderStatusCard key={row.configId} row={row} onTestConnection={async () => {
            try {
              await supabase.functions.invoke('provider-action', { body: { action: 'test-connection', configId: row.configId } });
              await load();
            } catch { /* ignore */ }
          }} />
        ))}

        {/* Stats bar */}
        <View style={{ flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.md }}>
          {[
            { label: 'Total Warnings', value: warnings.length, color: DS.color.text1 },
            { label: 'Unresolved',     value: unresolvedCount,  color: unresolvedCount > 0 ? DS.color.sell : DS.color.buy },
            { label: 'Resolved',       value: warnings.filter(w => w.resolved).length, color: DS.color.buy },
          ].map(s => (
            <View key={s.label} style={{ flex: 1, backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border, alignItems: 'center' }}>
              <Text style={{ color: s.color, fontSize: DS.font.lg, fontWeight: DS.font.extrabold }}>{s.value}</Text>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Filter chips */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: DS.space.sm, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 }}>
            <Filter size={13} color={DS.color.text3} />
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Filter:</Text>
          </View>
          {(['unresolved', 'all', 'balance_mismatch', 'unknown_deposit', 'withdrawal_status_mismatch'] as WarningFilter[]).map(f => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={{ backgroundColor: filter === f ? DS.color.buy : DS.color.surface, borderRadius: DS.radius.full, paddingHorizontal: 10, paddingVertical: 4 }}
            >
              <Text style={{ color: filter === f ? '#fff' : DS.color.text2, fontSize: DS.font.xxs, fontWeight: filter === f ? DS.font.bold : '400' }}>
                {f === 'all' ? 'All' : f === 'unresolved' ? 'Unresolved' : WARNING_TYPE_LABELS[f] ?? f}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Warning list */}
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: DS.space.sm, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Warnings ({filtered.length})
        </Text>

        {filtered.length === 0 && (
          <EmptyState title="No warnings" subtitle={filter === 'unresolved' ? 'All reconciliation warnings are resolved.' : 'No warnings match this filter.'} />
        )}

        {filtered.map(w => (
          <WarningRow key={w.id} w={w} onResolve={id => setResolveId(id)} />
        ))}
      </ScrollView>

      {/* Resolve modal */}
      {resolveId != null && (
        <ResolveModal
          warningId={resolveId}
          onClose={() => setResolveId(null)}
          onDone={() => { setResolveId(null); load(); }}
        />
      )}
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function loadProviderStatuses(): Promise<ProviderStatusRow[]> {
  const { data, error } = await supabase
    .from('wallet_provider_status')
    .select('*, exchange_provider_configs!config_id(id, label, provider_name)')
    .order('last_checked_at', { ascending: false });
  if (error || !data) return [];
  return data.map(r => {
    const cfg = r.exchange_provider_configs as Record<string, unknown> | null;
    return {
      configId:        r.config_id as string,
      label:           (cfg?.label as string) ?? 'Unknown',
      status:          (r.status as string) ?? 'unknown',
      depositEnabled:  Boolean(r.deposit_enabled),
      withdrawEnabled: Boolean(r.withdraw_enabled),
      spotEnabled:     Boolean(r.spot_enabled),
      futuresEnabled:  Boolean(r.futures_enabled),
      latencyMs:       r.latency_ms != null ? Number(r.latency_ms) : null,
      lastCheckedAt:   r.last_checked_at as string,
      errorMessage:    r.error_message as string | null,
    };
  });
}
