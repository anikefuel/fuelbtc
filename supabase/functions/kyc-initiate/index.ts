// kyc-initiate — creates a KYC attempt and returns provider configuration
// POST { country_code, doc_type?, force_provider? }
// Returns:
//   For Prembly: { attempt_id, submission_id, provider, reference_id, config_id, widget_key, public_key, environment, user_data }
//   For Dojah:   { attempt_id, submission_id, provider, reference_id, hosted_url, widget_id, user_data }
//
// Security:
//  - PREMBLY_SECRET_KEY and DOJAH_PRIVATE_KEY NEVER returned to client
//  - PREMBLY_PUBLIC_KEY is client-safe and returned for widget initialization
//  - reference_id format: EXX-KYC-{UUID}
//  - Frontend callbacks never directly mark user verified

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ── Inlined shared utils (platform bundles each function in isolation) ─────────
const JSON_H = { 'Content-Type': 'application/json' };

const DOJAH_WIDGET_ID   = '6a5b12349ff90fe054784334';
const DOJAH_BASE_URL    = 'https://identity.dojah.io';
const DOJAH_HOSTED_URL  = `${DOJAH_BASE_URL}?widget_id=${DOJAH_WIDGET_ID}`;
const PREMBLY_CONFIG_ID  = Deno.env.get('PREMBLY_CONFIG_ID')  ?? '98e264b6-62de-47bc-9896-fdf299d9c612';
const PREMBLY_WIDGET_KEY = Deno.env.get('PREMBLY_WIDGET_KEY') ?? 'wdgt_86138e502e7f4430be3da2aaac507193';

function getAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function generateKycReferenceId(): string {
  return `EXX-KYC-${crypto.randomUUID()}`;
}

function buildDojahHostedUrl(referenceId: string, userData?: { first_name?: string; last_name?: string }): string {
  const base = `${DOJAH_BASE_URL}?widget_id=${DOJAH_WIDGET_ID}&reference_id=${encodeURIComponent(referenceId)}`;
  const params: string[] = [];
  if (userData?.first_name) params.push(`first_name=${encodeURIComponent(userData.first_name)}`);
  if (userData?.last_name)  params.push(`last_name=${encodeURIComponent(userData.last_name)}`);
  return params.length > 0 ? `${base}&${params.join('&')}` : base;
}

interface KycProviderConfig {
  provider_name: string; display_name: string; enabled: boolean; priority: number;
  supported_countries: string[]; auto_fallback: boolean; health_status: string;
  failure_count: number; config: Record<string, unknown>;
}

async function resolveProviderFromDb(admin: ReturnType<typeof getAdmin>, countryCode: string): Promise<KycProviderConfig> {
  const { data: providers } = await admin.from('kyc_providers').select('*').eq('enabled', true).order('priority', { ascending: true });
  const available = (providers ?? []) as KycProviderConfig[];
  for (const p of available) {
    const countries = p.supported_countries ?? [];
    if (countries.length === 0 || countries.includes(countryCode.toUpperCase())) return p;
  }
  return { provider_name: 'prembly', display_name: 'Prembly IdentityPass', enabled: true, priority: 1, supported_countries: [], auto_fallback: true, health_status: 'unknown', failure_count: 0, config: { config_id: PREMBLY_CONFIG_ID, widget_key: PREMBLY_WIDGET_KEY } };
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
  } catch (e) { console.warn('[kyc-initiate] recordProviderHealth failed:', e instanceof Error ? e.message : e); }
}

async function storeProviderEvent(admin: ReturnType<typeof getAdmin>, params: { attempt_id?: string; submission_id?: string; provider: string; event_type: string; reference_id?: string; raw_payload: unknown }) {
  try { await admin.from('kyc_provider_events').insert({ ...params, processed: false }); }
  catch (e) { console.warn('[kyc-initiate] storeProviderEvent failed:', e instanceof Error ? e.message : e); }
}

