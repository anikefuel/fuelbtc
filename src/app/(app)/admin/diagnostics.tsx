// Provider Engine Diagnostics — Admin screen
// Shows real-time health, cache stats, execution logs, per-provider status,
// AND a Binance API tab that runs authenticated wallet health checks.

import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, FlatList, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft, RefreshCw, CheckCircle, XCircle, Clock, Zap,
  Database, Activity, AlertTriangle, Wifi, WifiOff, Shield, Radio,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import { supabase } from '@/client/supabase';
import { marketStream } from '@/services/marketStream.service';
import type { StreamHealth } from '@/services/marketStream.service';

// Import engine singletons
import { providerManager } from '@/engine/ProviderManager';
import { engineCache } from '@/engine/cache';
import { engineLogger } from '@/engine/logger';
import { PROVIDER_CONFIGS } from '@/engine/config';
import type { ProviderHealth } from '@/engine/types';

const C = DS.color;

type DiagTab = 'Health' | 'Cache' | 'Logs' | 'Config' | 'Binance API' | 'Market Data';

interface CacheStatsSnapshot {
  hits: number;
  misses: number;
  entries: number;
  expirations: number;
  hitRate: string;
}

function HealthBadge({ online }: { online: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: online ? '#0ECB8118' : '#F6465D18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
      {online ? <Wifi size={11} color="#0ECB81" /> : <WifiOff size={11} color="#F6465D" />}
      <Text style={{ color: online ? '#0ECB81' : '#F6465D', fontSize: 11, fontWeight: '700' }}>
        {online ? 'ONLINE' : 'OFFLINE'}
      </Text>
    </View>
  );
}

