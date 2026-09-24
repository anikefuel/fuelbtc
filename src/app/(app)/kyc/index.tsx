// KYC Verification Screen
// Flow: country select → resolveKycProvider → backend creates attempt (EXX-KYC-{UUID}) →
//       navigate to embedded WebView route → sync status on return → update UI
//
// Security:
//  • Private key NEVER reaches this file
//  • Prembly/Dojah embedded via WebView — no popup, no new browser tab
//  • Tier 2 granted only after backend webhook/poll confirms — never from frontend callback
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Platform, StatusBar, FlatList } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/client/supabase';
import {
  ArrowLeft, Globe, ShieldCheck, Shield, CheckCircle, XCircle,
  Clock, AlertTriangle, RefreshCw, Info, ChevronDown, ExternalLink,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import {
  getLatestKyc, initiateKyc, submitAppeal, syncDojahStatus, syncPremblyStatus,
  resolveKycProvider,
  KYC_TIER_INFO, KYC_STATUS_LABEL, KYC_STATUS_ADMIN_LABEL, DOJAH_WIDGET_ID,
  type KycSubmission, type KycDisplayStatus, type KycProvider,
} from '@/services/kyc.service';
import { getProfile } from '@/services/auth.service';
import DojahWidget, { type DojahWidgetParams } from '@/components/shared/DojahWidget';

// ── Country list ───────────────────────────────────────────────────────────────
const COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },        { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },        { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },         { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },        { code: 'PL', name: 'Poland' },
  { code: 'AT', name: 'Austria' },       { code: 'BE', name: 'Belgium' },
  { code: 'DK', name: 'Denmark' },       { code: 'FI', name: 'Finland' },
  { code: 'IE', name: 'Ireland' },       { code: 'PT', name: 'Portugal' },
  { code: 'CZ', name: 'Czech Republic' },{ code: 'RO', name: 'Romania' },
  { code: 'HU', name: 'Hungary' },       { code: 'HR', name: 'Croatia' },
  { code: 'BG', name: 'Bulgaria' },      { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },      { code: 'LT', name: 'Lithuania' },
  { code: 'LV', name: 'Latvia' },        { code: 'EE', name: 'Estonia' },
  { code: 'LU', name: 'Luxembourg' },    { code: 'MT', name: 'Malta' },
  { code: 'CY', name: 'Cyprus' },        { code: 'GR', name: 'Greece' },
  { code: 'NG', name: 'Nigeria' },       { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },         { code: 'ZA', name: 'South Africa' },
  { code: 'EG', name: 'Egypt' },         { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },      { code: 'BD', name: 'Bangladesh' },
  { code: 'PH', name: 'Philippines' },   { code: 'ID', name: 'Indonesia' },
  { code: 'MY', name: 'Malaysia' },      { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' },       { code: 'TR', name: 'Turkey' },
  { code: 'BR', name: 'Brazil' },        { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },     { code: 'CO', name: 'Colombia' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },         { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },   { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },   { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
];

const DOC_TYPES = [
  { value: 'passport',         label: 'Passport' },
  { value: 'national_id',      label: 'National ID' },
  { value: 'drivers_licence',  label: "Driver's Licence" },
  { value: 'residence_permit', label: 'Residence Permit' },
];

// ── Status helpers ─────────────────────────────────────────────────────────────
function statusColor(s: KycDisplayStatus | string): string {
  switch (s) {
    case 'approved': case 'verified':               return DS.color.buy;
    case 'rejected': case 'failed':                 return DS.color.sell;
    case 'pending': case 'under_review':
    case 'in_progress': case 'submitted':
    case 'pending_review':                          return DS.color.gold;
    case 'needs_manual_review': case 'manual_review':
    case 'resubmission_required':                   return DS.color.warn;
    case 'provider_unavailable':                    return DS.color.text2;
    default:                                        return DS.color.text3;
  }
}

function statusBg(s: KycDisplayStatus | string): string {
  switch (s) {
    case 'approved': case 'verified':               return DS.color.buyBg;
    case 'rejected': case 'failed':                 return DS.color.sellBg;
    case 'pending': case 'under_review':
    case 'in_progress': case 'submitted':
    case 'pending_review':                          return DS.color.goldBg;
    case 'needs_manual_review': case 'manual_review':
    case 'resubmission_required':                   return DS.color.warnBg;
    default:                                        return DS.color.surface;
  }
}

function isVerified(status: KycDisplayStatus | string | undefined): boolean {
  return status === 'approved' || status === 'verified';
}

function isActive(status: KycDisplayStatus | string | undefined): boolean {
  return ['pending', 'under_review', 'in_progress', 'submitted', 'pending_review', 'manual_review'].includes(status ?? '');
}

function isRetryable(status: KycDisplayStatus | string | undefined): boolean {
  return ['not_started', 'rejected', 'failed', 'expired', 'abandoned', 'resubmission_required', 'provider_unavailable'].includes(status ?? '');
}

function statusBadgeLabel(s: string): string {
  return KYC_STATUS_ADMIN_LABEL[s] ?? s.replace(/_/g, ' ');
}

function CheckRow({ label, result }: { label: string; result?: string }) {
  if (!result || result === 'not_run') return null;
  const passed = result === 'passed';
  const failed = result === 'failed' || result === 'risk_detected' || result === 'hit';
  const inc    = result === 'inconclusive';
  const color  = passed ? DS.color.buy : failed ? DS.color.sell : DS.color.warn;
  const Icon   = passed ? CheckCircle : failed ? XCircle : AlertTriangle;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon size={12} color={color} fill={passed ? color : 'transparent'} />
        <Text style={{ color, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'capitalize' }}>
          {inc ? 'Inconclusive' : result.replace(/_/g, ' ')}
        </Text>
      </View>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function KycVerificationScreen() {
  const router = useRouter();
  const pt = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8;

  const [submission, setSubmission]         = useState<KycSubmission | null>(null);
  const [loadingData, setLoadingData]       = useState(true);
  const [initiating, setInitiating]         = useState(false);
  const [error, setError]                   = useState('');
  const [syncingStatus, setSyncingStatus]   = useState(false);

  // Attempt tracking
  const [currentAttemptId, setCurrentAttemptId]     = useState<string | undefined>(undefined);
  const [currentReferenceId, setCurrentReferenceId] = useState<string | undefined>(undefined);

  // SDK WebView fallback (when hosted URL not available)
  const [dojahWidget, setDojahWidget]       = useState<DojahWidgetParams | null>(null);

  // Country / doc type selection
  const [showCountryPicker, setShowCountryPicker]   = useState(false);
  const [countrySearch, setCountrySearch]           = useState('');
  const [selectedCountry, setSelectedCountry]       = useState<{ code: string; name: string } | null>(null);
  const [selectedDocType, setSelectedDocType]       = useState('passport');
  const [showDocPicker, setShowDocPicker]           = useState(false);

  // Appeal state
  const [appealReason, setAppealReason]     = useState('');
  const [appealLoading, setAppealLoading]   = useState(false);
  const [appealDone, setAppealDone]         = useState(false);

  // Resolved provider — populated from kyc_providers (single source of truth)
  const [resolvedProviderLabel, setResolvedProviderLabel] = useState('Prembly IdentityPass');
  const [resolvedProviderReason, setResolvedProviderReason] = useState<string>('default_provider');

  const filteredCountries = countrySearch.length > 0
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
        c.code.includes(countrySearch.toUpperCase()))
    : COUNTRIES;

  // ── Resolve provider whenever country changes ──────────────────────────────
  // kyc_providers is the single source of truth — no hardcoded provider names
  useFocusEffect(useCallback(() => {
    let active = true;
    const cc = selectedCountry?.code ?? 'NG';
    (async () => {
      try {
        const resolved = await resolveKycProvider(cc);
        if (active) {
          setResolvedProviderLabel(resolved.displayName);
          setResolvedProviderReason(resolved.reason);
        }
      } catch {
        // Keep current label on error — non-critical
      }
    })();
    return () => { active = false; };
  }, [selectedCountry?.code]));

  // ── Load on focus ──────────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setError('');
      try {
        setLoadingData(true);
        const { data: { user: sessionUser } } = await supabase.auth.getUser();
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!sessionUser || !uuidRe.test(sessionUser.id)) {
          if (active) await supabase.auth.signOut();
          return;
        }
        const [sub, profile] = await Promise.all([getLatestKyc(), getProfile()]);
        if (!active) return;
        setSubmission(sub);
        if (!selectedCountry && profile?.country) {
          const match = COUNTRIES.find(c => c.code === profile.country?.toUpperCase() || c.name === profile.country);
          if (match) setSelectedCountry(match);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load KYC status');
      } finally {
        if (active) setLoadingData(false);
      }
    })();
    return () => { active = false; };
  }, []));

  // ── Start verification ─────────────────────────────────────────────────────
  async function handleStartVerification() {
    if (!selectedCountry) { setError('Please select your country first'); return; }
    setError('');
    setInitiating(true);
    try {
      const result = await initiateKyc({ countryCode: selectedCountry.code, docType: selectedDocType });
      setCurrentAttemptId(result.attemptId);
      setCurrentReferenceId(result.referenceId);

      if (result.provider === 'prembly') {
        // PRIMARY: Prembly embedded widget — no popup, no new tab
        router.push(`/(app)/kyc/prembly/${result.attemptId}` as never);
      } else if (result.provider === 'dojah') {
        // FALLBACK: Dojah embedded WebView — no popup, no new tab
        router.push(`/(app)/kyc/dojah/${result.attemptId}` as never);
      } else {
        setError('Verification provider is currently unavailable. Please try again later.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed. Please try again.');
    } finally {
      setInitiating(false);
    }
  }

  // ── Post-widget sync (called on focus-return from embed route) ────────────
  async function handlePostWidget(attemptId?: string, submissionId?: string, provider?: KycProvider) {
    setSyncingStatus(true);
    try {
      if (attemptId) {
        if (provider === 'prembly') {
          await syncPremblyStatus(attemptId);
        } else {
          await syncDojahStatus(submissionId, attemptId);
        }
      }
      const updated = await getLatestKyc();
      setSubmission(updated);
    } catch { /* non-fatal */ }
    finally { setSyncingStatus(false); }
  }

  // ── Dojah SDK widget callbacks (inline fallback mode only) ─────────────────
  async function handleDojahSuccess(_referenceId: string) {
    setDojahWidget(null);
    await handlePostWidget(currentAttemptId, dojahWidget?.submissionId, 'dojah');
  }

  function handleDojahError(err: string) {
    setDojahWidget(null);
    setError(err || 'Verification widget encountered an error. Please try again.');
  }

  async function handleDojahClose() {
    setDojahWidget(null);
    await handlePostWidget(currentAttemptId, dojahWidget?.submissionId, 'dojah');
  }

  // ── Appeal ─────────────────────────────────────────────────────────────────
  async function handleAppeal() {
    if (!submission || !appealReason.trim()) return;
    setAppealLoading(true);
    try {
      await submitAppeal(submission.id, appealReason.trim());
      setAppealDone(true);
      setSubmission(await getLatestKyc());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit appeal');
    } finally {
      setAppealLoading(false);
    }
  }

  async function handleRefresh() {
    setError('');
    setLoadingData(true);
    try {
      const s = submission?.status ?? '';
      if (isActive(s)) await syncDojahStatus(submission?.id, currentAttemptId);
      setSubmission(await getLatestKyc());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setLoadingData(false);
    }
  }

  // ── SDK WebView full-screen ────────────────────────────────────────────────
  if (dojahWidget) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
          <Pressable onPress={handleDojahClose}
            style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, flex: 1 }}>Identity Verification</Text>
        </View>
        <DojahWidget {...dojahWidget} onSuccess={handleDojahSuccess} onError={handleDojahError} onClose={handleDojahClose} />
      </View>
    );
  }

  // ── Country picker overlay ─────────────────────────────────────────────────
  if (showCountryPicker) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
          <Pressable onPress={() => { setShowCountryPicker(false); setCountrySearch(''); }}
            style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, flex: 1 }}>Select Country</Text>
        </View>
        <View style={{ paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
          <TextInput value={countrySearch} onChangeText={setCountrySearch} placeholder="Search countries..."
            placeholderTextColor={DS.color.text3}
            style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 9, color: DS.color.text1, fontSize: DS.font.sm, borderWidth: 1, borderColor: DS.color.border }} />
        </View>
        <FlatList
          data={filteredCountries}
          keyExtractor={item => item.code}
          contentInsetAdjustmentBehavior="automatic"
          renderItem={({ item }) => (
            <Pressable onPress={() => { setSelectedCountry(item); setShowCountryPicker(false); setCountrySearch(''); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, width: 36 }}>{item.code}</Text>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, flex: 1 }}>{item.name}</Text>
              {selectedCountry?.code === item.code && <CheckCircle size={14} color={DS.color.gold} fill={DS.color.gold} />}
            </Pressable>
          )}
        />
      </View>
    );
  }

  // ── Main content ───────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
        <Pressable onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, flex: 1 }}>Identity Verification</Text>
        <Pressable onPress={handleRefresh} disabled={loadingData || syncingStatus}
          style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          {loadingData || syncingStatus
            ? <ActivityIndicator size="small" color={DS.color.gold} />
            : <RefreshCw size={16} color={DS.color.text2} />}
        </Pressable>
      </View>

      {loadingData ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginTop: DS.space.sm }}>Loading verification status…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.md }} contentInsetAdjustmentBehavior="automatic">

          {error ? (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.md, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
              <AlertTriangle size={14} color={DS.color.sell} />
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
            </View>
          ) : null}

          {/* Syncing overlay */}
          {syncingStatus && (
            <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
              <ActivityIndicator size="small" color={DS.color.gold} />
              <Text style={{ color: DS.color.gold, fontSize: DS.font.xs }}>Confirming verification status…</Text>
            </View>
          )}

          {/* Verified banner */}
          {isVerified(submission?.status) && (
            <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.xl, padding: DS.space.lg, alignItems: 'center', gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.buy + '30' }}>
              <ShieldCheck size={44} color={DS.color.buy} fill={DS.color.buyBg} />
              <Text style={{ color: DS.color.buy, fontWeight: DS.font.extrabold, fontSize: DS.font.xl }}>Verified</Text>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, textAlign: 'center' }}>
                Your identity has been verified. Tier 2 limits are now unlocked.
              </Text>
              {submission?.expiresAt && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} color={DS.color.text3} />
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Valid until {new Date(submission.expiresAt).toLocaleDateString()}</Text>
                </View>
              )}
            </View>
          )}

          {/* Current submission status */}
          {submission && !isVerified(submission.status) ? (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: DS.space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5 }}>VERIFICATION STATUS</Text>
                <View style={{ backgroundColor: statusBg(submission.status), borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: statusColor(submission.status), fontSize: DS.font.xxs, fontWeight: DS.font.extrabold }}>
                    {statusBadgeLabel(submission.status)}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                <Shield size={12} color={DS.color.text3} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1 }}>
                  {KYC_STATUS_LABEL[submission.status] ?? submission.status}
                </Text>
              </View>

              {/* Reference ID */}
              {(submission.providerRefId ?? currentReferenceId) && (
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
                  Ref: {submission.providerRefId ?? currentReferenceId}
                </Text>
              )}

              {/* Active state hint */}
              {isActive(submission.status) && (
                <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, padding: DS.space.sm, marginTop: DS.space.xs, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
                  <Info size={13} color={DS.color.gold} />
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                    Your verification is being processed. Tier 2 limits will be unlocked once confirmed. Pull to refresh.
                  </Text>
                </View>
              )}

              {/* Provider unavailable hint */}
              {submission.status === 'provider_unavailable' && (
                <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.sm, marginTop: DS.space.xs, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                  <AlertTriangle size={13} color={DS.color.text2} />
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                    The verification service is temporarily unavailable. Please try again later.
                  </Text>
                </View>
              )}

              {submission.rejectionReason && (
                <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, padding: DS.space.sm, marginTop: DS.space.xs, borderWidth: 1, borderColor: DS.color.sell + '25' }}>
                  <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>Reason: {submission.rejectionReason}</Text>
                </View>
              )}

              {/* Check results */}
              {(submission.resultDocVerify || submission.resultFaceMatch || submission.resultAml) && (
                <View style={{ marginTop: DS.space.sm }}>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5, marginBottom: DS.space.xs }}>VERIFICATION CHECKS</Text>
                  <CheckRow label="Document Verification" result={submission.resultDocVerify} />
                  <CheckRow label="Face Match"            result={submission.resultFaceMatch} />
                  <CheckRow label="Liveness Detection"    result={submission.resultLiveness} />
                  <CheckRow label="AML Screening"         result={submission.resultAml} />
                  <CheckRow label="PEP Screening"         result={submission.resultPep} />
                  <CheckRow label="Sanctions Screening"   result={submission.resultSanctions} />
                  <CheckRow label="Fraud Detection"       result={submission.resultFraud} />
                </View>
              )}

              {submission.manualReviewReasons && submission.manualReviewReasons.length > 0 && (
                <View style={{ marginTop: DS.space.sm, backgroundColor: DS.color.warnBg, borderRadius: DS.radius.sm, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.warn + '30' }}>
                  <Text style={{ color: DS.color.warn, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: 4 }}>Manual Review Required</Text>
                  {submission.manualReviewReasons.map((r, i) => (
                    <Text key={i} style={{ color: DS.color.text2, fontSize: DS.font.xs }}>• {r}</Text>
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {/* Appeal section */}
          {(submission?.status === 'rejected' || submission?.status === 'failed') && !appealDone && (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, marginBottom: DS.space.xs }}>Appeal Decision</Text>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm }}>
                If you believe this decision is incorrect, provide context for your appeal.
              </Text>
              <TextInput value={appealReason} onChangeText={setAppealReason}
                placeholder="Explain why you believe the decision was incorrect..."
                placeholderTextColor={DS.color.text3} multiline numberOfLines={4}
                style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.sm, color: DS.color.text1, fontSize: DS.font.xs, minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.sm }} />
              <Pressable onPress={handleAppeal} disabled={!appealReason.trim() || appealLoading}
                style={{ backgroundColor: appealReason.trim() ? DS.color.warn : DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 12, alignItems: 'center' }}>
                {appealLoading
                  ? <ActivityIndicator color={DS.color.bg} size="small" />
                  : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Submit Appeal</Text>}
              </Pressable>
            </View>
          )}
          {appealDone && (
            <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.md, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.buy + '30' }}>
              <CheckCircle size={16} color={DS.color.buy} fill={DS.color.buy} />
              <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, flex: 1 }}>Appeal submitted. Our compliance team will review within 2–5 business days.</Text>
            </View>
          )}

          {/* Start/Retry verification */}
          {(!submission || isRetryable(submission.status)) && (
            <>
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: DS.space.sm }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
                  {submission?.status === 'resubmission_required' ? 'Resubmit Documents' : 'Start Verification'}
                </Text>

                {/* Country picker */}
                <View>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 5 }}>YOUR COUNTRY</Text>
                  <Pressable onPress={() => setShowCountryPicker(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
                    <Globe size={14} color={DS.color.text3} style={{ marginRight: DS.space.xs }} />
                    <Text style={{ color: selectedCountry ? DS.color.text1 : DS.color.text3, fontSize: DS.font.sm, flex: 1 }}>
                      {selectedCountry ? selectedCountry.name : 'Select country…'}
                    </Text>
                    <ChevronDown size={14} color={DS.color.text3} />
                  </Pressable>
                </View>

                {/* Provider info — resolved from kyc_providers (single source of truth) */}
                {selectedCountry && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
                    <ShieldCheck size={13} color={DS.color.gold} />
                    <Text style={{ color: DS.color.gold, fontSize: DS.font.xs }}>
                      Verification powered by{' '}
                      <Text style={{ fontWeight: DS.font.semibold }}>{resolvedProviderLabel}</Text>
                      {resolvedProviderReason === 'fallback_provider' && (
                        <Text style={{ fontWeight: '400' }}>{' '}(fallback)</Text>
                      )}
                    </Text>
                  </View>
                )}

                {/* Document type */}
                <View>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 5 }}>DOCUMENT TYPE</Text>
                  <Pressable onPress={() => setShowDocPicker(p => !p)}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
                    <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, flex: 1 }}>
                      {DOC_TYPES.find(d => d.value === selectedDocType)?.label ?? 'Passport'}
                    </Text>
                    <ChevronDown size={14} color={DS.color.text3} />
                  </Pressable>
                  {showDocPicker && (
                    <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, borderWidth: 1, borderColor: DS.color.border, marginTop: 4 }}>
                      {DOC_TYPES.map(d => (
                        <Pressable key={d.value} onPress={() => { setSelectedDocType(d.value); setShowDocPicker(false); }}
                          style={{ paddingHorizontal: DS.space.md, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ color: DS.color.text1, fontSize: DS.font.sm }}>{d.label}</Text>
                          {selectedDocType === d.value && <CheckCircle size={14} color={DS.color.gold} fill={DS.color.gold} />}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {/* Info */}
                <View style={{ flexDirection: 'row', gap: DS.space.xs, backgroundColor: DS.color.infoBg, borderRadius: DS.radius.sm, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.info + '25' }}>
                  <Info size={13} color={DS.color.info} />
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, lineHeight: 17 }}>
                    {"You'll be guided through identity verification in a secure browser session. Have your document and a clear view of your face ready."}
                  </Text>
                </View>
              </View>

              {/* Start button */}
              <Pressable onPress={handleStartVerification} disabled={!selectedCountry || initiating}
                style={{ backgroundColor: selectedCountry ? DS.color.gold : DS.color.surface, borderRadius: DS.radius.md, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: DS.space.xs }}>
                {initiating
                  ? <ActivityIndicator color={DS.color.bg} />
                  : <>
                      <ExternalLink size={18} color={selectedCountry ? DS.color.bg : DS.color.text3} />
                      <Text style={{ color: selectedCountry ? DS.color.bg : DS.color.text3, fontWeight: DS.font.bold, fontSize: DS.font.base }}>
                        {submission?.status === 'rejected' || submission?.status === 'failed' ? 'Retry Verification' : 'Start Verification'}
                      </Text>
                    </>}
              </Pressable>
            </>
          )}

          {/* Tier benefits */}
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5, marginBottom: DS.space.sm }}>WHAT YOU UNLOCK WITH TIER 2</Text>
            {[
              { label: 'Daily Withdrawal', value: '$10,000',       icon: <Shield size={13} color={DS.color.gold} /> },
              { label: 'Daily Trading',    value: '$100,000',      icon: <Shield size={13} color={DS.color.buy} /> },
              { label: 'P2P Trading',      value: '$20,000 / day', icon: <Shield size={13} color={DS.color.info} /> },
            ].map(row => (
              <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                {row.icon}
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, marginLeft: DS.space.xs }}>{row.label}</Text>
                <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{row.value}</Text>
              </View>
            ))}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}
