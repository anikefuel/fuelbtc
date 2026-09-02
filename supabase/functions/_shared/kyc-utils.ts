// Shared KYC utilities for edge functions
import { createClient } from 'npm:@supabase/supabase-js@2';

export const JSON_H = { 'Content-Type': 'application/json' };

// ── Dojah configuration (priority-2 fallback) ─────────────────────────────────
export const DOJAH_WIDGET_ID  = '6a5b12349ff90fe054784334';
export const DOJAH_BASE_URL   = 'https://identity.dojah.io';
export const DOJAH_HOSTED_URL = `${DOJAH_BASE_URL}?widget_id=${DOJAH_WIDGET_ID}`;

// ── Prembly configuration (priority-1 default) ────────────────────────────────
export const PREMBLY_CONFIG_ID   = Deno.env.get('PREMBLY_CONFIG_ID')  ?? '98e264b6-62de-47bc-9896-fdf299d9c612';
export const PREMBLY_WIDGET_KEY  = Deno.env.get('PREMBLY_WIDGET_KEY') ?? 'wdgt_86138e502e7f4430be3da2aaac507193';
export const PREMBLY_BASE_URL    = Deno.env.get('PREMBLY_BASE_URL')   ?? 'https://api.prembly.com';
export const PREMBLY_WIDGET_URL  = 'https://kyc.prembly.com';

/** Map Prembly widget status string to internal KYC attempt status */
export function mapPremblyStatus(premblyStatus: string): string {
  const s = (premblyStatus ?? '').toUpperCase().trim();
  if (s === 'VERIFIED')     return 'verified';
  if (s === 'NOT-VERIFIED') return 'failed';
  if (s === 'PENDING')      return 'pending_review';   // Prembly: could not complete — do not treat as verified
  return 'in_progress';
}

/** Map Prembly response_code to internal status/action */
export function mapPremblyResponseCode(code: string | number | undefined): {
  status: string; adminAlert?: string; userMessage: string;
} {
  const c = String(code ?? '');
  switch (c) {
    case '01': return { status: 'resubmission_required',  userMessage: 'We could not find your record. Please try again with a different document.' };
    case '02': return { status: 'provider_unavailable',   userMessage: 'Verification service is temporarily unavailable. Please try again shortly.', adminAlert: 'Prembly temporarily unavailable (code 02)' };
    case '03': return { status: 'provider_unavailable',   userMessage: 'Verification is temporarily unavailable. Please try again later.', adminAlert: 'Prembly insufficient wallet balance (code 03) — top up required' };
    case '07': return { status: 'manual_review',          userMessage: 'Your verification requires additional review.', adminAlert: 'Prembly blocked/watchlisted result (code 07) — compliance review required' };
    default:   return { status: 'in_progress',            userMessage: 'Verification in progress.' };
  }
}

/** Verify Prembly webhook HMAC-SHA256 signature */
export async function verifyPremblySignature(
  rawBody: string,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(publicKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
    // Constant-time comparison
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  } catch (e) {
    console.warn('[kyc-utils] verifyPremblySignature error:', e instanceof Error ? e.message : e);
    return false;
  }
}

export function getAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// ── Provider types ─────────────────────────────────────────────────────────────
export type KycProviderName = 'prembly' | 'dojah' | 'sumsub' | 'manual';

export interface KycProviderConfig {
  provider_name:       KycProviderName;
  display_name:        string;
  enabled:             boolean;
  priority:            number;
  supported_countries: string[];
  auto_fallback:       boolean;
  health_status:       string;
  failure_count:       number;
  config:              Record<string, unknown>;
}

// ── Generate unique EXX-KYC reference ID ──────────────────────────────────────
export function generateKycReferenceId(): string {
  return `EXX-KYC-${crypto.randomUUID()}`;
}

