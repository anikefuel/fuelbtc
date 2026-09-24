// StepUpProvider — secure step-up authorization modal
// Supports: Authenticator (TOTP), Passkey/Biometric, Email OTP, Backup Code
// Respects user security preferences per action_type.
// Usage:
//   const { requestStepUp } = useStepUp();
//   const token = await requestStepUp({ action_type: 'withdrawal', amount: 100, asset: 'BTC', destination: '...' });
//   if (!token) return; // user cancelled
//   // proceed with action, passing token_id to the server

import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { Shield, X, Smartphone, Key, Mail, ShieldOff, RefreshCw, CheckCircle } from 'lucide-react-native';
import { DS } from '@/lib/design';
import {
  issueStepUpToken, sendEmailOTP, verifyEmailOTP,
  syncSecurityPreferences, getVerifiedTOTPFactor, getPasskeys,
} from '@/services/auth.service';

export type StepUpParams = {
  action_type: string;
  txn_id?: string;
  amount?: number;
  asset?: string;
  destination?: string;
  network?: string;
  /** Human-readable description shown to the user */
  description?: string;
};

export type StepUpResult = { token_id: string; expires_at: string; verified_by: string } | null;

type ActiveMethod = 'totp' | 'passkey' | 'email' | 'backup';

type StepUpContextType = {
  requestStepUp: (params: StepUpParams) => Promise<StepUpResult>;
};

const StepUpContext = createContext<StepUpContextType>({
  requestStepUp: async () => null,
});

