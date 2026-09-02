// Dojah EasyOnboard — embedded full-screen WebView
// Route: /kyc/dojah/:attemptId
//
// Replaces WebBrowser.openBrowserAsync — no popup, no new tab.
// The Dojah JS SDK runs inside a react-native-webview.
// On Web (Expo Web) falls back to an iframe (camera allowed via allow="camera").
//
// After the widget closes (success / error / manual close):
//   1. A backend sync is triggered via sync-dojah-kyc-status.
//   2. The screen shows a transitioning state while syncing.
//   3. User is navigated back to /kyc once sync resolves.

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { ArrowLeft, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { DS } from '@/lib/design';

const WIDGET_ID  = '6a5b12349ff90fe054784334';
const WIDGET_URL = `https://identity.dojah.io?widget_id=${WIDGET_ID}`;

// ── Build widget URL with reference_id ───────────────────────────────────────
function buildWidgetUrl(referenceId: string): string {
  const base = new URL(WIDGET_URL);
  base.searchParams.set('reference_id', referenceId);
  return base.toString();
}

// ── Status sync via Edge Function ────────────────────────────────────────────
async function syncStatus(attemptId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('sync-dojah-kyc-status', {
    body: { attempt_id: attemptId },
  });
  if (error) {
    const msg = await (error as { context?: { text?: () => Promise<string> } }).context?.text?.();
    console.warn('[dojah-embed] sync error:', msg ?? error.message);
    return 'in_progress';
  }
  return (data as { status?: string })?.status ?? 'in_progress';
}

// ── Web iframe fallback ───────────────────────────────────────────────────────
function DojahIframe({ referenceId, onClose }: { referenceId: string; onClose: () => void }) {
  const src = buildWidgetUrl(referenceId);
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Pressable onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <ShieldCheck size={18} color={DS.color.gold} />
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Identity Verification</Text>
      </View>
      {/* Web: browser APIs allowed inside EXPO_OS === 'web' guard */}
      {/* @ts-ignore — iframe is valid JSX on web only */}
      <iframe src={src} style={{ flex: 1, border: 'none', width: '100%', height: '100%' }} allow="camera; fullscreen" title="Identity Verification" />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function DojahEmbedScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const webviewRef = useRef<WebView>(null);
  const pt = Platform.OS === 'ios' ? 52 : (RNStatusBar.currentHeight ?? 24) + 8;

  const [referenceId, setReferenceId]   = useState<string | null>(null);
  const [loadError, setLoadError]       = useState('');
  const [webviewLoading, setWebviewLoading] = useState(true);
  const [syncing, setSyncing]           = useState(false);
  const [syncDone, setSyncDone]         = useState(false);
  const [finalStatus, setFinalStatus]   = useState('');
  const [loadTimeout, setLoadTimeout]   = useState(false);

  // Load attempt → get reference_id
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      if (!attemptId) return;
      const { data: attempt } = await supabase
        .from('kyc_attempts')
        .select('reference_id, status')
        .eq('id', attemptId)
        .maybeSingle();
      if (!active) return;
      if (!attempt?.reference_id) { setLoadError('Verification session not found.'); return; }
      // Already terminal — go back immediately
      if (['verified', 'failed', 'abandoned'].includes(attempt.status)) {
        router.back(); return;
      }
      setReferenceId(attempt.reference_id);
    })();
    return () => { active = false; };
  }, [attemptId]));

  // Timeout guard for WebView load
  useEffect(() => {
    if (!referenceId || !webviewLoading) return;
    const t = setTimeout(() => setLoadTimeout(true), 20_000);
    return () => clearTimeout(t);
  }, [referenceId, webviewLoading]);

  // Handle sync after widget completes / closes
  async function handleWidgetDone(reason: 'success' | 'error' | 'close') {
    setSyncing(true);
    try {
      const status = await syncStatus(attemptId ?? '');
      setFinalStatus(status);
    } catch {
      setFinalStatus('in_progress');
    } finally {
      setSyncing(false);
      setSyncDone(true);
    }
    // Navigate back after short delay so user sees confirmation
    setTimeout(() => {
      if (router.canGoBack()) router.back();
    }, reason === 'success' ? 2000 : 1000);
  }

  // WebView message handler (Dojah JS SDK posts events)
  function onMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg?.type === 'dojah_success') handleWidgetDone('success');
      else if (msg?.type === 'dojah_close') handleWidgetDone('close');
      else if (msg?.type === 'dojah_error') handleWidgetDone('error');
    } catch { /* non-JSON messages ignored */ }
  }

  // Detect Dojah redirect signals in navigation state
  function onNavigationStateChange(nav: WebViewNavigation) {
    const url = nav.url ?? '';
    if (url.includes('status=success') || url.includes('verification=complete')) {
      handleWidgetDone('success');
    } else if (url.includes('status=failed') || url.includes('verification=failed')) {
      handleWidgetDone('error');
    }
  }

  function handleGoBack() {
    setSyncing(true);
    syncStatus(attemptId ?? '').then(status => {
      setFinalStatus(status);
    }).catch(() => {}).finally(() => {
      setSyncing(false);
      if (router.canGoBack()) router.back();
    });
  }

  // ── Web platform ────────────────────────────────────────────────────────────
  if (process.env.EXPO_OS === 'web') {
    return referenceId
      ? <DojahIframe referenceId={referenceId} onClose={handleGoBack} />
      : (
        <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      );
  }

  // ── Error / sync overlay ────────────────────────────────────────────────────
  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center', padding: DS.space.lg, gap: DS.space.md }}>
        <AlertTriangle size={40} color={DS.color.sell} />
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, textAlign: 'center' }}>Session Error</Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center' }}>{loadError}</Text>
        <Pressable onPress={() => router.back()} style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingHorizontal: DS.space.xl, paddingVertical: 12 }}>
          <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (syncing || syncDone) {
    const isDone = syncDone;
    const isVerified  = finalStatus === 'verified';
    const isFailed    = finalStatus === 'failed';
    const statusLabel = isVerified ? 'Verification Submitted' : isFailed ? 'Verification Incomplete' : 'Syncing Status…';
    const statusColor = isVerified ? DS.color.buy : isFailed ? DS.color.sell : DS.color.gold;
    const statusIcon  = isVerified ? <ShieldCheck size={48} color={DS.color.buy} /> : isFailed ? <AlertTriangle size={48} color={DS.color.sell} /> : null;
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center', padding: DS.space.lg, gap: DS.space.md }}>
        {isDone && statusIcon}
        {!isDone && <ActivityIndicator color={DS.color.gold} size="large" />}
        <Text style={{ color: statusColor, fontWeight: DS.font.bold, fontSize: DS.font.lg, textAlign: 'center' }}>{statusLabel}</Text>
        {isDone && <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
          {isVerified
            ? 'Your submission has been received. Final approval may take a few minutes.'
            : isFailed
            ? 'Something went wrong. You can retry from the verification page.'
            : 'Your verification status has been updated.'}
        </Text>}
      </View>
    );
  }

  if (!referenceId) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={DS.color.gold} size="large" />
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginTop: DS.space.sm }}>Loading verification…</Text>
      </View>
    );
  }

  const widgetUrl = buildWidgetUrl(referenceId);

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: DS.color.bg }}>
        <Pressable onPress={handleGoBack} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <ShieldCheck size={18} color={DS.color.gold} />
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, flex: 1 }}>Identity Verification</Text>
        {webviewLoading && <ActivityIndicator size="small" color={DS.color.gold} />}
        {!webviewLoading && (
          <Pressable onPress={() => webviewRef.current?.reload()} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
            <RefreshCw size={16} color={DS.color.text2} />
          </Pressable>
        )}
      </View>

      {/* Timeout overlay */}
      {loadTimeout && webviewLoading && (
        <View style={{ position: 'absolute', top: pt + 52, left: 0, right: 0, bottom: 0, backgroundColor: DS.color.bg, zIndex: 10, alignItems: 'center', justifyContent: 'center', padding: DS.space.lg, gap: DS.space.md }}>
          <AlertTriangle size={40} color={DS.color.warn} />
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, textAlign: 'center' }}>Taking too long</Text>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center' }}>Check your internet connection and try again.</Text>
          <Pressable onPress={() => { setLoadTimeout(false); setWebviewLoading(true); webviewRef.current?.reload(); }} style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingHorizontal: DS.space.xl, paddingVertical: 12 }}>
            <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Retry</Text>
          </Pressable>
          <Pressable onPress={handleGoBack}>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Cancel</Text>
          </Pressable>
        </View>
      )}

      <WebView
        ref={webviewRef}
        source={{ uri: widgetUrl }}
        style={{ flex: 1 }}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={() => { setWebviewLoading(true); setLoadTimeout(false); }}
        onLoadEnd={() => setWebviewLoading(false)}
        onError={() => { setWebviewLoading(false); setLoadError('Failed to load verification page. Check your connection.'); }}
        // Camera + fullscreen required by Dojah document capture
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        // Android: allow camera in WebView
        domStorageEnabled
        javaScriptEnabled
        geolocationEnabled={false}
        // iOS: allow camera without extra permission prompts
        allowsProtectedMedia
        // Prevent opening new tabs/windows — keep navigation inside WebView
        onShouldStartLoadWithRequest={() => true}
      />
    </View>
  );
}
