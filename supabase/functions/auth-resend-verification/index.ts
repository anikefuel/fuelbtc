// auth-resend-verification Edge Function
// Resends verification email with a 60-second cooldown per user.
// Requires authenticated session.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SITE_URL     = Deno.env.get('SITE_URL') ?? 'https://exchangex.app';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_H = { ...CORS, 'Content-Type': 'application/json' };
const COOLDOWN_SECONDS = 60;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_H });

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: sessionErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
  if (sessionErr || !user?.email) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: JSON_H });
  }

  if (user.email_confirmed_at) {
    return new Response(JSON.stringify({ error: 'Email is already verified' }), { status: 400, headers: JSON_H });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Enforce cooldown via profiles.verification_sent_at
  const { data: profile } = await admin.from('profiles').select('verification_sent_at').eq('id', user.id).maybeSingle();
  if (profile?.verification_sent_at) {
    const lastSentAt = new Date(profile.verification_sent_at).getTime();
    const elapsed = (Date.now() - lastSentAt) / 1000;
    if (elapsed < COOLDOWN_SECONDS) {
      const remaining = Math.ceil(COOLDOWN_SECONDS - elapsed);
      return new Response(JSON.stringify({ error: `Please wait ${remaining} seconds before requesting another verification email` }), { status: 429, headers: JSON_H });
    }
  }

  // Resend via admin API
  const { error: resendErr } = await admin.auth.admin.generateLink({
    type: 'signup',
    email: user.email,
    options: { redirectTo: `${SITE_URL}/auth/callback` },
  });

  if (resendErr) {
    return new Response(JSON.stringify({ error: resendErr.message }), { status: 500, headers: JSON_H });
  }

  // Update cooldown timestamp
  await admin.from('profiles').update({ verification_sent_at: new Date().toISOString() }).eq('id', user.id);

  return new Response(JSON.stringify({ success: true, message: 'Verification email sent' }), { headers: JSON_H });
});
