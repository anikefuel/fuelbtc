// Passkeys & Biometric screen
// Native (iOS/Android): expo-local-authentication biometric enrollment
// Web: WebAuthn with proper capability detection; clear errors for preview/insecure contexts
import { useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, TextInput, Modal } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Fingerprint, Trash2, Plus, AlertTriangle, CheckCircle, Smartphone, Shield } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { getPasskeys, registerNativePasskey, registerWebAuthnPasskey, removePasskey } from '@/services/auth.service';
import type { Passkey } from '@/services/auth.service';
import { supabase } from '@/client/supabase';

const IS_WEB = process.env.EXPO_OS === 'web';

// ── WebAuthn capability detection ───────────────────────────────────────────
type WebAuthnStatus =
  | 'supported'
  | 'insecure_context'
  | 'unsupported_browser'
  | 'preview_context'
  | 'unavailable';

function detectWebAuthn(): WebAuthnStatus {
  if (typeof window === 'undefined') return 'unavailable';
  if (!window.isSecureContext) return 'insecure_context';
  if (
    typeof PublicKeyCredential === 'undefined' ||
    typeof navigator?.credentials?.create !== 'function'
  ) return 'unsupported_browser';
  // Detect embedded preview/iframe context where WebAuthn cannot complete
  try {
    if (window.self !== window.top) return 'preview_context';
  } catch {
    return 'preview_context'; // cross-origin iframe — SecurityError thrown
  }
  return 'supported';
}

function webAuthnStatusMessage(status: WebAuthnStatus): string {
  switch (status) {
    case 'insecure_context':
      return 'Passkey registration requires HTTPS. Please open the app on a secure (https://) connection.';
    case 'unsupported_browser':
      return 'Your browser does not support passkeys. Please use Chrome 108+, Safari 16+, or Firefox 119+.';
    case 'preview_context':
      return 'Passkey registration is unavailable in this preview. Open the production site in Chrome or Safari on your device.';
    default:
      return 'Passkey registration is not available in this environment.';
  }
}

async function checkBiometricAvailable(): Promise<boolean> {
  if (IS_WEB) return false;
  try {
    const LA = await import('expo-local-authentication');
    const hasHw = await LA.hasHardwareAsync();
    const enrolled = await LA.isEnrolledAsync();
    return hasHw && enrolled;
  } catch {
    return false;
  }
}

