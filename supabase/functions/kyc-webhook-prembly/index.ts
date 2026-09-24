// kyc-webhook-prembly — Prembly webhook endpoint
//
// Endpoint: POST https://gehhhbuzjyxtwwljzfyx.supabase.co/functions/v1/kyc-webhook-prembly
//
// Security:
//  - Reads raw body before JSON parsing (required for HMAC integrity)
//  - Verifies x-prembly-signature (base64 HMAC-SHA256 over raw body, keyed by PREMBLY_PUBLIC_KEY)
//  - Reads `token` as unique webhook identifier for idempotency
//  - Rejects missing/invalid signatures and replayed tokens
//  - Manual override protection: skips if manual_override=true OR decision_source='manual'
//  - Returns HTTP 200 promptly even for duplicates
//
// Status mapping:
//  VERIFIED     → verified
//  NOT-VERIFIED → failed
//  PENDING      → pending_review (do NOT treat as verified)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ── Inlined shared utils (platform bundles each function in isolation) ─────────
const JSON_H = { 'Content-Type': 'application/json' };

function getAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function mapPremblyStatus(premblyStatus: string): string {
  const s = (premblyStatus ?? '').toUpperCase().trim();
  if (s === 'VERIFIED')     return 'verified';
  if (s === 'NOT-VERIFIED') return 'failed';
  if (s === 'PENDING')      return 'pending_review';
  return 'in_progress';
}

function mapPremblyResponseCode(code: string): { status: string; adminAlert?: string; userMessage: string } {
  switch (code) {
    case '01': return { status: 'resubmission_required', userMessage: 'Record not found. Try a different document.' };
    case '02': return { status: 'provider_unavailable',  userMessage: 'Service temporarily unavailable.', adminAlert: 'Prembly unavailable (code 02)' };
    case '03': return { status: 'provider_unavailable',  userMessage: 'Service temporarily unavailable.', adminAlert: 'Prembly insufficient balance (code 03)' };
    case '07': return { status: 'manual_review',         userMessage: 'Your verification requires additional review.', adminAlert: 'Prembly blocked result (code 07) — compliance review required' };
    default:   return { status: 'in_progress',           userMessage: 'Verification in progress.' };
  }
}

