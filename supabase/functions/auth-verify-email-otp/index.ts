// auth-verify-email-otp Edge Function
// Verifies a 6-digit code against the stored hash in email_verification_challenges.
// Returns a short-lived step-up token on success.
// Enforces: expiry, single-use, max 5 attempts per challenge.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_H = { ...CORS, 'Content-Type': 'application/json' };

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_H });

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: sessionErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
  if (sessionErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: JSON_H });
  }

  const body = await req.json() as {
    challenge_id: string;
    code: string;
    purpose: string;
    action_type?: string;
    txn_id?: string;
    amount?: number;
    asset?: string;
    destination?: string;
  };

  const { challenge_id, code, purpose } = body;
  if (!challenge_id || !code || !purpose) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: JSON_H });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Fetch challenge
  const { data: challenge, error: fetchErr } = await admin
    .from('email_verification_challenges')
    .select('*')
    .eq('id', challenge_id)
    .eq('user_id', user.id)
    .eq('purpose', purpose)
    .maybeSingle();

  if (fetchErr || !challenge) {
    return new Response(JSON.stringify({ error: 'Verification code not found. Please request a new one.' }), { status: 404, headers: JSON_H });
  }

  // Check already used
  if (challenge.used_at) {
    return new Response(JSON.stringify({ error: 'This verification code has already been used. Please request a new one.' }), { status: 400, headers: JSON_H });
  }

  // Check expiry
  if (new Date(challenge.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'Verification code expired. Please request a new one.' }), { status: 400, headers: JSON_H });
  }

  // Check max attempts (5)
  if (challenge.attempts >= 5) {
    return new Response(JSON.stringify({ error: 'Too many incorrect attempts. Please request a new verification code.' }), { status: 429, headers: JSON_H });
  }

  // Increment attempts before checking (prevents timing attacks)
  await admin.from('email_verification_challenges')
    .update({ attempts: challenge.attempts + 1 })
    .eq('id', challenge_id);

  // Verify code
  const submittedHash = await sha256hex(code.trim());
  if (submittedHash !== challenge.code_hash) {
    const remaining = 4 - challenge.attempts;
    const msg = remaining > 0
      ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      : 'Incorrect code. Please request a new verification code.';
    return new Response(JSON.stringify({ error: msg }), { status: 400, headers: JSON_H });
  }

  // Mark as used
  await admin.from('email_verification_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', challenge_id);

  // Issue a step-up token for the action
  const actionType = body.action_type ?? purpose;
  const tokenExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const tokenData: Record<string, unknown> = {
    user_id:     user.id,
    action_type: actionType,
    method:      'email_otp',
    expires_at:  tokenExpiry,
    challenge_id,
  };
  if (body.txn_id)     tokenData.txn_id      = body.txn_id;
  if (body.amount)     tokenData.amount       = body.amount;
  if (body.asset)      tokenData.asset        = body.asset;
  if (body.destination) tokenData.destination = body.destination;

  const { data: token, error: tokenErr } = await admin
    .from('step_up_tokens')
    .insert(tokenData)
    .select('id')
    .single();

  if (tokenErr || !token) {
    return new Response(JSON.stringify({ error: 'Verification succeeded but failed to create authorization token.' }), { status: 500, headers: JSON_H });
  }

  // Log security event
  await admin.from('security_logs').insert({
    user_id:    user.id,
    event_type: 'email_otp_verified',
    metadata:   { purpose, action_type: actionType, challenge_id },
  }).catch(() => {});

  return new Response(JSON.stringify({
    success:    true,
    token_id:   token.id,
    expires_at: tokenExpiry,
    message:    'Email verification successful.',
  }), { headers: JSON_H });
});