async function appendAuditLog(admin: ReturnType<typeof getAdmin>, params: { submission_id?: string; user_id: string; actor_id?: string; action: string; old_status?: string; new_status?: string; metadata?: Record<string, unknown> }) {
  await admin.from('kyc_audit_log').insert(params).then(() => {});
}
// ── End inlined utils ──────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const admin = getAdmin();
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });

    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });

    if (!UUID_RE.test(user.id)) {
      console.error('[kyc-initiate] Non-UUID user.id detected:', user.id);
      return new Response(JSON.stringify({ error: 'Session invalid — please sign out and sign in again.' }),
        { status: 401, headers: { ...JSON_H, ...CORS } });
    }

    const rawBody = await req.text();
    let parsedBody: Record<string, unknown> = {};
    try { parsedBody = JSON.parse(rawBody); } catch { /* empty body OK */ }
    const { country_code, doc_type = 'passport', force_provider } =
      parsedBody as { country_code?: string; doc_type?: string; force_provider?: string };

    if (!country_code) return new Response(JSON.stringify({ error: 'country_code is required' }),
      { status: 400, headers: { ...JSON_H, ...CORS } });

    // Prevent duplicate active attempts
    const { data: activeAttempt } = await admin
      .from('kyc_attempts')
      .select('id, status, reference_id, provider')
      .eq('user_id', user.id)
      .in('status', ['not_started', 'in_progress', 'submitted', 'pending_review'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Resolve provider — Prembly is priority-1 for ALL countries, Dojah is fallback
    const providerConfig = force_provider
      ? await (async () => {
          const { data: fp } = await admin
            .from('kyc_providers')
            .select('*')
            .eq('provider_name', force_provider)
            .maybeSingle();
          return fp ?? {
            provider_name: force_provider as string, priority: 2,
            config: { widget_id: DOJAH_WIDGET_ID, hosted_url: DOJAH_HOSTED_URL, integration_mode: 'hosted' },
          };
        })()
      : await resolveProviderFromDb(admin, country_code);

    const provider = providerConfig.provider_name;

    const { data: profile } = await admin
      .from('profiles')
      .select('uid, full_name, email, date_of_birth, nationality, country')
      .eq('id', user.id)
      .maybeSingle();

    const profileData = (profile ?? {}) as Record<string, unknown>;
    const firstName = profileData.full_name ? String(profileData.full_name).split(' ')[0] : '';
    const lastName  = profileData.full_name ? String(profileData.full_name).split(' ').slice(1).join(' ') : '';
    const email     = (profileData.email as string) ?? user.email ?? '';

    const { data: existingSub } = await admin
      .from('kyc_submissions')
      .select('id, status, provider')
      .eq('user_id', user.id)
      .in('status', ['pending', 'under_review', 'not_started'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let submissionId: string;
    let sdkToken: string | undefined;
    let referenceId: string = generateKycReferenceId();
    let hostedUrl: string | undefined;
    let finalProvider = provider;

    if (provider === 'prembly') {
      // Prembly: widget config — public keys returned to client, secret key NEVER leaves backend
      const configId   = PREMBLY_CONFIG_ID;
      const widgetKey  = PREMBLY_WIDGET_KEY;
      const publicKey  = Deno.env.get('PREMBLY_PUBLIC_KEY') ?? '';
      const environment = Deno.env.get('PREMBLY_ENVIRONMENT') ?? 'sandbox';

      if (!configId || !widgetKey || !publicKey) {
        console.warn('[kyc-initiate] Prembly not fully configured, falling back to Dojah');
        await recordProviderHealth(admin, 'prembly', false, 'Missing Prembly credentials');
        finalProvider = 'dojah';
        hostedUrl = buildDojahHostedUrl(referenceId, { first_name: firstName, last_name: lastName });
      } else {
        await recordProviderHealth(admin, 'prembly', true);
        console.log('[kyc-initiate] Prembly ref=', referenceId, 'env=', environment);
      }

    } else if (provider === 'dojah') {
      // Dojah: hosted URL with EXX-KYC reference
      hostedUrl = buildDojahHostedUrl(referenceId, { first_name: firstName, last_name: lastName });
      console.log('[kyc-initiate] Dojah ref=', referenceId, 'url=', hostedUrl);

    } else if (provider === 'sumsub') {
      const appToken  = Deno.env.get('SUMSUB_APP_TOKEN') ?? '';
      const secretKey = Deno.env.get('SUMSUB_SECRET_KEY') ?? '';

      if (!appToken || !secretKey) {
        console.warn('[kyc-initiate] Sumsub not configured, falling back to Dojah');
        finalProvider = 'dojah';
        hostedUrl = buildDojahHostedUrl(referenceId, { first_name: firstName, last_name: lastName });
      } else {
        const externalUserId = `exchangex_${user.id}`;
        const levelName = 'basic-kyc-level';

        async function sumsubSign(method: string, url: string, body: string): Promise<HeadersInit> {
          const ts = Math.floor(Date.now() / 1000).toString();
          const enc = new TextEncoder();
          const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ts + method.toUpperCase() + url + body));
          const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
          return { 'X-App-Token': appToken, 'X-App-Access-Sig': hex, 'X-App-Access-Ts': ts, 'Content-Type': 'application/json' };
        }

        try {
          const createPath = `/resources/applicants?levelName=${levelName}`;
          const createBody = JSON.stringify({ externalUserId, fixedInfo: { country: country_code } });
          const cr = await fetch(`https://api.sumsub.com${createPath}`, {
            method: 'POST', headers: await sumsubSign('POST', createPath, createBody), body: createBody,
          });
          let applicantId: string;
          if (cr.ok) {
            applicantId = (await cr.json()).id;
          } else {
            const fp = `/resources/applicants/-;externalUserId=${externalUserId}/one`;
            const fr = await fetch(`https://api.sumsub.com${fp}`, { method: 'GET', headers: await sumsubSign('GET', fp, '') });
            if (!fr.ok) throw new Error(`Sumsub applicant error: ${await fr.text()}`);
            applicantId = (await fr.json()).id;
          }
          const tp = `/resources/accessTokens?userId=${externalUserId}&levelName=${levelName}&ttlInSecs=600`;
          const tr = await fetch(`https://api.sumsub.com${tp}`, { method: 'POST', headers: await sumsubSign('POST', tp, '') });
          if (!tr.ok) throw new Error(`Sumsub token error: ${await tr.text()}`);
          sdkToken = (await tr.json()).token;
          await recordProviderHealth(admin, 'sumsub', true);
          console.log('[kyc-initiate] Sumsub applicantId=', applicantId, 'ref=', referenceId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Sumsub error';
          await recordProviderHealth(admin, 'sumsub', false, msg);
          console.warn('[kyc-initiate] Sumsub failed, falling back to Dojah:', msg);
          finalProvider = 'dojah';
          hostedUrl = buildDojahHostedUrl(referenceId, { first_name: firstName, last_name: lastName });
          sdkToken = undefined;
        }
      }
    } else {
      // Manual review
      console.log('[kyc-initiate] Manual review, ref=', referenceId);
    }

    // Upsert kyc_submissions
    if (existingSub) {
      submissionId = existingSub.id;
      await admin.from('kyc_submissions').update({
        provider: finalProvider, provider_ref_id: referenceId, country_code, doc_type, status: 'pending',
      }).eq('id', submissionId);
    } else {
      const { data: ins, error: insErr } = await admin
        .from('kyc_submissions')
        .insert({ user_id: user.id, tier: 'tier2', status: 'pending', provider: finalProvider,
          provider_ref_id: referenceId, country_code, doc_type })
        .select('id').single();
      if (insErr) throw new Error(insErr.message);
      submissionId = ins.id;
    }

    // Create kyc_attempt
    let attemptId: string;
    if (activeAttempt && finalProvider === activeAttempt.provider) {
      attemptId = activeAttempt.id;
      await admin.from('kyc_attempts').update({ status: 'in_progress', submission_id: submissionId,
        updated_at: new Date().toISOString() }).eq('id', attemptId);
    } else {
      const { data: att, error: attErr } = await admin
        .from('kyc_attempts')
        .insert({
          user_id:            user.id,          // auth UUID — never the EXX display ID
          submission_id:      submissionId,
          provider:           finalProvider,
          provider_priority:  providerConfig.priority ?? 1,
          reference_id:       referenceId,      // EXX-KYC-{UUID} text — stored in text column
          provider_reference: referenceId,      // dedicated text column for provider matching
          external_reference: referenceId,      // also stored as external_reference for webhook lookup
          exchange_user_id:   profile ? (String(profileData.uid ?? '')) : '',  // TEXT column — EXX display ID, never UUID
          widget_id:          finalProvider === 'dojah' ? DOJAH_WIDGET_ID : undefined,
          config_id:          finalProvider === 'prembly' ? PREMBLY_CONFIG_ID  : undefined,
          widget_key:         finalProvider === 'prembly' ? PREMBLY_WIDGET_KEY : undefined,
          country_code,
          doc_type,
          status:             'in_progress',
          started_at:         new Date().toISOString(),
          fallback_provider:  finalProvider !== provider ? provider : undefined,
        })
        .select('id').single();
      if (attErr) throw new Error(attErr.message);
      attemptId = att.id;
    }

    await appendAuditLog(admin, {
      submission_id: submissionId, user_id: user.id, action: 'attempt_created',
      new_status: 'in_progress',
      metadata: { provider: finalProvider, country_code, doc_type, attempt_id: attemptId, reference_id: referenceId },
    });

    await storeProviderEvent(admin, {
      attempt_id: attemptId, submission_id: submissionId, provider: finalProvider,
      event_type: 'manual_sync', reference_id: referenceId,
      raw_payload: { action: 'attempt_created', country_code, doc_type },
    });

    // Build response — never include private keys
    const response: Record<string, unknown> = {
      attempt_id: attemptId, submission_id: submissionId,
      provider: finalProvider, reference_id: referenceId,
    };

    if (finalProvider === 'prembly') {
      // Return public widget config — PREMBLY_SECRET_KEY is NEVER returned to client
      response.config_id   = PREMBLY_CONFIG_ID;
      response.widget_key  = PREMBLY_WIDGET_KEY;
      response.public_key  = Deno.env.get('PREMBLY_PUBLIC_KEY') ?? '';
      response.environment = Deno.env.get('PREMBLY_ENVIRONMENT') ?? 'sandbox';
      response.user_data   = { first_name: firstName, last_name: lastName, email, residence_country: country_code };
    } else if (finalProvider === 'dojah') {
      response.widget_id  = DOJAH_WIDGET_ID;
      response.hosted_url = hostedUrl;
      response.user_data  = { first_name: firstName, last_name: lastName, email, residence_country: country_code };
    } else if (sdkToken) {
      response.sdk_token = sdkToken;
    }

    return new Response(JSON.stringify(response), { headers: { ...JSON_H, ...CORS } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[kyc-initiate]', msg);
    try {
      const admin = getAdmin();
      const ah = req.headers.get('Authorization');
      if (ah) {
        const { data: { user } } = await admin.auth.getUser(ah.replace('Bearer ', ''));
        if (user) await admin.from('kyc_retry_queue').insert({
          user_id: user.id, submission_id: '00000000-0000-0000-0000-000000000000',
          provider: 'dojah', last_error: msg, next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        });
      }
    } catch { /* best-effort */ }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...JSON_H, ...CORS } });
  }
});