async function verifyPremblySignature(rawBody: string, signature: string, publicKey: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(publicKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

function needsManualReview(p: { confidence_score?: number | null; fraud_risk_score?: number | null; result_face_match?: string | null; result_liveness?: string | null; result_aml?: string | null; result_sanctions?: string | null; result_pep?: string | null; confidence_threshold: number; fraud_threshold: number; face_threshold: number }): string[] {
  const r: string[] = [];
  if (p.confidence_score != null && p.confidence_score < p.confidence_threshold) r.push(`Confidence ${p.confidence_score} below threshold ${p.confidence_threshold}`);
  if (p.fraud_risk_score != null && p.fraud_risk_score > p.fraud_threshold) r.push(`Fraud risk ${p.fraud_risk_score} exceeds threshold ${p.fraud_threshold}`);
  if (p.result_face_match === 'inconclusive') r.push('Face match inconclusive');
  if (p.result_liveness   === 'failed')       r.push('Liveness detection failed');
  if (p.result_aml        === 'hit')          r.push('AML screening hit');
  if (p.result_sanctions  === 'hit')          r.push('Sanctions screening hit');
  if (p.result_pep        === 'hit')          r.push('PEP screening hit');
  return r;
}

async function recordProviderHealth(admin: ReturnType<typeof getAdmin>, name: string, success: boolean, error?: string) {
  try {
    if (success) {
      await admin.from('kyc_providers').update({ health_status: 'healthy', failure_count: 0, last_success_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('provider_name', name);
    } else {
      const { data } = await admin.from('kyc_providers').select('failure_count').eq('provider_name', name).maybeSingle();
      const count = ((data as Record<string,unknown>)?.failure_count as number ?? 0) + 1;
      await admin.from('kyc_providers').update({ health_status: count > 5 ? 'unhealthy' : 'degraded', failure_count: count, last_error: error ?? 'unknown', last_error_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('provider_name', name);
    }
  } catch (e) { console.warn('[prembly-webhook] recordProviderHealth failed:', e instanceof Error ? e.message : e); }
}

async function storeProviderEvent(admin: ReturnType<typeof getAdmin>, params: { attempt_id?: string; submission_id?: string; provider: string; event_type: string; reference_id?: string; raw_payload: unknown; is_duplicate?: boolean }) {
  try {
    await admin.from('kyc_provider_events').insert({ ...params, processed: false });
  } catch (e) { console.warn('[prembly-webhook] storeProviderEvent failed:', e instanceof Error ? e.message : e); }
}

async function appendAuditLog(admin: ReturnType<typeof getAdmin>, params: { submission_id?: string; user_id: string; actor_id?: string; action: string; old_status?: string; new_status?: string; reason?: string; notes?: string; metadata?: Record<string, unknown> }) {
  await admin.from('kyc_audit_log').insert(params).then(() => {});
}
// ── End inlined utils ──────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...JSON_H, ...CORS } });
  }

  const admin = getAdmin();

  // ── 1. Read raw body (must happen before any .json() call) ────────────────
  const rawBody = await req.text();

  // ── 2. Verify HMAC-SHA256 signature ──────────────────────────────────────
  const publicKey   = Deno.env.get('PREMBLY_PUBLIC_KEY') ?? '';
  const incomingSig = req.headers.get('x-prembly-signature') ?? '';

  if (!publicKey) {
    console.error('[prembly-webhook] PREMBLY_PUBLIC_KEY not configured');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), { status: 500, headers: { ...JSON_H, ...CORS } });
  }
  if (!incomingSig) {
    console.warn('[prembly-webhook] Missing x-prembly-signature header');
    return new Response(JSON.stringify({ error: 'Missing signature' }), { status: 401, headers: { ...JSON_H, ...CORS } });
  }

  const sigValid = await verifyPremblySignature(rawBody, incomingSig, publicKey);
  if (!sigValid) {
    console.warn('[prembly-webhook] Invalid signature — rejecting');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: { ...JSON_H, ...CORS } });
  }

  // ── 3. Parse body ─────────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch (_e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...JSON_H, ...CORS } });
  }

  // ── 4. Extract unique token (idempotency key) ─────────────────────────────
  const token        = String(payload.token ?? payload.webhook_token ?? '');
  const providerRef  = String(payload.verification?.reference ?? payload.reference ?? payload.reference_id ?? '');
  const rawStatus    = String(payload.verification?.status ?? payload.status ?? '');
  const responseCode = String(payload.response_code ?? payload.verification?.response_code ?? '');

  console.log('[prembly-webhook] token=', token, 'ref=', providerRef, 'status=', rawStatus, 'code=', responseCode);

  if (!providerRef) {
    console.warn('[prembly-webhook] No reference found in payload — cannot match attempt');
    return new Response(JSON.stringify({ ok: true, skipped: 'no_reference' }), { headers: { ...JSON_H, ...CORS } });
  }

  // ── 5. Idempotency — reject replayed tokens ───────────────────────────────
  if (token) {
    const { data: existing } = await admin
      .from('kyc_attempts')
      .select('id, status')
      .eq('prembly_token', token)
      .maybeSingle();

    if (existing) {
      console.log('[prembly-webhook] Duplicate token — already processed attempt_id=', existing.id);
      await storeProviderEvent(admin, {
        attempt_id:  existing.id,
        provider:    'prembly',
        event_type:  'webhook',
        reference_id: providerRef,
        raw_payload: payload,
        is_duplicate: true,
      });
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: { ...JSON_H, ...CORS } });
    }
  }

  // ── 6. Match attempt by provider reference ────────────────────────────────
  const { data: attempt } = await admin
    .from('kyc_attempts')
    .select('id, user_id, submission_id, status, provider, manual_override, decision_source')
    .or(`reference_id.eq.${providerRef},external_reference.eq.${providerRef},provider_reference.eq.${providerRef},provider_ref_id.eq.${providerRef}`)
    .eq('provider', 'prembly')
    .maybeSingle();

  if (!attempt) {
    console.warn('[prembly-webhook] No attempt matched ref=', providerRef);
    await storeProviderEvent(admin, {
      provider:    'prembly',
      event_type:  'webhook',
      reference_id: providerRef,
      raw_payload: payload,
    });
    return new Response(JSON.stringify({ ok: true, skipped: 'attempt_not_found' }), { headers: { ...JSON_H, ...CORS } });
  }

  // ── 7. Manual override protection ────────────────────────────────────────
  if (attempt.manual_override === true || attempt.decision_source === 'manual') {
    console.log('[prembly-webhook] Skipping — manual override protects attempt_id=', attempt.id);
    await storeProviderEvent(admin, {
      attempt_id:  attempt.id,
      provider:    'prembly',
      event_type:  'webhook',
      reference_id: providerRef,
      raw_payload: payload,
    });
    return new Response(JSON.stringify({ ok: true, skipped: 'manual_override_protected' }), { headers: { ...JSON_H, ...CORS } });
  }

  // ── 8. Map Prembly status to internal status ──────────────────────────────
  let internalStatus = mapPremblyStatus(rawStatus);
  let adminAlert: string | undefined;

  // Response-code overrides take priority for non-verified responses
  if (responseCode && internalStatus !== 'verified') {
    const mapped = mapPremblyResponseCode(responseCode);
    internalStatus = mapped.status;
    adminAlert     = mapped.adminAlert;
  }

  // Check risk scores for manual review trigger
  const verificationData = (payload.verification ?? {}) as Record<string, unknown>;
  const manualReasons = needsManualReview({
    confidence_score:  verificationData.confidence_score as number | null,
    fraud_risk_score:  verificationData.fraud_risk_score as number | null,
    result_face_match: String(verificationData.face_match_status ?? '').toLowerCase() || null,
    result_liveness:   String(verificationData.liveness_status ?? '').toLowerCase() || null,
    result_aml:        String(verificationData.aml_status ?? '').toLowerCase() || null,
    result_sanctions:  String(verificationData.sanctions_status ?? '').toLowerCase() || null,
    result_pep:        String(verificationData.pep_status ?? '').toLowerCase() || null,
    confidence_threshold: 60,
    fraud_threshold:      70,
    face_threshold:        0,
  });

  if (manualReasons.length > 0 && internalStatus === 'verified') {
    internalStatus = 'manual_review';
    adminAlert = `Manual review required: ${manualReasons.join('; ')}`;
  }

  const now = new Date().toISOString();

  // ── 9. Store raw provider event ───────────────────────────────────────────
  await storeProviderEvent(admin, {
    attempt_id:   attempt.id,
    submission_id: attempt.submission_id ?? undefined,
    provider:     'prembly',
    event_type:   'webhook',
    reference_id: providerRef,
    raw_payload:  payload,
  });

  // ── 10. Update attempt ────────────────────────────────────────────────────
  const attemptUpdate: Record<string, unknown> = {
    status:             internalStatus,
    raw_provider_status: rawStatus,
    provider_reference: providerRef,
    last_webhook_at:    now,
    updated_at:         now,
  };
  if (token)                          attemptUpdate.prembly_token     = token;
  if (internalStatus === 'verified')  attemptUpdate.completed_at      = now;
  if (internalStatus === 'failed')    attemptUpdate.failure_reason    = `Prembly: ${rawStatus}`;
  if (manualReasons.length > 0)       attemptUpdate.manual_review_reasons = manualReasons;

  // Verification data fields
  if (verificationData.full_name)   attemptUpdate.full_name    = String(verificationData.full_name);
  if (verificationData.date_of_birth) attemptUpdate.date_of_birth = String(verificationData.date_of_birth);
  if (verificationData.confidence_score != null) attemptUpdate.confidence_score = verificationData.confidence_score;

  const { error: attErr } = await admin
    .from('kyc_attempts')
    .update(attemptUpdate)
    .eq('id', attempt.id);

  if (attErr) {
    console.error('[prembly-webhook] Attempt update failed:', attErr.message);
    await recordProviderHealth(admin, 'prembly', false, attErr.message);
    return new Response(JSON.stringify({ error: 'DB update failed' }), { status: 500, headers: { ...JSON_H, ...CORS } });
  }

  // ── 11. Update user profile (if terminal status) ──────────────────────────
  if (['verified', 'failed', 'rejected', 'manual_review'].includes(internalStatus)) {
    const profileUpdate: Record<string, unknown> = {
      kyc_status:    internalStatus,
      kyc_provider:  'prembly',
      updated_at:    now,
    };
    if (internalStatus === 'verified') {
      profileUpdate.kyc_verified_at = now;
      const country = verificationData.country ?? attempt.submission_id; // best-effort
      if (country) profileUpdate.kyc_country = String(country);
    }

    await admin.from('profiles').update(profileUpdate).eq('id', attempt.user_id);
  }

  // ── 12. Audit log + optional admin notification ───────────────────────────
  await appendAuditLog(admin, {
    submission_id: attempt.submission_id ?? undefined,
    user_id:       attempt.user_id,
    action:        'prembly_webhook',
    old_status:    attempt.status,
    new_status:    internalStatus,
    metadata: {
      provider:      'prembly',
      raw_status:    rawStatus,
      response_code: responseCode,
      token,
      admin_alert:   adminAlert,
    },
  });

  if (adminAlert) {
    await admin.from('notifications').insert({
      user_id:    attempt.user_id,
      type:       'kyc_admin_alert',
      title:      'KYC Compliance Alert',
      message:    adminAlert,
      is_read:    false,
      created_at: now,
    }).then(() => {});
  }

  await recordProviderHealth(admin, 'prembly', true);

  console.log(`[prembly-webhook] attempt=${attempt.id} ${attempt.status}→${internalStatus}`);
  return new Response(JSON.stringify({ ok: true }), { headers: { ...JSON_H, ...CORS } });
});