function ErrorRateBar({ rate }: { rate: number }) {
  const pct = Math.min(rate * 100, 100);
  const color = pct > 30 ? '#F6465D' : pct > 10 ? '#F0B90B' : '#0ECB81';
  return (
    <View style={{ height: 4, backgroundColor: C.surface, borderRadius: 2, flex: 1 }}>
      <View style={{ height: 4, width: `${pct}%`, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

function ProviderCard({ health }: { health: ProviderHealth }) {
  const config = PROVIDER_CONFIGS.find(c => c.id === health.providerId);
  const displayName = config?.name ?? health.providerId;

  const fmtTime = (ms: number | null) => ms ? `${ms.toLocaleString()} ms` : '—';
  const fmtDate = (epoch: number | null) => epoch
    ? new Date(epoch).toLocaleTimeString()
    : 'Never';

  return (
    <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: health.online ? `${C.gold}33` : '#F6465D33' }}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text1, fontWeight: '700', fontSize: 14 }}>{displayName}</Text>
          <Text style={{ color: C.text2, fontSize: 11, marginTop: 1 }}>
            Priority {config?.priority ?? '—'} · Timeout {(config?.timeoutMs ?? 0) / 1000}s · TTL {((config?.cacheTtlMs ?? 0) / 1000)}s
          </Text>
        </View>
        <HealthBadge online={health.online} />
      </View>

      {/* Metrics grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <View style={{ backgroundColor: C.surface, borderRadius: 8, padding: 8, flex: 1, minWidth: '44%' }}>
          <Text style={{ color: C.text2, fontSize: 10, marginBottom: 3 }}>Avg Response</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Clock size={11} color={C.gold} />
            <Text style={{ color: C.text1, fontWeight: '700', fontSize: 13 }}>{fmtTime(health.avgResponseMs)}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: C.surface, borderRadius: 8, padding: 8, flex: 1, minWidth: '44%' }}>
          <Text style={{ color: C.text2, fontSize: 10, marginBottom: 3 }}>Total Requests</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Activity size={11} color={C.gold} />
            <Text style={{ color: C.text1, fontWeight: '700', fontSize: 13 }}>{health.totalRequests.toLocaleString()}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: C.surface, borderRadius: 8, padding: 8, flex: 1, minWidth: '44%' }}>
          <Text style={{ color: C.text2, fontSize: 10, marginBottom: 3 }}>Total Errors</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <XCircle size={11} color={health.totalErrors > 0 ? '#F6465D' : C.text2} />
            <Text style={{ color: health.totalErrors > 0 ? '#F6465D' : C.text1, fontWeight: '700', fontSize: 13 }}>{health.totalErrors}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: C.surface, borderRadius: 8, padding: 8, flex: 1, minWidth: '44%' }}>
          <Text style={{ color: C.text2, fontSize: 10, marginBottom: 3 }}>Rate Limit Hits</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={11} color={health.rateLimitHits > 0 ? '#F0B90B' : C.text2} />
            <Text style={{ color: health.rateLimitHits > 0 ? '#F0B90B' : C.text1, fontWeight: '700', fontSize: 13 }}>{health.rateLimitHits}</Text>
          </View>
        </View>
      </View>

      {/* Error rate bar */}
      <View style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ color: C.text2, fontSize: 10 }}>Error Rate</Text>
          <Text style={{ color: C.text2, fontSize: 10 }}>{(health.errorRate * 100).toFixed(1)}%</Text>
        </View>
        <ErrorRateBar rate={health.errorRate} />
      </View>

      {/* Last seen */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <CheckCircle size={11} color="#0ECB81" />
          <Text style={{ color: C.text2, fontSize: 11 }}>Last OK: {fmtDate(health.lastSuccess)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <XCircle size={11} color="#F6465D" />
          <Text style={{ color: C.text2, fontSize: 11 }}>Last Err: {fmtDate(health.lastFailure)}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Binance API check types ──────────────────────────────────────────────────
interface BinanceCheckResult {
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  binanceCode?: number;
  status?: string;
  error?: string;
}

interface IpProbe {
  attempt:   number;
  ip:        string | null;
  source:    string;
  latencyMs: number;
}

interface BinanceDiagResult {
  outbound_ip: {
    current:      string | null;
    all_observed: string[];
    is_static:    boolean | null;
    probe_count:  number;
    probes:       IpProbe[];
    note:         string;
  };
  credentials: {
    api_key_present:    boolean;
    api_secret_present: boolean;
    configured_via:     string;
  };
  checks: {
    public_market:   BinanceCheckResult;
    account:         BinanceCheckResult;
    wallet_balance:  BinanceCheckResult;
    deposit_address: BinanceCheckResult;
    deposit_history: BinanceCheckResult;
    withdraw_perm:   BinanceCheckResult;
  };
  summary: {
    all_ok:              boolean;
    has_creds:           boolean;
    ip_restricted:       boolean;
    current_outbound_ip: string | null;
    ip_stability:        'stable_this_session' | 'dynamic' | 'inconclusive';
  };
  recommendation: string;
}

const BINANCE_CHECKS: { key: keyof BinanceDiagResult['checks']; label: string; desc: string }[] = [
  { key: 'public_market',   label: 'Public Market Endpoint',     desc: 'GET /api/v3/ping — no auth required' },
  { key: 'account',         label: 'Authenticated Account',      desc: 'GET /sapi/v1/account/info — requires valid API key' },
  { key: 'wallet_balance',  label: 'Wallet Balance',             desc: 'GET /sapi/v3/asset/getUserAsset — requires wallet read permission' },
  { key: 'deposit_address', label: 'Deposit Address (USDT/ETH)', desc: 'GET /sapi/v1/capital/deposit/address — tests capital read' },
  { key: 'deposit_history', label: 'Deposit History',            desc: 'GET /sapi/v1/capital/deposit/hisrec — tests capital history' },
  { key: 'withdraw_perm',   label: 'Withdrawal Permission',      desc: 'GET /sapi/v1/capital/withdraw/history — no actual withdrawal' },
];

function BinanceCheckRow({ label, desc, result }: { label: string; desc: string; result?: BinanceCheckResult }) {
  if (!result) return null;
  const ok = result.ok;
  const statusText = result.status ?? (ok ? '✅ Connected' : '❌ Error');
  const statusColor = ok ? '#0ECB81' : result.status?.includes('Rate') ? '#F0B90B' : '#F6465D';
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: ok ? '#0ECB8130' : '#F6465D30' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ marginTop: 2 }}>
          {ok
            ? <CheckCircle size={16} color="#0ECB81" />
            : <XCircle size={16} color={statusColor} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text1, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>{label}</Text>
          <Text style={{ color: C.text3, fontSize: 11, marginBottom: 6 }}>{desc}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Text style={{ color: statusColor, fontSize: 12, fontWeight: '600' }}>{statusText}</Text>
            {result.latencyMs > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Clock size={11} color={C.text3} />
                <Text style={{ color: C.text3, fontSize: 11 }}>{result.latencyMs} ms</Text>
              </View>
            )}
            {result.httpStatus && (
              <Text style={{ color: C.text3, fontSize: 11 }}>HTTP {result.httpStatus}</Text>
            )}
            {result.binanceCode && result.binanceCode !== 0 && (
              <Text style={{ color: C.text3, fontSize: 11 }}>Code {result.binanceCode}</Text>
            )}
          </View>
          {!ok && result.error && (
            <Text style={{ color: '#F6465D', fontSize: 11, marginTop: 6, lineHeight: 16 }}>{result.error}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

export default function DiagnosticsScreen() {
  const router = useRouter();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<DiagTab>(
    (tabParam as DiagTab | undefined) ?? 'Health'
  );
  const [healthData, setHealthData] = useState<ProviderHealth[]>([]);
  const [cacheStats, setCacheStats] = useState<CacheStatsSnapshot>({ hits: 0, misses: 0, entries: 0, expirations: 0, hitRate: '0%' });
  const [logSummary, setLogSummary] = useState<Record<string, { total: number; success: number; failed: number; timeout: number; avgDurationMs: number }>>({});
  const [recentErrors, setRecentErrors] = useState<{ id: string; providerId: string; checkerType: string; errorMessage: string | null; durationMs: number | null }[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<string>('—');

  // Binance diagnostics state
  const [binanceResult, setBinanceResult]   = useState<BinanceDiagResult | null>(null);
  const [binanceLoading, setBinanceLoading] = useState(false);
  const [binanceError, setBinanceError]     = useState('');
  const [binanceRanAt, setBinanceRanAt]     = useState('—');

  // Market stream health state
  const [streamHealth, setStreamHealth] = useState<StreamHealth>(marketStream.getHealth());
  const [cachedPrices, setCachedPrices] = useState(marketStream.getAllCachedPrices());

  // Subscribe to stream health updates
  useEffect(() => {
    const unsub = marketStream.subscribeHealth((h) => {
      setStreamHealth(h);
      setCachedPrices(marketStream.getAllCachedPrices());
    });
    return () => unsub();
  }, []);

  const runBinanceDiag = useCallback(async () => {
    setBinanceLoading(true);
    setBinanceError('');
    try {
      const { data, error } = await supabase.functions.invoke('binance-diagnostics', { body: {} });
      if (error) {
        let msg = error.message ?? 'Diagnostics request failed';
        const ctx = (error as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try { const b = await ctx.json() as { error?: string }; if (b?.error) msg = b.error; } catch { /* keep */ }
        }
        setBinanceError(msg);
      } else {
        setBinanceResult(data as BinanceDiagResult);
        setBinanceRanAt(new Date().toLocaleTimeString());
      }
    } catch (e) {
      setBinanceError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBinanceLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setHealthData(providerManager.getAllHealth());
    const raw = engineCache.getStats();
    const total = raw.hits + raw.misses;
    setCacheStats({
      ...raw,
      hitRate: total > 0 ? `${((raw.hits / total) * 100).toFixed(1)}%` : '0%',
    });
    setLogSummary(engineLogger.summary());
    setRecentErrors(
      engineLogger.errors().slice(0, 15).map(e => ({
        id: e.id,
        providerId: e.providerId,
        checkerType: e.checkerType,
        errorMessage: e.errorMessage,
        durationMs: e.durationMs,
      }))
    );
    setCachedPrices(marketStream.getAllCachedPrices());
    setLastRefreshed(new Date().toLocaleTimeString());
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const registered = providerManager.listRegistered();
  const active = PROVIDER_CONFIGS.filter(c => c.enabled && registered.includes(c.id));
  const disabled = PROVIDER_CONFIGS.filter(c => !c.enabled || !registered.includes(c.id));

  // Stream health display helpers
  const streamStateColor = streamHealth.state === 'live' ? '#0ECB81'
    : streamHealth.state === 'reconnecting' ? '#F0B90B'
    : streamHealth.state === 'rest_fallback' ? '#F0B90B'
    : '#F6465D';
  const streamStateLabel = streamHealth.state === 'live' ? 'LIVE'
    : streamHealth.state === 'connecting' ? 'CONNECTING'
    : streamHealth.state === 'reconnecting' ? 'RECONNECTING'
    : streamHealth.state === 'rest_fallback' ? 'REST FALLBACK'
    : 'DISCONNECTED';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <ArrowLeft size={22} color={C.text1} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text1, fontWeight: '800', fontSize: 18 }}>Provider Engine</Text>
          <Text style={{ color: C.text2, fontSize: 11 }}>Last updated: {lastRefreshed}</Text>
        </View>
        <Pressable onPress={refresh} style={{ padding: 8, backgroundColor: `${C.gold}22`, borderRadius: 10 }}>
          <RefreshCw size={16} color={C.gold} />
        </Pressable>
      </View>

      {/* Summary banner */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: '#0ECB8115', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#0ECB8130' }}>
          <Text style={{ color: '#0ECB81', fontSize: 18, fontWeight: '800' }}>{active.length}</Text>
          <Text style={{ color: C.text2, fontSize: 10 }}>Active</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#F6465D15', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#F6465D30' }}>
          <Text style={{ color: '#F6465D', fontSize: 18, fontWeight: '800' }}>{disabled.length}</Text>
          <Text style={{ color: C.text2, fontSize: 10 }}>Disabled</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: `${C.gold}15`, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: `${C.gold}30` }}>
          <Text style={{ color: C.gold, fontSize: 18, fontWeight: '800' }}>{cacheStats.entries}</Text>
          <Text style={{ color: C.text2, fontSize: 10 }}>Cached</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#F0B90B15', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#F0B90B30' }}>
          <Text style={{ color: '#F0B90B', fontSize: 18, fontWeight: '800' }}>{recentErrors.length}</Text>
          <Text style={{ color: C.text2, fontSize: 10 }}>Errors</Text>
        </View>
      </View>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}>
          {(['Health', 'Cache', 'Logs', 'Config', 'Binance API', 'Market Data'] as DiagTab[]).map(t => (
            <Pressable
              key={t}
              onPress={() => setActiveTab(t)}
              style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: activeTab === t ? C.gold : 'transparent', borderWidth: 1, borderColor: activeTab === t ? C.gold : C.border }}
            >
              <Text style={{ color: activeTab === t ? '#fff' : C.text2, fontSize: 12, fontWeight: '600' }}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        {/* ── HEALTH TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'Health' && (
          <>
            {healthData.length === 0 ? (
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Zap size={40} color={C.text2} />
                <Text style={{ color: C.text2, fontSize: 14, marginTop: 12 }}>No health data yet</Text>
                <Text style={{ color: C.text2, fontSize: 12, marginTop: 4, textAlign: 'center' }}>Execute a provider request to populate metrics</Text>
                <Pressable onPress={refresh} style={{ marginTop: 16, backgroundColor: C.gold, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 }}>
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Refresh</Text>
                </Pressable>
              </View>
            ) : (
              healthData.map(h => <ProviderCard key={h.providerId} health={h} />)
            )}
          </>
        )}

        {/* ── CACHE TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'Cache' && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Cache Hits', value: cacheStats.hits.toLocaleString(), icon: <CheckCircle size={16} color="#0ECB81" />, color: '#0ECB81' },
                { label: 'Cache Misses', value: cacheStats.misses.toLocaleString(), icon: <XCircle size={16} color="#F6465D" />, color: '#F6465D' },
                { label: 'Hit Rate', value: cacheStats.hitRate, icon: <Zap size={16} color="#F0B90B" />, color: '#F0B90B' },
                { label: 'Active Entries', value: cacheStats.entries.toLocaleString(), icon: <Database size={16} color={C.gold} />, color: C.gold },
                { label: 'Expired', value: cacheStats.expirations.toLocaleString(), icon: <Clock size={16} color={C.text2} />, color: C.text2 },
              ].map(item => (
                <View key={item.label} style={{ width: '47%', backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: `${item.color}33` }}>
                  {item.icon}
                  <Text style={{ color: item.color, fontSize: 20, fontWeight: '800', marginTop: 6 }}>{item.value}</Text>
                  <Text style={{ color: C.text2, fontSize: 11, marginTop: 2 }}>{item.label}</Text>
                </View>
              ))}
            </View>

            {/* Cache entries list */}
            <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Active Cache Entries
            </Text>
            {engineCache.listEntries().length === 0 ? (
              <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 20, alignItems: 'center' }}>
                <Database size={28} color={C.text2} />
                <Text style={{ color: C.text2, fontSize: 13, marginTop: 8 }}>Cache is empty</Text>
              </View>
            ) : (
              engineCache.listEntries().map(entry => (
                <View key={entry.key} style={{ backgroundColor: C.card, borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: C.gold }}>
                  <Text style={{ color: C.text1, fontSize: 12, fontWeight: '600', marginBottom: 4 }} numberOfLines={1}>{entry.key}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: C.text2, fontSize: 11 }}>Provider: {entry.providerId}</Text>
                    <Text style={{ color: '#0ECB81', fontSize: 11 }}>TTL: {Math.round(entry.remainingMs / 1000)}s left</Text>
                  </View>
                </View>
              ))
            )}
            <Pressable
              onPress={() => { engineCache.purgeExpired(); refresh(); }}
              style={{ backgroundColor: '#F6465D22', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#F6465D44', marginTop: 8 }}
            >
              <Text style={{ color: '#F6465D', fontWeight: '600' }}>Purge Expired Entries</Text>
            </Pressable>
          </>
        )}

        {/* ── LOGS TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'Logs' && (
          <>
            {/* Per-provider summary */}
            <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Execution Summary
            </Text>
            {Object.keys(logSummary).length === 0 ? (
              <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 16 }}>
                <Activity size={28} color={C.text2} />
                <Text style={{ color: C.text2, fontSize: 13, marginTop: 8 }}>No executions recorded yet</Text>
              </View>
            ) : (
              Object.entries(logSummary).map(([id, s]) => (
                <View key={id} style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ color: C.text1, fontWeight: '700', fontSize: 13 }}>
                      {PROVIDER_CONFIGS.find(c => c.id === id)?.name ?? id}
                    </Text>
                    <Text style={{ color: C.gold, fontSize: 12 }}>{s.avgDurationMs}ms avg</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <Text style={{ color: C.text2, fontSize: 12 }}>Total <Text style={{ color: C.text1 }}>{s.total}</Text></Text>
                    <Text style={{ color: C.text2, fontSize: 12 }}>✓ <Text style={{ color: '#0ECB81' }}>{s.success}</Text></Text>
                    <Text style={{ color: C.text2, fontSize: 12 }}>✗ <Text style={{ color: '#F6465D' }}>{s.failed}</Text></Text>
                    <Text style={{ color: C.text2, fontSize: 12 }}>⏱ <Text style={{ color: '#F0B90B' }}>{s.timeout}</Text></Text>
                  </View>
                </View>
              ))
            )}

            {/* Recent errors */}
            {recentErrors.length > 0 && (
              <>
                <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 8 }}>
                  Recent Errors
                </Text>
                {recentErrors.map(err => (
                  <View key={err.id} style={{ backgroundColor: '#F6465D10', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F6465D33' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: '#F6465D', fontWeight: '600', fontSize: 12 }}>{err.providerId}</Text>
                      <Text style={{ color: C.text2, fontSize: 11 }}>{err.checkerType}</Text>
                    </View>
                    <Text style={{ color: C.text2, fontSize: 12 }} numberOfLines={2}>{err.errorMessage ?? 'Unknown error'}</Text>
                    {err.durationMs !== null && (
                      <Text style={{ color: C.text2, fontSize: 11, marginTop: 4 }}>{err.durationMs}ms</Text>
                    )}
                  </View>
                ))}
              </>
            )}
            <Pressable
              onPress={() => { engineLogger.clear(); refresh(); }}
              style={{ backgroundColor: C.surface, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: C.border, marginTop: 8 }}
            >
              <Text style={{ color: C.text2, fontWeight: '600' }}>Clear Log History</Text>
            </Pressable>
          </>
        )}

        {/* ── BINANCE API TAB ─────────────────────────────────────────────── */}
        {activeTab === 'Binance API' && (
          <>
            {/* Summary + run button */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>Binance Wallet API</Text>
                <Text style={{ color: C.text3, fontSize: 11 }}>
                  {binanceResult
                    ? `Credentials via: ${binanceResult.credentials.configured_via} · Last run: ${binanceRanAt}`
                    : 'Run diagnostics to verify Binance connectivity + outbound IP'}
                </Text>
              </View>
              <Pressable
                onPress={runBinanceDiag}
                disabled={binanceLoading}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.goldBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.gold }}>
                {binanceLoading
                  ? <ActivityIndicator size="small" color={C.gold} />
                  : <Shield size={14} color={C.gold} />}
                <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700' }}>
                  {binanceLoading ? 'Running…' : 'Run Checks'}
                </Text>
              </Pressable>
            </View>

            {/* Error banner */}
            {!!binanceError && (
              <View style={{ backgroundColor: '#F6465D18', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#F6465D30' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <AlertTriangle size={16} color="#F6465D" />
                  <Text style={{ color: '#F6465D', fontSize: 13, fontWeight: '700' }}>Diagnostics Failed</Text>
                </View>
                <Text style={{ color: '#F6465D', fontSize: 12 }}>{binanceError}</Text>
              </View>
            )}

            {binanceResult && (
              <>
                {/* ── Outbound IP card ── */}
                <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1.5, borderColor: binanceResult.summary.ip_stability === 'dynamic' ? '#F6465D' : binanceResult.summary.ip_stability === 'stable_this_session' ? C.gold : C.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Wifi size={16} color={C.gold} />
                    <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>Outbound Public IP</Text>
                    <View style={{ marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                      backgroundColor: binanceResult.summary.ip_stability === 'dynamic' ? '#F6465D22' : binanceResult.summary.ip_stability === 'stable_this_session' ? `${C.gold}22` : '#F0B90B22',
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: '700',
                        color: binanceResult.summary.ip_stability === 'dynamic' ? '#F6465D' : binanceResult.summary.ip_stability === 'stable_this_session' ? C.gold : '#F0B90B',
                      }}>
                        {binanceResult.summary.ip_stability === 'dynamic' ? 'DYNAMIC' : binanceResult.summary.ip_stability === 'stable_this_session' ? 'STABLE THIS SESSION' : 'INCONCLUSIVE'}
                      </Text>
                    </View>
                  </View>

                  {/* Current IP — large, copy-ready */}
                  <View style={{ backgroundColor: C.surface, borderRadius: 10, padding: 12, marginBottom: 10, alignItems: 'center' }}>
                    <Text style={{ color: C.text3, fontSize: 11, marginBottom: 4 }}>
                      Current Outbound IP — Add this to Binance API Whitelist
                    </Text>
                    <Text style={{ color: C.gold, fontSize: 20, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
                      {binanceResult.outbound_ip.current ?? '—'}
                    </Text>
                    {binanceResult.outbound_ip.all_observed.length > 1 && (
                      <Text style={{ color: '#F6465D', fontSize: 11, marginTop: 6, textAlign: 'center' }}>
                        ⚠️ {binanceResult.outbound_ip.all_observed.length} different IPs observed: {binanceResult.outbound_ip.all_observed.join(', ')}
                      </Text>
                    )}
                  </View>

                  {/* Per-probe table */}
                  <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>
                    IP Probes ({binanceResult.outbound_ip.probe_count} attempts)
                  </Text>
                  {binanceResult.outbound_ip.probes.map(p => (
                    <View key={p.attempt} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border }}>
                      <Text style={{ color: C.text2, fontSize: 12 }}>Probe #{p.attempt}</Text>
                      <Text style={{ color: p.ip ? C.text1 : '#F6465D', fontSize: 12, fontFamily: 'monospace' }}>{p.ip ?? 'failed'}</Text>
                      <Text style={{ color: C.text3, fontSize: 11 }}>{p.latencyMs}ms</Text>
                    </View>
                  ))}

                  {/* Stability note */}
                  <Text style={{ color: binanceResult.summary.ip_stability === 'dynamic' ? '#F6465D' : C.text2, fontSize: 11, marginTop: 10, lineHeight: 16 }}>
                    {binanceResult.outbound_ip.note}
                  </Text>
                </View>

                {/* ── Credentials card ── */}
                <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ color: C.text1, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>API Credentials</Text>
                  {[
                    { label: 'BINANCE_API_KEY present',    ok: binanceResult.credentials.api_key_present },
                    { label: 'BINANCE_API_SECRET present', ok: binanceResult.credentials.api_secret_present },
                  ].map(({ label, ok }) => (
                    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      {ok ? <CheckCircle size={14} color="#0ECB81" /> : <XCircle size={14} color="#F6465D" />}
                      <Text style={{ color: ok ? '#0ECB81' : '#F6465D', fontSize: 12 }}>{label}</Text>
                    </View>
                  ))}
                  <Text style={{ color: C.text3, fontSize: 11, marginTop: 4 }}>
                    Loaded via: {binanceResult.credentials.configured_via}
                  </Text>
                </View>

                {/* ── Summary badges ── */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  <View style={{ flex: 1, backgroundColor: binanceResult.summary.all_ok ? '#0ECB8115' : '#F6465D15', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: binanceResult.summary.all_ok ? '#0ECB8130' : '#F6465D30' }}>
                    {binanceResult.summary.all_ok ? <CheckCircle size={18} color="#0ECB81" /> : <XCircle size={18} color="#F6465D" />}
                    <Text style={{ color: binanceResult.summary.all_ok ? '#0ECB81' : '#F6465D', fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'center' }}>
                      {binanceResult.summary.all_ok ? 'All OK' : 'Issues Found'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: binanceResult.summary.ip_restricted ? '#F6465D15' : '#0ECB8115', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: binanceResult.summary.ip_restricted ? '#F6465D30' : '#0ECB8130' }}>
                    <WifiOff size={18} color={binanceResult.summary.ip_restricted ? '#F6465D' : '#0ECB81'} />
                    <Text style={{ color: binanceResult.summary.ip_restricted ? '#F6465D' : '#0ECB81', fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'center' }}>
                      {binanceResult.summary.ip_restricted ? 'IP Restricted' : 'IP OK'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: `${C.gold}15`, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: `${C.gold}30` }}>
                    <Database size={18} color={C.gold} />
                    <Text style={{ color: C.gold, fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'center' }}>
                      {Object.values(binanceResult.checks).filter(c => c.ok).length}/{Object.keys(binanceResult.checks).length} Passed
                    </Text>
                  </View>
                </View>

                {/* ── Individual check rows ── */}
                {BINANCE_CHECKS.map(({ key, label, desc }) => (
                  <BinanceCheckRow key={key} label={label} desc={desc} result={binanceResult.checks[key]} />
                ))}

                {/* ── Architecture recommendation ── */}
                <View style={{ backgroundColor: '#F0B90B18', borderRadius: 12, padding: 14, marginTop: 6, borderWidth: 1, borderColor: '#F0B90B30' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <AlertTriangle size={16} color="#F0B90B" />
                    <Text style={{ color: '#F0B90B', fontSize: 13, fontWeight: '700' }}>Architecture Recommendation</Text>
                  </View>
                  <Text style={{ color: C.text2, fontSize: 12, lineHeight: 18 }}>
                    {binanceResult.recommendation}
                  </Text>
                </View>
              </>
            )}

            {/* Empty state */}
            {!binanceResult && !binanceLoading && !binanceError && (
              <View style={{ alignItems: 'center', paddingTop: 48 }}>
                <Shield size={44} color={C.text3} strokeWidth={1.2} />
                <Text style={{ color: C.text2, fontSize: 14, fontWeight: '600', marginTop: 14 }}>No results yet</Text>
                <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
                  {'Press "Run Checks" to detect the outbound IP and test all Binance API endpoints.'}{'\n'}
                  No withdrawals will be performed.
                </Text>
              </View>
            )}
          </>
        )}

        {/* ── MARKET DATA TAB ─────────────────────────────────────────────── */}
        {activeTab === 'Market Data' && (
          <>
            {/* WebSocket stream health card */}
            <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: `${streamStateColor}55` }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Radio size={18} color={streamStateColor} />
                <Text style={{ color: C.text1, fontWeight: '700', fontSize: 15, flex: 1 }}>WebSocket Market Stream</Text>
                <View style={{ backgroundColor: `${streamStateColor}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: streamStateColor, fontSize: 11, fontWeight: '800' }}>{streamStateLabel}</Text>
                </View>
              </View>

              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Connection State</Text>
                  <Text style={{ color: streamStateColor, fontSize: 12, fontWeight: '600' }}>{streamHealth.state}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Last Message</Text>
                  <Text style={{ color: C.text1, fontSize: 12 }}>
                    {streamHealth.lastMessageAt
                      ? `${Math.round((Date.now() - streamHealth.lastMessageAt) / 1000)}s ago`
                      : 'Never'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Reconnect Count</Text>
                  <Text style={{ color: streamHealth.reconnectCount > 0 ? '#F0B90B' : C.text1, fontSize: 12 }}>
                    {streamHealth.reconnectCount}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Data Status</Text>
                  <Text style={{ color: streamHealth.isStale ? '#F6465D' : '#0ECB81', fontSize: 12, fontWeight: '600' }}>
                    {streamHealth.isStale ? 'STALE (>30s)' : 'FRESH'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>REST Fallback</Text>
                  <Text style={{ color: streamHealth.fallbackActive ? '#F0B90B' : C.text2, fontSize: 12, fontWeight: '600' }}>
                    {streamHealth.fallbackActive ? 'ACTIVE' : 'Idle'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Cached Symbols</Text>
                  <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700' }}>{cachedPrices.length}</Text>
                </View>
              </View>

              {/* Connect / Disconnect controls */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <Pressable
                  onPress={() => { marketStream.connect(); setCachedPrices(marketStream.getAllCachedPrices()); }}
                  style={{ flex: 1, backgroundColor: '#0ECB8118', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#0ECB8140' }}
                >
                  <Text style={{ color: '#0ECB81', fontWeight: '700', fontSize: 12 }}>Connect Stream</Text>
                </Pressable>
                <Pressable
                  onPress={() => { marketStream.disconnect(); setCachedPrices([]); }}
                  style={{ flex: 1, backgroundColor: '#F6465D18', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#F6465D40' }}
                >
                  <Text style={{ color: '#F6465D', fontWeight: '700', fontSize: 12 }}>Disconnect</Text>
                </Pressable>
              </View>
            </View>

            {/* Cached price table */}
            <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Live Price Cache ({cachedPrices.length} symbols)
            </Text>
            {cachedPrices.length === 0 ? (
              <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 20, alignItems: 'center' }}>
                <Database size={28} color={C.text3} />
                <Text style={{ color: C.text2, fontSize: 13, marginTop: 8 }}>No cached prices</Text>
                <Text style={{ color: C.text3, fontSize: 11, marginTop: 4, textAlign: 'center' }}>
                  {'Navigate to the Markets tab to trigger the stream, or press "Connect Stream" above.'}
                </Text>
              </View>
            ) : (
              <>
                {/* Header row */}
                <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surface, borderRadius: 8, marginBottom: 4 }}>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', flex: 1 }}>SYMBOL</Text>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', flex: 1.5, textAlign: 'right' }}>PRICE</Text>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', flex: 1, textAlign: 'right' }}>24H %</Text>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', flex: 1.2, textAlign: 'right' }}>AGE</Text>
                </View>
                {[...cachedPrices]
                  .sort((a, b) => a.symbol.localeCompare(b.symbol))
                  .map(p => {
                    const ageMs = Date.now() - p.updatedAt;
                    const ageS  = Math.round(ageMs / 1000);
                    const isOld = ageMs > 15_000;
                    const pos   = p.change24h >= 0;
                    return (
                      <View key={p.symbol} style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
                        <Text style={{ color: C.text1, fontSize: 13, fontWeight: '700', flex: 1 }}>{p.symbol}</Text>
                        <Text style={{ color: C.text1, fontSize: 12, flex: 1.5, textAlign: 'right' }}>
                          ${p.price < 1 ? p.price.toFixed(5) : p.price.toLocaleString()}
                        </Text>
                        <Text style={{ color: pos ? '#0ECB81' : '#F6465D', fontSize: 12, fontWeight: '600', flex: 1, textAlign: 'right' }}>
                          {pos ? '+' : ''}{p.change24h.toFixed(2)}%
                        </Text>
                        <Text style={{ color: isOld ? '#F0B90B' : C.text3, fontSize: 11, flex: 1.2, textAlign: 'right' }}>
                          {ageS}s
                        </Text>
                      </View>
                    );
                  })}
              </>
            )}

            {/* Manual REST market fetch test */}
            <Pressable
              onPress={refresh}
              style={{ backgroundColor: `${C.gold}18`, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: `${C.gold}40`, marginTop: 12 }}
            >
              <Text style={{ color: C.gold, fontWeight: '700' }}>Refresh Cache Snapshot</Text>
            </Pressable>
          </>
        )}

        {/* ── CONFIG TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'Config' && (
          <>
            <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Provider Registry ({PROVIDER_CONFIGS.length} total)
            </Text>
            {PROVIDER_CONFIGS.map(config => {
              const isRegistered = registered.includes(config.id);
              return (
                <View key={config.id} style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: config.enabled ? `${C.gold}33` : C.border, opacity: config.enabled ? 1 : 0.6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: C.text1, fontWeight: '700', fontSize: 14 }}>{config.name}</Text>
                      <Text style={{ color: C.text2, fontSize: 11 }}>id: {config.id}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {isRegistered && (
                        <View style={{ backgroundColor: `${C.gold}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: C.gold, fontSize: 10, fontWeight: '700' }}>REGISTERED</Text>
                        </View>
                      )}
                      <View style={{ backgroundColor: config.enabled ? '#0ECB8122' : '#F6465D22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ color: config.enabled ? '#0ECB81' : '#F6465D', fontSize: 10, fontWeight: '700' }}>
                          {config.enabled ? 'ENABLED' : 'DISABLED'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Config details */}
                  <View style={{ backgroundColor: C.surface, borderRadius: 8, padding: 10, gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.text2, fontSize: 11 }}>Priority</Text>
                      <Text style={{ color: C.text1, fontSize: 11 }}>{config.priority}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.text2, fontSize: 11 }}>Timeout</Text>
                      <Text style={{ color: C.text1, fontSize: 11 }}>{config.timeoutMs / 1000}s</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.text2, fontSize: 11 }}>Max Retries</Text>
                      <Text style={{ color: C.text1, fontSize: 11 }}>{config.maxRetries}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.text2, fontSize: 11 }}>Cache TTL</Text>
                      <Text style={{ color: C.text1, fontSize: 11 }}>{config.cacheTtlMs / 1000}s</Text>
                    </View>
                    {config.rateLimit && (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: C.text2, fontSize: 11 }}>Rate Limit</Text>
                        <Text style={{ color: C.text1, fontSize: 11 }}>{config.rateLimit.requestsPerMinute} req/min</Text>
                      </View>
                    )}
                  </View>

                  {/* Supported checkers */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                    {config.supportedCheckers.map(ct => (
                      <View key={ct} style={{ backgroundColor: `${C.gold}18`, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 }}>
                        <Text style={{ color: C.gold, fontSize: 10 }}>{ct}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}
