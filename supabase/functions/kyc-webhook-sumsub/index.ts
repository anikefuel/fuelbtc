// kyc-webhook-sumsub — receives & verifies Sumsub webhook events
// Signature: X-Payload-Digest (HMAC-SHA1 of body with SUMSUB_WEBHOOK_SECRET)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAdmin, appendAuditLog, mapProviderStatus, needsManualReview, JSON_H } from '../_shared/kyc-utils.ts';

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rawBody = await req.text();

  // ── Signature verification ──────────────────────────────────
  const secret = Deno.env.get('SUMSUB_WEBHOOK_SECRET') ?? '';
  const receivedSig = req.headers.get('X-Payload-Digest') ?? '';

  if (secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const expectedSig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (expectedSig !== receivedSig.toLowerCase()) {
      console.error('[sumsub-webhook] Invalid signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: JSON_H });
    }
  }

  const payload = JSON.parse(rawBody);
  const admin   = getAdmin();

  console.log('[sumsub-webhook] event:', payload.type, payload.externalUserId);

  try {
    // externalUserId = 'exchangex_<uuid>'
    const externalUserId: string = payload.externalUserId ?? '';
    const userId = externalUserId.replace(/^exchangex_/, '');
    const applicantId: string = payload.applicantId ?? '';
    const reviewResult = payload.reviewResult ?? {};

    // Lookup submission by provider_ref_id
    const { data: submission } = await admin
      .from('kyc_submissions')
      .select('id, status, user_id')
      .eq('provider_ref_id', applicantId)
      .maybeSingle() ?? {};

    if (!submission && !userId) {
      console.warn('[sumsub-webhook] No matching submission for', applicantId);
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_H });
    }

    const targetUserId = submission?.user_id ?? userId;

    const mappedStatus = mapProviderStatus(
      'sumsub',
      reviewResult.reviewAnswer,
      reviewResult.reviewRejectType,
      payload.type,
    );

    // Load thresholds from settings
    const { data: settings } = await admin
      .from('kyc_settings')
      .select('key, value')
      .in('key', ['manual_review_confidence_threshold', 'fraud_risk_threshold', 'face_match_threshold']);

    const getNum = (key: string, def: number) =>
      Number((settings ?? []).find(s => s.key === key)?.value ?? def);
    const confThresh  = getNum('manual_review_confidence_threshold', 75);
    const fraudThresh = getNum('fraud_risk_threshold', 60);
    const faceThresh  = getNum('face_match_threshold', 80);

    // Extract check results from Sumsub payload
    const checks    = payload.reviewResult?.reviewRejectDetails ?? {};
    const docCheck  = payload.reviewResult?.reviewAnswer === 'GREEN' ? 'passed' : 'failed';
    const faceScore = payload.applicantReview?.checkResults?.faceMatchScore ?? null;
    const faceResult = faceScore != null
      ? (faceScore >= faceThresh / 100 ? 'passed' : faceScore >= 0.6 ? 'inconclusive' : 'failed')
      : null;

    const amlCheck = payload.applicantReview?.checkResults?.amlCheck ?? null;
    const pepCheck = payload.applicantReview?.checkResults?.pepCheck ?? null;
    const sanctionsCheck = payload.applicantReview?.checkResults?.sanctionsCheck ?? null;
    const fraudScore = (payload.applicantReview?.riskScore ?? 0) * 100;

    const manualReasons = needsManualReview({
      confidence_score:  null,   // Sumsub uses reviewAnswer
      fraud_risk_score:  fraudScore,
      result_face_match: faceResult,
      result_liveness:   null,
      result_aml:        amlCheck === 'GREEN' ? 'passed' : amlCheck === 'RED' ? 'hit' : null,
      result_sanctions:  sanctionsCheck === 'GREEN' ? 'passed' : sanctionsCheck === 'RED' ? 'hit' : null,
      result_pep:        pepCheck === 'GREEN' ? 'passed' : pepCheck === 'RED' ? 'hit' : null,
      confidence_threshold: confThresh,
      fraud_threshold: fraudThresh,
      face_threshold: faceThresh,
    });

    const finalStatus = (manualReasons.length > 0 && mappedStatus !== 'rejected' && mappedStatus !== 'approved')
      ? 'needs_manual_review'
      : mappedStatus;

    // Update submission
    const updates: Record<string, unknown> = {
      status: finalStatus,
      result_doc_verify: docCheck,
      result_face_match: faceResult,
      result_aml:   amlCheck === 'GREEN' ? 'passed' : amlCheck === 'RED' ? 'hit' : 'not_run',
      result_pep:   pepCheck === 'GREEN' ? 'passed' : pepCheck === 'RED' ? 'hit' : 'not_run',
      result_sanctions: sanctionsCheck === 'GREEN' ? 'passed' : sanctionsCheck === 'RED' ? 'hit' : 'not_run',
      result_fraud: fraudScore > fraudThresh ? 'risk_detected' : 'passed',
      fraud_risk_score: fraudScore,
      manual_review_reasons: manualReasons,
      raw_provider_payload: payload,
    };

    if (submission) {
      await admin.from('kyc_submissions').update(updates).eq('id', submission.id);
    }

    // Auto approve: upgrade tier and update profile
    if (finalStatus === 'approved') {
      await admin.from('profiles').update({ kyc_tier: 'tier2', kyc_status: 'approved' }).eq('id', targetUserId);
      // Set expiry (12 months default)
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 12);
      if (submission) {
        await admin.from('kyc_submissions').update({ expires_at: expiresAt.toISOString() }).eq('id', submission.id);
      }
    } else if (finalStatus === 'rejected') {
      await admin.from('profiles').update({ kyc_status: 'rejected' }).eq('id', targetUserId);
    } else if (finalStatus === 'needs_manual_review') {
      await admin.from('profiles').update({ kyc_status: 'needs_manual_review' }).eq('id', targetUserId);
    }

    await appendAuditLog(admin, {
      submission_id: submission?.id,
      user_id: targetUserId,
      action: 'webhook_received',
      old_status: submission?.status,
      new_status: finalStatus,
      metadata: { provider: 'sumsub', type: payload.type, review_answer: reviewResult.reviewAnswer },
    });

    return new Response(JSON.stringify({ ok: true }), { headers: JSON_H });
  } catch (e) {
    console.error('[sumsub-webhook] Error:', e);
    return new Response(JSON.stringify({ error: 'Processing failed' }), { status: 500, headers: JSON_H });
  }
});
