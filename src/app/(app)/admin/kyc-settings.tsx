// Admin KYC Settings — provider management + runtime thresholds + webhook audit
// Tab 1: Providers    — enable/disable, priority, health, fallback, set-default
// Tab 2: Settings     — thresholds, tier limits, lifecycle config
// Tab 3: Attempts     — full approve/reject/escalate/request-info actions
// Tab 4: Webhooks     — audit log of all received webhook events
// Tab 5: Diagnostics  — live config mismatch checks, provider health summary
import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Platform, StatusBar, Switch, Modal } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Settings, Save, RefreshCw, ChevronDown,
  CheckCircle, AlertTriangle, Shield, Zap, ZapOff, Activity,
  Clock, AlertCircle, ChevronRight, RotateCcw, Terminal,
  Check, X, ArrowUpCircle, HelpCircle, MessageSquare, Webhook, Info,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import {
  adminGetAllSettings, adminUpdateSetting,
  getKycProviders, adminUpdateProvider, adminSetDefaultProvider,
  getKycDiagnostics,
  adminKycAction,
  KYC_STATUS_ADMIN_LABEL, kycStatusColor,
  KYC_ACTIONABLE_STATUSES, KYC_TERMINAL_STATUSES,
  type KycProviderConfig, type KycDiagnostic,
} from '@/services/kyc.service';
import { getAdminVerificationReport } from '@/services/admin.service';
import { supabase } from '@/client/supabase';
import Constants from 'expo-constants';

// ── Shared helpers ─────────────────────────────────────────────────────────────
function sColor(status: string): string {
  return kycStatusColor(status, { buy: DS.color.buy, sell: DS.color.sell, warn: DS.color.warn, gold: DS.color.gold });
}

