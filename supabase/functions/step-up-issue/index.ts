// step-up-issue Edge Function
// Issues a short-lived step-up authorization token after successful TOTP or passkey verification.
// The token is bound to: user + action_type + optional txn_id + amount + asset + destination.
// Single-use, 5-minute TTL.
// Never authorizes a different action than what was verified.

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

const ALLOWED_ACTIONS = [
  'withdrawal', 'escrow_release', 'password_change', 'totp_disable',
  'passkey_remove', 'api_key_generate', 'address_change', 'email_change', 'phone_change',
];

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
    action_type:   string;
    verification:
      | { method: 'totp'; code: string }
      | { method: 'backup_code'; code: string }
      | { method: 'passkey'; credential_id: string };
    txn_id?:  string;
    amount?:  number;
    asset?:   string;
    destination?: string;
    network?: string;
  };

  const { action_type, verification, txn_id, amount, asset, destination, network } = body;

  if (!ALLOWED_ACTIONS.includes(action_type)) {
    return new Response(JSON.stringify({ error: 'Invalid action_type' }), { status: 400, headers: JSON_H });
  }
  if (!verification?.method || !verification?.code) {
    return new Response(JSON.stringify({ error: 'verification.method and verification.code are required' }), { status: 400, headers: JSON_H });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let verified_by = '';

  if (verification.method === 'totp') {
    // Verify TOTP code via Supabase MFA.
    // CRITICAL: must set the user's session on the client so mfa.listFactors() returns their factors
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await userClient.auth.setSession({ access_token: token, refresh_token: '' });
    // Get factors for user
    const { data: factors } = await userClient.auth.mfa.listFactors();
    if (!factors?.totp?.length) {
      return new Response(JSON.stringify({ error: 'TOTP is not enrolled for this account' }), { status: 400, headers: JSON_H });
    }
    const factorId = factors.totp[0].id;
    const { data: challengeData, error: challengeErr } = await userClient.auth.mfa.challenge({ factorId });
    if (challengeErr || !challengeData) {
      return new Response(JSON.stringify({ error: 'Failed to create MFA challenge' }), { status: 500, headers: JSON_H });
    }
    const { error: verifyErr } = await userClient.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code: verification.code,
    });
    if (verifyErr) {
      await admin.from('security_logs').insert({
        user_id:    user.id,
        event_type: 'step_up_failed',
        metadata:   { method: 'totp', action_type },
      });
      return new Response(JSON.stringify({ error: 'Invalid TOTP code' }), { status: 400, headers: JSON_H });
    }
    verified_by = 'totp';
  } else if (verification.method === 'backup_code') {
    // Hash the provided code and look for match
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(verification.code.toUpperCase().replace(/-/g, '')));
    const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: codeRow } = await admin
      .from('backup_codes')
      .select('id, used_at')
      .eq('user_id', user.id)
      .eq('code_hash', hashHex)
      .maybeSingle();

    if (!codeRow) {
      return new Response(JSON.stringify({ error: 'Invalid backup code' }), { status: 400, headers: JSON_H });
    }
    if (codeRow.used_at) {
      return new Response(JSON.stringify({ error: 'This backup code has already been used' }), { status: 400, headers: JSON_H });
    }
    // Mark as used
    await admin.from('backup_codes').update({ used_at: new Date().toISOString() }).eq('id', codeRow.id);
    verified_by = 'backup_code';

    await admin.from('security_logs').insert({
      user_id:    user.id,
      event_type: 'backup_code_used',
      metadata:   { action_type },
    });
  } else if (verification.method === 'passkey') {
    // Verify passkey: check that the credential_id exists and belongs to the user
    const credId = (verification as { method: 'passkey'; credential_id: string }).credential_id;
    if (!credId) {
      return new Response(JSON.stringify({ error: 'credential_id is required for passkey verification' }), { status: 400, headers: JSON_H });
    }
    const { data: passkeyRow } = await admin
      .from('passkeys')
      .select('id, device_label, platform_type')
      .eq('user_id', user.id)
      .eq('credential_id', credId)
      .maybeSingle();

    if (!passkeyRow) {
      return new Response(JSON.stringify({ error: 'Passkey not found or not registered to this account.' }), { status: 400, headers: JSON_H });
    }
    await admin.from('passkeys').update({ last_used_at: new Date().toISOString() }).eq('id', passkeyRow.id);
    verified_by = 'passkey';

    await admin.from('security_logs').insert({
      user_id:    user.id,
      event_type: 'passkey_verified',
      metadata:   { action_type, device_label: passkeyRow.device_label },
    });
  } else {
    return new Response(JSON.stringify({ error: 'Unsupported verification method' }), { status: 400, headers: JSON_H });
  }
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: tokenRow, error: tokenErr } = await admin
    .from('step_up_tokens')
    .insert({
      user_id:     user.id,
      action_type,
      txn_id:      txn_id ?? null,
      amount:      amount ?? null,
      asset:       asset ?? null,
      destination: destination ?? null,
      verified_by,
      expires_at:  expiresAt,
    })
    .select('id')
    .single();

  if (tokenErr || !tokenRow) {
    return new Response(JSON.stringify({ error: 'Failed to issue step-up token' }), { status: 500, headers: JSON_H });
  }

  await admin.from('security_logs').insert({
    user_id:    user.id,
    event_type: 'step_up_completed',
    metadata:   { method: verified_by, action_type, txn_id: txn_id ?? null },
  });

  return new Response(JSON.stringify({
    token_id:    tokenRow.id,
    action_type,
    expires_at:  expiresAt,
    verified_by,
  }), { headers: JSON_H });
});
