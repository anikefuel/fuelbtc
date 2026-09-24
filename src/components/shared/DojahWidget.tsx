// DojahWidget — renders the Dojah EasyOnboard widget securely.
//
// Security guarantees:
//  • Uses ONLY the PUBLIC key (EXPO_PUBLIC_DOJAH_PUBLIC_KEY) — never the private key.
//  • Private key stays exclusively in Supabase Edge Function env vars.
//  • The HTML injected into the WebView loads the official Dojah JS SDK from cdn.dojah.io.
//  • onSuccess does NOT grant tier upgrades — it only closes the widget and triggers a
//    backend status-sync.  Tier 2 is granted only after a verified webhook / secure poll.
//
// On Web (Expo Web): falls back to a full-screen iframe pointing at widget.dojah.io
// with public credentials only.
//
// Widget ID setup:
//  1. Log in at https://app.dojah.io
//  2. Go to Widget → EasyOnboard → Create Widget
//  3. Configure steps (Government ID, Selfie/Liveness, etc.)
//  4. Publish and copy the Widget ID
//  5. Set DOJAH_WIDGET_ID in Supabase Edge Function secrets (Dashboard → Settings → Secrets)
//  6. Also set EXPO_PUBLIC_DOJAH_WIDGET_ID in app.json extra (for client reference only)

import { useRef, useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ShieldCheck, AlertTriangle, RefreshCw, ExternalLink, Settings } from 'lucide-react-native';
import { DS } from '@/lib/design';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DojahWidgetParams {
  submissionId: string;
  referenceId:  string;
  widgetId:     string;
  userData?: {
    first_name?:        string;
    last_name?:         string;
    email?:             string;
    residence_country?: string;
  };
  metadata?: Record<string, string>;
}

interface Props extends DojahWidgetParams {
  onSuccess: (referenceId: string) => void;
  onError:   (err: string) => void;
  onClose:   () => void;
}

// ── Widget-not-configured screen ───────────────────────────────────────────────

function DojahWidgetNotConfigured({ onClose }: { onClose: () => void }) {
  const steps = [
    { n: '1', text: 'Log in at app.dojah.io' },
    { n: '2', text: 'Go to Widget → EasyOnboard → Create Widget' },
    { n: '3', text: 'Add steps: Government ID + Selfie/Liveness' },
    { n: '4', text: 'Click Publish, then copy the Widget ID shown' },
    { n: '5', text: 'In Supabase Dashboard → Settings → Edge Function Secrets, add:\n  DOJAH_WIDGET_ID = <your widget ID>' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Widget Setup Required</Text>
        <Pressable onPress={onClose} style={{ paddingHorizontal: DS.space.sm, paddingVertical: 6, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, borderWidth: 1, borderColor: DS.color.border }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Close</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1, padding: DS.space.lg, gap: DS.space.lg }}>
        {/* Icon + heading */}
        <View style={{ alignItems: 'center', gap: DS.space.sm, paddingTop: DS.space.md }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center' }}>
            <Settings size={32} color={DS.color.gold} />
          </View>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.xl, textAlign: 'center' }}>
            Dojah Widget Not Configured
          </Text>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
            An admin must publish an EasyOnboard widget in the Dojah dashboard and add the Widget ID to the backend secrets.
          </Text>
        </View>

        {/* Setup steps */}
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, gap: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
          <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.xs, letterSpacing: 1, textTransform: 'uppercase' }}>
            Admin Setup Steps
          </Text>
          {steps.map(s => (
            <View key={s.n} style={{ flexDirection: 'row', gap: DS.space.sm, alignItems: 'flex-start' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                <Text style={{ color: DS.color.gold, fontSize: 11, fontWeight: DS.font.bold }}>{s.n}</Text>
              </View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, flex: 1, lineHeight: 20 }}>{s.text}</Text>
            </View>
          ))}
        </View>

        {/* Open dashboard button */}
        <Pressable
          onPress={() => Linking.openURL('https://app.dojah.io')}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: DS.space.xs, backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingVertical: 13 }}>
          <ExternalLink size={16} color={DS.color.bg} />
          <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Open Dojah Dashboard</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Build the Dojah widget HTML page ──────────────────────────────────────────