function SBadge({ status }: { status: string }) {
  const c = sColor(status);
  const label = KYC_STATUS_ADMIN_LABEL[status] ?? status.replace(/_/g, ' ');
  return (
    <View style={{ backgroundColor: c + '22', borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Text style={{ color: c, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{label}</Text>
    </View>
  );
}
interface SettingDef {
  key: string; label: string; description: string;
  type: 'number' | 'boolean' | 'text' | 'json'; section: string;
}

const SETTING_DEFS: SettingDef[] = [
  // Provider routing — default_provider is read-only here; source of truth is kyc_providers.is_default
  { key: 'default_provider',                  label: 'Default Provider',                description: 'Primary KYC provider (prembly | dojah | manual) — set via Providers tab',  type: 'text',    section: 'Provider Routing' },
  { key: 'fallback_enabled',                  label: 'Fallback Enabled',                description: 'Enable automatic provider fallback on failure',                type: 'boolean', section: 'Provider Routing' },
  { key: 'max_dojah_retries',                 label: 'Max Dojah Retries',               description: 'Max retry attempts before switching provider',                 type: 'number',  section: 'Provider Routing' },
  // Thresholds
  { key: 'manual_review_confidence_threshold', label: 'Manual Review Confidence (%)',   description: 'Below this confidence → manual review',                       type: 'number',  section: 'Review Thresholds' },
  { key: 'fraud_risk_threshold',               label: 'Fraud Risk Threshold (%)',        description: 'Above this fraud score → manual review',                      type: 'number',  section: 'Review Thresholds' },
  { key: 'face_match_threshold',               label: 'Face Match Threshold (%)',        description: 'Below this face match score → inconclusive',                  type: 'number',  section: 'Review Thresholds' },
  // KYC lifecycle
  { key: 'kyc_expiry_months',                  label: 'KYC Expiry (months)',             description: 'Approved KYC validity period',                                type: 'number',  section: 'KYC Lifecycle' },
  { key: 'supported_doc_types',                label: 'Supported Document Types',        description: 'JSON array of accepted doc types',                            type: 'json',    section: 'KYC Lifecycle' },
  // Tier limits
  { key: 'tier0_daily_withdrawal_usd',         label: 'Tier 0 Daily Withdrawal (USD)',   description: 'Max daily withdrawal for unverified users',                   type: 'number',  section: 'Tier Limits' },
  { key: 'tier1_daily_withdrawal_usd',         label: 'Tier 1 Daily Withdrawal (USD)',   description: 'Max daily withdrawal for basic KYC users',                    type: 'number',  section: 'Tier Limits' },
  { key: 'tier2_daily_withdrawal_usd',         label: 'Tier 2 Daily Withdrawal (USD)',   description: 'Max daily withdrawal for verified users',                     type: 'number',  section: 'Tier Limits' },
  { key: 'tier3_daily_withdrawal_usd',         label: 'Tier 3 Daily Withdrawal (USD)',   description: 'Max daily withdrawal for enhanced verified users',            type: 'number',  section: 'Tier Limits' },
  { key: 'tier0_daily_trading_usd',            label: 'Tier 0 Daily Trading (USD)',      description: 'Max daily trading for unverified users',                      type: 'number',  section: 'Tier Limits' },
  { key: 'tier1_daily_trading_usd',            label: 'Tier 1 Daily Trading (USD)',      description: 'Max daily trading for basic KYC users',                       type: 'number',  section: 'Tier Limits' },
  { key: 'tier2_daily_trading_usd',            label: 'Tier 2 Daily Trading (USD)',      description: 'Max daily trading for verified users',                        type: 'number',  section: 'Tier Limits' },
  { key: 'tier3_daily_trading_usd',            label: 'Tier 3 Daily Trading (USD)',      description: 'Max daily trading for enhanced verified users',               type: 'number',  section: 'Tier Limits' },
  { key: 'tier0_daily_p2p_usd',                label: 'Tier 0 Daily P2P (USD)',          description: 'Max daily P2P for unverified users',                          type: 'number',  section: 'Tier Limits' },
  { key: 'tier1_daily_p2p_usd',                label: 'Tier 1 Daily P2P (USD)',          description: 'Max daily P2P for basic KYC users',                           type: 'number',  section: 'Tier Limits' },
  { key: 'tier2_daily_p2p_usd',                label: 'Tier 2 Daily P2P (USD)',          description: 'Max daily P2P for verified users',                            type: 'number',  section: 'Tier Limits' },
  { key: 'tier3_daily_p2p_usd',                label: 'Tier 3 Daily P2P (USD)',          description: 'Max daily P2P for enhanced verified users',                   type: 'number',  section: 'Tier Limits' },
];

const SETTING_SECTIONS = [...new Set(SETTING_DEFS.map(s => s.section))];

// ── Health helpers ─────────────────────────────────────────────────────────────
function healthColor(h: KycProviderConfig['healthStatus']): string {
  switch (h) {
    case 'healthy':   return DS.color.buy;
    case 'degraded':  return DS.color.warn;
    case 'unhealthy': return DS.color.sell;
    default:          return DS.color.text3;
  }
}
function healthBg(h: KycProviderConfig['healthStatus']): string {
  switch (h) {
    case 'healthy':   return DS.color.buyBg;
    case 'degraded':  return DS.color.warnBg;
    case 'unhealthy': return DS.color.sellBg;
    default:          return DS.color.surface;
  }
}
function priorityLabel(p: number): string {
  if (p === 1)   return '1st — Default';
  if (p === 2)   return '2nd — Fallback';
  if (p === 999) return 'Last — Manual';
  return `Priority ${p}`;
}

// ── Provider card ──────────────────────────────────────────────────────────────
function ProviderCard({
  provider, onToggleEnabled, onPriorityChange, onToggleFallback, onSave, onSetDefault,
  onConfigChange, saving, settingDefault, dirty,
}: {
  provider: KycProviderConfig;
  onToggleEnabled: () => void;
  onPriorityChange: (v: string) => void;
  onToggleFallback: () => void;
  onSave: () => void;
  onSetDefault: () => void;
  onConfigChange: (patch: Record<string, string>) => void;
  saving: boolean;
  settingDefault: boolean;
  dirty: boolean;
}) {
  const [expanded, setExpanded] = useState(provider.priority === 1);

  const isDojah    = provider.providerName === 'dojah';
  const isPrembly  = provider.providerName === 'prembly';
  const widgetId   = isDojah   ? (provider.config?.widget_id  as string ?? '') : undefined;
  const hostedUrl  = isDojah   ? (provider.config?.hosted_url as string ?? '') : undefined;
  const configId   = isPrembly ? (provider.config?.config_id  as string ?? '') : undefined;
  const widgetKey  = isPrembly ? (provider.config?.widget_key as string ?? '') : undefined;
  const premblyEnv = isPrembly ? (provider.config?.environment as string ?? 'production') : undefined;

  return (
    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: provider.priority === 1 ? DS.color.gold + '50' : DS.color.border, overflow: 'hidden', marginBottom: DS.space.sm }}>
      {/* Header row */}
      <Pressable onPress={() => setExpanded(e => !e)}
        style={{ flexDirection: 'row', alignItems: 'center', padding: DS.space.md, gap: DS.space.sm }}>

        {/* Priority badge */}
        <View style={{ backgroundColor: provider.priority === 1 ? DS.color.goldBg : DS.color.surface, borderRadius: DS.radius.xs, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: provider.priority === 1 ? DS.color.gold + '40' : DS.color.border }}>
          <Text style={{ color: provider.priority === 1 ? DS.color.gold : DS.color.text3, fontSize: DS.font.xs, fontWeight: DS.font.extrabold }}>{provider.priority === 999 ? '—' : provider.priority}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{provider.displayName}</Text>
            {provider.isDefault && (
              <View style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.xs, paddingHorizontal: 5, paddingVertical: 2 }}>
                <Text style={{ color: DS.color.bg, fontSize: DS.font.xxs, fontWeight: DS.font.extrabold }}>DEFAULT</Text>
              </View>
            )}
          </View>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{priorityLabel(provider.priority)}</Text>
        </View>

        {/* Health badge */}
        <View style={{ backgroundColor: healthBg(provider.healthStatus), borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
          <Text style={{ color: healthColor(provider.healthStatus), fontSize: DS.font.xxs, fontWeight: DS.font.semibold, textTransform: 'uppercase' }}>
            {provider.healthStatus}
          </Text>
        </View>

        {/* Enabled toggle */}
        <Switch value={provider.enabled} onValueChange={onToggleEnabled}
          trackColor={{ true: DS.color.buy, false: DS.color.surface }}
          thumbColor={provider.enabled ? DS.color.bg : DS.color.text3} />

        <ChevronDown size={14} color={DS.color.text3}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
      </Pressable>

      {expanded && (
        <View style={{ borderTopWidth: 1, borderTopColor: DS.color.border, padding: DS.space.md, gap: DS.space.sm }}>

          {/* Health details */}
          <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.sm, gap: 6, borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5 }}>HEALTH MONITOR</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Status</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Activity size={12} color={healthColor(provider.healthStatus)} />
                <Text style={{ color: healthColor(provider.healthStatus), fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'capitalize' }}>{provider.healthStatus}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Failure count</Text>
              <Text style={{ color: provider.failureCount > 0 ? DS.color.sell : DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{provider.failureCount}</Text>
            </View>
            {provider.lastSuccessAt && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Last success</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>{new Date(provider.lastSuccessAt).toLocaleString()}</Text>
              </View>
            )}
            {provider.lastError && (
              <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.xs, borderWidth: 1, borderColor: DS.color.sell + '25' }}>
                <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs }}>Last error: {provider.lastError}</Text>
                {provider.lastErrorAt && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{new Date(provider.lastErrorAt).toLocaleString()}</Text>}
              </View>
            )}
          </View>

          {/* Prembly config — EDITABLE (Config ID, Widget Key, Environment) */}
          {isPrembly && (
            <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, padding: DS.space.sm, gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.gold + '40' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                <Settings size={13} color={DS.color.gold} />
                <Text style={{ color: DS.color.gold, fontSize: DS.font.xs, fontWeight: DS.font.semibold, letterSpacing: 0.5 }}>PREMBLY CONFIGURATION</Text>
              </View>

              {/* Config ID */}
              <View>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>CONFIG ID</Text>
                <TextInput
                  value={configId ?? ''}
                  onChangeText={(v) => onConfigChange({ config_id: v })}
                  placeholder="2c2e39dd-ecdc-4ba0-a728-…"
                  placeholderTextColor={DS.color.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: DS.color.border, fontFamily: 'monospace' }}
                />
              </View>

              {/* Widget Key */}
              <View>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>WIDGET KEY</Text>
                <TextInput
                  value={widgetKey ?? ''}
                  onChangeText={(v) => onConfigChange({ widget_key: v })}
                  placeholder="wdgt_…"
                  placeholderTextColor={DS.color.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: DS.color.border, fontFamily: 'monospace' }}
                />
              </View>

              {/* Environment selector */}
              <View>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>ENVIRONMENT</Text>
                <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                  {(['production', 'sandbox'] as const).map((env) => (
                    <Pressable key={env} onPress={() => onConfigChange({ environment: env })}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: DS.radius.sm, alignItems: 'center', borderWidth: 1.5,
                        borderColor: premblyEnv === env ? (env === 'production' ? DS.color.buy : DS.color.warn) : DS.color.border,
                        backgroundColor: premblyEnv === env ? (env === 'production' ? DS.color.buy + '18' : DS.color.warn + '18') : DS.color.surface,
                      }}>
                      <Text style={{ fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase',
                        color: premblyEnv === env ? (env === 'production' ? DS.color.buy : DS.color.warn) : DS.color.text3 }}>
                        {env}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: DS.space.xs }}>
                <Info size={11} color={DS.color.text3} style={{ marginTop: 1 }} />
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, flex: 1 }}>
                  Secret Key is backend-only (stored in Supabase Secrets). Config ID and Widget Key come from your Prembly dashboard → SDK Integration Guide.
                </Text>
              </View>
            </View>
          )}

          {/* Dojah config — EDITABLE (Widget ID) */}
          {isDojah && (
            <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, padding: DS.space.sm, gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                <Settings size={13} color={DS.color.gold} />
                <Text style={{ color: DS.color.gold, fontSize: DS.font.xs, fontWeight: DS.font.semibold, letterSpacing: 0.5 }}>DOJAH CONFIGURATION</Text>
              </View>
              <View>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>WIDGET ID</Text>
                <TextInput
                  value={widgetId ?? ''}
                  onChangeText={(v) => onConfigChange({ widget_id: v, hosted_url: `https://identity.dojah.io?widget_id=${v}` })}
                  placeholder="6a5b12349ff90fe054784334"
                  placeholderTextColor={DS.color.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: DS.color.border, fontFamily: 'monospace' }}
                />
              </View>
              {hostedUrl ? (
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, fontFamily: 'monospace' }} numberOfLines={2}>{hostedUrl}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: DS.space.xs }}>
                <Info size={11} color={DS.color.text3} style={{ marginTop: 1 }} />
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, flex: 1 }}>Widget ID from your Dojah EasyOnboard dashboard.</Text>
              </View>
            </View>
          )}

          {/* Priority input */}
          {provider.providerName !== 'manual' && (
            <View>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 5 }}>PRIORITY (lower = higher priority, 1 = default)</Text>
              <TextInput
                value={String(provider.priority)}
                onChangeText={onPriorityChange}
                keyboardType="numeric"
                editable={!isPrembly} // Prembly is always priority-1 default
                style={{ backgroundColor: isPrembly ? DS.color.surface + '80' : DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: isPrembly ? DS.color.text3 : DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: DS.color.border }}
              />
              {isPrembly && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 3 }}>Prembly is priority 1 — the default provider for all countries. Dojah is the fallback at priority 2.</Text>}
            </View>
          )}

          {/* Supported countries */}
          <View>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 3 }}>SUPPORTED COUNTRIES</Text>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
              {provider.supportedCountries.length === 0 ? '🌍 All countries' : provider.supportedCountries.join(', ')}
            </Text>
          </View>

          {/* Auto fallback toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.medium }}>Auto Fallback</Text>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Automatically route to next provider on failure</Text>
            </View>
            <Switch value={provider.autoFallback} onValueChange={onToggleFallback}
              trackColor={{ true: DS.color.buy, false: DS.color.surface }}
              thumbColor={provider.autoFallback ? DS.color.bg : DS.color.text3} />
          </View>

          {/* Save button */}
          {dirty && (
            <Pressable onPress={onSave} disabled={saving}
              style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: DS.space.xs, marginTop: DS.space.xs }}>
              {saving
                ? <ActivityIndicator size="small" color={DS.color.bg} />
                : <><Save size={14} color={DS.color.bg} /><Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Save Provider Changes</Text></>}
            </Pressable>
          )}

          {/* Set as Default button — shown for non-default enabled providers */}
          {!provider.isDefault && provider.enabled && provider.providerName !== 'manual' && (
            <Pressable onPress={onSetDefault} disabled={settingDefault || saving}
              style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: DS.space.xs, marginTop: dirty ? DS.space.xs : DS.space.xs, borderWidth: 1, borderColor: DS.color.gold + '50' }}>
              {settingDefault
                ? <ActivityIndicator size="small" color={DS.color.gold} />
                : <><Shield size={13} color={DS.color.gold} /><Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Set as Default Provider</Text></>}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ── Attempt types ──────────────────────────────────────────────────────────────
