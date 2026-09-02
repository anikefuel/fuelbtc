// Prembly IdentityPass — embedded full-screen WebView
// Route: /kyc/prembly/:attemptId
//
// Loads the Prembly widget inside ExchangeX — no popup, no new tab.
// On native (iOS/Android): react-native-webview with postMessage bridge.
// On Web (Expo Web): iframe fallback with camera permission.
//
// After widget closes (success / error / manual close):
//   1. Updates attempt to submitted status via backend sync.
//   2. Shows transition state while syncing.
//   3. Returns user to /kyc once sync resolves.
//
// Security:
//   - PREMBLY_SECRET_KEY never leaves the backend.
//   - PREMBLY_PUBLIC_KEY (client-safe) loaded via EXPO_PUBLIC_PREMBLY_PUBLIC_KEY.
//   - Frontend callbacks do NOT directly mark user verified.

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, ActivityIndicator,
  StatusBar as RNStatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { DS } from '@/lib/design';

// WebView is native-only — import at top level, guard usage behind EXPO_OS check
import { WebView } from 'react-native-webview';

// ── Config (public values only — secret key never in frontend) ────────────────
// These are the compile-time .env fallbacks.
// At runtime, the widget screen loads the LIVE config from kyc_providers in Supabase
// so admins can update keys via the Admin → KYC Settings → Providers tab without a redeploy.
const PREMBLY_ENV_FALLBACK = process.env.EXPO_PUBLIC_PREMBLY_ENVIRONMENT ?? 'production';

// ── Build the Prembly widget HTML for WebView injection ───────────────────────
//
// Prembly SDK v2 (production) global name: IdentitypassWidget
// Script URL: https://widget.prembly.com/widget.js
//
// CRITICAL — do NOT use 'async' on the script tag: the 'load' event may already
// have fired by the time an async script executes, causing the init callback to
// never run.  Use a synchronous script tag or poll for the global.
//
// Constructor signature (production v2):
//   new IdentitypassWidget({
//     config_id, widget_key, app_id, environment,
//     reference_id, email?, country?,
//     onSuccess, onError, onClose, onReady
//   })
// ── Widget page URL builder ───────────────────────────────────────────────────
// The Prembly widget is served by the `prembly-widget-page` Edge Function.
// Using an Edge Function URL (real https:// origin) instead of srcdoc solves two issues:
//   1. srcdoc iframes have null origin → <script src="https://..."> blocked by CORS.
//   2. Fetching widget.js from the client app is blocked because widget.prembly.com
//      does not send Access-Control-Allow-Origin: * on their JS bundle.
// The Edge Function serves the full HTML page from Supabase's real origin, so the
// Prembly SDK <script> tag loads freely and camera/microphone permissions work.
//
// Widget page URL: https://gehhhbuzjyxtwwljzfyx.supabase.co/functions/v1/prembly-widget-page
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://gehhhbuzjyxtwwljzfyx.supabase.co';
const WIDGET_PAGE_BASE = `${SUPABASE_URL}/functions/v1/prembly-widget-page`;

function buildWidgetPageUrl(params: {
  configId:   string;
  widgetKey:  string;
  publicKey:  string;
  env:        string;
  reference:  string;
  email?:     string;
  country?:   string;
  parentOrigin?: string;
}): string {
  const { configId, widgetKey, publicKey, env, reference, email, country, parentOrigin } = params;
  const q = new URLSearchParams({
    config_id:    configId,
    widget_key:   widgetKey,
    app_id:       publicKey,
    environment:  env,
    reference_id: reference,
  });
  if (email)        q.set('email', email);
  if (country)      q.set('country', country);
  if (parentOrigin) q.set('parent_origin', parentOrigin);
  return `${WIDGET_PAGE_BASE}?${q.toString()}`;
}

// ── HTML for native WebView (unchanged — WebView has full network access) ──────
const SDK_URL = 'https://widget.prembly.com/widget.js';