function buildWidgetHtml(params: DojahWidgetParams): string {
  const appId    = process.env.EXPO_PUBLIC_DOJAH_APP_ID    ?? '';
  const publicKey = process.env.EXPO_PUBLIC_DOJAH_PUBLIC_KEY ?? '';
  const { referenceId, widgetId, userData = {}, submissionId, metadata = {} } = params;

  const userDataJson = JSON.stringify({
    first_name:        userData.first_name ?? '',
    last_name:         userData.last_name  ?? '',
    email:             userData.email      ?? '',
    residence_country: userData.residence_country ?? '',
  });

  const metaJson = JSON.stringify({
    submission_id: submissionId,
    ...metadata,
  });

  // Use official Dojah Connect JS SDK — public credentials only
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Identity Verification</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0a0a0a; font-family:-apple-system,sans-serif; display:flex;
           align-items:center; justify-content:center; min-height:100vh; }
    #loader { color:#d4a017; font-size:14px; text-align:center; }
    #loader p { margin-top:10px; color:#aaa; font-size:12px; }
    .spinner { width:32px; height:32px; border:3px solid #333;
               border-top-color:#d4a017; border-radius:50%;
               animation:spin .8s linear infinite; margin:0 auto 12px; }
    @keyframes spin { to { transform:rotate(360deg); } }
    #error { display:none; color:#e74c3c; text-align:center; font-size:13px; padding:20px; }
  </style>
</head>
<body>
  <div id="loader">
    <div class="spinner"></div>
    <span>Loading verification…</span>
    <p>Powered by Dojah</p>
  </div>
  <div id="error">
    <p id="error-msg">Failed to load the verification widget.</p>
    <button onclick="initWidget()" style="margin-top:12px;background:#d4a017;color:#000;
      border:none;padding:10px 22px;border-radius:8px;cursor:pointer;font-weight:600;">
      Retry
    </button>
  </div>

  <script src="https://cdn.dojah.io/widget/2.1.3/connect.js"
    onload="initWidget()"
    onerror="showError('SDK failed to load — check network connectivity.')">
  </script>
  <script>
    var _loaded = false;
    var _timeout = setTimeout(function() {
      if (!_loaded) showError('Verification widget timed out. Please retry.');
    }, 15000);

    function showError(msg) {
      document.getElementById('loader').style.display = 'none';
      document.getElementById('error').style.display  = 'block';
      document.getElementById('error-msg').textContent = msg || 'An error occurred.';
      postToApp({ type: 'dojah_error', message: msg });
    }

    function postToApp(data) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(data));
        }
      } catch(e) {}
    }

    function initWidget() {
      _loaded = true;
      clearTimeout(_timeout);
      try {
        document.getElementById('loader').style.display = 'none';

        var connect = new Connect({
          app_id:       "${appId}",
          p_key:        "${publicKey}",
          type:         "custom",
          widget_id:    "${widgetId}",
          user_id:      "${referenceId}",
          user_data:    ${userDataJson},
          metadata:     ${metaJson},
          onSuccess: function(data) {
            postToApp({ type: 'dojah_success', reference_id: "${referenceId}", data: data });
          },
          onError: function(err) {
            showError(typeof err === 'string' ? err : JSON.stringify(err));
          },
          onClose: function() {
            postToApp({ type: 'dojah_close' });
          }
        });
        connect.setup();
        connect.open();
      } catch(e) {
        showError(e && e.message ? e.message : 'Widget initialization failed.');
      }
    }
  </script>
