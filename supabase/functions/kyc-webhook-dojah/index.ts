// kyc-webhook-dojah — Dojah status-sync + webhook endpoint
//
// Supports two call modes:
//  1. STATUS-SYNC (app polling after widget completion):
//     POST { submission_id?, attempt_id? }  +  Authorization: Bearer <user_jwt>
//     → calls Dojah REST API, updates kyc_attempts + kyc_submissions, returns { status }
//
//  2. WEBHOOK (Dojah server push event):
//     POST <raw dojah payload>  +  X-Dojah-Signature or X-Dojah-Signature-V2 header
//     → validates HMAC-SHA256 signature
//     → matches event via reference_id (EXX-KYC-{UUID} or legacy exchangex_{userId}_{ts})
//     → idempotent duplicate detection
//     → stores raw event in kyc_provider_events
//     → updates kyc_attempts status + kyc_submissions
//     → returns HTTP 200 promptly
//
// SECURITY:
//  - DOJAH_PRIVATE_KEY is backend-only — never returned to client
//  - Tier is only granted after backend-verified webhook/poll, never from frontend
//  - reference_id ownership validated against user_id before any DB write

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAdmin, appendAuditLog, mapProviderStatus, needsManualReview, recordProviderHealth, storeProviderEvent, JSON_H } from '../_shared/kyc-utils.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Dojah REST API: fetch verification by reference_id ────────────────────────
async function fetchDojahVerification(referenceId: string): Promise<Record<string, unknown> | null> {
  const appId      = Deno.env.get('DOJAH_APP_ID') ?? '';
  const privateKey = Deno.env.get('DOJAH_PRIVATE_KEY') ?? '';
  if (!appId || !privateKey) { console.warn('[dojah] API creds not configured'); return null; }

  const url = `https://api.dojah.io/api/v1/kyc/widget/verification?reference_id=${encodeURIComponent(referenceId)}`;
  try {
    const res = await fetch(url, { headers: { 'AppId': appId, 'Authorization': privateKey } });
    // 404 = record not found for this reference (not a provider health failure)
    // Only mark unhealthy on 5xx (server errors) or 401/403 (bad credentials)
    if (res.status === 404) {
      console.warn('[dojah] No verification record for reference:', referenceId);
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      await recordProviderHealth(getAdmin(), 'dojah', false, `HTTP ${res.status} — check DOJAH_APP_ID and DOJAH_PRIVATE_KEY`);
      return null;
    }
    if (res.status >= 500) {
      await recordProviderHealth(getAdmin(), 'dojah', false, `HTTP ${res.status} server error`);
      return null;
    }
    if (!res.ok) {
      console.warn('[dojah] API returned', res.status, '— not recorded as health failure');
      return null;
    }
    await recordProviderHealth(getAdmin(), 'dojah', true);
    const json = await res.json();
    return (json?.entity ?? json) as Record<string, unknown>;
  } catch (e) {
    await recordProviderHealth(getAdmin(), 'dojah', false, e instanceof Error ? e.message : 'fetch error');
    return null;
  }
}

// ── Normalize Dojah status to internal KYC attempt status ─────────────────────
function normalizeDojahStatus(dojahStatus: string, data: Record<string, unknown>): string {
  const s = dojahStatus.toLowerCase().trim();
  if (['ongoing','in_progress','initiated','processing'].includes(s)) return 'in_progress';
  if (['abandoned','cancelled','expired'].includes(s))               return 'abandoned';
  if (s === 'pending')                                                return 'pending_review';
  if (['completed','successful','success'].includes(s)) {
    const passed = data.passed;
    const result = String(data.result ?? '').toLowerCase();
    if (passed === true || result === 'passed' || result === 'success') return 'verified';
    if (passed === false || result === 'failed')                        return 'failed';
    return 'pending_review';
  }
  if (['failed','rejected','declined'].includes(s)) return 'failed';
  return 'in_progress';
}

// Map attempt status → submission status (legacy kyc_status enum values)
function attemptToSubmissionStatus(attemptStatus: string): string {
  switch (attemptStatus) {
    case 'verified':     return 'approved';
    case 'failed':       return 'rejected';
    case 'pending_review': return 'under_review';
    case 'abandoned':    return 'not_started';
    case 'manual_review': return 'needs_manual_review';
    default:             return 'pending';
  }
}

