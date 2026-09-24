// sync-prembly-kyc-status — server-side result fetch from Prembly API
//
// Called after SDK completion or admin retry request.
// POST { attempt_id } + Authorization: Bearer <user_jwt>
//
// Security:
//  - PREMBLY_SECRET_KEY used for API auth — never returned to client
//  - Manual override protection — skips if manual_override=true
//  - Idempotent — safe to call multiple times
//  - Only marks verified after full result validation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ── Inlined shared utils (platform bundles each function in isolation) ─────────
const JSON_H = { 'Content-Type': 'application/json' };
const PREMBLY_BASE_URL = Deno.env.get('PREMBLY_BASE_URL') ?? 'https://api.prembly.com';

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

function mapPremblyResponseCode(code: string): { status: string; adminAlert?: string } {
  switch (code) {
    case '01': return { status: 'resubmission_required' };
    case '02': return { status: 'provider_unavailable',  adminAlert: 'Prembly unavailable (code 02)' };
    case '03': return { status: 'provider_unavailable',  adminAlert: 'Prembly insufficient balance (code 03)' };
    case '07': return { status: 'manual_review',         adminAlert: 'Prembly blocked result (code 07) — compliance review required' };
    default:   return { status: 'in_progress' };
  }
}

function needsManualReview(p: { confidence_score?: number | null; fraud_risk_score?: number | null; result_face_match?: string | null; result_liveness?: string | null; result_aml?: string | null; result_sanctions?: string | null; result_pep?: string | null; confidence_threshold: number; fraud_threshold: number; face_threshold: number }): string[] {
  const r: string[] = [];
  if (p.confidence_score != null && p.confidence_score < p.confidence_threshold) r.push(`Confidence ${p.confidence_score} below threshold`);
  if (p.fraud_risk_score != null && p.fraud_risk_score > p.fraud_threshold)      r.push(`Fraud risk ${p.fraud_risk_score} exceeds threshold`);
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
  } catch (e) { console.warn('[prembly-sync] recordProviderHealth failed:', e instanceof Error ? e.message : e); }
}

async function storeProviderEvent(admin: ReturnType<typeof getAdmin>, params: { attempt_id?: string; submission_id?: string; provider: string; event_type: string; reference_id?: string; raw_payload: unknown }) {
  try {
    await admin.from('kyc_provider_events').insert({ ...params, processed: false });
  } catch (e) { console.warn('[prembly-sync] storeProviderEvent failed:', e instanceof Error ? e.message : e); }
}