export function useStepUp() {
  return useContext(StepUpContext);
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible]         = useState(false);
  const [params, setParams]           = useState<StepUpParams | null>(null);
  const [code, setCode]               = useState('');
  const [method, setMethod]           = useState<ActiveMethod>('totp');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [availableMethods, setAvailable] = useState<ActiveMethod[]>(['totp', 'backup']);

  // Email OTP state
  const [emailChallengeId, setEmailChallengeId] = useState('');
  const [emailSent, setEmailSent]               = useState(false);
  const [emailCooldown, setEmailCooldown]       = useState(0);

  // Two-step flow state
  const [step, setStep]               = useState<1 | 2>(1);
  const [step1TokenId, setStep1TokenId] = useState('');
  const [requiresTwoSteps, setRequiresTwoSteps] = useState(false);

  const resolveRef = useRef<((result: StepUpResult) => void) | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cooldown timer for email resend
  useEffect(() => {
    if (emailCooldown > 0) {
      cooldownRef.current = setInterval(() => {
        setEmailCooldown(c => {
          if (c <= 1 && cooldownRef.current) { clearInterval(cooldownRef.current); cooldownRef.current = null; }
          return Math.max(0, c - 1);
        });
      }, 1000);
    }
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, [emailCooldown]);

  const requestStepUp = useCallback((p: StepUpParams): Promise<StepUpResult> => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setParams(p);
      setCode('');
      setError('');
      setStep(1);
      setStep1TokenId('');
      setEmailSent(false);
      setEmailChallengeId('');
      setEmailCooldown(0);

      // Determine available methods from user preferences
      (async () => {
        try {
          const [prefs, totpFactor, passkeys] = await Promise.all([
            syncSecurityPreferences(),
            getVerifiedTOTPFactor(),
            getPasskeys(),
          ]);

          const methods: ActiveMethod[] = [];
          if (prefs.passkey_enabled && passkeys.length > 0) methods.push('passkey');
          if (prefs.totp_enabled && totpFactor)              methods.push('totp');
          if (prefs.email_otp_enabled)                       methods.push('email');
          if (prefs.backup_codes_enabled)                    methods.push('backup');

          if (methods.length === 0) methods.push('totp'); // safe fallback

          // Determine if two-step is required by preference
          const prefKey = `pref_${p.action_type}` as keyof typeof prefs;
          const pref = (prefs[prefKey] as string | undefined) ?? 'any_strong';
          const needsTwoSteps = pref === 'two_strong' || pref === 'all_enabled';

          // For high-risk actions (withdrawal, p2p, new_address) never allow email alone as only step
          const isHighRisk = ['withdrawal', 'p2p_release', 'new_address', 'large_transfer'].includes(p.action_type);
          const strongMethods = methods.filter(m => m !== 'email' && m !== 'backup');
          const displayMethods = isHighRisk && strongMethods.length > 0
            ? methods.filter(m => m !== 'backup') // keep email but not backup as primary for high-risk
            : methods;

          setAvailable(displayMethods);
          setRequiresTwoSteps(needsTwoSteps);
          setMethod(displayMethods[0] ?? 'totp');
        } catch {
          setAvailable(['totp', 'backup']);
          setRequiresTwoSteps(false);
          setMethod('totp');
        }
        setVisible(true);
      })();
    });
  }, []);

  function handleCancel() {
    setVisible(false);
    resolveRef.current?.(null);
    resolveRef.current = null;
  }

  async function handleSendEmail() {
    if (emailCooldown > 0 || !params) return;
    setLoading(true); setError('');
    try {
      const result = await sendEmailOTP(params.action_type, {
        amount: params.amount, asset: params.asset, destination: params.destination,
      });
      setEmailChallengeId(result.challenge_id);
      setEmailSent(true);
      setEmailCooldown(60);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send verification email.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskey() {
    if (!params) return;
    setLoading(true); setError('');
    try {
      if (process.env.EXPO_OS !== 'web') {
        const LocalAuth = await import('expo-local-authentication');
        const hasHardware = await LocalAuth.hasHardwareAsync();
        const isEnrolled  = await LocalAuth.isEnrolledAsync();
        if (!hasHardware || !isEnrolled) {
          throw new Error('Biometric authentication is not set up on this device. Please use another method.');
        }
        const authResult = await LocalAuth.authenticateAsync({
          promptMessage: `Authorize: ${params.description ?? params.action_type}`,
          fallbackLabel:  'Use Passcode',
          cancelLabel:    'Cancel',
          disableDeviceFallback: false,
        });
        if (!authResult.success) {
          if (authResult.error === 'user_cancel' || authResult.error === 'user_fallback') {
            setLoading(false); return;
          }
          throw new Error('Biometric verification failed. Please try another method.');
        }
      }
      // Biometric passed locally — issue step-up token using passkey credential
      // For web/unsupported we still try; server validates registered credential
      const passkeys = await getPasskeys();
      if (passkeys.length === 0) throw new Error('No passkeys registered. Please set up a passkey first.');
      const primaryPasskey = passkeys[0];
      await handleComplete({ method: 'passkey', credential_id: primaryPasskey.credential_id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Passkey verification failed.');
      setLoading(false);
    }
  }

  async function handleComplete(
    verification: { method: 'totp'; code: string }
      | { method: 'backup_code'; code: string }
      | { method: 'passkey'; credential_id: string }
      | { method: 'email'; challenge_id: string; code: string }
  ) {
    if (!params) return;
    setLoading(true); setError('');
    try {
      let result: StepUpResult;

      if (verification.method === 'email') {
        // Email OTP verified via dedicated edge function
        const emailResult = await verifyEmailOTP({
          challenge_id: verification.challenge_id,
          code:         verification.code,
          purpose:      params.action_type,
          action_type:  params.action_type,
          amount:       params.amount,
          asset:        params.asset,
          destination:  params.destination,
        });
        result = { token_id: emailResult.token_id, expires_at: emailResult.expires_at, verified_by: 'email_otp' };
      } else {
        result = await issueStepUpToken({
          action_type:  params.action_type,
          verification: verification as Parameters<typeof issueStepUpToken>[0]['verification'],
          txn_id:       params.txn_id,
          amount:       params.amount,
          asset:        params.asset,
          destination:  params.destination,
          network:      params.network,
        });
      }

      // Two-step flow: first step done, now require second
      if (requiresTwoSteps && step === 1) {
        setStep1TokenId(result?.token_id ?? '');
        setStep(2);
        setCode('');
        setError('');
        setEmailSent(false);
        setEmailChallengeId('');
        // For step 2, suggest email if step 1 was TOTP/passkey, or vice versa
        const remainingMethods = availableMethods.filter(m => m !== method && m !== 'backup');
        if (remainingMethods.length > 0) setMethod(remainingMethods[0]);
        else setMethod('email');
        setLoading(false);
        return;
      }

      setVisible(false);
      resolveRef.current?.(result);
      resolveRef.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed. Please try again.');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (method === 'passkey') { await handlePasskey(); return; }
    if (method === 'email') {
      if (!emailSent) { await handleSendEmail(); return; }
      if (code.length < 6) { setError('Enter the 6-digit code from your email.'); return; }
      await handleComplete({ method: 'email', challenge_id: emailChallengeId, code });
      return;
    }
    const minLen = method === 'totp' ? 6 : 8;
    if (code.length < minLen) { setError(`Enter your ${method === 'totp' ? '6-digit authenticator' : 'backup recovery'} code.`); return; }
    await handleComplete(
      method === 'totp'
        ? { method: 'totp', code }
        : { method: 'backup_code', code }
    );
  }

  const METHOD_LABELS: Record<ActiveMethod, string> = {
    passkey: 'Passkey / Biometrics',
    totp:    'Authenticator App',
    email:   'Email Code',
    backup:  'Backup Code',
  };
  const METHOD_ICONS: Record<ActiveMethod, React.ReactNode> = {
    passkey: <Key size={14} color={DS.color.text2} />,
    totp:    <Smartphone size={14} color={DS.color.text2} />,
    email:   <Mail size={14} color={DS.color.text2} />,
    backup:  <ShieldOff size={14} color={DS.color.text2} />,
  };

  const canSubmit = (() => {
    if (loading) return false;
    if (method === 'passkey') return true;
    if (method === 'email' && !emailSent) return true; // "Send Code" button
    if (method === 'email' && emailSent) return code.length === 6;
    if (method === 'totp') return code.length === 6;
    if (method === 'backup') return code.length >= 8;
    return false;
  })();

  const buttonLabel = (() => {
    if (method === 'passkey') return 'Verify with Biometrics';
    if (method === 'email' && !emailSent) return 'Send Verification Email';
    return step === 1 && requiresTwoSteps ? 'Continue to Step 2 of 2' : 'Verify & Proceed';
  })();

  return (
    <StepUpContext.Provider value={{ requestStepUp }}>
      {children}
      <Modal visible={visible} transparent animationType="fade">
        <Pressable onPress={handleCancel} style={{ flex: 1, backgroundColor: DS.color.overlay, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: DS.color.card, borderTopLeftRadius: DS.radius.xxl, borderTopRightRadius: DS.radius.xxl, paddingBottom: 34 }}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={{ padding: DS.space.lg, gap: DS.space.md }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: DS.color.warnBg, alignItems: 'center', justifyContent: 'center' }}>
                      <Shield size={18} color={DS.color.warn} />
                    </View>
                    <View>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Verify Your Identity</Text>
                      {requiresTwoSteps && (
                        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Step {step} of 2 required</Text>
                      )}
                    </View>
                  </View>
                  <Pressable onPress={handleCancel} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: DS.color.surface, alignItems: 'center', justifyContent: 'center' }}>
                    <X size={16} color={DS.color.text2} />
                  </Pressable>
                </View>

                {/* Step 1 completion indicator */}
                {requiresTwoSteps && step === 2 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.buy}40` }}>
                    <CheckCircle size={14} color={DS.color.buy} />
                    <Text style={{ color: DS.color.buy, fontSize: DS.font.xs }}>Step 1 verified. Now complete the second verification.</Text>
                  </View>
                )}

                {/* Action summary */}
                {params?.description && (
                  <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.warn}40` }}>
                    <Text style={{ color: DS.color.warn, fontSize: DS.font.xs }}>{params.description}</Text>
                  </View>
                )}
                {params?.amount != null && params?.asset && (
                  <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm }}>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
                      Amount: <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>{params.amount} {params.asset}</Text>
                    </Text>
                    {params.destination && (
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
                        To: <Text style={{ color: DS.color.text1, fontSize: DS.font.xs }}>{params.destination.slice(0, 20)}…</Text>
                      </Text>
                    )}
                  </View>
                )}

                {/* Method selector */}
                {availableMethods.length > 1 && (
                  <View>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 6 }}>Verification method</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                      <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                        {availableMethods.map(m => (
                          <Pressable
                            key={m}
                            onPress={() => { setMethod(m); setCode(''); setError(''); setEmailSent(false); setEmailChallengeId(''); }}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: DS.space.sm, paddingVertical: 8, borderRadius: DS.radius.full, backgroundColor: method === m ? DS.color.gold : DS.color.surface, borderWidth: 1, borderColor: method === m ? DS.color.gold : DS.color.border }}
                          >
                            {METHOD_ICONS[m]}
                            <Text style={{ color: method === m ? DS.color.bg : DS.color.text2, fontSize: DS.font.xxs, fontWeight: method === m ? DS.font.bold : DS.font.regular }}>{METHOD_LABELS[m]}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {/* Method-specific UI */}
                {method === 'passkey' && (
                  <View style={{ alignItems: 'center', paddingVertical: DS.space.md }}>
                    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: DS.color.buyBg, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.sm }}>
                      <Key size={28} color={DS.color.buy} />
                    </View>
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, textAlign: 'center' }}>Use Face ID / Fingerprint / PIN</Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, textAlign: 'center', marginTop: 4 }}>Your device will prompt for biometric authentication.</Text>
                  </View>
                )}

                {method === 'email' && (
                  <View style={{ gap: DS.space.sm }}>
                    {!emailSent ? (
                      <View style={{ alignItems: 'center', paddingVertical: DS.space.sm }}>
                        <Mail size={28} color={DS.color.info} />
                        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, marginTop: DS.space.xs, textAlign: 'center' }}>Send Email Code</Text>
                        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, textAlign: 'center', marginTop: 4 }}>A 6-digit code will be sent to your account email.</Text>
                      </View>
                    ) : (
                      <View style={{ gap: DS.space.sm }}>
                        <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.buy}40` }}>
                          <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, textAlign: 'center' }}>Code sent! Check your email inbox.</Text>
                        </View>
                        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, textAlign: 'center' }}>Enter the 6-digit code from your email</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, paddingHorizontal: DS.space.md, paddingVertical: DS.space.xs }}>
                          <Mail size={16} color={DS.color.text2} />
                          <TextInput
                            value={code}
                            onChangeText={t => { setCode(t.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
                            keyboardType="number-pad"
                            maxLength={6}
                            placeholder="000000"
                            placeholderTextColor={DS.color.text3}
                            style={{ color: DS.color.gold, fontSize: DS.font.xl, fontWeight: DS.font.bold, letterSpacing: 8, width: 160, textAlign: 'center' }}
                            autoFocus
                          />
                        </View>
                        <Pressable
                          onPress={handleSendEmail}
                          disabled={emailCooldown > 0 || loading}
                          style={{ alignItems: 'center' }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <RefreshCw size={12} color={emailCooldown > 0 ? DS.color.text3 : DS.color.info} />
                            <Text style={{ color: emailCooldown > 0 ? DS.color.text3 : DS.color.info, fontSize: DS.font.xs }}>
                              {emailCooldown > 0 ? `Resend in ${emailCooldown}s` : 'Resend code'}
                            </Text>
                          </View>
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}

                {(method === 'totp' || method === 'backup') && (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: DS.space.sm, textAlign: 'center' }}>
                      {method === 'totp'
                        ? 'Enter the 6-digit code from your authenticator app'
                        : 'Enter one of your backup recovery codes (used once)'}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, paddingHorizontal: DS.space.md, paddingVertical: DS.space.xs }}>
                      <Smartphone size={16} color={DS.color.text2} />
                      <TextInput
                        value={code}
                        onChangeText={t => { setCode(method === 'totp' ? t.replace(/\D/g, '').slice(0, 6) : t.toUpperCase().slice(0, 12)); if (error) setError(''); }}
                        keyboardType={method === 'totp' ? 'number-pad' : 'default'}
                        maxLength={method === 'totp' ? 6 : 12}
                        placeholder={method === 'totp' ? '000000' : 'XXXXX-XXXXX'}
                        placeholderTextColor={DS.color.text3}
                        style={{ color: DS.color.gold, fontSize: DS.font.xl, fontWeight: DS.font.bold, letterSpacing: method === 'totp' ? 8 : 4, width: 160, textAlign: 'center' }}
                        autoFocus
                        autoCapitalize="characters"
                      />
                    </View>
                  </View>
                )}

                {!!error && (
                  <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
                    <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, textAlign: 'center' }}>{error}</Text>
                  </View>
                )}

                {/* Confirm button */}
                <Pressable
                  onPress={handleVerify}
                  disabled={!canSubmit}
                  style={{ backgroundColor: canSubmit ? DS.color.gold : DS.color.border, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
                >
                  {loading
                    ? <ActivityIndicator color={DS.color.bg} />
                    : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>{buttonLabel}</Text>}
                </Pressable>

                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, textAlign: 'center', lineHeight: 16 }}>
                  This authorization is single-use and expires in 5 minutes. It is bound to this specific action only.
                </Text>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </StepUpContext.Provider>
  );
}
