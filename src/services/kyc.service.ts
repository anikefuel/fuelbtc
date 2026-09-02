// KYC Service — multi-provider verification (Prembly default + Dojah fallback)
// Prembly IdentityPass is the priority-1 provider for ALL countries.
// Dojah EasyOnboard is the fallback at priority-2.
// Widget ID (Dojah fallback): 6a5b12349ff90fe054784334
import { supabase } from '@/client/supabase';

// ─── Constants ─────────────────────────────────────────────────────────────────
export const DOJAH_WIDGET_ID   = '6a5b12349ff90fe054784334';
export const DOJAH_HOSTED_URL  = `https://identity.dojah.io?widget_id=${DOJAH_WIDGET_ID}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type KycProvider = 'prembly' | 'dojah' | 'sumsub' | 'manual';

/** Internal KYC attempt statuses (new granular set) */
export type KycAttemptStatus =
  | 'not_started' | 'in_progress' | 'submitted' | 'pending_review'
  | 'verified' | 'failed' | 'abandoned' | 'resubmission_required'
  | 'provider_unavailable' | 'manual_review';

/** Legacy submission statuses + extended statuses used by kyc/index UI */
export type KycVerificationStatus =
  | 'not_started' | 'pending' | 'under_review' | 'approved'
  | 'rejected' | 'needs_manual_review' | 'expired'
  | 'failed' | 'resubmission_required' | 'provider_unavailable'
  | 'abandoned' | 'submitted' | 'pending_review';

/** Full type combining attempt + legacy statuses for UI */
export type KycDisplayStatus = KycAttemptStatus | KycVerificationStatus;

export interface KycAttempt {
  id: string;
  userId: string;
  submissionId?: string;
  provider: KycProvider;
  providerPriority: number;
  referenceId: string;       // EXX-KYC-{UUID}
  widgetId?: string;
  countryCode?: string;
  docType?: string;
  status: KycAttemptStatus;
  rawProviderStatus?: string;
  providerRefId?: string;
  fallbackProvider?: string;
  failureReason?: string;
  startedAt: string;
  submittedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface KycProviderConfig {
  id: string;
  providerName: KycProvider;
  displayName: string;
  enabled: boolean;
  priority: number;
  isDefault: boolean;           // ← authoritative default flag (source of truth)
  supportedCountries: string[];
  supportedDocTypes: string[];
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  failureCount: number;
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  autoFallback: boolean;
  manualSelection: boolean;
  config: Record<string, unknown>;
  updatedAt: string;
}

export interface KycSubmission {
  id: string;
  userId: string;
  tier: string;
  status: KycVerificationStatus;
  provider?: KycProvider;
  providerRefId?: string;
  countryCode?: string;
  docType?: string;
  fullName?: string;
  dateOfBirth?: string;
  docNumberMasked?: string;
  rejectionReason?: string;
  reviewedAt?: string;
  expiresAt?: string;
  // Per-check results
  resultDocVerify?: string;
  resultFaceMatch?: string;
  resultLiveness?: string;
  resultAddress?: string;
  resultAml?: string;
  resultPep?: string;
  resultSanctions?: string;
  resultFraud?: string;
  resultDuplicate?: string;
  confidenceScore?: number;
  fraudRiskScore?: number;
  manualReviewReasons?: string[];
  createdAt: string;
}

export interface KycDocument {
  id: string;
  submissionId: string;
  docType: string;
  storagePath: string;
  mimeType: string;
  createdAt: string;
  signedUrl?: string; // populated on demand
}

export interface KycAuditEntry {
  id: string;
  submissionId?: string;
  userId: string;
  actorId?: string;
  action: string;
  oldStatus?: string;
  newStatus?: string;
  reason?: string;
  notes?: string;
  createdAt: string;
}

export interface KycSetting {
  key: string;
  value: unknown;
}

// ─── Provider routing — Prembly is priority-1 default ────────────────────────
/** Prembly is the default provider for ALL countries. Dojah is the fallback. */
export function resolveProvider(_countryCode: string): KycProvider {
  return 'prembly';
}

/**
 * Shared provider resolver — reads `kyc_providers` as the single source of truth.
 * Routing order:
 *   1. Enabled provider with is_default=true and healthy status
 *   2. Next enabled provider by priority (fallback)
 *   3. 'manual' as final fallback
 *
 * Returns { provider, displayName, reason }
 */
export async function resolveKycProvider(
  countryCode: string,
  _docType?: string,
): Promise<{ provider: KycProvider; displayName: string; reason: string }> {
  const { data, error } = await supabase
    .from('kyc_providers')
    .select('provider_name, display_name, enabled, priority, is_default, health_status, supported_countries')
    .eq('enabled', true)
    .order('priority', { ascending: true });

  if (error || !data?.length) {
    return { provider: 'manual', displayName: 'Manual Review', reason: 'no_providers_configured' };
  }

  const cc = countryCode.toUpperCase();

  // Helpers
  const supportsCountry = (row: Record<string, unknown>) => {
    const countries = (row.supported_countries as string[]) ?? [];
    return countries.length === 0 || countries.includes(cc);
  };
  const isHealthy = (row: Record<string, unknown>) => {
    const h = (row.health_status as string) ?? 'unknown';
    return h === 'healthy' || h === 'unknown'; // unknown treated as available
  };

  // Step 1: default provider (is_default=true) if healthy + supports country
  const defaultRow = data.find(r => r.is_default && isHealthy(r) && supportsCountry(r));
  if (defaultRow) {
    return {
      provider:    defaultRow.provider_name as KycProvider,
      displayName: defaultRow.display_name as string,
      reason:      'default_provider',
    };
  }

  // Step 2: next available by priority
  const fallbackRow = data.find(
    r => !r.is_default && r.provider_name !== 'manual' && isHealthy(r) && supportsCountry(r),
  );
  if (fallbackRow) {
    return {
      provider:    fallbackRow.provider_name as KycProvider,
      displayName: fallbackRow.display_name as string,
      reason:      'fallback_provider',
    };
  }

  // Step 3: manual review
  return { provider: 'manual', displayName: 'Manual Review', reason: 'no_provider_available' };
}

// ─── Tier info (static display) ───────────────────────────────────────────────

export interface KycTierInfo {
  tier: string;
  label: string;
  description: string;
  dailyWithdrawalUsd: number;
  dailyTradingUsd: number;
  requirements: string[];
}

export const KYC_TIER_INFO: KycTierInfo[] = [
  {
    tier: 'tier0',
    label: 'Unverified',
    description: 'Account registered, email verified',
    dailyWithdrawalUsd: 0,
    dailyTradingUsd: 0,
    requirements: ['Email verification'],
  },
  {
    tier: 'tier1',
    label: 'Basic',
    description: 'Phone & basic profile completed',
    dailyWithdrawalUsd: 0,
    dailyTradingUsd: 5000,
    requirements: ['Phone verification', 'Basic profile'],
  },
  {
    tier: 'tier2',
    label: 'Verified',
    description: 'Identity verified via KYC provider',
    dailyWithdrawalUsd: 10000,
    dailyTradingUsd: 100000,
    requirements: ['Government-issued ID', 'Selfie / liveness', 'AML screening'],
  },
  {
    tier: 'tier3',
    label: 'Enhanced',
    description: 'Enhanced due diligence completed',
    dailyWithdrawalUsd: 100000,
    dailyTradingUsd: 1000000,
    requirements: ['Source of funds', 'Enhanced due diligence'],
  },
];

export const KYC_STATUS_LABEL: Record<string, string> = {
  // Canonical attempt statuses — used everywhere
  not_started:             'Not Started',
  in_progress:             'In Progress',
  submitted:               'Submitted',
  pending_review:          'Pending Review',
  verified:                'Verified',
  failed:                  'Failed',
  abandoned:               'Abandoned',
  resubmission_required:   'More Information Required',
  provider_unavailable:    'Provider Unavailable',
  manual_review:           'Manual Review',
  rejected:                'Rejected',
  // Legacy / profile enum aliases — map to canonical display
  pending:                 'Pending',
  under_review:            'Under Review',
  approved:                'Verified',            // legacy — treat same as verified
  needs_manual_review:     'Manual Review',
  expired:                 'Expired',
  none:                    'Not Started',
};

/** Admin-facing short label for status badges */
export const KYC_STATUS_ADMIN_LABEL: Record<string, string> = {
  not_started:            'Not Started',
  in_progress:            'In Progress',
  submitted:              'Submitted',
  pending_review:         'Pending Review',
  verified:               'Verified',
  failed:                 'Failed',
  rejected:               'Rejected',
  abandoned:              'Abandoned',
  resubmission_required:  'Info Required',
  manual_review:          'Manual Review',
  approved:               'Verified',
  needs_manual_review:    'Manual Review',
};

/** Return DS color key for a KYC status */
export function kycStatusColor(status: string, DS: Record<string, string>): string {
  if (['verified', 'approved'].includes(status))               return DS.buy;
  if (['rejected', 'failed'].includes(status))                 return DS.sell;
  if (['manual_review', 'needs_manual_review'].includes(status)) return DS.warn;
  if (['resubmission_required'].includes(status))              return DS.warn;
  return DS.gold;
}

/** Statuses that allow admin approval / rejection */
export const KYC_ACTIONABLE_STATUSES = [
  'in_progress', 'submitted', 'pending', 'pending_review', 'manual_review', 'resubmission_required',
];
/** Statuses that are terminal manual decisions — require force_override to change */
export const KYC_TERMINAL_STATUSES = ['verified', 'rejected'];

// ─── User-facing functions ─────────────────────────────────────────────────────

/** Get the current user's latest KYC submission — always filters by auth UUID */
export async function getLatestKyc(): Promise<KycSubmission | null> {
  // Get the auth UUID explicitly — never use profiles.uid (EXX display ID)
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user?.id) return null;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(user.id)) {
    console.error('[kyc] getLatestKyc: non-UUID user.id', user.id);
    return null;
  }

  // Also fetch profile.kyc_status to reconcile cases where an admin action updated
  // the profile but the submission row was not yet updated (e.g. rejected but shows pending).
  const [subRes, profileRes] = await Promise.all([
    supabase
      .from('kyc_submissions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('kyc_status')
      .eq('id', user.id)
      .maybeSingle(),
  ]);
  if (subRes.error) throw new Error('Unable to load your verification status. Please retry.');
  if (!subRes.data) return null;

  const mapped = mapKyc(subRes.data);
  // Reconcile: if admin rejected the profile but the submission still shows a stale
  // active/pending status, honour the profile's decision so the user sees the correct state.
  const profileStatus = profileRes.data?.kyc_status as string | undefined;
  const STALE_STATUSES = ['pending', 'in_progress', 'submitted', 'pending_review', 'manual_review'];
  if (profileStatus === 'rejected' && STALE_STATUSES.includes(mapped.status)) {
    mapped.status = 'rejected' as typeof mapped.status;
  }
  if (profileStatus === 'verified' && STALE_STATUSES.includes(mapped.status)) {
    mapped.status = 'verified' as typeof mapped.status;
  }
  return mapped;
}

/** Get KYC submission history for the current user */
export async function getKycHistory(): Promise<KycSubmission[]> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user?.id) return [];

  const { data, error } = await supabase
    .from('kyc_submissions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error('Unable to load verification history. Please retry.');
  return Array.isArray(data) ? data.map(mapKyc) : [];
}

/**
 * Initiate KYC via Edge Function — Dojah is the default provider for all countries.
 * Returns config_id+widget_key for Prembly, or hosted_url for Dojah.
 */
export async function initiateKyc(params: {
  countryCode:    string;
  docType?:       string;
  forceProvider?: KycProvider;
}): Promise<{
  attemptId:      string;
  submissionId:   string;
  provider:       KycProvider;
  referenceId:    string;        // EXX-KYC-{UUID}
  // Prembly fields
  configId?:      string;
  widgetKey?:     string;
  publicKey?:     string;
  environment?:   string;
  // Dojah fields
  hostedUrl?:     string;
  widgetId?:      string;
  // Shared
  userData?:      { first_name?: string; last_name?: string; email?: string; residence_country?: string };
}> {
  const body: Record<string, string> = {
    country_code: params.countryCode,
    doc_type:     params.docType ?? 'passport',
  };
  if (params.forceProvider) body.force_provider = params.forceProvider;

  const { data, error } = await supabase.functions.invoke('kyc-initiate', { body });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return {
    attemptId:    data.attempt_id ?? data.submission_id,
    submissionId: data.submission_id,
    provider:     data.provider as KycProvider,
    referenceId:  data.reference_id ?? data.provider_ref_id ?? '',
    configId:     data.config_id,
    widgetKey:    data.widget_key,
    publicKey:    data.public_key,
    environment:  data.environment,
    hostedUrl:    data.hosted_url,
    widgetId:     data.widget_id,
    userData:     data.user_data,
  };
}

/** Sync Prembly verification status via backend — never trusts frontend status */
export async function syncPremblyStatus(attemptId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('sync-prembly-kyc-status', {
    body: { attempt_id: attemptId },
  });
  if (error) {
    const msg = await error?.context?.text?.();
    console.warn('[kyc] syncPremblyStatus error:', msg || error.message);
    return null;
  }
  if (data?.error) { console.warn('[kyc] syncPremblyStatus:', data.error); return null; }
  return (data?.status as string) ?? null;
}

/**
 * Sync Dojah verification status — uses dedicated sync-dojah-kyc-status function.
 * Pass attemptId for best results; falls back to latest attempt for user.
 */
export async function syncDojahStatus(submissionId?: string, attemptId?: string): Promise<string | null> {
  const body: Record<string, string> = {};
  if (attemptId) body.attempt_id = attemptId;
  // submissionId kept for backward compat but not used by new function
  const { data, error } = await supabase.functions.invoke('sync-dojah-kyc-status', { body });
  if (error) {
    const msg = await error?.context?.text?.();
    console.warn('[kyc] syncDojahStatus error:', msg || error.message);
    // Fallback to old webhook function
    const fallback = await supabase.functions.invoke('kyc-webhook-dojah', {
      body: attemptId ? { attempt_id: attemptId } : { submission_id: submissionId },
    });
    return (fallback.data?.status as string) ?? null;
  }
  if (data?.error) { console.warn('[kyc] syncDojahStatus:', data.error); return null; }
  return (data?.status as string) ?? null;
}

/** Get a short-lived signed URL for a KYC document */
export async function getDocumentSignedUrl(docId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke(`kyc-get-doc-url?doc_id=${docId}`, { method: 'GET' } as never);
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data.signed_url as string;
}

/** List KYC documents for a submission */
export async function getSubmissionDocuments(submissionId: string): Promise<KycDocument[]> {
  const { data, error } = await supabase
    .from('kyc_documents')
    .select('*')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapDoc);
}

/** Submit an appeal after rejection */
export async function submitAppeal(submissionId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('kyc_submissions')
    .update({ status: 'needs_manual_review', appeal_at: new Date().toISOString() })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);

  // Always supply user_id from auth session — never use the EXX display uid from profiles.
  // kyc_audit_log.user_id is uuid NOT NULL (references profiles.id = auth UUID).
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('kyc_audit_log').insert({
    submission_id: submissionId,
    user_id:       user.id,   // Supabase auth UUID — never profile.uid (EXX display ID)
    action:        'appeal_submitted',
    reason,
    new_status:    'needs_manual_review',
  });
}

/** Load KYC settings (admin-configured runtime values) */
export async function getKycSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('kyc_settings').select('key, value');
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map(r => [r.key, r.value]));
}

// ─── Unified admin KYC types ───────────────────────────────────────────────────

/** Full admin view of a KYC attempt — source of truth is kyc_attempts + profiles */
export interface KycAttemptAdmin {
  // Attempt fields
  id:                  string;
  userId:              string;
  submissionId?:       string;
  provider:            string;
  referenceId:         string;
  providerReference?:  string;
  widgetId?:           string;
  countryCode?:        string;
  docType?:            string;
  status:              string;
  rawProviderStatus?:  string;
  failureReason?:      string;
  reviewReason?:       string;
  manualReviewReasons?: string[];
  resultDocVerify?:    string;
  resultFaceMatch?:    string;
  resultLiveness?:     string;
  resultAml?:          string;
  resultPep?:          string;
  resultSanctions?:    string;
  resultFraud?:        string;
  confidenceScore?:    number;
  fraudRiskScore?:     number;
  fullName?:           string;
  dateOfBirth?:        string;
  startedAt?:          string;
  submittedAt?:        string;
  completedAt?:        string;
  lastWebhookAt?:      string;
  createdAt:           string;
  updatedAt?:          string;
  // Profile fields (joined)
  email?:              string;
  username?:           string;
  displayName?:        string;
  customerReference?:  string;  // EXX display ID (text)
  exchangeUserId?:     string;  // EXX display ID (text)
  profileCountry?:     string;
}

function mapAttemptAdmin(row: Record<string, unknown>): KycAttemptAdmin {
  const p = (row.profiles ?? {}) as Record<string, unknown>;
  return {
    id:                  row.id as string,
    userId:              row.user_id as string,
    submissionId:        (row.submission_id as string) ?? undefined,
    provider:            row.provider as string,
    referenceId:         row.reference_id as string,
    providerReference:   (row.provider_reference as string) ?? undefined,
    widgetId:            (row.widget_id as string) ?? undefined,
    countryCode:         (row.country_code as string) ?? undefined,
    docType:             (row.doc_type as string) ?? undefined,
    status:              row.status as string,
    rawProviderStatus:   (row.raw_provider_status as string) ?? undefined,
    failureReason:       (row.failure_reason as string) ?? undefined,
    reviewReason:        (row.review_reason as string) ?? undefined,
    manualReviewReasons: Array.isArray(row.manual_review_reasons) ? row.manual_review_reasons as string[] : [],
    resultDocVerify:     (row.result_doc_verify as string) ?? undefined,
    resultFaceMatch:     (row.result_face_match as string) ?? undefined,
    resultLiveness:      (row.result_liveness as string) ?? undefined,
    resultAml:           (row.result_aml as string) ?? undefined,
    resultPep:           (row.result_pep as string) ?? undefined,
    resultSanctions:     (row.result_sanctions as string) ?? undefined,
    resultFraud:         (row.result_fraud as string) ?? undefined,
    confidenceScore:     (row.confidence_score as number) ?? undefined,
    fraudRiskScore:      (row.fraud_risk_score as number) ?? undefined,
    fullName:            (row.full_name as string) ?? undefined,
    dateOfBirth:         (row.date_of_birth as string) ?? undefined,
    startedAt:           (row.started_at as string) ?? undefined,
    submittedAt:         (row.submitted_at as string) ?? undefined,
    completedAt:         (row.completed_at as string) ?? undefined,
    lastWebhookAt:       (row.last_webhook_at as string) ?? undefined,
    createdAt:           row.created_at as string,
    updatedAt:           (row.updated_at as string) ?? undefined,
    // Profile join — profile.id = kyc_attempts.user_id
    email:               (p.email as string) ?? undefined,
    username:            (p.username as string) ?? undefined,
    displayName:         (p.full_name as string) ?? undefined,
    customerReference:   (row.customer_reference as string) ?? (p.uid as string) ?? undefined,
    exchangeUserId:      (row.exchange_user_id as string) ?? (p.uid as string) ?? undefined,
    profileCountry:      (p.country as string) ?? undefined,
  };
}

// ─── Admin functions ───────────────────────────────────────────────────────────

const ATTEMPT_ADMIN_SELECT =
  `id, user_id, submission_id, provider, reference_id, provider_reference,
   external_reference, widget_id, country_code, doc_type, status, raw_provider_status,
   failure_reason, review_reason, manual_review_reasons,
   result_doc_verify, result_face_match, result_liveness, result_aml,
   result_pep, result_sanctions, result_fraud,
   confidence_score, fraud_risk_score, full_name, date_of_birth,
   customer_reference, exchange_user_id,
   started_at, submitted_at, completed_at, last_webhook_at,
   created_at, updated_at,
   profiles!kyc_attempts_user_id_fkey(email, username, full_name, uid, country)`;

/** Admin: list KYC attempts with user info — source of truth */
export async function adminListAttempts(params: {
  status?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}): Promise<{ attempts: KycAttemptAdmin[]; count: number }> {
  let query = supabase
    .from('kyc_attempts')
    .select(ATTEMPT_ADMIN_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 100);

  if (params.offset) query = query.range(params.offset, params.offset + (params.limit ?? 100) - 1);
  if (params.status && params.status !== 'all') query = query.eq('status', params.status);
  if (params.provider) query = query.eq('provider', params.provider);

  const { data, error, count } = await query;
  if (error) {
    // PostgREST FK hint missing — fall back to two-query merge
    if (error.message.includes('relationship') || error.message.includes('fkey')) {
      return adminListAttemptsFallback(params);
    }
    throw new Error(error.message);
  }
  return {
    attempts: (data ?? []).map(r => mapAttemptAdmin(r as Record<string, unknown>)),
    count: count ?? 0,
  };
}

/** Fallback: fetch attempts + profiles separately, merge by user_id */
async function adminListAttemptsFallback(params: {
  status?: string; provider?: string; limit?: number; offset?: number;
}): Promise<{ attempts: KycAttemptAdmin[]; count: number }> {
  let q = supabase.from('kyc_attempts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 100);
  if (params.status && params.status !== 'all') q = q.eq('status', params.status);
  if (params.provider) q = q.eq('provider', params.provider);
  const { data: rows, error, count } = await q;
  if (error) throw new Error(error.message);

  const userIds = [...new Set((rows ?? []).map((r: Record<string, unknown>) => r.user_id as string))];
  let profiles: Record<string, Record<string, unknown>> = {};
  if (userIds.length > 0) {
    const { data: pRows } = await supabase.from('profiles')
      .select('id, email, username, full_name, uid, country')
      .in('id', userIds);
    (pRows ?? []).forEach((p: Record<string, unknown>) => { profiles[p.id as string] = p; });
  }

  const attempts = (rows ?? []).map((r: Record<string, unknown>) => {
    const merged = { ...r, profiles: profiles[r.user_id as string] ?? {} };
    return mapAttemptAdmin(merged as Record<string, unknown>);
  });
  return { attempts, count: count ?? 0 };
}

/** Admin: get full KYC attempt detail */
export async function adminGetAttemptDetail(attemptId: string): Promise<KycAttemptAdmin | null> {
  const { data, error } = await supabase
    .from('kyc_attempts')
    .select(ATTEMPT_ADMIN_SELECT)
    .eq('id', attemptId)
    .maybeSingle();
  if (error) {
    // Fallback without join
    const { data: row } = await supabase.from('kyc_attempts').select('*').eq('id', attemptId).maybeSingle();
    if (!row) return null;
    const { data: profile } = await supabase.from('profiles')
      .select('email, username, full_name, uid, country').eq('id', (row as Record<string, unknown>).user_id).maybeSingle();
    return mapAttemptAdmin({ ...(row as Record<string, unknown>), profiles: profile ?? {} });
  }
  return data ? mapAttemptAdmin(data as Record<string, unknown>) : null;
}

/** Admin: get provider events for an attempt */
export async function adminGetProviderEvents(attemptId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('kyc_provider_events')
    .select('id, event_type, reference_id, is_duplicate, created_at')
    .eq('attempt_id', attemptId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data ?? []) as Record<string, unknown>[];
}

/** Admin: get KYC attempt status counts */
export async function adminGetAttemptCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('kyc_attempts')
    .select('status');
  if (error) throw new Error(`Failed to load KYC counts: ${error.message}`);
  const counts: Record<string, number> = {};
  (data ?? []).forEach((r: Record<string, unknown>) => {
    const s = r.status as string;
    counts[s] = (counts[s] ?? 0) + 1;
  });
  counts['all'] = (data ?? []).length;
  return counts;
}

/** Admin: sync a specific attempt via the dedicated sync function */
export async function adminSyncAttempt(attemptId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('sync-dojah-kyc-status', {
    body: { attempt_id: attemptId },
  });
  if (error) {
    const msg = await (error as { context?: { text?: () => Promise<string> } }).context?.text?.();
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return (data?.status as string) ?? null;
}

/** Admin: write a kyc_review record — always uses auth UUID for admin_user_id */
export async function adminWriteReview(params: {
  attemptId:   string;
  action:      string;
  oldStatus?:  string;
  newStatus?:  string;
  reason?:     string;
  notes?:      string;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  const { error } = await supabase.from('kyc_reviews').insert({
    attempt_id:    params.attemptId,
    admin_user_id: user.id,          // always auth UUID — never EXX text uid
    action:        params.action,
    old_status:    params.oldStatus ?? null,
    new_status:    params.newStatus ?? null,
    reason:        params.reason    ?? null,
    notes:         params.notes     ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Admin: list submissions (legacy — kept for backward compat, delegates to adminListAttempts) */
export async function adminListSubmissions(params: {
  status?: string; provider?: string; limit?: number; offset?: number;
}): Promise<{ submissions: KycSubmission[]; count: number }> {
  // Map old submission status filters to attempt statuses
  const statusMap: Record<string, string> = {
    needs_manual_review: 'manual_review',
    pending:             'in_progress',
    under_review:        'pending_review',
    approved:            'verified',
    rejected:            'failed',
  };
  const mappedStatus = params.status ? (statusMap[params.status] ?? params.status) : undefined;
  const { attempts, count } = await adminListAttempts({ ...params, status: mappedStatus });
  // Convert KycAttemptAdmin → KycSubmission shape for backward compat
  const submissions = attempts.map(a => ({
    id:                   a.id,
    userId:               a.userId,
    tier:                 'tier2',
    status:               (a.status === 'verified' ? 'approved' : a.status === 'failed' ? 'rejected' : a.status === 'manual_review' ? 'needs_manual_review' : 'pending') as KycVerificationStatus,
    provider:             a.provider as KycProvider,
    providerRefId:        a.providerReference,
    countryCode:          a.countryCode,
    docType:              a.docType,
    fullName:             a.fullName,
    resultDocVerify:      a.resultDocVerify,
    resultFaceMatch:      a.resultFaceMatch,
    resultLiveness:       a.resultLiveness,
    resultAml:            a.resultAml,
    manualReviewReasons:  a.manualReviewReasons,
    createdAt:            a.createdAt,
    email:                a.email,
    username:             a.username,
  } as KycSubmission & { email?: string; username?: string }));
  return { submissions, count };
}

/** Admin: get full submission detail (legacy wrapper) */
export async function adminGetSubmission(attemptId: string): Promise<KycSubmission | null> {
  const a = await adminGetAttemptDetail(attemptId);
  if (!a) return null;
  return {
    id:          a.id, userId: a.userId, tier: 'tier2',
    status:      (a.status === 'verified' ? 'approved' : a.status === 'failed' ? 'rejected' : a.status === 'manual_review' ? 'needs_manual_review' : 'pending') as KycVerificationStatus,
    provider:    a.provider as KycProvider, providerRefId: a.providerReference,
    countryCode: a.countryCode, docType: a.docType, fullName: a.fullName,
    dateOfBirth: a.dateOfBirth, resultDocVerify: a.resultDocVerify,
    resultFaceMatch: a.resultFaceMatch, resultLiveness: a.resultLiveness,
    resultAml: a.resultAml, resultPep: a.resultPep, resultSanctions: a.resultSanctions,
    resultFraud: a.resultFraud, confidenceScore: a.confidenceScore,
    fraudRiskScore: a.fraudRiskScore, manualReviewReasons: a.manualReviewReasons,
    createdAt: a.createdAt,
  } as KycSubmission;
}

/** Admin: get audit log — tries kyc_reviews first, falls back to kyc_audit_log */
export async function adminGetAuditLog(attemptId: string): Promise<KycAuditEntry[]> {
  // Try kyc_reviews (new)
  const { data: reviews } = await supabase
    .from('kyc_reviews')
    .select('id, attempt_id, admin_user_id, action, old_status, new_status, reason, notes, created_at')
    .eq('attempt_id', attemptId)
    .order('created_at', { ascending: true });

  if (reviews && reviews.length > 0) {
    return reviews.map((r: Record<string, unknown>) => ({
      id: r.id as string, userId: r.admin_user_id as string,
      action: r.action as string, oldStatus: (r.old_status as string) ?? undefined,
      newStatus: (r.new_status as string) ?? undefined, reason: (r.reason as string) ?? undefined,
      notes: (r.notes as string) ?? undefined, createdAt: r.created_at as string,
    } as KycAuditEntry));
  }

  // Fall back to kyc_audit_log (by attempt, or by submission)
  const { data: attempt } = await supabase.from('kyc_attempts')
    .select('submission_id').eq('id', attemptId).maybeSingle();
  const subId = (attempt as Record<string, unknown> | null)?.submission_id as string | undefined;

  const { data, error } = await supabase
    .from('kyc_audit_log')
    .select('*')
    .eq(subId ? 'submission_id' : 'id', subId ?? attemptId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data ?? []).map(mapAudit);
}

/** Admin: perform an action (approve / reject / escalate / request_info / add_note) */
export async function adminKycAction(params: {
  action: 'approve' | 'reject' | 'escalate' | 'request_info' | 'add_note';
  attemptId: string;         // attempt UUID — authoritative key
  reason?: string;
  notes?: string;
  tier?: string;
  forceOverride?: boolean;
}): Promise<{ oldStatus: string; newStatus: string }> {
  const { data, error } = await supabase.functions.invoke('kyc-admin-action', {
    body: {
      action:          params.action,
      attempt_id:      params.attemptId,
      reason:          params.reason,
      notes:           params.notes,
      tier:            params.tier,
      force_override:  params.forceOverride ?? false,
    },
  });

  if (error) {
    // FunctionsHttpError wraps non-2xx — extract the real JSON body error message
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json() as { error?: string; message?: string };
        const extracted = body?.error ?? body?.message;
        if (extracted) msg = extracted;
      } else if (ctx && typeof ctx.text === 'function') {
        const text = await ctx.text();
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed?.error) msg = parsed.error;
        } catch { if (text && text.length < 200) msg = text; }
      }
    } catch { /* keep original */ }
    throw new Error(msg);
  }

  // data.error means the function returned 200 but with a business error in the body
  if (data?.error) throw new Error(data.error);
  if (!data?.ok)   throw new Error('KYC attempt was not updated — no confirmation received');
  return { oldStatus: data.old_status, newStatus: data.new_status };
}

/** Admin: update a KYC setting */
export async function adminUpdateSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from('kyc_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

/** Admin: get all KYC settings */
export async function adminGetAllSettings(): Promise<KycSetting[]> {
  const { data, error } = await supabase
    .from('kyc_settings')
    .select('key, value, updated_at')
    .order('key');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({ key: r.key, value: r.value }));
}

// ─── Provider management ───────────────────────────────────────────────────────

/** Get all KYC provider configurations */
export async function getKycProviders(): Promise<KycProviderConfig[]> {
  const { data, error } = await supabase
    .from('kyc_providers')
    .select('*')
    .order('priority', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapProvider);
}

/** Admin: update provider configuration — stores updated_by as text (auth UUID string) */
export async function adminUpdateProvider(providerId: string, updates: Partial<{
  enabled:          boolean;
  priority:         number;
  autoFallback:     boolean;
  manualSelection:  boolean;
  supportedCountries: string[];
  config:           Record<string, unknown>;
}>): Promise<KycProviderConfig> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Administrator account not authenticated. Please sign in again.');

  const { data: profile, error: profileErr } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if (profileErr || !profile) throw new Error('Administrator profile not found.');
  if (profile.role !== 'admin') throw new Error('Administrator access required to modify provider settings.');

  const dbUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  };
  if (updates.enabled            !== undefined) dbUpdates.enabled             = updates.enabled;
  if (updates.priority           !== undefined) dbUpdates.priority            = updates.priority;
  if (updates.autoFallback       !== undefined) dbUpdates.auto_fallback       = updates.autoFallback;
  if (updates.manualSelection    !== undefined) dbUpdates.manual_selection    = updates.manualSelection;
  if (updates.supportedCountries !== undefined) dbUpdates.supported_countries = updates.supportedCountries;
  if (updates.config             !== undefined) dbUpdates.config              = updates.config;

  // Persist and verify — always refetch the saved row
  const { data, error } = await supabase
    .from('kyc_providers')
    .update(dbUpdates)
    .eq('id', providerId)
    .select()
    .single();
  if (error) throw new Error(`Failed to save provider: ${error.message}`);
  if (!data)  throw new Error('Provider save returned no data — update may not have persisted.');
  return mapProvider(data as Record<string, unknown>);
}

/**
 * Admin: atomically set a new default provider.
 * 1. Verify admin permission
 * 2. Clear all is_default flags
 * 3. Set chosen provider is_default=true, priority=1
 * 4. Ensure previous default has priority > 1
 * 5. Sync kyc_settings.default_provider
 * 6. Insert audit log
 * Returns updated provider list.
 */
export async function adminSetDefaultProvider(
  providerName: KycProvider,
  reason = 'admin_selection',
): Promise<KycProviderConfig[]> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') throw new Error('Administrator access required');

  // Fetch current state for audit
  const { data: current } = await supabase
    .from('kyc_providers').select('provider_name, priority, is_default');
  const oldDefault = (current ?? []).find((r: Record<string,unknown>) => r.is_default)?.provider_name ?? 'unknown';

  // Step 1: clear all defaults
  const { error: clearErr } = await supabase
    .from('kyc_providers')
    .update({ is_default: false, updated_at: new Date().toISOString(), updated_by: user.id })
    .neq('provider_name', '');          // matches all rows
  if (clearErr) throw new Error(`Failed to clear defaults: ${clearErr.message}`);

  // Step 2: set new default at priority 1
  const { error: setErr } = await supabase
    .from('kyc_providers')
    .update({ is_default: true, priority: 1, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('provider_name', providerName);
  if (setErr) throw new Error(`Failed to set default: ${setErr.message}`);

  // Step 3: bump any other non-manual provider that ended up at priority 1 to priority 2
  await supabase
    .from('kyc_providers')
    .update({ priority: 2, updated_at: new Date().toISOString() })
    .neq('provider_name', providerName)
    .neq('provider_name', 'manual')
    .eq('priority', 1);

  // Step 4: sync kyc_settings.default_provider
  await supabase
    .from('kyc_settings')
    .upsert(
      { key: 'default_provider', value: JSON.stringify(providerName), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );

  // Step 5: audit log
  await supabase.from('kyc_audit_log').insert({
    user_id:   user.id,
    actor_id:  user.id,
    action:    'set_default_provider',
    reason,
    metadata:  { old_default: oldDefault, new_default: providerName, timestamp: new Date().toISOString() },
  });

  // Return refreshed list
  const { data: refreshed, error: fetchErr } = await supabase
    .from('kyc_providers').select('*').order('priority', { ascending: true });
  if (fetchErr) throw new Error(fetchErr.message);
  return (refreshed ?? []).map(r => mapProvider(r as Record<string, unknown>));
}

/** Admin: get latest KYC attempts with user info */
export async function adminGetAttempts(params: {
  status?: string;
  provider?: string;
  limit?: number;
}): Promise<KycAttempt[]> {
  let query = supabase
    .from('kyc_attempts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 50);
  if (params.status)   query = query.eq('status', params.status);
  if (params.provider) query = query.eq('provider', params.provider);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAttempt);
}

/** Admin: move attempt to manual review */
export async function adminMoveToManualReview(attemptId: string, reason: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  await supabase.from('kyc_attempts').update({ status: 'manual_review', failure_reason: reason,
    updated_at: new Date().toISOString() }).eq('id', attemptId);
  // Also log to audit
  const { data: attempt } = await supabase.from('kyc_attempts')
    .select('user_id, submission_id').eq('id', attemptId).maybeSingle();
  if (attempt) {
    await supabase.from('kyc_audit_log').insert({
      submission_id: attempt.submission_id, user_id: attempt.user_id, actor_id: user.id,
      action: 'moved_to_manual_review', new_status: 'manual_review', reason,
    });
  }
}

/** Admin: retry result sync for an attempt */
export async function adminRetrySync(attemptId: string): Promise<string | null> {
  const { data: attempt } = await supabase.from('kyc_attempts')
    .select('submission_id, provider').eq('id', attemptId).maybeSingle();
  if (!attempt) throw new Error('Attempt not found');
  if (attempt.provider === 'prembly') {
    return syncPremblyStatus(attemptId);
  }
  if (attempt.provider === 'dojah') {
    return syncDojahStatus(attempt.submission_id, attemptId);
  }
  return null;
}

/** Admin: request resubmission for an attempt */
export async function adminRequestResubmission(attemptId: string, reason: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  await supabase.from('kyc_attempts').update({ status: 'resubmission_required', failure_reason: reason,
    updated_at: new Date().toISOString() }).eq('id', attemptId);
  const { data: attempt } = await supabase.from('kyc_attempts')
    .select('user_id, submission_id').eq('id', attemptId).maybeSingle();
  if (attempt) {
    await supabase.from('kyc_submissions').update({ status: 'not_started' }).eq('id', attempt.submission_id);
    await supabase.from('kyc_audit_log').insert({
      submission_id: attempt.submission_id, user_id: attempt.user_id, actor_id: user.id,
      action: 'resubmission_requested', new_status: 'resubmission_required', reason,
    });
  }
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export interface KycDiagnostic {
  key:     string;
  label:   string;
  status:  'ok' | 'warn' | 'error';
  detail:  string;
}

/**
 * Returns a list of diagnostic checks for the KYC configuration:
 *  - kyc_providers default matches kyc_settings.default_provider
 *  - Default provider is enabled + healthy
 *  - Fallback provider is enabled
 *  - No two providers share the same priority
 *  - At least one provider enabled
 */
export async function getKycDiagnostics(): Promise<KycDiagnostic[]> {
  const results: KycDiagnostic[] = [];

  const [providerRows, settingRows] = await Promise.all([
    supabase.from('kyc_providers').select('provider_name, display_name, enabled, priority, is_default, health_status, failure_count').order('priority', { ascending: true }),
    supabase.from('kyc_settings').select('key, value').in('key', ['default_provider', 'fallback_enabled']),
  ]);

  const providers = (providerRows.data ?? []) as Array<{
    provider_name: string; display_name: string; enabled: boolean;
    priority: number; is_default: boolean; health_status: string; failure_count: number;
  }>;
  const settings = Object.fromEntries((settingRows.data ?? []).map(r => [r.key, r.value]));

  // 1. At least one provider enabled
  const enabledProviders = providers.filter(p => p.enabled && p.provider_name !== 'manual');
  results.push({
    key:    'enabled_count',
    label:  'Enabled providers',
    status: enabledProviders.length > 0 ? 'ok' : 'error',
    detail: enabledProviders.length > 0
      ? `${enabledProviders.length} provider(s) active: ${enabledProviders.map(p => p.display_name).join(', ')}`
      : 'No providers enabled — all KYC attempts will fail',
  });

  // 2. Exactly one is_default=true
  const defaultProviders = providers.filter(p => p.is_default);
  results.push({
    key:    'single_default',
    label:  'Single default provider',
    status: defaultProviders.length === 1 ? 'ok' : 'error',
    detail: defaultProviders.length === 1
      ? `${defaultProviders[0].display_name} is marked as default`
      : defaultProviders.length === 0
        ? 'No provider has is_default=true — provider resolution will fail'
        : `Multiple defaults: ${defaultProviders.map(p => p.provider_name).join(', ')}`,
  });

  // 3. kyc_providers default matches kyc_settings.default_provider
  const dbDefault     = defaultProviders[0]?.provider_name ?? null;
  const settingDefault = String(settings['default_provider'] ?? '').replace(/"/g, '').trim();
  results.push({
    key:    'provider_setting_sync',
    label:  'Provider ↔ settings in sync',
    status: dbDefault && settingDefault && dbDefault === settingDefault ? 'ok' : 'warn',
    detail: dbDefault && settingDefault && dbDefault === settingDefault
      ? `Both sources agree: ${dbDefault}`
      : `Mismatch — kyc_providers default: "${dbDefault ?? 'none'}", kyc_settings: "${settingDefault || 'none'}"`,
  });

  // 4. Default provider is enabled
  if (dbDefault) {
    const defRow = providers.find(p => p.provider_name === dbDefault);
    results.push({
      key:    'default_enabled',
      label:  'Default provider enabled',
      status: defRow?.enabled ? 'ok' : 'error',
      detail: defRow?.enabled
        ? `${defRow.display_name} is enabled`
        : `Default provider "${dbDefault}" is DISABLED — all new verifications will fail`,
    });

    // 5. Default provider health
    const health = defRow?.health_status ?? 'unknown';
    results.push({
      key:    'default_health',
      label:  'Default provider health',
      status: health === 'healthy' ? 'ok' : health === 'degraded' ? 'warn' : 'error',
      detail: `${defRow?.display_name ?? dbDefault} — ${health}${defRow && defRow.failure_count > 0 ? ` (${defRow.failure_count} failures)` : ''}`,
    });
  }

  // 6. Fallback provider exists and is enabled
  const fallbackRow = providers.find(p => !p.is_default && p.provider_name !== 'manual' && p.enabled);
  results.push({
    key:    'fallback_available',
    label:  'Fallback provider available',
    status: fallbackRow ? 'ok' : 'warn',
    detail: fallbackRow
      ? `${fallbackRow.display_name} (priority ${fallbackRow.priority}) is ready as fallback`
      : 'No fallback provider enabled — if default fails, users cannot verify',
  });

  // 7. No duplicate priorities among enabled non-manual providers
  const priorities = enabledProviders.map(p => p.priority);
  const hasDupes = priorities.length !== new Set(priorities).size;
  results.push({
    key:    'priority_unique',
    label:  'Provider priorities unique',
    status: hasDupes ? 'warn' : 'ok',
    detail: hasDupes
      ? `Duplicate priority values detected — routing order is non-deterministic`
      : `All ${priorities.length} providers have unique priorities`,
  });

  // 8. fallback_enabled setting is true
  const fallbackSetting = String(settings['fallback_enabled'] ?? 'true');
  results.push({
    key:    'fallback_setting',
    label:  'Auto-fallback setting',
    status: fallbackSetting === 'true' ? 'ok' : 'warn',
    detail: fallbackSetting === 'true'
      ? 'Automatic fallback is enabled'
      : 'Auto-fallback is DISABLED — provider failures will not route to fallback',
  });

  return results;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapProvider(row: Record<string, unknown>): KycProviderConfig {
  const rawHealth = (row.health_status as string) ?? 'unknown';
  const config    = (row.config as Record<string, unknown>) ?? {};
  const widgetId  = config.widget_id as string | undefined;
  // A 404 against a per-record endpoint is NOT a provider outage.
  // Show "healthy" if failure_count === 0 OR if the only errors were 404s.
  // Show "configured" for Dojah when widget_id + env vars are present but
  // no real API calls have succeeded yet (failure_count === 0, status unknown).
  let healthStatus = rawHealth as KycProviderConfig['healthStatus'];
  if (row.provider_name === 'dojah') {
    const failureCount = (row.failure_count as number) ?? 0;
    if (failureCount === 0) {
      // Widget ID present → configured and healthy
      healthStatus = widgetId ? 'healthy' : 'unknown';
    }
    // If last_error is only "HTTP 404" (record not found), downgrade to healthy
    const lastErr = (row.last_error as string) ?? '';
    if (lastErr.includes('404') && failureCount <= 5) {
      healthStatus = 'healthy';
    }
  }
  return {
    id:                 row.id as string,
    providerName:       row.provider_name as KycProvider,
    displayName:        row.display_name as string,
    enabled:            row.enabled as boolean,
    priority:           row.priority as number,
    isDefault:          (row.is_default as boolean) ?? false,
    supportedCountries: (row.supported_countries as string[]) ?? [],
    supportedDocTypes:  (row.supported_doc_types as string[]) ?? [],
    healthStatus,
    failureCount:       (row.failure_count as number) ?? 0,
    lastSuccessAt:      (row.last_success_at as string) ?? undefined,
    lastError:          (row.last_error as string) ?? undefined,
    lastErrorAt:        (row.last_error_at as string) ?? undefined,
    autoFallback:       row.auto_fallback as boolean,
    manualSelection:    row.manual_selection as boolean,
    config,
    updatedAt:          row.updated_at as string,
  };
}

function mapAttempt(row: Record<string, unknown>): KycAttempt {
  return {
    id:               row.id as string,
    userId:           row.user_id as string,
    submissionId:     (row.submission_id as string) ?? undefined,
    provider:         row.provider as KycProvider,
    providerPriority: (row.provider_priority as number) ?? 1,
    referenceId:      row.reference_id as string,
    widgetId:         (row.widget_id as string) ?? undefined,
    countryCode:      (row.country_code as string) ?? undefined,
    docType:          (row.doc_type as string) ?? undefined,
    status:           row.status as KycAttemptStatus,
    rawProviderStatus:(row.raw_provider_status as string) ?? undefined,
    providerRefId:    (row.provider_ref_id as string) ?? undefined,
    fallbackProvider: (row.fallback_provider as string) ?? undefined,
    failureReason:    (row.failure_reason as string) ?? undefined,
    startedAt:        row.started_at as string,
    submittedAt:      (row.submitted_at as string) ?? undefined,
    completedAt:      (row.completed_at as string) ?? undefined,
    createdAt:        row.created_at as string,
  };
}

function mapKyc(row: Record<string, unknown>): KycSubmission {
  return {
    id:                   row.id as string,
    userId:               row.user_id as string,
    tier:                 (row.tier as string) ?? 'tier2',
    status:               (row.status as KycVerificationStatus) ?? 'not_started',
    provider:             (row.provider as KycProvider) ?? undefined,
    providerRefId:        (row.provider_ref_id as string) ?? undefined,
    countryCode:          (row.country_code as string) ?? undefined,
    docType:              (row.doc_type as string) ?? undefined,
    fullName:             (row.full_name as string) ?? undefined,
    dateOfBirth:          (row.date_of_birth as string) ?? undefined,
    docNumberMasked:      (row.doc_number_masked as string) ?? undefined,
    rejectionReason:      (row.rejection_reason as string) ?? undefined,
    reviewedAt:           (row.reviewed_at as string) ?? undefined,
    expiresAt:            (row.expires_at as string) ?? undefined,
    resultDocVerify:      (row.result_doc_verify as string) ?? undefined,
    resultFaceMatch:      (row.result_face_match as string) ?? undefined,
    resultLiveness:       (row.result_liveness as string) ?? undefined,
    resultAddress:        (row.result_address as string) ?? undefined,
    resultAml:            (row.result_aml as string) ?? undefined,
    resultPep:            (row.result_pep as string) ?? undefined,
    resultSanctions:      (row.result_sanctions as string) ?? undefined,
    resultFraud:          (row.result_fraud as string) ?? undefined,
    resultDuplicate:      (row.result_duplicate as string) ?? undefined,
    confidenceScore:      (row.confidence_score as number) ?? undefined,
    fraudRiskScore:       (row.fraud_risk_score as number) ?? undefined,
    manualReviewReasons:  Array.isArray(row.manual_review_reasons) ? row.manual_review_reasons as string[] : [],
    createdAt:            row.created_at as string,
  };
}

function mapDoc(row: Record<string, unknown>): KycDocument {
  return {
    id:           row.id as string,
    submissionId: row.submission_id as string,
    docType:      row.doc_type as string,
    storagePath:  row.storage_path as string,
    mimeType:     row.mime_type as string,
    createdAt:    row.created_at as string,
  };
}

function mapAudit(row: Record<string, unknown>): KycAuditEntry {
  return {
    id:           row.id as string,
    submissionId: (row.submission_id as string) ?? undefined,
    userId:       row.user_id as string,
    actorId:      (row.actor_id as string) ?? undefined,
    action:       row.action as string,
    oldStatus:    (row.old_status as string) ?? undefined,
    newStatus:    (row.new_status as string) ?? undefined,
    reason:       (row.reason as string) ?? undefined,
    notes:        (row.notes as string) ?? undefined,
    createdAt:    row.created_at as string,
  };
}
