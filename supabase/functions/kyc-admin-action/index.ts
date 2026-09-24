// kyc-admin-action — atomic admin KYC decision
// POST { action, attempt_id, reason?, notes?, tier?, force_override? }
//
// Authoritative source: kyc_attempts.status
// ALL status changes go to kyc_attempts first, then profile summary.
// Manual decisions set manual_override=true so provider sync cannot revert them.
//
// NOTE: All shared utilities are inlined — Supabase deploys each function in isolation.
//       Do NOT import from ../_shared/ at the top level; those modules are unavailable at runtime.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ── Inlined shared utilities ───────────────────────────────────────────────────
const JSON_H = { 'Content-Type': 'application/json' };

function getAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function appendAuditLog(
  admin: ReturnType<typeof getAdmin>,
  params: {
    submission_id?: string;
    user_id: string;
    actor_id?: string;
    action: string;
    old_status?: string;
    new_status?: string;
    reason?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await admin.from('kyc_audit_log').insert(params).then(() => {});
}
// ── End inlined utilities ──────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AdminAction = 'approve' | 'reject' | 'escalate' | 'request_info' | 'add_note';

// Terminal statuses that require force_override to change
const TERMINAL_STATUSES = ['verified', 'rejected'];

// Map action → attempt status
// NOTE: 'rejected' is now in the kyc_attempts_status_check constraint (migration added it)
function actionToAttemptStatus(action: AdminAction): string | null {
  switch (action) {
    case 'approve':      return 'verified';
    case 'reject':       return 'rejected';
    case 'escalate':     return 'manual_review';
    case 'request_info': return 'resubmission_required';
    case 'add_note':     return null; // no status change
  }
}

// Map attempt status → profile kyc_status summary
function attemptStatusToProfileStatus(attemptStatus: string): string {
  switch (attemptStatus) {
    case 'verified':               return 'verified';
    case 'rejected':               return 'rejected';
    case 'manual_review':          return 'under_review';
    case 'resubmission_required':  return 'resubmission_required';
    default:                       return attemptStatus;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const admin = getAdmin();

    // ── 1. Authenticate admin server-side ──────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });
    }
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });
    }

    // ── 2. Verify admin role ───────────────────────────────────────────────
    const { data: adminProfile } = await admin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (adminProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: { ...JSON_H, ...CORS } });
    }

    // ── 3. Parse & validate input ──────────────────────────────────────────
    const body: {
      action: AdminAction;
      attempt_id: string;
      reason?: string;
      notes?: string;
      tier?: string;
      force_override?: boolean;
    } = await req.json();

    const { action, attempt_id, reason, notes, tier, force_override = false } = body;

    if (!action || !attempt_id) {
      return new Response(JSON.stringify({ error: 'action and attempt_id are required' }), { status: 400, headers: { ...JSON_H, ...CORS } });
    }
    if (action === 'reject' && !reason) {
      return new Response(JSON.stringify({ error: 'reason is required for reject' }), { status: 400, headers: { ...JSON_H, ...CORS } });
    }

    // ── 4. Fetch attempt (authoritative record) ────────────────────────────
    const { data: attempt, error: attemptErr } = await admin
      .from('kyc_attempts')
      .select('id, user_id, submission_id, status, provider, country_code, manual_override, decision_source')
      .eq('id', attempt_id)
      .maybeSingle();

    if (attemptErr) {
      throw new Error(`Attempt lookup failed: ${attemptErr.message}`);
    }
    if (!attempt) {
      return new Response(JSON.stringify({ error: 'KYC attempt not found' }), { status: 404, headers: { ...JSON_H, ...CORS } });
    }

    // ── 5. Guard: prevent overwriting terminal manual decisions ────────────
    if (TERMINAL_STATUSES.includes(attempt.status) && attempt.manual_override && !force_override) {
      return new Response(JSON.stringify({
        error: `Attempt is already ${attempt.status} (manual decision). Use force_override=true to reopen.`,
        current_status: attempt.status,
      }), { status: 409, headers: { ...JSON_H, ...CORS } });
    }

    const oldStatus    = attempt.status;
    const newStatus    = actionToAttemptStatus(action);
    const now          = new Date().toISOString();
    const isDecision   = newStatus !== null;
    const isTerminal   = newStatus !== null && TERMINAL_STATUSES.includes(newStatus);

    // ── 6. Build atomic attempt update ────────────────────────────────────
    const attemptUpdate: Record<string, unknown> = {
      updated_at:      now,
      review_reason:   reason   ?? null,
      review_notes:    notes    ?? null,
      reviewed_by:     isDecision ? user.id : null,
      reviewed_at:     isDecision ? now     : null,
      decision_source: isDecision ? 'manual' : (attempt.decision_source ?? 'provider'),
      manual_override: isDecision ? true     : (attempt.manual_override ?? false),
    };
    if (newStatus) {
      attemptUpdate.status = newStatus;
    }
    if (isTerminal) {
      attemptUpdate.final_decision_at = now;
      attemptUpdate.final_decision_by = user.id;
      attemptUpdate.completed_at      = now;
    }

    // ── 7. Update kyc_attempts and verify the returned row ─────────────────
    const { data: updatedAttempt, error: updateErr } = await admin
      .from('kyc_attempts')
      .update(attemptUpdate)
      .eq('id', attempt_id)
      .select('id, status, user_id, provider, country_code, manual_override, reviewed_by, reviewed_at')
      .single();

    if (updateErr) throw new Error(`Attempt update failed: ${updateErr.code ?? ''} ${updateErr.message}`);
    if (!updatedAttempt) throw new Error(`KYC attempt was not updated — zero rows returned (attempt_id=${attempt_id})`);
    if (newStatus && updatedAttempt.status !== newStatus) {
      throw new Error(`Status mismatch after update: expected ${newStatus}, got ${updatedAttempt.status}`);
    }

    // ── 8. Update profile summary (same decision) ──────────────────────────
    if (newStatus) {
      const profileStatus = attemptStatusToProfileStatus(newStatus);
      const profileUpdate: Record<string, unknown> = {
        kyc_status:   profileStatus,
        updated_at:   now,
      };
      if (newStatus === 'verified') {
        const verifiedTier = tier ?? 'tier2';
        profileUpdate.kyc_tier        = verifiedTier;
        profileUpdate.kyc_verified_at = now;
        profileUpdate.kyc_provider    = attempt.provider  ?? null;
        profileUpdate.kyc_country     = attempt.country_code ?? null;
        profileUpdate.kyc_status      = 'verified';
        // Clear null on reject (was previously rejected)
      } else if (newStatus === 'rejected') {
        profileUpdate.kyc_verified_at = null;
      }

      const { error: profileErr } = await admin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', attempt.user_id);

      if (profileErr) {
        // Roll back attempt status to preserve consistency
        await admin.from('kyc_attempts').update({
          status: oldStatus, decision_source: 'provider', manual_override: false,
          reviewed_by: null, reviewed_at: null, final_decision_at: null,
          final_decision_by: null, updated_at: now,
        }).eq('id', attempt_id);
        throw new Error(`Profile update failed: ${profileErr.code ?? ''} ${profileErr.message}`);
      }
    }

    // ── 9. On reject: mark kyc_submissions as 'rejected' so user sees clear rejection ──
    // The user dashboard reads kyc_submissions.status directly — must be 'rejected' not 'not_started'
    // After acknowledging the rejection the user can start fresh (initiateKyc creates a new submission)
    if (newStatus === 'rejected' && attempt.submission_id) {
      const { error: subErr } = await admin
        .from('kyc_submissions')
        .update({ status: 'rejected' })
        .eq('id', attempt.submission_id);
      if (subErr) {
        console.warn(`[kyc-admin-action] submission status update failed (non-fatal): ${subErr.code} ${subErr.message}`);
      } else {
        console.log(`[kyc-admin-action] submission ${attempt.submission_id} → rejected`);
      }
    }

    // ── 9. Insert review record (non-fatal — never block the action) ───────
    const { error: reviewErr } = await admin.from('kyc_reviews').insert({
      attempt_id:    attempt_id,
      admin_user_id: user.id,
      action,
      old_status:    oldStatus,
      new_status:    newStatus ?? oldStatus,
      reason:        reason ?? null,
      notes:         notes  ?? null,
      created_at:    now,
    });
    if (reviewErr) {
      // Log but do NOT throw — decision is already committed to DB
      console.warn(`[kyc-admin-action] review insert failed (non-fatal): ${reviewErr.code} ${reviewErr.message}`);
    }

    // ── 10. Audit log ──────────────────────────────────────────────────────
    await appendAuditLog(admin, {
      submission_id: attempt.submission_id ?? undefined,
      user_id:       attempt.user_id,
      actor_id:      user.id,
      action,
      old_status:    oldStatus,
      new_status:    newStatus ?? oldStatus,
      reason,
      notes,
      metadata: {
        attempt_id, tier, action,
        decision_source: 'manual',
        manual_override: true,
        force_override,
      },
    });

    // ── 11. User notification ──────────────────────────────────────────────
    if (newStatus && newStatus !== oldStatus) {
      const notifMessages: Record<string, string> = {
        verified:              'Your identity verification has been approved.',
        rejected:              `Your identity verification was not approved. ${reason ? `Reason: ${reason}` : ''}`,
        manual_review:         'Your verification has been escalated for additional review.',
        resubmission_required: `Additional information is required. ${reason ? reason : 'Please restart verification.'}`,
      };
      const msg = notifMessages[newStatus];
      if (msg) {
        await admin.from('notifications').insert({
          user_id:    attempt.user_id,
          type:       `kyc_${action}`,
          title:      newStatus === 'verified' ? 'Identity Verified ✓' : 'KYC Update',
          message:    msg,
          is_read:    false,
          created_at: now,
        }).then(() => {});
      }
    }

    console.log(`[kyc-admin-action] ${action} attempt=${attempt_id} ${oldStatus}→${newStatus ?? oldStatus} by admin=${user.id}`);

    return new Response(JSON.stringify({
      ok:          true,
      attempt_id,
      old_status:  oldStatus,
      new_status:  updatedAttempt.status,
      action,
      manual_override: true,
    }), { headers: { ...JSON_H, ...CORS } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[kyc-admin-action]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...JSON_H, ...CORS } });
  }
});
