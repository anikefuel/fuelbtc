// auth-update-profile Edge Function
// Updates non-sensitive profile fields (full_name, username, phone, country, preferred_currency).
// Email changes are handled separately (requires step-up).
// Never allows role/kyc_tier/is_frozen changes from client.

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

const ALLOWED_FIELDS = new Set([
  'full_name', 'username', 'phone', 'phone_country_code', 'country',
  'nationality', 'state_province', 'city', 'street_address', 'apt_suite',
  'postal_code', 'date_of_birth', 'preferred_currency', 'avatar_url', 'anti_phishing_code',
]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_H });

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: sessionErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
  if (sessionErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: JSON_H });
  }

  const updates = await req.json() as Record<string, unknown>;

  // Strip any fields not in the allowlist
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED_FIELDS.has(k)) safe[k] = v === '' ? null : v;
  }

  if (Object.keys(safe).length === 0) {
    return new Response(JSON.stringify({ error: 'No valid fields to update' }), { status: 400, headers: JSON_H });
  }

  // Username uniqueness check
  if (safe.username) {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('username', safe.username)
      .neq('id', user.id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ error: 'Username is already taken' }), { status: 409, headers: JSON_H });
    }
  }

  safe.updated_at = new Date().toISOString();

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error: updateErr } = await admin.from('profiles').update(safe).eq('id', user.id);
  if (updateErr) {
    return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: JSON_H });
  }

  return new Response(JSON.stringify({ success: true, updated: Object.keys(safe) }), { headers: JSON_H });
});