// ── Resolve reference to user/submission/attempt ───────────────────────────────
async function resolveReference(
  admin: ReturnType<typeof getAdmin>,
  referenceId: string,
): Promise<{ userId: string; submissionId?: string; attemptId?: string } | null> {
  // Try kyc_attempts first (EXX-KYC-{UUID} format)
  const { data: attempt } = await admin
    .from('kyc_attempts')
    .select('id, user_id, submission_id')
    .eq('reference_id', referenceId)
    .maybeSingle();

  if (attempt) {
    return { userId: attempt.user_id, submissionId: attempt.submission_id, attemptId: attempt.id };
  }

  // Legacy: exchangex_{userId}_{ts} format
  const legacyMatch = referenceId.match(/^exchangex_([a-f0-9-]{36})/);
  if (legacyMatch) {
    const userId = legacyMatch[1];
    const { data: sub } = await admin
      .from('kyc_submissions')
      .select('id, user_id')
      .eq('provider_ref_id', referenceId)
      .maybeSingle();
    return { userId, submissionId: sub?.id };
  }

  // Try provider_ref_id on submission
  const { data: sub2 } = await admin
    .from('kyc_submissions')
    .select('id, user_id')
    .eq('provider_ref_id', referenceId)
    .maybeSingle();

  if (sub2) return { userId: sub2.user_id, submissionId: sub2.id };

  console.warn('[dojah] Cannot resolve reference:', referenceId);
  return null;
}