</body>
</html>`;
}

// ── Web fallback (Expo Web) ────────────────────────────────────────────────────

function DojahWidgetWeb({ submissionId, referenceId, widgetId, userData, onClose }: Props) {
  const appId     = process.env.EXPO_PUBLIC_DOJAH_APP_ID    ?? '';
  const publicKey = process.env.EXPO_PUBLIC_DOJAH_PUBLIC_KEY ?? '';

  const params = new URLSearchParams({
    app_id:    appId,
    p_key:     publicKey,
    widget_id: widgetId,
    user_id:   referenceId,
    type:      'custom',
    ...(userData?.first_name ? { first_name: userData.first_name } : {}),
    ...(userData?.last_name  ? { last_name:  userData.last_name  } : {}),
    ...(userData?.email      ? { email:      userData.email      } : {}),
    ...(userData?.residence_country ? { residence_country: userData.residence_country } : {}),
    metadata: JSON.stringify({ submission_id: submissionId }),
  });

  const src = `https://widget.dojah.io/?${params.toString()}`;

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Identity Verification</Text>
        <Pressable onPress={onClose} style={{ paddingHorizontal: DS.space.sm, paddingVertical: 6, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, borderWidth: 1, borderColor: DS.color.border }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Close</Text>
        </Pressable>
      </View>
      {/* Web: render iframe — browser APIs allowed in EXPO_OS === 'web' guard */}
      {/* @ts-ignore — iframe is valid JSX on web only */}
      <iframe src={src} style={{ flex: 1, border: 'none', width: '100%', height: '100%' }} allow="camera; microphone" />
    </View>
  );
}

// ── Main component (native WebView) ───────────────────────────────────────────

export default function DojahWidget(props: Props) {
  const { onSuccess, onError, onClose } = props;
  const webviewRef = useRef<WebView>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading]     = useState(true);

  // Guard: widget_id must be configured before launching
  const appId     = process.env.EXPO_PUBLIC_DOJAH_APP_ID    ?? '';
  const publicKey = process.env.EXPO_PUBLIC_DOJAH_PUBLIC_KEY ?? '';
  const widgetIdMissing = !props.widgetId || props.widgetId.trim() === '';
  const credsMissing    = !appId || !publicKey;
  const notConfigured   = widgetIdMissing || credsMissing;

  // Load timeout guard — must be declared before any conditional return
  useEffect(() => {
    if (notConfigured) return;
    const t = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setLoadError('Verification widget timed out. Please retry.');
      }
    }, 20000);
    return () => clearTimeout(t);
  }, [loading, notConfigured]);

  if (notConfigured) {
    return <DojahWidgetNotConfigured onClose={onClose} />;
  }

  if (process.env.EXPO_OS === 'web') {
    return <DojahWidgetWeb {...props} />;
  }

  const html = buildWidgetHtml(props);

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
      if (msg.type === 'dojah_success') {
        onSuccess(props.referenceId);
      } else if (msg.type === 'dojah_error') {
        const errMsg = typeof msg.message === 'string' ? msg.message : 'Verification error';
        setLoadError(errMsg);
        onError(errMsg);
      } else if (msg.type === 'dojah_close') {
        onClose();
      }
    } catch {
      // ignore malformed messages
    }
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center', padding: DS.space.xl }}>
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: DS.color.sellBg, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.md }}>
          <AlertTriangle size={28} color={DS.color.sell} />
        </View>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base, textAlign: 'center', marginBottom: DS.space.xs }}>
          Widget Load Failed
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20, marginBottom: DS.space.lg }}>
          {loadError}
        </Text>
        <Pressable
          onPress={() => { setLoadError(''); setLoading(true); }}
          style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingVertical: 12, paddingHorizontal: DS.space.xl, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs, marginBottom: DS.space.sm }}>
          <RefreshCw size={16} color={DS.color.bg} />
          <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Retry</Text>
        </Pressable>
        <Pressable onPress={onClose}>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {loading && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10, backgroundColor: DS.color.bg }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.md }}>
            <ShieldCheck size={28} color={DS.color.gold} />
          </View>
          <ActivityIndicator color={DS.color.gold} size="large" style={{ marginBottom: DS.space.sm }} />
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Loading verification…</Text>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginTop: 4 }}>Powered by Dojah</Text>
        </View>
      )}
      <WebView
        ref={webviewRef}
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        onMessage={handleMessage}
        onLoad={() => setLoading(false)}
        onError={(e) => {
          setLoading(false);
          const desc = e.nativeEvent.description ?? 'Failed to load page';
          setLoadError(desc);
          onError(desc);
        }}
        style={{ flex: 1 }}
      />
    </View>
  );
}