async function appendAuditLog(admin: ReturnType<typeof getAdmin>, params: { submission_id?: string; user_id: string; actor_id?: string; action: string; old_status?: string; new_status?: string; metadata?: Record<string, unknown> }) {
  await admin.from('kyc_audit_log').insert(params).then(() => {});
}
// ── End inlined utils ──────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Fetch Prembly verification result by reference */
async function fetchPremblyResult(reference: string): Promise<Record<string, unknown> | null> {
  const secretKey = Deno.env.get('PREMBLY_SECRET_KEY') ?? '';
  const publicKey = Deno.env.get('PREMBLY_PUBLIC_KEY') ?? '';

  if (!secretKey || !publicKey) {
    console.warn('[prembly-sync] Prembly credentials not configured');
    return null;
  }

  // Try verification status endpoint
  const url = `${PREMBLY_BASE_URL}/identitypass/verification/status/${encodeURIComponent(reference)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'app-id':       publicKey,
        'x-api-key':    secretKey,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 404) {
      console.warn('[prembly-sync] No result found for ref=', reference);
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      await recordProviderHealth(getAdmin(), 'prembly', false, `HTTP ${res.status} — check Prembly credentials`);
      return null;
    }
    if (res.status >= 500) {
      await recordProviderHealth(getAdmin(), 'prembly', false, `Prembly HTTP ${res.status}`);
      return null;
    }
    if (!res.ok) {
      console.warn('[prembly-sync] Unexpected status', res.status);
      return null;
    }

    await recordProviderHealth(getAdmin(), 'prembly', true);
    const json = await res.json();
    return (json?.data ?? json?.verification ?? json) as Record<string, unknown>;
  } catch (e) {
    await recordProviderHealth(getAdmin(), 'prembly', false, e instanceof Error ? e.message : 'fetch error');
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const admin = getAdmin();

    // ── 1. Authenticate caller ─────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });
    }
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });
    }

    // ── 2. Parse input ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const attemptId = String(body.attempt_id ?? '');

    if (!attemptId) {
      return new Response(JSON.stringify({ error: 'attempt_id is required' }), { status: 400, headers: { ...JSON_H, ...CORS } });
    }

    // ── 3. Load attempt ────────────────────────────────────────────────────
    const { data: attempt, error: attErr } = await admin
      .from('kyc_attempts')
      .select('id, user_id, provider, reference_id, external_reference, provider_reference, status, manual_override, decision_source, submission_id, country_code')
      .eq('id', attemptId)
      .maybeSingle();

    if (attErr || !attempt) {
      return new Response(JSON.stringify({ error: 'Attempt not found' }), { status: 404, headers: { ...JSON_H, ...CORS } });
    }

    // Ownership check — user can only sync their own attempts (admin can sync any via kyc-admin-action)
    if (attempt.user_id !== user.id) {
      const { data: adminProfile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (adminProfile?.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...JSON_H, ...CORS } });
      }
    }

    if (attempt.provider !== 'prembly') {
      return new Response(JSON.stringify({ error: 'Attempt is not a Prembly attempt' }), { status: 400, headers: { ...JSON_H, ...CORS } });
    }

    // ── 4. Manual override protection ─────────────────────────────────────
    if (attempt.manual_override === true || attempt.decision_source === 'manual') {
      return new Response(JSON.stringify({
        status: attempt.status,
        skipped: 'manual_override_protected',
      }), { headers: { ...JSON_H, ...CORS } });
    }

    // ── 5. Fetch Prembly result ────────────────────────────────────────────
    const providerRef = attempt.provider_reference ?? attempt.external_reference ?? attempt.reference_id;
    const result = await fetchPremblyResult(providerRef);

    if (!result) {
      // Provider unavailable — update status but don't fail the user
      await admin.from('kyc_attempts').update({
        status:     'provider_unavailable',
        updated_at: new Date().toISOString(),
      }).eq('id', attempt.id);

      return new Response(JSON.stringify({ status: 'provider_unavailable' }), { headers: { ...JSON_H, ...CORS } });
    }

    // ── 6. Map status ──────────────────────────────────────────────────────
    const rawStatus    = String(result.status ?? result.verification_status ?? '');
    const responseCode = String(result.response_code ?? '');
    let internalStatus = mapPremblyStatus(rawStatus);

    if (responseCode && internalStatus !== 'verified') {
      const mapped = mapPremblyResponseCode(responseCode);
      internalStatus = mapped.status;
    }

    // Risk-based manual review escalation
    const manualReasons = needsManualReview({
      confidence_score:  result.confidence_score as number | null,
      fraud_risk_score:  result.fraud_risk_score as number | null,
      result_face_match: String(result.face_match_status ?? '').toLowerCase() || null,
      result_liveness:   String(result.liveness_status ?? '').toLowerCase() || null,
      result_aml:        String(result.aml_status ?? '').toLowerCase() || null,
      result_sanctions:  String(result.sanctions_status ?? '').toLowerCase() || null,
      result_pep:        String(result.pep_status ?? '').toLowerCase() || null,
      confidence_threshold: 60,
      fraud_threshold:      70,
      face_threshold:        0,
    });
    if (manualReasons.length > 0 && internalStatus === 'verified') {
      internalStatus = 'manual_review';
    }

    const now = new Date().toISOString();

    // ── 7. Store event ─────────────────────────────────────────────────────
    await storeProviderEvent(admin, {
      attempt_id:    attempt.id,
      submission_id: attempt.submission_id ?? undefined,
      provider:      'prembly',
      event_type:    'poll',
      reference_id:  providerRef,
      raw_payload:   result,
    });

    // ── 8. Update attempt ──────────────────────────────────────────────────
    const attemptUpdate: Record<string, unknown> = {
      status:              internalStatus,
      raw_provider_status: rawStatus,
      last_webhook_at:     now,
      updated_at:          now,
      decision_source:     'provider',
    };
    if (internalStatus === 'verified') {
      attemptUpdate.completed_at   = now;
      attemptUpdate.submitted_at   = attemptUpdate.submitted_at ?? now;
    }
    if (internalStatus === 'failed') {
      attemptUpdate.failure_reason = `Prembly: ${rawStatus}`;
    }
    if (manualReasons.length > 0) {
      attemptUpdate.manual_review_reasons = manualReasons;
    }
    if (result.full_name)     attemptUpdate.full_name    = String(result.full_name);
    if (result.date_of_birth) attemptUpdate.date_of_birth = String(result.date_of_birth);
    if (result.confidence_score != null) attemptUpdate.confidence_score = result.confidence_score;

    await admin.from('kyc_attempts').update(attemptUpdate).eq('id', attempt.id);

    // ── 9. Update profile (terminal statuses) ─────────────────────────────
    if (['verified', 'failed', 'rejected', 'manual_review'].includes(internalStatus)) {
      const profileUpdate: Record<string, unknown> = {
        kyc_status:   internalStatus,
        kyc_provider: 'prembly',
        updated_at:   now,
      };
      if (internalStatus === 'verified') {
        profileUpdate.kyc_verified_at = now;
        profileUpdate.kyc_country     = attempt.country_code ?? '';
      }
      await admin.from('profiles').update(profileUpdate).eq('id', attempt.user_id);
    }

    // ── 10. Audit log ──────────────────────────────────────────────────────
    await appendAuditLog(admin, {
      submission_id: attempt.submission_id ?? undefined,
      user_id:       attempt.user_id,
      actor_id:      user.id,
      action:        'prembly_sync',
      old_status:    attempt.status,
      new_status:    internalStatus,
      metadata:      { provider: 'prembly', raw_status: rawStatus, response_code: responseCode },
    });

    console.log(`[prembly-sync] attempt=${attempt.id} ${attempt.status}→${internalStatus}`);
    return new Response(JSON.stringify({ status: internalStatus, old_status: attempt.status }), { headers: { ...JSON_H, ...CORS } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[prembly-sync]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...JSON_H, ...CORS } });
  }
});