interface AttemptRow {
  id: string; user_id: string; provider: string; reference_id: string;
  status: string; country_code?: string; created_at: string; failure_reason?: string;
  submission_id?: string; manual_override?: boolean; decision_source?: string;
}

// ── Verification Report Panel ──────────────────────────────────────────────────
function VerificationReport() {
  const [report, setReport]   = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function fetchReport() {
    setLoading(true); setError('');
    try {
      const r = await getAdminVerificationReport();
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch report');
    } finally { setLoading(false); }
  }

  const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl
    ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'N/A';
  const envLabel = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1')
    ? 'local' : supabaseUrl.includes('.co') ? 'production' : 'preview';

  function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
    const color = ok === true ? DS.color.buy : ok === false ? DS.color.sell : DS.color.text2;
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: DS.color.border + '50' }}>
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, flex: 1 }}>{label}</Text>
        <Text style={{ color, fontSize: DS.font.xxs, fontFamily: 'monospace', textAlign: 'right', flex: 1.2 }} numberOfLines={2}>{value}</Text>
      </View>
    );
  }

  const dojah = report?.dojah_provider as Record<string, unknown> | undefined;

  return (
    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
          <Terminal size={13} color={DS.color.gold} />
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Admin Verification Report</Text>
        </View>
        <Pressable onPress={fetchReport} disabled={loading} style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 6, borderWidth: 1, borderColor: DS.color.border }}>
          {loading ? <ActivityIndicator size="small" color={DS.color.gold} /> : <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs }}>Run Report</Text>}
        </Pressable>
      </View>

      {/* Environment info — always visible */}
      <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.sm, marginBottom: DS.space.sm }}>
        <Row label="Environment" value={envLabel.toUpperCase()} ok={envLabel === 'production'} />
        <Row label="Supabase URL" value={supabaseUrl.replace('https://', '').slice(0, 40)} />
      </View>

      {error ? (
        <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, marginBottom: DS.space.xs }}>{error}</Text>
      ) : null}

      {report && (
        <View style={{ gap: DS.space.xs }}>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 2 }}>IDENTITY MAPPING</Text>
          <Row label="Admin UUID" value={String(report.admin_uuid ?? '—')} ok={!!report.admin_uuid} />
          <Row label="Admin Role" value={String(report.admin_role ?? '—')} ok={report.admin_role === 'admin'} />

          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: DS.space.xs, marginBottom: 2 }}>USER COUNTS</Text>
          <Row label="Auth Users"           value={String(report.auth_users ?? 0)} ok={(report.auth_users as number) > 0} />
          <Row label="App Profiles"         value={String(report.profiles ?? 0)} ok={(report.profiles as number) > 0} />
          <Row label="Missing Auth Profile" value={String(report.profiles_missing_auth ?? 0)} ok={(report.profiles_missing_auth as number) === 0} />

          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: DS.space.xs, marginBottom: 2 }}>KYC RECORDS</Text>
          <Row label="KYC Attempts"   value={String(report.kyc_attempts ?? 0)} />
          <Row label="— Pending"      value={String(report.kyc_attempts_pending ?? 0)} />
          <Row label="— In Progress"  value={String(report.kyc_attempts_in_progress ?? 0)} />
          <Row label="— Verified"     value={String(report.kyc_attempts_verified ?? 0)} />
          <Row label="— Failed"       value={String(report.kyc_attempts_failed ?? 0)} />
          <Row label="KYC Submissions" value={String(report.kyc_submissions ?? 0)} />

          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: DS.space.xs, marginBottom: 2 }}>WEBHOOKS</Text>
          <Row label="Total Received"  value={String(report.webhooks_total ?? 0)} />
          <Row label="Failed Webhooks" value={String(report.webhooks_failed ?? 0)} ok={(report.webhooks_failed as number) === 0} />

          {dojah && (
            <>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: DS.space.xs, marginBottom: 2 }}>DOJAH CONFIGURATION</Text>
              <Row label="Widget ID"    value={String(dojah.widget_id ?? '—')} ok={!!dojah.widget_id} />
              <Row label="Health"       value={String(dojah.health_status ?? '—')} ok={dojah.health_status === 'healthy'} />
              <Row label="Failure Count" value={String(dojah.failure_count ?? 0)} ok={(dojah.failure_count as number) === 0} />
              <Row label="Enabled"      value={String(dojah.enabled ?? false)} ok={!!dojah.enabled} />
            </>
          )}

          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: DS.space.xs }}>
            Generated: {new Date(report.generated_at as string).toLocaleString()}
          </Text>
        </View>
      )}

      {!report && !loading && !error && (
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, textAlign: 'center', paddingVertical: DS.space.sm }}>
          Press "Run Report" to verify admin data connections
        </Text>
      )}
    </View>
  );
}