// ── Core: process Dojah verification payload → update DB ──────────────────────
async function processDojahVerification(
  admin: ReturnType<typeof getAdmin>,
  referenceId: string,
  verificationData: Record<string, unknown>,
  rawPayload: unknown,
  eventType: 'webhook' | 'poll' | 'manual_sync' = 'poll',
): Promise<{ userId: string; finalAttemptStatus: string; submissionId?: string; attemptId?: string } | null> {

  const resolved = await resolveReference(admin, referenceId);
  if (!resolved) return null;
  const { userId, submissionId, attemptId } = resolved;

  // Idempotency + manual-override guard
  if (attemptId) {
    const { data: currentAttempt } = await admin
      .from('kyc_attempts')
      .select('status, manual_override, decision_source')
      .eq('id', attemptId)
      .maybeSingle();
    if (currentAttempt) {
      // CRITICAL: never overwrite a manual admin decision
      if (currentAttempt.manual_override === true || currentAttempt.decision_source === 'manual') {
        console.log('[dojah] Skipping — manual_override=true for attempt', attemptId, 'status:', currentAttempt.status);
        await storeProviderEvent(admin, { attempt_id: attemptId, submission_id: submissionId,
          provider: 'dojah', event_type: eventType, reference_id: referenceId,
          raw_payload: rawPayload, is_duplicate: true });
        return { userId, finalAttemptStatus: currentAttempt.status, submissionId, attemptId };
      }
      // Also skip terminal provider statuses (verified/failed/abandoned)
      if (['verified', 'failed', 'abandoned'].includes(currentAttempt.status)) {
        const dojahStatusRaw = String(verificationData.status ?? verificationData.verification_status ?? '');
        const newStatus = normalizeDojahStatus(dojahStatusRaw, verificationData);
        if (currentAttempt.status === newStatus) {
          console.log('[dojah] Idempotent skip:', referenceId, 'already', currentAttempt.status);
          await storeProviderEvent(admin, { attempt_id: attemptId, submission_id: submissionId,
            provider: 'dojah', event_type: eventType, reference_id: referenceId,
            raw_payload: rawPayload, is_duplicate: true });
          return { userId, finalAttemptStatus: currentAttempt.status, submissionId, attemptId };
        }
      }
    }
  }

  // Extract & normalize status
  const dojahStatusRaw = String(
    verificationData.status ?? verificationData.verification_status ?? 'pending'
  );
  const finalAttemptStatus = normalizeDojahStatus(dojahStatusRaw, verificationData);

  // Extract check results
  const docData       = (verificationData.document     ?? {}) as Record<string, unknown>;
  const faceData      = (verificationData.face_match   ?? {}) as Record<string, unknown>;
  const livenessData  = (verificationData.liveness     ?? {}) as Record<string, unknown>;
  const amlData       = (verificationData.aml          ?? {}) as Record<string, unknown>;
  const fraudData     = (verificationData.fraud        ?? {}) as Record<string, unknown>;
  const sanctionsData = (verificationData.sanctions    ?? {}) as Record<string, unknown>;
  const pepData       = (verificationData.pep          ?? {}) as Record<string, unknown>;

  const { data: settings } = await admin.from('kyc_settings').select('key,value')
    .in('key', ['manual_review_confidence_threshold','fraud_risk_threshold','face_match_threshold']);
  const getN = (k: string, d: number) => Number((settings ?? []).find((s: Record<string,unknown>) => s.key === k)?.value ?? d);
  const confThresh  = getN('manual_review_confidence_threshold', 75);
  const fraudThresh = getN('fraud_risk_threshold', 60);
  const faceThresh  = getN('face_match_threshold', 80);

  const faceConf   = faceData.confidence != null ? Number(faceData.confidence) * 100 : null;
  const fraudScore = fraudData.risk_score != null ? Number(fraudData.risk_score) * 100 : 0;
  const faceResult = faceConf != null
    ? (faceConf >= faceThresh ? 'passed' : faceConf >= 60 ? 'inconclusive' : 'failed') : null;
  const livenessResult = String(livenessData.status ?? '');
  const amlResult      = String(amlData.status ?? '');

  const manualReasons = needsManualReview({
    confidence_score:  docData.confidence != null ? Number(docData.confidence) * 100 : null,
    fraud_risk_score:  fraudScore,
    result_face_match: faceResult,
    result_liveness:   livenessResult === 'live' ? 'passed' : livenessResult === 'failed' ? 'failed' : null,
    result_aml:        amlResult === 'clear' ? 'passed' : amlResult === 'hit' ? 'hit' : null,
    result_sanctions:  String(sanctionsData.status ?? '') === 'clear' ? 'passed' : String(sanctionsData.status ?? '') === 'hit' ? 'hit' : null,
    result_pep:        String(pepData.status ?? '') === 'clear' ? 'passed' : String(pepData.status ?? '') === 'hit' ? 'hit' : null,
    confidence_threshold: confThresh, fraud_threshold: fraudThresh, face_threshold: faceThresh,
  });

  // Escalate to manual_review if needed (but NOT if already rejected/verified)
  const resolvedAttemptStatus = (manualReasons.length > 0 && !['verified','failed','abandoned'].includes(finalAttemptStatus))
    ? 'manual_review' : finalAttemptStatus;

  const submissionStatus = attemptToSubmissionStatus(resolvedAttemptStatus);

  const now = new Date().toISOString();

  // Update kyc_attempts
  if (attemptId) {
    const attemptUpdates: Record<string, unknown> = {
      status:             resolvedAttemptStatus,
      raw_provider_status: dojahStatusRaw,
      updated_at:         now,
    };
    if (['verified','failed','abandoned','manual_review'].includes(resolvedAttemptStatus)) {
      attemptUpdates.completed_at = now;
    }
    if (resolvedAttemptStatus === 'submitted' || resolvedAttemptStatus === 'pending_review') {
      attemptUpdates.submitted_at = now;
    }
    if (resolvedAttemptStatus === 'failed') {
      attemptUpdates.failure_reason = manualReasons.length > 0 ? manualReasons.join('; ') : dojahStatusRaw;
    }
    await admin.from('kyc_attempts').update(attemptUpdates).eq('id', attemptId);
  }

  // Update kyc_submissions (legacy table, kept for compatibility)
  if (submissionId) {
    const subUpdates: Record<string, unknown> = {
      status:                submissionStatus,
      result_doc_verify:     String(docData.status ?? '') || null,
      result_face_match:     faceResult,
      result_liveness:       livenessResult === 'live' ? 'passed' : livenessResult || null,
      result_aml:            amlResult === 'clear' ? 'passed' : amlResult === 'hit' ? 'hit' : 'not_run',
      result_pep:            String(pepData.status ?? '') === 'clear' ? 'passed' : String(pepData.status ?? '') === 'hit' ? 'hit' : 'not_run',
      result_sanctions:      String(sanctionsData.status ?? '') === 'clear' ? 'passed' : String(sanctionsData.status ?? '') === 'hit' ? 'hit' : 'not_run',
      result_fraud:          fraudScore > fraudThresh ? 'risk_detected' : 'passed',
      fraud_risk_score:      fraudScore,
      full_name:             docData.first_name ? `${docData.first_name} ${docData.last_name ?? ''}`.trim() : null,
      date_of_birth:         docData.date_of_birth ?? null,
      doc_number_masked:     docData.document_number ? `****${String(docData.document_number).slice(-4)}` : null,
      confidence_score:      docData.confidence != null ? Number(docData.confidence) * 100 : null,
      manual_review_reasons: manualReasons,
      raw_provider_payload:  rawPayload,
    };
    await admin.from('kyc_submissions').update(subUpdates).eq('id', submissionId);
  }

  // Update profile KYC status (approved ONLY from backend verification)
  if (resolvedAttemptStatus === 'verified') {
    await admin.from('profiles').update({ kyc_tier: 'tier2', kyc_status: 'verified' }).eq('id', userId);
    if (submissionId) {
      const exp = new Date(); exp.setMonth(exp.getMonth() + 12);
      await admin.from('kyc_submissions').update({ expires_at: exp.toISOString() }).eq('id', submissionId);
    }
  } else if (resolvedAttemptStatus === 'failed') {
    await admin.from('profiles').update({ kyc_status: 'rejected' }).eq('id', userId);
  } else if (resolvedAttemptStatus === 'manual_review') {
    await admin.from('profiles').update({ kyc_status: 'needs_manual_review' }).eq('id', userId);
  } else if (resolvedAttemptStatus === 'abandoned') {
    await admin.from('profiles').update({ kyc_status: 'not_started' }).eq('id', userId);
  }

  // Store provider event
  await storeProviderEvent(admin, {
    attempt_id: attemptId, submission_id: submissionId, provider: 'dojah',
    event_type: eventType, reference_id: referenceId,
    raw_payload: rawPayload, is_duplicate: false,
  });

  return { userId, finalAttemptStatus: resolvedAttemptStatus, submissionId, attemptId };
}