// ── Resolve provider from DB (Dojah is priority-1 default) ────────────────────
export async function resolveProviderFromDb(
  admin: ReturnType<typeof getAdmin>,
  countryCode: string,
): Promise<KycProviderConfig> {
  const { data: providers } = await admin
    .from('kyc_providers')
    .select('*')
    .eq('enabled', true)
    .order('priority', { ascending: true });

  const available = (providers ?? []) as KycProviderConfig[];

  // Find best matching provider for country
  for (const p of available) {
    const countries = p.supported_countries ?? [];
    // empty supported_countries = supports ALL countries
    if (countries.length === 0 || countries.includes(countryCode.toUpperCase())) {
      return p;
    }
  }

  // Fallback: return Prembly default config if DB is empty
  return {
    provider_name:       'prembly',
    display_name:        'Prembly IdentityPass',
    enabled:             true,
    priority:            1,
    supported_countries: [],
    auto_fallback:       true,
    health_status:       'unknown',
    failure_count:       0,
    config: {
      integration_mode: 'widget',
      base_widget_url:  PREMBLY_WIDGET_URL,
      config_id:        PREMBLY_CONFIG_ID,
      widget_key:       PREMBLY_WIDGET_KEY,
    },
  };
}

// ── Legacy sync helper (kept for backward compat) ─────────────────────────────
export const SUMSUB_COUNTRIES = new Set([
  'US', 'GB', 'CA',
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE',
  'GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT',
  'RO','SK','SI','ES','SE',
]);

/** @deprecated Use resolveProviderFromDb() — Prembly is now the default for ALL countries */
export function routeProvider(_countryCode: string): 'prembly' | 'dojah' {
  return 'prembly';
}

// ── Build Dojah hosted URL with reference_id ─────────────────────────────────
export function buildDojahHostedUrl(referenceId: string, userData?: {
  first_name?: string;
  last_name?: string;
  email?: string;
}): string {
  const base = `${DOJAH_BASE_URL}?widget_id=${DOJAH_WIDGET_ID}&reference_id=${encodeURIComponent(referenceId)}`;
  // Only attach safe, non-sensitive metadata
  const params: string[] = [];
  if (userData?.first_name) params.push(`first_name=${encodeURIComponent(userData.first_name)}`);
  if (userData?.last_name)  params.push(`last_name=${encodeURIComponent(userData.last_name)}`);
  // Never attach email, DOB, or any sensitive compliance data to URL
  return params.length > 0 ? `${base}&${params.join('&')}` : base;
}

// ── Record provider health event ──────────────────────────────────────────────
/** Validate Dojah widget configuration — checks env vars, not API reachability */
export function validateDojahConfig(): { valid: boolean; status: string; details: string } {
  const appId     = Deno.env.get('DOJAH_APP_ID')      ?? '';
  const widgetId  = Deno.env.get('DOJAH_WIDGET_ID')   ?? DOJAH_WIDGET_ID;
  const privKey   = Deno.env.get('DOJAH_PRIVATE_KEY') ?? '';
  const pubKey    = Deno.env.get('DOJAH_PUBLIC_KEY')  ?? '';
  const missing: string[] = [];
  if (!appId)    missing.push('DOJAH_APP_ID');
  if (!widgetId) missing.push('DOJAH_WIDGET_ID');
  if (!privKey)  missing.push('DOJAH_PRIVATE_KEY');
  if (!pubKey)   missing.push('DOJAH_PUBLIC_KEY');
  if (missing.length > 0) {
    return { valid: false, status: 'misconfigured', details: `Missing: ${missing.join(', ')}` };
  }
  return { valid: true, status: 'configured', details: `widget_id=${widgetId}, app_id=${appId.slice(0, 8)}…` };
}

export async function recordProviderHealth(
  admin: ReturnType<typeof getAdmin>,
  providerName: KycProviderName,
  success: boolean,
  error?: string,
) {
  try {
    if (success) {
      await admin.from('kyc_providers').update({
        health_status:    'healthy',
        failure_count:    0,
        last_success_at:  new Date().toISOString(),
        last_error:       null,
        updated_at:       new Date().toISOString(),
      }).eq('provider_name', providerName);
    } else {
      // Try RPC first; fall back to direct update if RPC not available
      const { error: rpcErr } = await admin.rpc('increment_provider_failure', { p_name: providerName, p_error: error ?? 'unknown' });
      if (rpcErr) {
        const { data } = await admin.from('kyc_providers').select('failure_count').eq('provider_name', providerName).maybeSingle();
        const count = ((data as Record<string,unknown>)?.failure_count as number ?? 0) + 1;
        await admin.from('kyc_providers').update({
          health_status:  count > 5 ? 'unhealthy' : 'degraded',
          failure_count:  count,
          last_error:     error ?? 'unknown',
          last_error_at:  new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        }).eq('provider_name', providerName);
      }
    }
  } catch (e) {
    console.warn('[kyc-utils] recordProviderHealth failed:', e instanceof Error ? e.message : e);
  }
}

