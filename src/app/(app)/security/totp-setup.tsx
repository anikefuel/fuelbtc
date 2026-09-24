// TOTP Setup screen — uses Supabase MFA API
// Status is read from mfa.listFactors() (source of truth), NOT from profiles.two_fa_enabled.
// Flow: status → enroll (unenroll all existing first) → QR → verify → backup codes → done
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Smartphone, Copy, CheckCircle, AlertTriangle, Shield } from 'lucide-react-native';
import { Image } from 'expo-image';
import { DS } from '@/lib/design';
import {
  enrollTOTP, verifyAndEnableTOTP, unenrollTOTP,
  generateBackupCodes, getVerifiedTOTPFactor, listMFAFactors,
} from '@/services/auth.service';

type Step = 'status' | 'enroll' | 'verify' | 'backup' | 'disable-confirm';

export default function TOTPSetupScreen() {
  const router = useRouter();
  const [step, setStep]           = useState<Step>('status');
  const [loading, setLoading]     = useState(true);
  const [actionLoading, setAL]    = useState(false);
  const [error, setError]         = useState('');

  const [twoFaOn, setTwoFaOn]     = useState(false);
  const [factorId, setFactorId]   = useState('');
  const [qrCode, setQrCode]       = useState('');
  const [secret, setSecret]       = useState('');
  const [code, setCode]           = useState('');
  const [backupCodes, setBC]      = useState<string[]>([]);
  const [copyDone, setCopyDone]   = useState(false);
  const [backupRetry, setBackupRetry] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        // Always read TOTP status from the MFA API — profiles.two_fa_enabled can be stale
        const verified = await getVerifiedTOTPFactor();
        if (active) {
          if (verified) {
            setTwoFaOn(true);
            setFactorId(verified.id);
          } else {
            setTwoFaOn(false);
            setFactorId('');
          }
        }
      } catch {
        // non-critical; leave defaults
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  async function startEnroll() {
    setAL(true); setError('');
    try {
      // enrollTOTP() already unenrolls all existing factors before re-enrolling
      const res = await enrollTOTP();
      setQrCode(res.qr_code);
      setSecret(res.secret);
      setFactorId(res.factor_id);
      setStep('enroll');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start enrollment. Please try again.');
    } finally {
      setAL(false);
    }
  }

  async function handleVerify() {
    if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setAL(true); setError('');
    try {
      // Step 1: challenge + verify (elevates session to AAL2)
      await verifyAndEnableTOTP(factorId, code);

      // Step 2: generate backup codes — only reached if verification succeeded
      setBackupRetry(false);
      try {
        const codes = await generateBackupCodes();
        setBC(codes);
      } catch (backupErr: unknown) {
        // Verification succeeded but backup-code creation failed — show recoverable error
        setBackupRetry(true);
        setBC([]);
        setError(
          backupErr instanceof Error
            ? backupErr.message
            : 'We could not save your recovery codes. Please use the Retry button below.'
        );
      }

      setTwoFaOn(true);
      setStep('backup');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid code. Please try again.');
      setCode('');
    } finally {
      setAL(false);
    }
  }

  async function retryBackupCodes() {
    setAL(true); setError('');
    try {
      const codes = await generateBackupCodes();
      setBC(codes);
      setBackupRetry(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'We could not save your recovery codes. Please retry.');
    } finally {
      setAL(false);
    }
  }

  async function handleDisable() {
    if (code.length !== 6) { setError('Enter the 6-digit code to confirm disable.'); return; }
    setAL(true); setError('');
    try {
      const fid = factorId || (await getVerifiedTOTPFactor())?.id;
      if (!fid) throw new Error('No active 2FA factor found.');
      await unenrollTOTP(fid);
      setTwoFaOn(false);
      setFactorId('');
      setStep('status');
      setCode('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to disable 2FA. Please try again.');
      setCode('');
    } finally {
      setAL(false);
    }
  }

  async function handleRegenerateBackup() {
    setAL(true); setError('');
    try {
      const codes = await generateBackupCodes();
      setBC(codes);
      setBackupRetry(false);
      setStep('backup');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'We could not save your recovery codes. Please retry.');
    } finally {
      setAL(false);
    }
  }

  function copyBackup() {
    if (process.env.EXPO_OS !== 'web') {
      import('expo-clipboard').then(Clipboard => {
        Clipboard.setStringAsync(backupCodes.join('\n')).catch(() => {});
      }).catch(() => {});
    }
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  }

  // ── Status screen ────────────────────────────────────────────────────
  if (loading) return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={DS.color.gold} />
    </View>
  );

  if (step === 'status') {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Two-Factor Authentication</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: DS.space.lg, gap: DS.space.md }}>
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.lg, alignItems: 'center', gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: twoFaOn ? DS.color.buyBg : DS.color.warnBg, alignItems: 'center', justifyContent: 'center' }}>
              <Smartphone size={28} color={twoFaOn ? DS.color.buy : DS.color.warn} />
            </View>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, textAlign: 'center' }}>
              {twoFaOn ? '2FA is Enabled' : '2FA is Disabled'}
            </Text>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
              {twoFaOn
                ? 'Your account is protected with a TOTP authenticator app.'
                : 'Add an extra layer of security by linking an authenticator app.'}
            </Text>
          </View>

          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
            </View>
          )}

          {!twoFaOn ? (
            <Pressable
              onPress={startEnroll}
              disabled={actionLoading}
              style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
            >
              {actionLoading ? <ActivityIndicator color={DS.color.bg} /> : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Set Up Authenticator</Text>}
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => { setCode(''); setError(''); setStep('disable-confirm'); }}
                style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center', borderWidth: 1, borderColor: `${DS.color.sell}40` }}
              >
                <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Disable 2FA</Text>
              </Pressable>
              <Pressable
                onPress={handleRegenerateBackup}
                disabled={actionLoading}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}
              >
                {actionLoading ? <ActivityIndicator color={DS.color.gold} /> : <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.base }}>Regenerate Backup Codes</Text>}
              </Pressable>
            </>
          )}

          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: 4 }}>SUPPORTED APPS</Text>
            {['Google Authenticator', 'Authy', 'Microsoft Authenticator', '1Password', 'Apple Passwords'].map(app => (
              <View key={app} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={12} color={DS.color.buy} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{app}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── QR Code / Enroll step ────────────────────────────────────────────
  if (step === 'enroll') {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Pressable onPress={() => setStep('status')} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Scan QR Code</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: DS.space.lg, gap: DS.space.md, alignItems: 'center' }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
            Open your authenticator app and scan the QR code below, or enter the key manually.
          </Text>

          {/* QR Code */}
          <View style={{ backgroundColor: '#fff', borderRadius: DS.radius.lg, padding: DS.space.sm }}>
            <Image source={{ uri: qrCode }} style={{ width: 200, height: 200 }} contentFit="contain" />
          </View>

          {/* Manual key */}
          <View style={{ width: '100%', backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.5 }}>MANUAL SETUP KEY</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
              <Text selectable style={{ flex: 1, color: DS.color.gold, fontWeight: DS.font.bold, fontSize: DS.font.sm, letterSpacing: 2 }}>{secret}</Text>
              <Pressable onPress={() => {}}>
                <Copy size={15} color={DS.color.text2} />
              </Pressable>
            </View>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Time-based OTP (TOTP) · SHA1 · 30 seconds</Text>
          </View>

          <Pressable
            onPress={() => { setCode(''); setError(''); setStep('verify'); }}
            style={{ width: '100%', backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
          >
            <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>{"I've Scanned the QR Code"}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Verify first code ────────────────────────────────────────────────
  if (step === 'verify') {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Pressable onPress={() => setStep('enroll')} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Verify Code</Text>
        </View>
        <View style={{ flex: 1, padding: DS.space.lg, gap: DS.space.md }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 20 }}>
            Enter the 6-digit code from your authenticator app to confirm setup.
          </Text>

          <View style={{ alignItems: 'center' }}>
            <TextInput
              value={code}
              onChangeText={t => { setCode(t.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={DS.color.text3}
              style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, fontSize: 32, fontWeight: DS.font.bold, letterSpacing: 12, textAlign: 'center', padding: DS.space.md, width: 220 }}
            />
          </View>

          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, textAlign: 'center' }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleVerify}
            disabled={actionLoading || code.length < 6}
            style={{ backgroundColor: code.length === 6 ? DS.color.gold : DS.color.border, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
          >
            {actionLoading ? <ActivityIndicator color={DS.color.bg} /> : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Enable 2FA</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Backup codes display ─────────────────────────────────────────────
  if (step === 'backup') {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Save Backup Codes</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: DS.space.lg, gap: DS.space.md }}>
          {/* Backup-code generation failed — show recoverable error + retry */}
          {backupRetry && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.md, borderWidth: 1, borderColor: `${DS.color.sell}40`, gap: DS.space.sm }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={15} color={DS.color.sell} />
                <Text style={{ flex: 1, color: DS.color.sell, fontSize: DS.font.xs, lineHeight: 18 }}>
                  {error || 'We could not save your recovery codes. Tap Retry to try again.'}
                </Text>
              </View>
              <Pressable
                onPress={retryBackupCodes}
                disabled={actionLoading}
                style={{ backgroundColor: DS.color.sell, borderRadius: DS.radius.sm, padding: DS.space.sm, alignItems: 'center' }}
              >
                {actionLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Retry</Text>}
              </Pressable>
            </View>
          )}

          {!backupRetry && (
            <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: `${DS.color.warn}40` }}>
              <AlertTriangle size={14} color={DS.color.warn} />
              <Text style={{ flex: 1, color: DS.color.warn, fontSize: DS.font.xs, lineHeight: 18 }}>
                These codes are shown only once. Store them securely. Each code can be used once to access your account if you lose your authenticator.
              </Text>
            </View>
          )}

          {backupCodes.length > 0 && (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.lg, gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: DS.space.sm, justifyContent: 'center' }}>
                {backupCodes.map((c, i) => (
                  <View key={i} style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.md, paddingVertical: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                    <Text selectable style={{ color: DS.color.gold, fontWeight: DS.font.bold, fontSize: DS.font.sm, letterSpacing: 2 }}>{c}</Text>
                  </View>
                ))}
              </View>
              <Pressable
                onPress={copyBackup}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: DS.space.xs }}
              >
                {copyDone ? <CheckCircle size={15} color={DS.color.buy} /> : <Copy size={15} color={DS.color.text2} />}
                <Text style={{ color: copyDone ? DS.color.buy : DS.color.text2, fontSize: DS.font.sm }}>{copyDone ? 'Copied!' : 'Copy all codes'}</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            onPress={() => { setStep('status'); router.back(); }}
            disabled={backupRetry}
            style={{ backgroundColor: backupRetry ? DS.color.border : DS.color.gold, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
          >
            <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>
              {backupRetry ? 'Save codes first to continue' : "I've Saved My Codes — Done"}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Disable confirm ──────────────────────────────────────────────────
  if (step === 'disable-confirm') {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Pressable onPress={() => setStep('status')} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ArrowLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Disable 2FA</Text>
        </View>
        <View style={{ flex: 1, padding: DS.space.lg, gap: DS.space.md }}>
          <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.lg, padding: DS.space.md, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
            <Shield size={16} color={DS.color.sell} />
            <Text style={{ flex: 1, color: DS.color.sell, fontSize: DS.font.xs, lineHeight: 18 }}>
              Disabling 2FA reduces your account security. Enter your authenticator code to confirm.
            </Text>
          </View>

          <View style={{ alignItems: 'center' }}>
            <TextInput
              value={code}
              onChangeText={t => { setCode(t.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={DS.color.text3}
              style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, fontSize: 32, fontWeight: DS.font.bold, letterSpacing: 12, textAlign: 'center', padding: DS.space.md, width: 220 }}
            />
          </View>

          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, textAlign: 'center' }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleDisable}
            disabled={actionLoading || code.length < 6}
            style={{ backgroundColor: code.length === 6 ? DS.color.sell : DS.color.border, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
          >
            {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.base }}>Confirm Disable 2FA</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return null;
}