// ── HMAC-SHA256 signature verification ────────────────────────────────────────
async function verifyDojahSignature(secret: string, rawBody: string, header: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expected = 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  return expected === header;
}

// ── Main handler ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rawBody = await req.text();
  const admin   = getAdmin();

  // ── Path A: authenticated app poll ────────────────────────────────────────
  const authHeader  = req.headers.get('Authorization') ?? '';
  const hasDojahSig = req.headers.has('X-Dojah-Signature') || req.headers.has('X-Dojah-Signature-V2');

  if (authHeader && !hasDojahSig) {
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...JSON_H, ...CORS } });

    let attemptId: string | undefined;
    let submissionId: string | undefined;
    try { const b = JSON.parse(rawBody); attemptId = b.attempt_id; submissionId = b.submission_id; } catch { /* ok */ }

    // Find the latest attempt for this user
    let query = admin.from('kyc_attempts').select('id, status, reference_id, provider, submission_id')
      .eq('user_id', user.id).eq('provider', 'dojah')
      .order('created_at', { ascending: false }).limit(1);
    if (attemptId) query = admin.from('kyc_attempts').select('id, status, reference_id, provider, submission_id')
      .eq('id', attemptId).eq('user_id', user.id).limit(1);

    const { data: attempt } = await query.maybeSingle();

    // Fallback to kyc_submissions for legacy references
    if (!attempt?.reference_id) {
      let subQuery = admin.from('kyc_submissions').select('id, status, provider_ref_id, user_id')
        .eq('user_id', user.id).eq('provider', 'dojah').order('created_at', { ascending: false }).limit(1);
      if (submissionId) subQuery = admin.from('kyc_submissions').select('id, status, provider_ref_id, user_id')
        .eq('id', submissionId).eq('user_id', user.id).limit(1);
      const { data: sub } = await subQuery.maybeSingle();
      if (!sub?.provider_ref_id) return new Response(JSON.stringify({ error: 'No Dojah attempt found' }),
        { status: 404, headers: { ...JSON_H, ...CORS } });

      if (['approved','rejected'].includes(sub.status)) return new Response(
        JSON.stringify({ status: sub.status, synced: false }), { headers: { ...JSON_H, ...CORS } });

      const vd = await fetchDojahVerification(sub.provider_ref_id);
      if (!vd) return new Response(JSON.stringify({ status: sub.status, synced: false }), { headers: { ...JSON_H, ...CORS } });

      const result = await processDojahVerification(admin, sub.provider_ref_id, vd, vd, 'poll');
      if (!result) return new Response(JSON.stringify({ status: sub.status, synced: false }), { headers: { ...JSON_H, ...CORS } });

      await appendAuditLog(admin, { submission_id: sub.id, user_id: user.id, action: 'status_sync',
        old_status: sub.status, new_status: result.finalAttemptStatus, metadata: { provider: 'dojah', triggered_by: 'app_poll' } });

      return new Response(JSON.stringify({ status: result.finalAttemptStatus, synced: true }), { headers: { ...JSON_H, ...CORS } });
    }

    if (['verified','failed'].includes(attempt.status)) return new Response(
      JSON.stringify({ status: attempt.status, synced: false }), { headers: { ...JSON_H, ...CORS } });

    const vd = await fetchDojahVerification(attempt.reference_id);
    if (!vd) return new Response(JSON.stringify({ status: attempt.status, synced: false }), { headers: { ...JSON_H, ...CORS } });

    try {
      const result = await processDojahVerification(admin, attempt.reference_id, vd, vd, 'poll');
      if (!result) return new Response(JSON.stringify({ status: attempt.status, synced: false }), { headers: { ...JSON_H, ...CORS } });

      await appendAuditLog(admin, { submission_id: attempt.submission_id, user_id: user.id, action: 'status_sync',
        old_status: attempt.status, new_status: result.finalAttemptStatus,
        metadata: { provider: 'dojah', triggered_by: 'app_poll', attempt_id: attempt.id } });

      return new Response(JSON.stringify({ status: result.finalAttemptStatus, synced: true }), { headers: { ...JSON_H, ...CORS } });
    } catch (e) {
      console.error('[dojah-sync] error:', e);
      return new Response(JSON.stringify({ error: 'Sync failed' }), { status: 500, headers: { ...JSON_H, ...CORS } });
    }
  }

  // ── Path B: Dojah webhook push ────────────────────────────────────────────
  const secret     = Deno.env.get('DOJAH_WEBHOOK_SECRET') ?? '';
  const sigV1      = req.headers.get('X-Dojah-Signature')    ?? '';
  const sigV2      = req.headers.get('X-Dojah-Signature-V2') ?? '';
  const receivedSig = sigV2 || sigV1;

  if (secret && receivedSig) {
    const valid = await verifyDojahSignature(secret, rawBody, receivedSig);
    if (!valid) {
      console.error('[dojah-webhook] Invalid signature — rejected');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: JSON_H });
    }
  } else if (!secret) {
    console.error('[dojah-webhook] DOJAH_WEBHOOK_SECRET not set — rejecting push');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), { status: 401, headers: JSON_H });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_H }); }

  console.log('[dojah-webhook] push event — status:', payload.status, 'ref:', payload.reference_id);

  // Return 200 immediately (Dojah expects fast ACK)
  const responsePromise = new Response(JSON.stringify({ ok: true }), { headers: JSON_H });

  try {
    const referenceId = String(payload.reference_id ?? '');
    if (!referenceId) return new Response(JSON.stringify({ error: 'Missing reference_id' }), { status: 400, headers: JSON_H });

    // Write webhook audit log entry (always, before processing)
    await admin.from('webhook_audit_log').insert({
      source: 'dojah', reference_id: referenceId,
      event_type: String(payload.status ?? payload.type ?? 'unknown'),
      status: 'received', raw_payload: payload,
    }).then(() => {});

    const verificationData = (payload.data ?? payload.verification ?? payload) as Record<string, unknown>;
    let auditStatus = 'processed';
    let auditError: string | undefined;
    let attemptId: string | undefined;
    try {
      const result = await processDojahVerification(admin, referenceId, verificationData, payload, 'webhook');
      if (result) {
        attemptId = result.attemptId;
        if (result.isDuplicate) auditStatus = 'duplicate';
        await appendAuditLog(admin, {
          submission_id: result.submissionId, user_id: result.userId, action: 'webhook_received',
          new_status: result.finalAttemptStatus,
          metadata: { provider: 'dojah', raw_status: payload.status, reference_id: referenceId, attempt_id: result.attemptId },
        });
      } else {
        auditStatus = 'failed';
        auditError  = 'processDojahVerification returned null';
      }
    } catch (innerErr) {
      auditStatus = 'failed';
      auditError  = innerErr instanceof Error ? innerErr.message : String(innerErr);
      console.error('[dojah-webhook] Processing error:', innerErr);
    }

    // Update audit log entry with final status
    await admin.from('webhook_audit_log').update({
      status: auditStatus, error: auditError ?? null, attempt_id: attemptId ?? null,
    }).eq('reference_id', referenceId).eq('status', 'received').then(() => {});

  } catch (e) {
    console.error('[dojah-webhook] Error:', e);
  }

  return responsePromise;
});