async function authenticateWithBiometric(): Promise<boolean> {
  if (IS_WEB) return false;
  try {
    const LA = await import('expo-local-authentication');
    const result = await LA.authenticateAsync({
      promptMessage: 'Verify your identity to register this device',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
    });
    return result.success;
  } catch {
    return false;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export default function PasskeysScreen() {
  const router = useRouter();
  const [passkeys, setPasskeys]       = useState<Passkey[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [biometricAvail, setBioAvail] = useState(false);
  const [webAuthnStatus, setWaStatus] = useState<WebAuthnStatus>('unavailable');

  const [showAdd, setShowAdd]         = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [adding, setAdding]           = useState(false);
  const [addError, setAddError]       = useState('');

  const [removing, setRemoving]       = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const [keys, bioOk] = await Promise.all([getPasskeys(), checkBiometricAvailable()]);
        if (active) {
          setPasskeys(keys);
          setBioAvail(bioOk);
          if (IS_WEB) setWaStatus(detectWebAuthn());
        }
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load passkeys');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  async function handleAdd() {
    const label = deviceLabel.trim() || 'My Device';
    setAdding(true); setAddError('');
    try {
      if (!IS_WEB) {
        // Native path: require biometric enrollment on device
        if (!biometricAvail) {
          setAddError('No biometric authentication enrolled. Please set up Face ID or fingerprint in device Settings first.');
          setAdding(false);
          return;
        }
        const ok = await authenticateWithBiometric();
        if (!ok) {
          setAddError('Biometric verification was cancelled or failed. No record was created.');
          setAdding(false);
          return;
        }
        await registerNativePasskey(label);
      } else {
        // Web path: require WebAuthn support & secure context
        const status = detectWebAuthn();
        if (status !== 'supported') {
          setAddError(webAuthnStatusMessage(status));
          setAdding(false);
          return;
        }
        // Verify authenticated session before attempting WebAuthn
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setAddError('No active session. Please sign in again.');
          setAdding(false);
          return;
        }
        // Attempt WebAuthn credential creation
        try {
          const challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);
          const credential = await navigator.credentials.create({
            publicKey: {
              challenge,
              rp: { name: 'ExchangeX' },
              user: {
                id: new TextEncoder().encode(user.id),
                name: user.email ?? user.id,
                displayName: label,
              },
              pubKeyCredParams: [
                { alg: -7,   type: 'public-key' }, // ES256
                { alg: -257, type: 'public-key' }, // RS256
              ],
              authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'preferred',
              },
              timeout: 60000,
            },
          }) as PublicKeyCredential | null;

          if (!credential) {
            setAddError('Passkey creation was cancelled. No record was created.');
            setAdding(false);
            return;
          }
          // Store only the credential ID (not the private key — never stored)
          const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
          await registerWebAuthnPasskey(label, credentialId);
        } catch (webErr: unknown) {
          const msg = webErr instanceof Error ? webErr.message : String(webErr);
          if (msg.includes('cancelled') || msg.includes('NotAllowedError') || msg.includes('AbortError')) {
            setAddError('Registration was cancelled. No record was created.');
          } else if (msg.includes('SecurityError') || msg.includes('InvalidStateError')) {
            setAddError('Passkey registration failed due to a security restriction. Ensure you are on the production HTTPS site.');
          } else {
            setAddError(`Passkey registration failed: ${msg}`);
          }
          setAdding(false);
          return;
        }
      }
      const keys = await getPasskeys();
      setPasskeys(keys);
      setShowAdd(false);
      setDeviceLabel('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to register device';
      setAddError(msg);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    setRemoving(id); setError('');
    try {
      await removePasskey(id);
      setPasskeys(prev => prev.filter(p => p.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove passkey');
    } finally {
      setRemoving(null);
    }
  }

  const canAdd = !IS_WEB ? biometricAvail : webAuthnStatus === 'supported';
  const webWarning = IS_WEB && webAuthnStatus !== 'supported'
    ? webAuthnStatusMessage(webAuthnStatus)
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Passkeys & Biometric</Text>
        </View>
        <Pressable onPress={() => { setDeviceLabel(''); setAddError(''); setShowAdd(true); }} style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 7, borderWidth: 1, borderColor: `${DS.color.gold}50`, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Plus size={14} color={DS.color.gold} />
          <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Add</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} />
        </View>
      ) : (
        <FlatList
          data={passkeys}
          keyExtractor={item => item.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm }}
          ListHeaderComponent={
            <View style={{ gap: DS.space.sm, marginBottom: DS.space.xs }}>
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, marginBottom: DS.space.xs }}>
                  <Fingerprint size={18} color={DS.color.info} />
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Biometric or Device Verification</Text>
                </View>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, lineHeight: 18 }}>
                  Register your device to approve sensitive actions — withdrawals, P2P escrow release, and security changes — using Face ID, fingerprint, device PIN, or a hardware security key.{'\n\n'}No biometric data is stored. Verification happens locally on your device.
                </Text>
              </View>

              {/* Context-specific WebAuthn status (web only) */}
              {IS_WEB && webAuthnStatus !== 'supported' && (
                <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: `${DS.color.warn}40` }}>
                  <AlertTriangle size={13} color={DS.color.warn} />
                  <Text style={{ flex: 1, color: DS.color.warn, fontSize: DS.font.xxs, lineHeight: 16 }}>
                    {webWarning}
                  </Text>
                </View>
              )}
              {IS_WEB && webAuthnStatus === 'supported' && (
                <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: `${DS.color.buy}30` }}>
                  <CheckCircle size={13} color={DS.color.buy} />
                  <Text style={{ flex: 1, color: DS.color.buy, fontSize: DS.font.xxs, lineHeight: 16 }}>
                    Your browser supports passkeys. Tap Add to register this device.
                  </Text>
                </View>
              )}
              {!IS_WEB && !biometricAvail && (
                <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: `${DS.color.warn}40` }}>
                  <Shield size={13} color={DS.color.warn} />
                  <Text style={{ flex: 1, color: DS.color.warn, fontSize: DS.font.xxs, lineHeight: 16 }}>
                    No biometric authentication is enrolled on this device. Set up Face ID or fingerprint in device Settings to register a passkey.
                  </Text>
                </View>
              )}

              {!!error && (
                <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
                  <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: DS.space.xl, gap: DS.space.md }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: DS.color.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Fingerprint size={28} color={DS.color.text3} />
              </View>
              <Text style={{ color: DS.color.text2, textAlign: 'center' }}>No passkeys registered yet</Text>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, textAlign: 'center' }}>
                {canAdd ? 'Tap Add to register this device' : 'Resolve the issue above to register a passkey'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
              <View style={{ width: 40, height: 40, borderRadius: DS.radius.full, backgroundColor: DS.color.infoBg, alignItems: 'center', justifyContent: 'center' }}>
                <Smartphone size={18} color={DS.color.info} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{item.device_label}</Text>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>{item.platform_type === 'biometric_native' ? 'Native biometric' : 'WebAuthn passkey'}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Added {timeAgo(item.created_at)}{item.last_used_at ? ` · Last used ${timeAgo(item.last_used_at)}` : ''}</Text>
              </View>
              <Pressable
                onPress={() => handleRemove(item.id)}
                disabled={removing === item.id}
                style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.sellBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${DS.color.sell}30` }}
              >
                {removing === item.id ? <ActivityIndicator size={14} color={DS.color.sell} /> : <Trash2 size={15} color={DS.color.sell} />}
              </Pressable>
            </View>
          )}
        />
      )}

      {/* Add passkey modal */}
      <Modal visible={showAdd} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: DS.color.overlay, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: DS.color.card, borderTopLeftRadius: DS.radius.xxl, borderTopRightRadius: DS.radius.xxl, padding: DS.space.lg, gap: DS.space.md }}>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Register This Device</Text>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, lineHeight: 20 }}>
              {'Give this device a name so you can identify it later (e.g. "iPhone" or "Office Laptop").'}
            </Text>

            <TextInput
              value={deviceLabel}
              onChangeText={t => { setDeviceLabel(t); if (addError) setAddError(''); }}
              placeholder="Device name"
              placeholderTextColor={DS.color.text3}
              style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }}
              maxLength={40}
            />

            {!!addError && (
              <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}30` }}>
                <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, lineHeight: 18 }}>{addError}</Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: DS.space.sm }}>
              <Pressable
                onPress={() => { setShowAdd(false); setAddError(''); }}
                style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}
              >
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAdd}
                disabled={adding}
                style={{ flex: 1, backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
              >
                {adding ? <ActivityIndicator color={DS.color.bg} /> : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Fingerprint size={15} color={DS.color.bg} />
                    <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold }}>Verify & Register</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
