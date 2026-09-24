// auth-change-password Edge Function
// Requires: current password verification + active session.
// Uses service role to update password after verifying current credentials.
// Never exposes service role key to client.

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_H });

  // Verify caller session via user client
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: sessionErr } = await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
  if (sessionErr || !user?.email) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: JSON_H });
  }

  const { current_password, new_password } = await req.json() as { current_password?: string; new_password?: string };

  if (!current_password || !new_password) {
    return new Response(JSON.stringify({ error: 'current_password and new_password are required' }), { status: 400, headers: JSON_H });
  }
  if (new_password.length < 8) {
    return new Response(JSON.stringify({ error: 'New password must be at least 8 characters' }), { status: 400, headers: JSON_H });
  }
  if (current_password === new_password) {
    return new Response(JSON.stringify({ error: 'New password must be different from current password' }), { status: 400, headers: JSON_H });
  }

  // Verify current password by attempting sign-in
  const verifyClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: verifyErr } = await verifyClient.auth.signInWithPassword({ email: user.email, password: current_password });
  if (verifyErr) {
    return new Response(JSON.stringify({ error: 'Current password is incorrect' }), { status: 400, headers: JSON_H });
  }

  // Update password using service role
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, { password: new_password });
  if (updateErr) {
    return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: JSON_H });
  }

  // Log the security event
  await admin.from('security_logs').insert({
    user_id:    user.id,
    event_type: 'password_changed',
    metadata:   { email: user.email },
  });

  return new Response(JSON.stringify({ success: true }), { headers: JSON_H });
});