function buildPremblyHtml(params: {
  configId:  string;
  widgetKey: string;
  publicKey: string;
  env:       string;
  reference: string;
  email?:    string;
  country?:  string;
}): string {
  const { configId, widgetKey, publicKey, env, reference, email = '', country = '' } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Identity Verification</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; background: #0a0a0a; font-family: -apple-system, sans-serif; }
    #prembly-widget { width: 100vw; height: 100vh; }
    #loading-state {
      position: fixed; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; background: #0a0a0a; gap: 16px; z-index: 100;
    }
    .loading-text { color: #C9A84C; font-size: 14px; }
    .spinner {
      width: 40px; height: 40px; border: 3px solid #333;
      border-top-color: #C9A84C; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="loading-state">
    <div class="spinner"></div>
    <div class="loading-text" id="status-text">Loading verification…</div>
  </div>
  <div id="prembly-widget"></div>
  <script src="${SDK_URL}" onerror="document.getElementById('status-text').textContent='Failed to load SDK.';window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'prembly_error',error:'SDK load failed'}));"></script>
  <script>
    function postToNative(msg) {
      try {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
        else window.parent.postMessage(JSON.stringify(msg), '*');
      } catch(e) {}
    }
    function hideLoading() { var el=document.getElementById('loading-state'); if(el) el.style.display='none'; }
    function initWidget() {
      var cfg = {
        config_id:    ${JSON.stringify(configId)},
        widget_key:   ${JSON.stringify(widgetKey)},
        app_id:       ${JSON.stringify(publicKey)},
        environment:  ${JSON.stringify(env)},
        reference_id: ${JSON.stringify(reference)},
        ${email   ? `email:   ${JSON.stringify(email)},`   : ''}
        ${country ? `country: ${JSON.stringify(country)},` : ''}
        onSuccess: function(data) { hideLoading(); postToNative({ type: 'prembly_success', data: data || {} }); },
        onError:   function(err)  { hideLoading(); postToNative({ type: 'prembly_error', error: (err&&(err.message||JSON.stringify(err)))||'Verification error' }); },
        onClose:   function()     { postToNative({ type: 'prembly_close' }); },
        onReady:   function()     { hideLoading(); postToNative({ type: 'prembly_ready' }); },
      };
      try {
        if      (typeof IdentitypassWidget !== 'undefined') new IdentitypassWidget(cfg);
        else if (typeof PremblyWidget      !== 'undefined') new PremblyWidget(cfg);
        else if (typeof Identitypass       !== 'undefined') new Identitypass(cfg);
        else {
          var g = Object.keys(window).filter(function(k){return k.toLowerCase().includes('prembly')||k.toLowerCase().includes('identitypass');}).join(', ');
          var m = 'SDK not loaded. Globals: '+(g||'none');
          document.getElementById('status-text').textContent = m;
          postToNative({ type: 'prembly_error', error: m });
        }
      } catch(e) {
        var msg = e&&e.message?e.message:String(e);
        document.getElementById('status-text').textContent = 'SDK init error: '+msg;
        postToNative({ type: 'prembly_error', error: 'SDK init error: '+msg });
      }
    }
    initWidget();
  </script>
</body>
</html>`;
}

// ── Backend sync ──────────────────────────────────────────────────────────────
async function syncPremblyStatus(attemptId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('sync-prembly-kyc-status', {
    body: { attempt_id: attemptId },
  });
  if (error) {
    const msg = await (error as { context?: { text?: () => Promise<string> } }).context?.text?.();
    console.warn('[prembly-embed] sync error:', msg ?? error.message);
    return 'in_progress';
  }
  return (data as { status?: string })?.status ?? 'in_progress';
}

// ── Web iframe fallback ───────────────────────────────────────────────────────
// Loads the widget via the `prembly-widget-page` Edge Function URL (src=).
// Using a real https:// src avoids the null-origin CORS issue that srcdoc causes,
// so widget.prembly.com/widget.js loads freely and camera permissions work.
function PremblyIframe({
  widgetUrl, onClose, onMessage,
}: {
  widgetUrl: string;
  onClose: () => void;
  onMessage: (type: string, data: unknown) => void;
}) {
  // Listen for postMessage from the Edge Function iframe
  useEffect(() => {
    function handler(event: MessageEvent) {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (msg?.type) onMessage(msg.type, msg.data ?? msg.error ?? null);
      } catch { /* ignore non-JSON */ }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{
        paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm,
        flexDirection: 'row', alignItems: 'center', gap: DS.space.sm,
        borderBottomWidth: 1, borderBottomColor: DS.color.border,
      }}>
        <Pressable onPress={onClose} style={{
          width: 36, height: 36, borderRadius: 18, backgroundColor: DS.color.card,
          alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border,
        }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <ShieldCheck size={18} color={DS.color.gold} />
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
          Identity Verification
        </Text>
      </View>
      {/* @ts-ignore — iframe is valid DOM on Web; EXPO_OS guard in parent ensures this never runs on native */}
      <iframe
        src={widgetUrl}
        style={{ flex: 1, border: 'none', width: '100%', height: '100%' }}
        allow="camera; microphone; fullscreen"
        title="Identity Verification"
      />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function PremblyEmbedScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router        = useRouter();
  const pt = RNStatusBar.currentHeight ? RNStatusBar.currentHeight + 8 : 52;

  const [referenceId, setReferenceId]       = useState<string | null>(null);
  const [email, setEmail]                   = useState('');
  const [country, setCountry]               = useState('');
  const [loadError, setLoadError]           = useState('');
  const [webviewLoading, setWebviewLoading] = useState(true);
  const [syncing, setSyncing]               = useState(false);
  const [syncDone, setSyncDone]             = useState(false);
  const [finalStatus, setFinalStatus]       = useState('');
  const [retryCount, setRetryCount]         = useState(0);
  // Auto-polling state — used after widget closes to wait for verified/failed resolution
  const [polling, setPolling]               = useState(false);

  // Live provider config loaded from DB — overrides .env compile-time values
  const [premblyConfigId,  setPremblyConfigId]  = useState(process.env.EXPO_PUBLIC_PREMBLY_CONFIG_ID  ?? '');
  const [premblyWidgetKey, setPremblyWidgetKey] = useState(process.env.EXPO_PUBLIC_PREMBLY_WIDGET_KEY ?? '');
  const [premblyPublicKey, setPremblyPublicKey] = useState(process.env.EXPO_PUBLIC_PREMBLY_PUBLIC_KEY ?? '');
  const [premblyEnv,       setPremblyEnv]       = useState(PREMBLY_ENV_FALLBACK);

  // ── Load attempt + user data + live provider config ──────────────────────
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      if (!attemptId) { setLoadError('Invalid verification link'); return; }
      try {
        // Load attempt row and live Prembly provider config in parallel
        const [attemptRes, providerRes] = await Promise.all([
          supabase
            .from('kyc_attempts')
            .select('reference_id, provider_reference, external_reference, country_code, status')
            .eq('id', attemptId)
            .maybeSingle(),
          supabase
            .from('kyc_providers')
            .select('config')
            .eq('provider_name', 'prembly')
            .eq('enabled', true)
            .maybeSingle(),
        ]);

        if (!active) return;

        // Apply live config values — these override the compile-time .env fallbacks
        const cfg = providerRes.data?.config as Record<string, string> | undefined;
        if (cfg) {
          if (cfg.config_id)  setPremblyConfigId(cfg.config_id);
          if (cfg.widget_key) setPremblyWidgetKey(cfg.widget_key);
          if (cfg.environment) setPremblyEnv(cfg.environment);
          // public_key is optional in DB config — fall back to .env
          if (cfg.public_key) setPremblyPublicKey(cfg.public_key);
        }

        const { data: attempt, error: aErr } = attemptRes;
        if (aErr || !attempt) { setLoadError('Verification session not found'); return; }

        // If already terminal, skip widget and go back
        if (['verified', 'rejected', 'failed'].includes(attempt.status ?? '')) {
          router.replace('/(app)/kyc' as never);
          return;
        }

        const ref = attempt.provider_reference ?? attempt.external_reference ?? attempt.reference_id;
        setReferenceId(ref);
        setCountry(attempt.country_code ?? '');

        const { data: { user } } = await supabase.auth.getUser();
        if (!active) return;
        if (user?.email) setEmail(user.email);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => { active = false; };
  }, [attemptId]));

  // ── Handle postMessage from WebView ──────────────────────────────────────
  async function handleMessage(event: { nativeEvent: { data: string } }) {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }

    const type = msg.type as string;
    console.log('[prembly-embed] message:', type);

    if (type === 'prembly_ready') {
      setWebviewLoading(false);
    } else if (type === 'prembly_success') {
      // Save reference from SDK response — do NOT mark verified here
      const data = (msg.data ?? {}) as Record<string, unknown>;
      const verRef = String(
        (data.verification as Record<string,unknown>)?.reference
        ?? data.reference
        ?? referenceId
        ?? ''
      );
      if (verRef && verRef !== referenceId) {
        await supabase.from('kyc_attempts').update({
          provider_reference: verRef,
          external_reference: verRef,
          status:             'submitted',
          submitted_at:       new Date().toISOString(),
          updated_at:         new Date().toISOString(),
        }).eq('id', attemptId);
      } else {
        await supabase.from('kyc_attempts').update({
          status:      'submitted',
          submitted_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        }).eq('id', attemptId);
      }
      // Trigger backend sync
      setSyncing(true);
      const status = await syncPremblyStatus(attemptId!);
      setSyncing(false);
      setSyncDone(true);
      setFinalStatus(status);
    } else if (type === 'prembly_error') {
      const errMsg = String(msg.error ?? 'Verification error');
      console.warn('[prembly-embed] SDK error:', errMsg);
      setLoadError(errMsg);
    } else if (type === 'prembly_close') {
      // Widget closed — start polling for status resolution instead of navigating away immediately.
      // The webhook / sync may arrive seconds after close, so poll until terminal state.
      setPolling(true);
    }
  }

  // ── Auto-polling after widget closes ─────────────────────────────────────
  // Poll every 3 s (up to 20 attempts = 60 s) until status is terminal.
  // This covers the gap between the user closing the widget and Prembly's
  // webhook / sync resolving to verified / rejected / failed.
  useEffect(() => {
    if (!polling || !attemptId) return;
    const TERMINAL = ['verified', 'rejected', 'failed', 'not_started'];
    const MAX_ATTEMPTS = 20;
    let attempts = 0;
    let cancelled = false;

    async function poll() {
      while (!cancelled && attempts < MAX_ATTEMPTS) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000));
        if (cancelled) break;
        try {
          const status = await syncPremblyStatus(attemptId!);
          if (cancelled) break;
          if (TERMINAL.includes(status)) {
            setPolling(false);
            setSyncDone(true);
            setFinalStatus(status);
            return;
          }
        } catch {
          // network hiccup — keep polling
        }
      }
      // Timed out — show whatever state we have
      if (!cancelled) {
        setPolling(false);
        setSyncDone(true);
        setFinalStatus('in_progress');
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [polling, attemptId]);

  function handleClose() {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/kyc' as never);
  }

  function handleDone() {
    router.replace('/(app)/kyc' as never);
  }

  function handleRetry() {
    setLoadError('');
    setWebviewLoading(true);
    setRetryCount(c => c + 1);
  }

  // ── Loading (waiting for reference) ──────────────────────────────────────
  if (!referenceId) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={DS.color.gold} size="large" />
        <Text style={{ color: DS.color.text3, marginTop: DS.space.sm, fontSize: DS.font.sm }}>
          Preparing verification…
        </Text>
      </View>
    );
  }

  // Build HTML — native WebView only. Web uses the Edge Function URL directly.
  const html = buildPremblyHtml({
    configId:  premblyConfigId,
    widgetKey: premblyWidgetKey,
    publicKey: premblyPublicKey,
    env:       premblyEnv,
    reference: referenceId,
    email,
    country,
  });

  // Build widget page URL — used by Web iframe (Edge Function serves the HTML with a real origin)
  // URL: https://gehhhbuzjyxtwwljzfyx.supabase.co/functions/v1/prembly-widget-page?...
  const widgetPageUrl = buildWidgetPageUrl({
    configId:     premblyConfigId,
    widgetKey:    premblyWidgetKey,
    publicKey:    premblyPublicKey,
    env:          premblyEnv,
    reference:    referenceId,
    email,
    country,
    parentOrigin: process.env.EXPO_OS === 'web' ? window.location.origin : undefined,
  });

  // ── Web: use Edge Function iframe (real https:// origin — SDK loads freely) ─
  if (process.env.EXPO_OS === 'web') {
    return (
      <PremblyIframe
        widgetUrl={widgetPageUrl}
        onClose={handleClose}
        onMessage={(type, data) => {
          handleMessage({ nativeEvent: { data: JSON.stringify({ type, data }) } });
        }}
      />
    );
  }

  // ── Sync done state ───────────────────────────────────────────────────────
  if (syncDone) {
    const isVerified = finalStatus === 'verified';
    const isPending  = ['submitted', 'pending_review', 'in_progress', 'manual_review'].includes(finalStatus);
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: DS.space.xl }}>
        <View style={{
          backgroundColor: DS.color.card, borderRadius: DS.radius.xl,
          padding: DS.space.xl, alignItems: 'center', gap: DS.space.md,
          borderWidth: 1, borderColor: DS.color.border, width: '100%',
        }}>
          {isVerified
            ? <CheckCircle size={48} color={DS.color.buy} />
            : <ShieldCheck size={48} color={DS.color.gold} />}
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, textAlign: 'center' }}>
            {isVerified ? 'Verification Complete' : 'Verification Submitted'}
          </Text>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
            {isVerified
              ? 'Your identity has been verified successfully.'
              : isPending
                ? 'Your verification has been submitted and is awaiting confirmation. We will notify you once the review is complete.'
                : 'Your verification could not be completed at this time. Please try again or contact support.'}
          </Text>
          <Pressable onPress={handleDone} style={{
            backgroundColor: DS.color.gold, borderRadius: DS.radius.md,
            paddingVertical: DS.space.sm, paddingHorizontal: DS.space.xl,
            alignItems: 'center', width: '100%', marginTop: DS.space.xs,
          }}>
            <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>
              Back to Account
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Syncing state ─────────────────────────────────────────────────────────
  if (syncing) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center', gap: DS.space.md }}>
        <ActivityIndicator color={DS.color.gold} size="large" />
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Confirming your verification…</Text>
      </View>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{
          paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm,
          flexDirection: 'row', alignItems: 'center', gap: DS.space.sm,
          borderBottomWidth: 1, borderBottomColor: DS.color.border,
        }}>
          <Pressable onPress={handleClose} style={{
            width: 36, height: 36, borderRadius: 18, backgroundColor: DS.color.card,
            alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border,
          }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
            Identity Verification
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: DS.space.xl, gap: DS.space.md }}>
          <AlertTriangle size={48} color={DS.color.sell} />
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.md, textAlign: 'center' }}>
            Verification Unavailable
          </Text>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
            {loadError.includes('SDK') || loadError.includes('loaded')
              ? 'The verification SDK could not be loaded. Please check your connection and try again.'
              : 'Something went wrong loading the verification. Please try again.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: DS.space.sm }}>
            <Pressable onPress={handleRetry} style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: DS.color.card, borderRadius: DS.radius.md,
              paddingVertical: DS.space.sm, paddingHorizontal: DS.space.md,
              borderWidth: 1, borderColor: DS.color.border,
            }}>
              <RefreshCw size={14} color={DS.color.gold} />
              <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Retry</Text>
            </Pressable>
            <Pressable onPress={handleClose} style={{
              backgroundColor: DS.color.surface, borderRadius: DS.radius.md,
              paddingVertical: DS.space.sm, paddingHorizontal: DS.space.md,
              borderWidth: 1, borderColor: DS.color.border,
            }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ── Native: WebView with injected HTML ───────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{
        paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm,
        flexDirection: 'row', alignItems: 'center', gap: DS.space.sm,
        borderBottomWidth: 1, borderBottomColor: DS.color.border,
        backgroundColor: DS.color.bg,
      }}>
        <Pressable onPress={handleClose} style={{
          width: 36, height: 36, borderRadius: 18, backgroundColor: DS.color.card,
          alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border,
        }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <ShieldCheck size={18} color={DS.color.gold} />
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, flex: 1 }}>
          Identity Verification
        </Text>
        {webviewLoading && <ActivityIndicator color={DS.color.gold} size="small" />}
      </View>

      {/* WebView */}
      <WebView
        key={retryCount}
        source={{ html }}
        style={{ flex: 1, backgroundColor: DS.color.bg }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        onMessage={handleMessage}
        onLoadEnd={() => setWebviewLoading(false)}
        onError={() => setLoadError('Failed to load the verification page. Check your connection.')}
        onHttpError={() => setLoadError('Verification page returned an error.')}
        userAgent="ExchangeX/1.0 (PremblyWidget)"
      />
    </View>
  );
}