// ── Attempts tab — full admin decision panel ───────────────────────────────────
function RecentAttempts() {
  const [attempts, setAttempts]     = useState<AttemptRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [syncing, setSyncing]       = useState<string | null>(null);
  const [actioning, setActioning]   = useState<string | null>(null);
  const [selected, setSelected]     = useState<AttemptRow | null>(null);
  const [actionReason, setReason]   = useState('');
  const [actionNotes, setNotes]     = useState('');
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null);

  const COLS = 'id, user_id, provider, reference_id, status, country_code, created_at, failure_reason, submission_id, manual_override, decision_source';

  async function loadAttempts(active = true) {
    try {
      const { data, error: e } = await supabase
        .from('kyc_attempts').select(COLS)
        .order('created_at', { ascending: false }).limit(40);
      if (!active) return;
      if (e) throw new Error(e.message);
      setAttempts((data ?? []) as AttemptRow[]);
    } catch (e2) {
      if (active) showToast(e2 instanceof Error ? e2.message : 'Failed to load', false);
    } finally {
      if (active) setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    loadAttempts(active);
    return () => { active = false; };
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleSync(a: AttemptRow) {
    setSyncing(a.id);
    try {
      await supabase.functions.invoke('sync-dojah-kyc-status', { body: { attempt_id: a.id } });
      const { data: fresh } = await supabase.from('kyc_attempts').select(COLS)
        .order('created_at', { ascending: false }).limit(40);
      setAttempts((fresh ?? []) as AttemptRow[]);
      if (selected?.id === a.id && fresh) {
        setSelected((fresh as AttemptRow[]).find(r => r.id === a.id) ?? null);
      }
      showToast('Status synced from provider.', true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Sync failed', false);
    } finally { setSyncing(null); }
  }

  async function handleAction(action: 'approve' | 'reject' | 'escalate' | 'request_info' | 'add_note') {
    if (!selected) return;
    if (action === 'reject' && !actionReason.trim()) {
      showToast('A rejection reason is required.', false); return;
    }
    setActioning(selected.id);
    try {
      const result = await adminKycAction({
        action,
        attemptId: selected.id,
        reason: actionReason.trim() || undefined,
        notes:  actionNotes.trim()  || undefined,
        tier:   action === 'approve' ? 'tier2' : undefined,
      });
      // Refresh list + selected row
      const { data: fresh } = await supabase.from('kyc_attempts').select(COLS)
        .order('created_at', { ascending: false }).limit(40);
      const rows = (fresh ?? []) as AttemptRow[];
      setAttempts(rows);
      setSelected(rows.find(r => r.id === selected.id) ?? null);
      setReason(''); setNotes('');
      showToast(`✓ ${action.replace(/_/g,' ')} — status: ${result.newStatus}`, true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', false);
    } finally { setActioning(null); }
  }

  const canAct   = selected ? KYC_ACTIONABLE_STATUSES.includes(selected.status) : false;
  const isActing = actioning === selected?.id;

  function ActionBtn({ label, onPress, color, icon }: {
    label: string; onPress: () => void; color: string; icon: React.ReactNode;
  }) {
    return (
      <Pressable onPress={onPress} disabled={isActing || !canAct}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
          backgroundColor: canAct ? color + '18' : DS.color.surface,
          borderRadius: DS.radius.sm, paddingVertical: 8,
          borderWidth: 1, borderColor: canAct ? color + '40' : DS.color.border, opacity: canAct ? 1 : 0.4 }}>
        {isActing ? <ActivityIndicator size="small" color={color} /> : icon}
        <Text style={{ color: canAct ? color : DS.color.text3, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: DS.space.sm }}>
      {/* Toast */}
      {toast && (
        <View style={{ backgroundColor: toast.ok ? DS.color.buyBg : DS.color.sellBg, borderRadius: DS.radius.md,
          padding: DS.space.sm, borderWidth: 1, borderColor: (toast.ok ? DS.color.buy : DS.color.sell) + '40' }}>
          <Text style={{ color: toast.ok ? DS.color.buy : DS.color.sell, fontSize: DS.font.xs }}>{toast.msg}</Text>
        </View>
      )}

      {/* Attempt list */}
      {loading && <ActivityIndicator color={DS.color.gold} style={{ marginTop: DS.space.md }} />}
      {!loading && attempts.length === 0 && (
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, textAlign: 'center', paddingVertical: DS.space.md }}>No KYC attempts yet</Text>
      )}
      {attempts.map(a => {
        const c = sColor(a.status);
        const isSelected = selected?.id === a.id;
        return (
          <Pressable key={a.id} onPress={() => setSelected(isSelected ? null : a)}
            style={{ backgroundColor: isSelected ? DS.color.goldBg : DS.color.card, borderRadius: DS.radius.md,
              padding: DS.space.sm, borderWidth: 1,
              borderColor: isSelected ? DS.color.gold + '60' : DS.color.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs, fontFamily: 'monospace' }} numberOfLines={1}>
                  {a.reference_id}
                </Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
                  {a.provider} · {a.country_code ?? '—'} · {new Date(a.created_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <SBadge status={a.status} />
                {a.manual_override && (
                  <Text style={{ color: DS.color.gold, fontSize: 9, fontWeight: DS.font.bold }}>MANUAL</Text>
                )}
              </View>
            </View>
            {a.failure_reason && (
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Reason: {a.failure_reason}</Text>
            )}
            {/* Quick sync button for non-terminal */}
            {!isSelected && a.provider === 'dojah' && !KYC_TERMINAL_STATUSES.includes(a.status) && !a.manual_override && (
              <Pressable onPress={(ev) => { ev.stopPropagation?.(); handleSync(a); }} disabled={syncing === a.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 6,
                  backgroundColor: DS.color.surface, borderRadius: DS.radius.xs,
                  paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: DS.color.border }}>
                {syncing === a.id ? <ActivityIndicator size="small" color={DS.color.gold} /> : <RotateCcw size={10} color={DS.color.text2} />}
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Sync</Text>
              </Pressable>
            )}

            {/* Expanded decision panel */}
            {isSelected && (
              <View style={{ marginTop: DS.space.sm, gap: DS.space.sm, borderTopWidth: 1, borderTopColor: DS.color.border, paddingTop: DS.space.sm }}>
                {/* Status context */}
                <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.xs, gap: 2 }}>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Attempt ID: <Text style={{ fontFamily: 'monospace', color: DS.color.text2 }}>{a.id}</Text></Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Decision source: <Text style={{ color: DS.color.text2 }}>{a.decision_source ?? 'provider'}</Text></Text>
                  {!canAct && (
                    <Text style={{ color: DS.color.warn, fontSize: DS.font.xxs, marginTop: 2 }}>
                      {KYC_TERMINAL_STATUSES.includes(a.status)
                        ? `Status is ${a.status} (terminal). Use force-override to reopen.`
                        : 'This status does not allow admin actions.'}
                    </Text>
                  )}
                </View>

                {/* Reason / Notes inputs */}
                <TextInput
                  value={actionReason} onChangeText={setReason}
                  placeholder="Reason (required for reject)"
                  placeholderTextColor={DS.color.text3}
                  style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm,
                    paddingHorizontal: DS.space.sm, paddingVertical: 8,
                    color: DS.color.text1, fontSize: DS.font.xs,
                    borderWidth: 1, borderColor: DS.color.border }} />
                <TextInput
                  value={actionNotes} onChangeText={setNotes}
                  placeholder="Internal notes (optional)"
                  placeholderTextColor={DS.color.text3}
                  style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm,
                    paddingHorizontal: DS.space.sm, paddingVertical: 8,
                    color: DS.color.text1, fontSize: DS.font.xs,
                    borderWidth: 1, borderColor: DS.color.border }} />

                {/* Action buttons */}
                <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                  <ActionBtn label="Approve" onPress={() => handleAction('approve')} color={DS.color.buy}
                    icon={<Check size={11} color={canAct ? DS.color.buy : DS.color.text3} />} />
                  <ActionBtn label="Reject" onPress={() => handleAction('reject')} color={DS.color.sell}
                    icon={<X size={11} color={canAct ? DS.color.sell : DS.color.text3} />} />
                </View>
                <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                  <ActionBtn label="Escalate" onPress={() => handleAction('escalate')} color={DS.color.warn}
                    icon={<ArrowUpCircle size={11} color={canAct ? DS.color.warn : DS.color.text3} />} />
                  <ActionBtn label="Request Info" onPress={() => handleAction('request_info')} color={DS.color.gold}
                    icon={<HelpCircle size={11} color={canAct ? DS.color.gold : DS.color.text3} />} />
                  <ActionBtn label="Add Note" onPress={() => handleAction('add_note')} color={DS.color.text2}
                    icon={<MessageSquare size={11} color={DS.color.text3} />} />
                </View>

                {/* Sync button */}
                {a.provider === 'dojah' && !a.manual_override && (
                  <Pressable onPress={() => handleSync(a)} disabled={syncing === a.id}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                      backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 8,
                      borderWidth: 1, borderColor: DS.color.border }}>
                    {syncing === a.id ? <ActivityIndicator size="small" color={DS.color.gold} /> : <RotateCcw size={12} color={DS.color.text2} />}
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Sync from Provider</Text>
                  </Pressable>
                )}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Webhook Audit Log tab ──────────────────────────────────────────────────────
interface WebhookEntry {
  id: string; source: string; reference_id?: string; event_type?: string;
  status: string; error?: string; created_at: string;
}

function WebhookAuditLog() {
  const [entries, setEntries]   = useState<WebhookEntry[]>([]);
  const [loading, setLoading]   = useState(false);
  const [filter, setFilter]     = useState<'all' | 'processed' | 'failed' | 'duplicate'>('all');
  const [error, setError]       = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setError('');
    (async () => {
      try {
        let q = supabase.from('webhook_audit_log')
          .select('id, source, reference_id, event_type, status, error, created_at')
          .order('created_at', { ascending: false }).limit(60);
        if (filter !== 'all') q = q.eq('status', filter);
        const { data, error: e } = await q;
        if (!active) return;
        if (e) throw new Error(e.message);
        setEntries((data ?? []) as WebhookEntry[]);
      } catch (e2) {
        if (active) setError(e2 instanceof Error ? e2.message : 'Failed to load');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [filter]));

  const statusColor = (s: string) => {
    if (s === 'processed') return DS.color.buy;
    if (s === 'failed')    return DS.color.sell;
    if (s === 'duplicate') return DS.color.text3;
    return DS.color.gold; // received
  };

  const FILTERS: Array<typeof filter> = ['all', 'processed', 'failed', 'duplicate'];

  return (
    <View style={{ gap: DS.space.sm }}>
      {/* Filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: DS.space.xs }}>
        <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
          {FILTERS.map(f => (
            <Pressable key={f} onPress={() => setFilter(f)}
              style={{ backgroundColor: filter === f ? DS.color.gold : DS.color.card,
                borderRadius: DS.radius.full, paddingHorizontal: 12, paddingVertical: 5,
                borderWidth: 1, borderColor: filter === f ? DS.color.goldDark : DS.color.border }}>
              <Text style={{ color: filter === f ? DS.color.bg : DS.color.text2, fontSize: DS.font.xxs, fontWeight: DS.font.semibold, textTransform: 'capitalize' }}>{f}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {error ? <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text> : null}
      {loading && <ActivityIndicator color={DS.color.gold} />}

      {!loading && entries.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: DS.space.xl }}>
          <Webhook size={28} color={DS.color.text3} />
          <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, marginTop: DS.space.sm }}>No webhook events</Text>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginTop: 4 }}>
            {filter !== 'all' ? `No ${filter} events` : 'Webhook events will appear here once received'}
          </Text>
        </View>
      )}

      {entries.map(w => {
        const c = statusColor(w.status);
        return (
          <View key={w.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.md, padding: DS.space.sm,
            borderWidth: 1, borderColor: DS.color.border, borderLeftWidth: 3, borderLeftColor: c }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.medium }}>
                  {w.source} {w.event_type ? `· ${w.event_type}` : ''}
                </Text>
                {w.reference_id && (
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, fontFamily: 'monospace' }} numberOfLines={1}>
                    {w.reference_id}
                  </Text>
                )}
              </View>
              <View style={{ backgroundColor: c + '20', borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: c, fontSize: DS.font.xxs, fontWeight: DS.font.semibold, textTransform: 'uppercase' }}>{w.status}</Text>
              </View>
            </View>
            {w.error && (
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, marginTop: 2 }} numberOfLines={2}>
                {w.error}
              </Text>
            )}
            <Text style={{ color: DS.color.text3, fontSize: 10, marginTop: 4 }}>
              {new Date(w.created_at).toLocaleString()}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
type Tab = 'providers' | 'settings' | 'attempts' | 'webhooks' | 'diagnostics';

export default function AdminKycSettingsScreen() {
  const router = useRouter();
  const pt = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8;

  const [activeTab, setActiveTab] = useState<Tab>('providers');

  // Providers state
  const [providers, setProviders]           = useState<KycProviderConfig[]>([]);
  const [providerDirty, setProviderDirty]   = useState<Record<string, boolean>>({});
  const [providerSaving, setProviderSaving] = useState<string | null>(null);
  const [settingDefaultFor, setSettingDefaultFor] = useState<string | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);

  // Settings state
  const [values, setValues]         = useState<Record<string, string>>({});
  const [originals, setOriginals]   = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving]         = useState<string | null>(null);
  const [savedKeys, setSavedKeys]   = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed]   = useState<Record<string, boolean>>({});

  const [error, setError] = useState('');

  // Diagnostics state
  const [diagnostics, setDiagnostics]         = useState<KycDiagnostic[]>([]);
  const [diagLoading, setDiagLoading]         = useState(false);
  const [diagLastRun, setDiagLastRun]         = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setError('');
      try {
        const [provData, settingsData] = await Promise.all([
          getKycProviders(),
          adminGetAllSettings(),
        ]);
        if (!active) return;
        setProviders(provData);
        const map: Record<string, string> = {};
        settingsData.forEach(s => {
          map[s.key] = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value ?? '');
        });
        setValues(map);
        setOriginals(map);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (active) { setProvidersLoading(false); setSettingsLoading(false); }
      }
    })();
    return () => { active = false; };
  }, []));

  async function runDiagnostics() {
    setDiagLoading(true);
    setError('');
    try {
      // Client-side env var checks (public keys only — never secret)
      const clientChecks: KycDiagnostic[] = [
        {
          key:    'env_environment',
          label:  'Environment',
          status:  process.env.EXPO_PUBLIC_PREMBLY_ENVIRONMENT === 'production' ? 'ok' : 'error',
          detail: process.env.EXPO_PUBLIC_PREMBLY_ENVIRONMENT
            ? `EXPO_PUBLIC_PREMBLY_ENVIRONMENT = "${process.env.EXPO_PUBLIC_PREMBLY_ENVIRONMENT}"`
            : 'EXPO_PUBLIC_PREMBLY_ENVIRONMENT not set — widget will default to sandbox',
        },
        {
          key:    'env_config_id',
          label:  'Config ID loaded',
          status:  process.env.EXPO_PUBLIC_PREMBLY_CONFIG_ID ? 'ok' : 'error',
          detail: process.env.EXPO_PUBLIC_PREMBLY_CONFIG_ID
            ? `EXPO_PUBLIC_PREMBLY_CONFIG_ID set (${process.env.EXPO_PUBLIC_PREMBLY_CONFIG_ID.slice(0, 8)}…)`
            : 'EXPO_PUBLIC_PREMBLY_CONFIG_ID is empty — widget cannot initialise',
        },
        {
          key:    'env_widget_key',
          label:  'Widget Key loaded',
          status:  process.env.EXPO_PUBLIC_PREMBLY_WIDGET_KEY ? 'ok' : 'error',
          detail: process.env.EXPO_PUBLIC_PREMBLY_WIDGET_KEY
            ? `EXPO_PUBLIC_PREMBLY_WIDGET_KEY set (${process.env.EXPO_PUBLIC_PREMBLY_WIDGET_KEY.slice(0, 8)}…)`
            : 'EXPO_PUBLIC_PREMBLY_WIDGET_KEY is empty — hosted iframe fallback will fail',
        },
        {
          key:    'env_public_key',
          label:  'Public Key loaded',
          status:  process.env.EXPO_PUBLIC_PREMBLY_PUBLIC_KEY ? 'ok' : 'error',
          detail: process.env.EXPO_PUBLIC_PREMBLY_PUBLIC_KEY
            ? `EXPO_PUBLIC_PREMBLY_PUBLIC_KEY set (${process.env.EXPO_PUBLIC_PREMBLY_PUBLIC_KEY.slice(0, 10)}…)`
            : 'EXPO_PUBLIC_PREMBLY_PUBLIC_KEY is empty — SDK auth will fail',
        },
        {
          key:    'env_secret_note',
          label:  'Backend Secret',
          status:  'ok',
          detail: 'PREMBLY_SECRET_KEY is stored as a Supabase backend secret — never exposed to the client',
        },
      ];
      const dbResults = await getKycDiagnostics();
      setDiagnostics([...clientChecks, ...dbResults]);
      setDiagLastRun(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diagnostics failed');
    } finally {
      setDiagLoading(false);
    }
  }

  // Auto-run diagnostics when tab becomes active
  const diagRanRef = React.useRef(false);
  React.useEffect(() => {
    if (activeTab === 'diagnostics' && !diagRanRef.current) {
      diagRanRef.current = true;
      runDiagnostics();
    }
  }, [activeTab]);
  function mutateProvider(id: string, patch: Partial<KycProviderConfig>) {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
    setProviderDirty(d => ({ ...d, [id]: true }));
  }

  async function saveProvider(provider: KycProviderConfig) {
    setProviderSaving(provider.id);
    setError('');
    try {
      // adminUpdateProvider persists config (config_id, widget_key, environment, etc.)
      const saved = await adminUpdateProvider(provider.id, {
        enabled:            provider.enabled,
        priority:           provider.priority,
        autoFallback:       provider.autoFallback,
        manualSelection:    provider.manualSelection,
        supportedCountries: provider.supportedCountries,
        config:             provider.config as Record<string, unknown>,
      });
      // Replace local copy with DB-confirmed row, clear dirty flag
      setProviders(ps => ps.map(p => p.id === saved.id ? saved : p));
      setProviderDirty(d => ({ ...d, [provider.id]: false }));
      // Sync settings panel so default_provider field reflects DB state
      const settingsData = await adminGetAllSettings();
      const map: Record<string, string> = {};
      settingsData.forEach(s => {
        map[s.key] = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value ?? '');
      });
      setValues(v  => ({ ...v,  ...map }));
      setOriginals(o => ({ ...o, ...map }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setProviderSaving(null);
    }
  }

  async function handleSetDefault(providerName: string) {
    setSettingDefaultFor(providerName);
    setError('');
    try {
      // Atomic: clears all is_default, sets chosen provider, syncs kyc_settings, audit logs
      const updated = await adminSetDefaultProvider(
        providerName as import('@/services/kyc.service').KycProvider,
        'admin_ui_selection',
      );
      setProviders(updated);
      setProviderDirty({});
      // Refresh settings panel so default_provider row shows new value immediately
      const settingsData = await adminGetAllSettings();
      const map: Record<string, string> = {};
      settingsData.forEach(s => {
        map[s.key] = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value ?? '');
      });
      setValues(v  => ({ ...v,  ...map }));
      setOriginals(o => ({ ...o, ...map }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set default provider');
    } finally {
      setSettingDefaultFor(null);
    }
  }

  // ── Settings mutations ───────────────────────────────────────────────────────
  async function handleSaveSetting(key: string) {
    setSaving(key);
    setError('');
    try {
      const def = SETTING_DEFS.find(d => d.key === key);
      let parsed: unknown = values[key];
      if (def?.type === 'number')  parsed = parseFloat(values[key] ?? '0') || 0;
      if (def?.type === 'boolean') parsed = values[key] === 'true';
      if (def?.type === 'json') {
        try { parsed = JSON.parse(values[key] ?? '[]'); }
        catch { setError(`Invalid JSON for ${key}`); setSaving(null); return; }
      }
      await adminUpdateSetting(key, parsed);
      setOriginals(o => ({ ...o, [key]: values[key] ?? '' }));
      setSavedKeys(s => new Set([...s, key]));
      setTimeout(() => setSavedKeys(s => { const n = new Set(s); n.delete(key); return n; }), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(null); }
  }

  const isDirty = (key: string) => values[key] !== originals[key];
  const loading = providersLoading || settingsLoading;

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
        <Pressable onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, flex: 1 }}>KYC Administration</Text>
        <View style={{ backgroundColor: DS.color.infoBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.info + '30' }}>
          <Text style={{ color: DS.color.info, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>ADMIN</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: DS.color.border, paddingHorizontal: DS.space.md }}>
        {([
          { key: 'providers',   label: 'Providers'    },
          { key: 'settings',    label: 'Settings'     },
          { key: 'attempts',    label: 'Attempts'     },
          { key: 'webhooks',    label: 'Webhooks'     },
          { key: 'diagnostics', label: 'Diagnostics'  },
        ] as { key: Tab; label: string }[]).map(tab => (
          <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)}
            style={{ paddingVertical: 13, paddingHorizontal: DS.space.sm, borderBottomWidth: 2, borderBottomColor: activeTab === tab.key ? DS.color.gold : 'transparent', marginRight: DS.space.xs }}>
            <Text style={{ color: activeTab === tab.key ? DS.color.gold : DS.color.text3, fontSize: DS.font.sm, fontWeight: activeTab === tab.key ? DS.font.semibold : DS.font.regular }}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.md }} contentInsetAdjustmentBehavior="automatic">

          {error ? (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.md, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
              <AlertTriangle size={15} color={DS.color.sell} />
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
            </View>
          ) : null}

          {/* ── Providers tab ──────────────────────────────────────────────── */}
          {activeTab === 'providers' && (
            <>
              <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
                <Info size={13} color={DS.color.gold} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                  Prembly IdentityPass is priority 1 — the default for all countries. Dojah EasyOnboard is the fallback at priority 2. Other providers act as configurable fallbacks. Every change creates an audit record.
                </Text>
              </View>

              {providers.map(p => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onToggleEnabled={() => mutateProvider(p.id, { enabled: !p.enabled })}
                  onPriorityChange={(v) => {
                    const n = parseInt(v, 10);
                    if (!isNaN(n) && n > 0 && p.providerName !== 'prembly') mutateProvider(p.id, { priority: n });
                  }}
                  onToggleFallback={() => mutateProvider(p.id, { autoFallback: !p.autoFallback })}
                  onConfigChange={(patch) => {
                    // Merge config patch into the provider's config object and mark dirty
                    mutateProvider(p.id, { config: { ...(p.config ?? {}), ...patch } });
                  }}
                  onSave={() => saveProvider(p)}
                  onSetDefault={() => handleSetDefault(p.providerName)}
                  saving={providerSaving === p.id}
                  settingDefault={settingDefaultFor === p.providerName}
                  dirty={!!providerDirty[p.id]}
                />
              ))}

              {providers.length === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: DS.space.xl }}>
                  <Shield size={32} color={DS.color.text3} />
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, marginTop: DS.space.sm }}>No providers configured</Text>
                </View>
              )}
            </>
          )}

          {/* ── Settings tab ──────────────────────────────────────────────── */}
          {activeTab === 'settings' && (
            <>
              <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.warn + '30' }}>
                <Info size={13} color={DS.color.warn} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                  Changes take effect immediately. Each setting is saved individually.
                </Text>
              </View>

              <VerificationReport />

              {SETTING_SECTIONS.map(section => {
                const defs = SETTING_DEFS.filter(d => d.section === section);
                const isCollapsed = collapsed[section];
                return (
                  <View key={section} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden' }}>
                    <Pressable onPress={() => setCollapsed(c => ({ ...c, [section]: !c[section] }))}
                      style={{ flexDirection: 'row', alignItems: 'center', padding: DS.space.md, borderBottomWidth: isCollapsed ? 0 : 1, borderBottomColor: DS.color.border }}>
                      <Settings size={13} color={DS.color.gold} style={{ marginRight: DS.space.xs }} />
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, flex: 1 }}>{section}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginRight: DS.space.xs }}>{defs.length}</Text>
                      <ChevronDown size={13} color={DS.color.text3} style={{ transform: [{ rotate: isCollapsed ? '0deg' : '180deg' }] }} />
                    </Pressable>

                    {!isCollapsed && defs.map((def, idx) => (
                      <View key={def.key} style={{ padding: DS.space.md, borderBottomWidth: idx < defs.length - 1 ? 1 : 0, borderBottomColor: DS.color.border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: DS.space.xs }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.medium }}>{def.label}</Text>
                            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>{def.description}</Text>
                          </View>
                          {savedKeys.has(def.key) && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <CheckCircle size={12} color={DS.color.buy} fill={DS.color.buy} />
                              <Text style={{ color: DS.color.buy, fontSize: DS.font.xxs }}>Saved</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                          {def.key === 'default_provider' ? (
                            // Read-only — source of truth is kyc_providers.is_default (Providers tab)
                            <View style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                              <Shield size={12} color={DS.color.gold} />
                              <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, flex: 1 }}>
                                {values[def.key]?.replace(/"/g, '') || 'prembly'}
                              </Text>
                              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>read-only</Text>
                            </View>
                          ) : (
                            <>
                              <TextInput
                                value={values[def.key] ?? ''}
                                onChangeText={v => setValues(p => ({ ...p, [def.key]: v }))}
                                placeholder={def.type === 'json' ? '["US","GB"]' : def.type === 'number' ? '0' : ''}
                                placeholderTextColor={DS.color.text3}
                                keyboardType={def.type === 'number' ? 'numeric' : 'default'}
                                style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: DS.color.text1, fontSize: DS.font.xs, borderWidth: 1, borderColor: isDirty(def.key) ? DS.color.gold + '60' : DS.color.border, fontFamily: def.type === 'json' ? 'monospace' : undefined }} />
                              <Pressable onPress={() => handleSaveSetting(def.key)} disabled={!isDirty(def.key) || saving === def.key}
                                style={{ backgroundColor: isDirty(def.key) ? DS.color.gold : DS.color.surface, borderRadius: DS.radius.sm, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: isDirty(def.key) ? DS.color.goldDark : DS.color.border }}>
                                {saving === def.key
                                  ? <ActivityIndicator size="small" color={DS.color.bg} />
                                  : <Save size={14} color={isDirty(def.key) ? DS.color.bg : DS.color.text3} />}
                              </Pressable>
                            </>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })}
            </>
          )}

          {/* ── Attempts tab ──────────────────────────────────────────────── */}
          {activeTab === 'attempts' && (
            <>
              <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, padding: DS.space.sm,
                flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
                <Shield size={13} color={DS.color.gold} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                  Tap an attempt to expand the decision panel. Approve, Reject, Escalate, Request Info and Add Note all update <Text style={{ fontWeight: DS.font.bold }}>kyc_attempts</Text> as the authoritative record, then sync the user profile. Manual decisions are protected from provider overwrites.
                </Text>
              </View>
              <RecentAttempts />
            </>
          )}

          {/* ── Webhooks tab ──────────────────────────────────────────────── */}
          {activeTab === 'webhooks' && (
            <>
              <View style={{ backgroundColor: DS.color.infoBg, borderRadius: DS.radius.md, padding: DS.space.sm,
                flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.info + '30' }}>
                <Webhook size={13} color={DS.color.info} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                  Every webhook event received from Dojah is logged here with its processing status and error detail.
                </Text>
              </View>
              <WebhookAuditLog />
            </>
          )}

          {/* ── Diagnostics tab ─────────────────────────────────────────── */}
          {activeTab === 'diagnostics' && (
            <>
              {/* Header + run button */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Provider Configuration Diagnostics</Text>
                  {diagLastRun && (
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>Last run: {diagLastRun}</Text>
                  )}
                </View>
                <Pressable onPress={runDiagnostics} disabled={diagLoading}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 8, borderWidth: 1, borderColor: DS.color.border }}>
                  {diagLoading
                    ? <ActivityIndicator size="small" color={DS.color.gold} />
                    : <RefreshCw size={13} color={DS.color.gold} />}
                  <Text style={{ color: DS.color.gold, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>
                    {diagLoading ? 'Running…' : 'Run Checks'}
                  </Text>
                </Pressable>
              </View>

              {/* Info banner */}
              <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
                <Info size={13} color={DS.color.gold} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                  Checks kyc_providers ↔ kyc_settings consistency, default provider health, fallback availability, and priority conflicts. Use the Providers tab to fix any issues found.
                </Text>
              </View>

              {/* Results */}
              {diagLoading && diagnostics.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: DS.space.xl }}>
                  <ActivityIndicator color={DS.color.gold} size="large" />
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, marginTop: DS.space.sm }}>Running diagnostics…</Text>
                </View>
              ) : diagnostics.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: DS.space.xl, gap: DS.space.sm }}>
                  <Terminal size={32} color={DS.color.text3} />
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.sm }}>Press "Run Checks" to inspect configuration</Text>
                </View>
              ) : (
                <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden' }}>
                  {diagnostics.map((d, idx) => {
                    const isOk    = d.status === 'ok';
                    const isWarn  = d.status === 'warn';
                    const isError = d.status === 'error';
                    const statusColor = isOk ? DS.color.buy : isWarn ? DS.color.warn : DS.color.sell;
                    const StatusIcon  = isOk ? CheckCircle : isWarn ? AlertTriangle : AlertCircle;
                    return (
                      <View key={d.key} style={{
                        padding: DS.space.md,
                        borderBottomWidth: idx < diagnostics.length - 1 ? 1 : 0,
                        borderBottomColor: DS.color.border,
                        backgroundColor: isError ? DS.color.sellBg + '40' : isWarn ? DS.color.warnBg + '30' : 'transparent',
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: DS.space.sm }}>
                          <StatusIcon size={15} color={statusColor} fill={isOk ? statusColor : undefined} style={{ marginTop: 1 }} />
                          <View style={{ flex: 1, gap: 3 }}>
                            <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.medium }}>{d.label}</Text>
                            <Text style={{ color: isOk ? DS.color.text3 : statusColor, fontSize: DS.font.xxs, lineHeight: 15 }}>{d.detail}</Text>
                          </View>
                          <View style={{ backgroundColor: statusColor + '20', borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ color: statusColor, fontSize: DS.font.xxs, fontWeight: DS.font.extrabold, textTransform: 'uppercase' }}>
                              {d.status}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Summary counts */}
              {diagnostics.length > 0 && (
                <View style={{ flexDirection: 'row', gap: DS.space.sm }}>
                  {(['ok', 'warn', 'error'] as const).map(s => {
                    const count = diagnostics.filter(d => d.status === s).length;
                    const color = s === 'ok' ? DS.color.buy : s === 'warn' ? DS.color.warn : DS.color.sell;
                    const bg    = s === 'ok' ? DS.color.buyBg : s === 'warn' ? DS.color.warnBg : DS.color.sellBg;
                    if (count === 0) return null;
                    return (
                      <View key={s} style={{ flex: 1, backgroundColor: bg, borderRadius: DS.radius.md, padding: DS.space.sm, alignItems: 'center', borderWidth: 1, borderColor: color + '30' }}>
                        <Text style={{ color, fontSize: DS.font.xl, fontWeight: DS.font.extrabold }}>{count}</Text>
                        <Text style={{ color, fontSize: DS.font.xxs, textTransform: 'uppercase', fontWeight: DS.font.semibold }}>{s}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}