// ── Store raw provider event (idempotent) ─────────────────────────────────────
export async function storeProviderEvent(
  admin: ReturnType<typeof getAdmin>,
  params: {
    attempt_id?:    string;
    submission_id?: string;
    provider:       string;
    event_type:     'webhook' | 'poll' | 'manual_sync';
    reference_id?:  string;
    raw_payload:    unknown;
    is_duplicate?:  boolean;
  },
) {
  try {
    const { error } = await admin.from('kyc_provider_events').insert({
      ...params,
      raw_payload: params.raw_payload,
      processed:   false,
    });
    if (error) console.warn('[kyc-utils] storeProviderEvent DB error:', error.message);
  } catch (e) {
    console.warn('[kyc-utils] storeProviderEvent failed:', e instanceof Error ? e.message : e);
  }
}

/** Append an immutable audit log entry */
export async function appendAuditLog(admin: ReturnType<typeof getAdmin>, params: {
  submission_id?: string;
  user_id: string;
  actor_id?: string;
  action: string;
  old_status?: string;
  new_status?: string;
  reason?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}) {
  await admin.from('kyc_audit_log').insert(params);
}

/** Compute new status from provider webhook event */
export function mapProviderStatus(
  provider: 'sumsub' | 'dojah',
  reviewAnswer?: string,
  reviewRejectType?: string,
  rawStatus?: string,
): 'pending' | 'approved' | 'rejected' | 'under_review' | 'needs_manual_review' | 'expired' {
  if (provider === 'sumsub') {
    if (reviewAnswer === 'GREEN') return 'approved';
    if (reviewAnswer === 'RED') {
      if (reviewRejectType === 'RETRY') return 'rejected';
      if (reviewRejectType === 'FINAL') return 'rejected';
      return 'needs_manual_review';
    }
    if (rawStatus === 'pending') return 'pending';
    if (rawStatus === 'onHold' || rawStatus === 'queued') return 'needs_manual_review';
    return 'under_review';
  }
  // Dojah
  if (rawStatus === 'verified' || rawStatus === 'approved') return 'approved';
  if (rawStatus === 'failed' || rawStatus === 'rejected') return 'rejected';
  if (rawStatus === 'manual_review') return 'needs_manual_review';
  if (rawStatus === 'pending') return 'pending';
  return 'under_review';
}

/** Determine if manual review should be triggered */
export function needsManualReview(params: {
  confidence_score?: number | null;
  fraud_risk_score?: number | null;
  result_face_match?: string | null;
  result_liveness?: string | null;
  result_aml?: string | null;
  result_sanctions?: string | null;
  result_pep?: string | null;
  confidence_threshold: number;
  fraud_threshold: number;
  face_threshold: number;
}): string[] {
  const reasons: string[] = [];
  if (params.confidence_score != null && params.confidence_score < params.confidence_threshold)
    reasons.push(`Confidence score ${params.confidence_score} below threshold ${params.confidence_threshold}`);
  if (params.fraud_risk_score != null && params.fraud_risk_score > params.fraud_threshold)
    reasons.push(`Fraud risk score ${params.fraud_risk_score} exceeds threshold ${params.fraud_threshold}`);
  if (params.result_face_match === 'inconclusive')
    reasons.push('Face match inconclusive');
  if (params.result_liveness === 'failed')
    reasons.push('Liveness detection failed');
  if (params.result_aml === 'hit')
    reasons.push('AML screening hit — requires investigation');
  if (params.result_sanctions === 'hit')
    reasons.push('Sanctions screening hit — requires investigation');
  if (params.result_pep === 'hit')
    reasons.push('PEP screening hit — requires investigation');
  return reasons;
}
