// Reset Password screen — handles deep-link token from Supabase email
// The Supabase reset link lands here with the session auto-set by the client.
// On mobile the deep link is exchangex://reset-password which maps here.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import type { RelativePathString } from 'expo-router';
import { Eye, EyeOff, Lock, CheckCircle, AlertTriangle, Zap } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { XInput } from '@/components/shared/XInput';
import { XButton } from '@/components/shared/XButton';
import { DS } from '@/lib/design';

function StrengthBar({ password }: { password: string }) {
  const score = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8)  s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();
  const label = ['', 'Very Weak', 'Weak', 'Fair', 'Good', 'Strong'][score] ?? '';
  const color = ['', '#F6465D', '#F0B90B', '#F0B90B', '#0ECB81', '#0ECB81'][score] ?? DS.color.border;
  return (
    <View style={{ marginTop: -DS.space.xs }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
        {[1,2,3,4,5].map(i => (
          <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= score ? color : DS.color.border }} />
        ))}
      </View>
      {password.length > 0 && <Text style={{ color, fontSize: DS.font.xxs }}>{label}</Text>}
    </View>
  );
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    // Check if we have a valid reset session (set by Supabase from email link)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
    });
  }, []);

  async function handleReset() {
    if (!password) { setError('Please enter a new password'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain at least one uppercase letter and one number'); return;
    }
    if (password !== confirm) { setError('Passwords do not match'); return; }

    setError(''); setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (err) {
      setError(err.message.includes('same password') ? 'New password must differ from your current password' : err.message);
      return;
    }
    // Sign out other sessions after password reset
    await supabase.auth.signOut({ scope: 'others' });
    setDone(true);
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'center', alignItems: 'center', paddingHorizontal: DS.space.lg }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${DS.color.buy}20`, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.lg }}>
          <CheckCircle size={36} color={DS.color.buy} />
        </View>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.xl, fontWeight: DS.font.extrabold, textAlign: 'center', marginBottom: DS.space.sm }}>
          Password Updated
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 22, marginBottom: DS.space.xl }}>
          Your password has been changed successfully. All other sessions have been signed out for your security.
        </Text>
        <XButton label="Sign In with New Password" onPress={() => router.replace('/')} />
      </View>
    );
  }

  if (!hasSession) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'center', alignItems: 'center', paddingHorizontal: DS.space.lg }}>
        <AlertTriangle size={40} color={DS.color.sell} style={{ marginBottom: DS.space.md }} />
        <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold, textAlign: 'center', marginBottom: DS.space.sm }}>
          Link Expired or Invalid
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 22, marginBottom: DS.space.xl }}>
          This password reset link is no longer valid. Reset links expire after 1 hour.
        </Text>
        <Pressable onPress={() => router.replace('/(auth)/forgot-password' as RelativePathString)} style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.xl, paddingVertical: DS.space.sm, borderWidth: 1, borderColor: DS.color.gold }}>
          <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold }}>Request a New Link</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: DS.space.lg, paddingTop: 60, paddingBottom: DS.space.xl }} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: DS.space.xl }}>
          <View style={{ width: 56, height: 56, borderRadius: DS.radius.xl, backgroundColor: DS.color.goldBg, borderWidth: 1.5, borderColor: `${DS.color.gold}60`, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.md }}>
            <Zap size={26} color={DS.color.gold} fill={DS.color.gold} />
          </View>
          <Text style={{ fontSize: DS.font.xl, fontWeight: DS.font.extrabold, color: DS.color.text1 }}>New Password</Text>
          <Text style={{ fontSize: DS.font.sm, color: DS.color.text2, marginTop: 6, textAlign: 'center' }}>
            Create a strong password for your account.
          </Text>
        </View>

        <View style={{ gap: DS.space.md }}>
          <View style={{ gap: 8 }}>
            <XInput
              label="New Password"
              value={password}
              onChangeText={t => { setPassword(t); if (error) setError(''); }}
              secureTextEntry={!showPw}
              placeholder="At least 8 characters"
              leftIcon={<Lock size={17} color={DS.color.text2} />}
              rightIcon={showPw ? <EyeOff size={17} color={DS.color.text2} /> : <Eye size={17} color={DS.color.text2} />}
              onRightIconPress={() => setShowPw(v => !v)}
            />
            <StrengthBar password={password} />
          </View>

          <XInput
            label="Confirm New Password"
            value={confirm}
            onChangeText={t => { setConfirm(t); if (error) setError(''); }}
            secureTextEntry={!showPw}
            placeholder="Repeat your new password"
            leftIcon={<Lock size={17} color={DS.color.text2} />}
          />

          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
            </View>
          )}

          {/* Requirements checklist */}
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.md, padding: DS.space.md, gap: 6 }}>
            {[
              { label: '8+ characters', ok: password.length >= 8 },
              { label: 'One uppercase letter (A–Z)', ok: /[A-Z]/.test(password) },
              { label: 'One number (0–9)', ok: /[0-9]/.test(password) },
              { label: 'Passwords match', ok: !!confirm && password === confirm },
            ].map(({ label, ok }) => (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={13} color={ok ? DS.color.buy : DS.color.text3} />
                <Text style={{ color: ok ? DS.color.text1 : DS.color.text3, fontSize: DS.font.xs }}>{label}</Text>
              </View>
            ))}
          </View>

          <XButton label="Update Password" onPress={handleReset} loading={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
