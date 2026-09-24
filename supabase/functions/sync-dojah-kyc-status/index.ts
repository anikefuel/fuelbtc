// sync-dojah-kyc-status — Dedicated status-sync for a single Dojah KYC attempt.
//
// Called by:
//   • User after widget close (attempt_id param)
//   • Admin "Sync Status" button (attempt_id param)
//   • Scheduled reconciliation (no param — syncs all non-terminal attempts)
//
// POST { attempt_id?: string }  +  Authorization: Bearer <jwt>
//
// Security:
//  • DOJAH_PRIVATE_KEY stays server-side — never returned to client.
//  • Tier upgrade done only on verified backend result, never from client signal.
//  • Admin path accepts any attempt; user path enforces user_id == auth.uid().

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ── Inlined shared utilities (avoids _shared bundler path issues) ─────────────
const JSON_H = { 'Content-Type': 'application/json' };

function getAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function recordProviderHealth(
  admin: ReturnType<typeof getAdmin>,
  providerName: string,
  success: boolean,
  error?: string,
) {
  try {
    if (success) {
      await admin.from('kyc_providers').update({
        health_status: 'healthy', failure_count: 0,
        last_success_at: new Date().toISOString(), last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('provider_name', providerName);
    } else {
      const { data } = await admin.from('kyc_providers')
        .select('failure_count').eq('provider_name', providerName).maybeSingle();
      const count = ((data as Record<string, unknown>)?.failure_count as number ?? 0) + 1;
      await admin.from('kyc_providers').update({
        health_status: count > 5 ? 'unhealthy' : 'degraded',
        failure_count: count, last_error: error ?? 'unknown',
        last_error_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('provider_name', providerName);
    }
  } catch (e) {
    console.warn('[sync-dojah] recordProviderHealth failed:', e instanceof Error ? e.message : e);
  }
}

async function storeProviderEvent(
  admin: ReturnType<typeof getAdmin>,
  params: {
    attempt_id?: string; submission_id?: string; provider: string;
    event_type: string; reference_id?: string;
    raw_payload: unknown; is_duplicate?: boolean;
  },
) {
  try {
    await admin.from('kyc_provider_events').insert({ ...params, processed: false });
  } catch (e) {
    console.warn('[sync-dojah] storeProviderEvent failed:', e instanceof Error ? e.message : e);
  }
}

async function appendAuditLog(
  admin: ReturnType<typeof getAdmin>,
  params: {
    submission_id?: string; user_id: string; action: string;
    old_status?: string; new_status?: string;
    reason?: string; notes?: string; metadata?: Record<string, unknown>;
  },
) {
  try {
    await admin.from('kyc_audit_log').insert(params);
  } catch (e) {
    console.warn('[sync-dojah] appendAuditLog failed:', e instanceof Error ? e.message : e);
  }
}

function needsManualReview(params: {
  confidence_score?: number | null; fraud_risk_score?: number | null;
  result_face_match?: string | null; result_liveness?: string | null;
  result_aml?: string | null; result_sanctions?: string | null;
  result_pep?: string | null;
  confidence_threshold: number; fraud_threshold: number; face_threshold: number;
}): string[] {
  const reasons: string[] = [];
  if (params.confidence_score != null && params.confidence_score < params.confidence_threshold)
    reasons.push(`Confidence score ${params.confidence_score} below threshold ${params.confidence_threshold}`);
  if (params.fraud_risk_score != null && params.fraud_risk_score > params.fraud_threshold)
    reasons.push(`Fraud risk score ${params.fraud_risk_score} exceeds threshold ${params.fraud_threshold}`);
  if (params.result_face_match === 'inconclusive') reasons.push('Face match inconclusive');
  if (params.result_liveness   === 'failed')       reasons.push('Liveness detection failed');
  if (params.result_aml        === 'hit')          reasons.push('AML screening hit — requires investigation');
  if (params.result_sanctions  === 'hit')          reasons.push('Sanctions screening hit — requires investigation');
  if (params.result_pep        === 'hit')          reasons.push('PEP screening hit — requires investigation');
  return reasons;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Dojah Verification Details API ───────────────────────────────────────────
async function fetchDojahVerification(
  admin: ReturnType<typeof getAdmin>,
  referenceId: string,
): Promise<Record<string, unknown> | null> {
  const appId      = Deno.env.get('DOJAH_APP_ID')      ?? '';
  const privateKey = Deno.env.get('DOJAH_PRIVATE_KEY') ?? '';
  if (!appId || !privateKey) {
    console.warn('[sync-dojah] API credentials not configured');
    return null;
  }

  const url = `https://api.dojah.io/api/v1/kyc/widget/verification?reference_id=${encodeURIComponent(referenceId)}`;
  try {
    const res = await fetch(url, { headers: { AppId: appId, Authorization: privateKey } });
    // 404 = no record found for this reference — not a provider health failure
    if (res.status === 404) {
      console.warn('[sync-dojah] No verification found for reference:', referenceId);
      return null;
    }
    // 401/403 = bad credentials → mark misconfigured
    if (res.status === 401 || res.status === 403) {
      await recordProviderHealth(admin, 'dojah', false, `HTTP ${res.status} — check DOJAH_APP_ID and DOJAH_PRIVATE_KEY`);
      return null;
    }
    // 5xx = real server error → mark unhealthy
    if (res.status >= 500) {
      await recordProviderHealth(admin, 'dojah', false, `HTTP ${res.status} server error`);
      return null;
    }
    if (!res.ok) {
      console.warn('[sync-dojah] Dojah API HTTP', res.status, '— not a health failure');
      return null;
    }
    await recordProviderHealth(admin, 'dojah', true);
    const json = await res.json();
    return (json?.entity ?? json) as Record<string, unknown>;
  } catch (e) {
    await recordProviderHealth(admin, 'dojah', false, e instanceof Error ? e.message : 'fetch error');
    return null;
  }
}

// ── Status normalisation ───────────────────────────────────────────────────────
function normalizeDojahStatus(raw: string, data: Record<string, unknown>): string {
  const s = raw.toLowerCase().trim();
  if (['ongoing', 'in_progress', 'initiated', 'processing'].includes(s)) return 'in_progress';
  if (['abandoned', 'cancelled', 'expired'].includes(s))                  return 'abandoned';
  if (s === 'pending')                                                     return 'pending_review';
  if (['completed', 'successful', 'success'].includes(s)) {
    const passed = data.passed;
    const result = String(data.result ?? '').toLowerCase();
    if (passed === true  || result === 'passed' || result === 'success') return 'verified';
    if (passed === false || result === 'failed')                         return 'failed';
    return 'pending_review';
  }
  if (['failed', 'rejected', 'declined'].includes(s)) return 'failed';
  return 'in_progress';
}

// ── Process one attempt ────────────────────────────────────────────────────────
async function syncAttempt(
  admin: ReturnType<typeof getAdmin>,
  attempt: {
    id: string; user_id: string; reference_id: string; status: string;
    submission_id?: string; provider: string;
  },
  triggeredBy: string,
): Promise<{ status: string; synced: boolean; error?: string }> {
  // CRITICAL: never overwrite a manual admin decision
  if ((attempt as Record<string, unknown>).manual_override === true ||
      (attempt as Record<string, unknown>).decision_source === 'manual') {
    console.log('[sync-dojah] Skipping — manual_override=true for attempt', attempt.id, 'status:', attempt.status);
    return { status: attempt.status, synced: false };
  }
  // Already terminal provider status — skip API call
  if (['verified', 'failed', 'abandoned'].includes(attempt.status)) {
    return { status: attempt.status, synced: false };
  }

  const vd = await fetchDojahVerification(admin, attempt.reference_id);
  if (!vd) return { status: attempt.status, synced: false, error: 'Dojah API unavailable' };

  const rawStatus   = String(vd.status ?? vd.verification_status ?? 'pending');
  const normalized  = normalizeDojahStatus(rawStatus, vd);

  // Extract check results
  const doc       = (vd.document   ?? {}) as Record<string, unknown>;
  const face      = (vd.face_match ?? {}) as Record<string, unknown>;
  const liveness  = (vd.liveness   ?? {}) as Record<string, unknown>;
  const aml       = (vd.aml        ?? {}) as Record<string, unknown>;
  const fraud     = (vd.fraud      ?? {}) as Record<string, unknown>;
  const sanctions = (vd.sanctions  ?? {}) as Record<string, unknown>;
  const pep       = (vd.pep        ?? {}) as Record<string, unknown>;

  // Load thresholds from settings
  const { data: settings } = await admin.from('kyc_settings').select('key,value')
    .in('key', ['manual_review_confidence_threshold', 'fraud_risk_threshold', 'face_match_threshold']);
  const getN = (k: string, d: number) =>
    Number((settings ?? []).find((s: Record<string, unknown>) => s.key === k)?.value ?? d);
  const confThresh  = getN('manual_review_confidence_threshold', 75);
  const fraudThresh = getN('fraud_risk_threshold', 60);
  const faceThresh  = getN('face_match_threshold', 80);

  const faceConf   = face.confidence != null ? Number(face.confidence) * 100 : null;
  const fraudScore = fraud.risk_score != null ? Number(fraud.risk_score) * 100 : 0;
  const livenessResult = String(liveness.status ?? '');
  const amlResult      = String(aml.status ?? '');
  const faceResult     = faceConf != null
    ? (faceConf >= faceThresh ? 'passed' : faceConf >= 60 ? 'inconclusive' : 'failed') : null;

  const manualReasons = needsManualReview({
    confidence_score:  doc.confidence != null ? Number(doc.confidence) * 100 : null,
    fraud_risk_score:  fraudScore,
    result_face_match: faceResult,
    result_liveness:   livenessResult === 'live' ? 'passed' : livenessResult === 'failed' ? 'failed' : null,
    result_aml:        amlResult === 'clear' ? 'passed' : amlResult === 'hit' ? 'hit' : null,
    result_sanctions:  String(sanctions.status ?? '') === 'clear' ? 'passed' : String(sanctions.status ?? '') === 'hit' ? 'hit' : null,
    result_pep:        String(pep.status ?? '') === 'clear' ? 'passed' : String(pep.status ?? '') === 'hit' ? 'hit' : null,
    confidence_threshold: confThresh, fraud_threshold: fraudThresh, face_threshold: faceThresh,
  });

  const finalStatus = (manualReasons.length > 0 && !['verified', 'failed', 'abandoned'].includes(normalized))
    ? 'manual_review' : normalized;

  const now = new Date().toISOString();
  const attemptUpdates: Record<string, unknown> = {
    status:               finalStatus,
    raw_provider_status:  rawStatus,
    result_doc_verify:    String(doc.status ?? '') || null,
    result_face_match:    faceResult,
    result_liveness:      livenessResult === 'live' ? 'passed' : livenessResult || null,
    result_aml:           amlResult === 'clear' ? 'passed' : amlResult === 'hit' ? 'hit' : 'not_run',
    result_pep:           String(pep.status ?? '') === 'clear' ? 'passed' : String(pep.status ?? '') === 'hit' ? 'hit' : 'not_run',
    result_sanctions:     String(sanctions.status ?? '') === 'clear' ? 'passed' : String(sanctions.status ?? '') === 'hit' ? 'hit' : 'not_run',
    result_fraud:         fraudScore > fraudThresh ? 'risk_detected' : 'passed',
    confidence_score:     doc.confidence != null ? Number(doc.confidence) * 100 : null,
    fraud_risk_score:     fraudScore,
    manual_review_reasons: manualReasons.length > 0 ? manualReasons : null,
    full_name:            doc.first_name ? `${doc.first_name} ${doc.last_name ?? ''}`.trim() : null,
    date_of_birth:        doc.date_of_birth ?? null,
    last_webhook_at:      now,
    updated_at:           now,
  };
  if (['verified', 'failed', 'abandoned', 'manual_review'].includes(finalStatus)) {
    attemptUpdates.completed_at = now;
  }
  if (finalStatus === 'submitted' || finalStatus === 'pending_review') {
    attemptUpdates.submitted_at = now;
  }
  if (finalStatus === 'failed') {
    attemptUpdates.failure_reason = manualReasons.length > 0 ? manualReasons.join('; ') : rawStatus;
  }

  await admin.from('kyc_attempts').update(attemptUpdates).eq('id', attempt.id);

  // Sync kyc_submissions if linked (legacy compat)
  if (attempt.submission_id) {
    const subStatus = finalStatus === 'verified' ? 'approved'
      : finalStatus === 'failed' ? 'rejected'
      : finalStatus === 'manual_review' ? 'needs_manual_review'
      : finalStatus === 'abandoned' ? 'not_started'
      : 'pending';
    await admin.from('kyc_submissions').update({
      status: subStatus, result_doc_verify: attemptUpdates.result_doc_verify,
      result_face_match: attemptUpdates.result_face_match,
      result_liveness: attemptUpdates.result_liveness,
      result_aml: attemptUpdates.result_aml,
      confidence_score: attemptUpdates.confidence_score,
      fraud_risk_score: attemptUpdates.fraud_risk_score,
      manual_review_reasons: attemptUpdates.manual_review_reasons,
    }).eq('id', attempt.submission_id);
  }

  // Update profile
  if (finalStatus === 'verified') {
    await admin.from('profiles').update({ kyc_tier: 'tier2', kyc_status: 'approved' }).eq('id', attempt.user_id);
  } else if (finalStatus === 'failed') {
    await admin.from('profiles').update({ kyc_status: 'rejected' }).eq('id', attempt.user_id);
  } else if (finalStatus === 'manual_review') {
    await admin.from('profiles').update({ kyc_status: 'needs_manual_review' }).eq('id', attempt.user_id);
  } else if (finalStatus === 'abandoned') {
    await admin.from('profiles').update({ kyc_status: 'not_started' }).eq('id', attempt.user_id);
  }

  // Store provider event
  await storeProviderEvent(admin, {
    attempt_id: attempt.id, submission_id: attempt.submission_id,
    provider: 'dojah', event_type: 'poll', reference_id: attempt.reference_id,
    raw_payload: vd, is_duplicate: false,
  });

  // Audit log
  await appendAuditLog(admin, {
    submission_id: attempt.submission_id, user_id: attempt.user_id,
    action: 'status_sync', old_status: attempt.status, new_status: finalStatus,
    metadata: { provider: 'dojah', triggered_by: triggeredBy, attempt_id: attempt.id },
  });

  return { status: finalStatus, synced: true };
}

// ── Main handler ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const admin = getAdmin();
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...JSON_H, ...CORS } });

    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...JSON_H, ...CORS } });

    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const isAdmin = profile?.role === 'admin';

    let attemptId: string | undefined;
    try { const b = await req.json(); attemptId = b.attempt_id; } catch { /* ok */ }

    if (attemptId) {
      // Single attempt sync
      const { data: attempt, error: attErr } = await admin
        .from('kyc_attempts')
        .select('id, user_id, reference_id, status, submission_id, provider, manual_override, decision_source')
        .eq('id', attemptId)
        // Non-admins can only sync their own attempts
        .eq(isAdmin ? 'provider' : 'user_id', isAdmin ? 'dojah' : user.id)
        .maybeSingle();

      if (attErr || !attempt) return new Response(
        JSON.stringify({ error: 'Attempt not found or access denied' }),
        { status: 404, headers: { ...JSON_H, ...CORS } });

      if (!isAdmin && attempt.user_id !== user.id) return new Response(
        JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...JSON_H, ...CORS } });

      const result = await syncAttempt(admin, attempt, isAdmin ? 'admin_sync' : 'user_poll');
      return new Response(JSON.stringify(result), { headers: { ...JSON_H, ...CORS } });
    }

    // No attemptId — find latest for this user (non-admin convenience)
    const { data: latestAttempt } = await admin
      .from('kyc_attempts')
      .select('id, user_id, reference_id, status, submission_id, provider, manual_override, decision_source')
      .eq('user_id', user.id)
      .eq('provider', 'dojah')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestAttempt) return new Response(
      JSON.stringify({ error: 'No Dojah attempt found' }),
      { status: 404, headers: { ...JSON_H, ...CORS } });

    const result = await syncAttempt(admin, latestAttempt, 'user_poll');
    return new Response(JSON.stringify(result), { headers: { ...JSON_H, ...CORS } });

  } catch (e) {
    console.error('[sync-dojah] unhandled:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...JSON_H, ...CORS } });
  }
});
