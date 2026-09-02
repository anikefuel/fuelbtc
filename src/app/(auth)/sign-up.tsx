import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { CheckCircle, Eye, EyeOff, Lock, Mail, UserCheck, Zap } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { XInput } from '@/components/shared/XInput';
import { XButton } from '@/components/shared/XButton';
import { DS } from '@/lib/design';

function passwordScore(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

function StrengthBar({ password }: { password: string }) {
  const score = passwordScore(password);
  const labels = ['', 'Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', '#F6465D', '#F0B90B', '#F0B90B', '#0ECB81', '#0ECB81'];
  const color = colors[score] ?? DS.color.border;
  return (
    <View style={{ marginTop: -DS.space.xs }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
        {[1,2,3,4,5].map(i => (
          <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= score ? color : DS.color.border }} />
        ))}
      </View>
      {password.length > 0 && (
        <Text style={{ color, fontSize: DS.font.xxs }}>{labels[score]}</Text>
      )}
    </View>
  );
}

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [referral, setReferral] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [agreed, setAgreed]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState(false);

  async function handleSignUp() {
    const emailTrimmed = email.trim().toLowerCase();
    if (!emailTrimmed || !password || !confirm) { setError('Please fill in all required fields'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setError('Please enter a valid email address'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(password)) { setError('Password must include at least one uppercase letter'); return; }
    if (!/[0-9]/.test(password)) { setError('Password must include at least one number'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (!agreed) { setError('Please accept the Terms of Service and Privacy Policy'); return; }

    setError(''); setLoading(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: emailTrimmed,
      password,
      options: { data: { referral_code: referral.trim().toUpperCase() || undefined } },
    });
    setLoading(false);

    if (err) {
      if (err.message.toLowerCase().includes('already registered') || err.message.toLowerCase().includes('already exists')) {
        setError('An account with this email already exists. Please sign in instead.');
      } else if (err.message.toLowerCase().includes('password')) {
        setError('Password is too weak. Use at least 8 characters with uppercase, lowercase and numbers.');
      } else {
        setError(err.message);
      }
      return;
    }

    // If email confirmation is required, identities will be empty
    if (data.user && !data.session) {
      setSuccess(true);
    } else {
      router.replace('/');
    }
  }

  if (success) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'center', alignItems: 'center', paddingHorizontal: DS.space.lg }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${DS.color.buy}20`, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.lg }}>
          <CheckCircle size={36} color={DS.color.buy} />
        </View>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.xl, fontWeight: DS.font.extrabold, textAlign: 'center', marginBottom: DS.space.sm }}>
          Check Your Email
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 22, marginBottom: DS.space.xl }}>
          We sent a verification link to{'\n'}
          <Text style={{ color: DS.color.gold }}>{email.trim().toLowerCase()}</Text>
          {'\n\n'}{"Click the link in the email to activate your account. Check your spam folder if you don't see it."}
        </Text>
        <Pressable onPress={() => router.replace('/(auth)/sign-in')} style={{ borderWidth: 1, borderColor: DS.color.border, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.xl, paddingVertical: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>Back to Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: DS.space.lg, paddingVertical: DS.space.xxxl }} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: DS.space.xl }}>
          <View style={{ width: 68, height: 68, borderRadius: DS.radius.xl, backgroundColor: DS.color.goldBg, borderWidth: 1.5, borderColor: DS.color.gold + '60', alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.md }}>
            <Zap size={32} color={DS.color.gold} fill={DS.color.gold} />
          </View>
          <Text style={{ fontSize: DS.font.xl, fontWeight: DS.font.extrabold, color: DS.color.text1, letterSpacing: 0.5 }}>
            Create Account
          </Text>
          <Text style={{ fontSize: DS.font.sm, color: DS.color.text2, marginTop: 6 }}>
            Join ExchangeX today — trade smarter
          </Text>
        </View>

        {/* Form */}
        <View style={{ gap: DS.space.md }}>
          <XInput
            label="Email Address"
            value={email}
            onChangeText={t => { setEmail(t); if (error) setError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="Enter your email"
            leftIcon={<Mail size={17} color={DS.color.text2} />}
          />
          <View style={{ gap: 8 }}>
            <XInput
              label="Password"
              value={password}
              onChangeText={t => { setPassword(t); if (error) setError(''); }}
              secureTextEntry={!showPw}
              placeholder="Minimum 8 characters"
              leftIcon={<Lock size={17} color={DS.color.text2} />}
              rightIcon={showPw ? <EyeOff size={17} color={DS.color.text2} /> : <Eye size={17} color={DS.color.text2} />}
              onRightIconPress={() => setShowPw(v => !v)}
            />
            <StrengthBar password={password} />
          </View>
          <XInput
            label="Confirm Password"
            value={confirm}
            onChangeText={t => { setConfirm(t); if (error) setError(''); }}
            secureTextEntry
            placeholder="Re-enter your password"
            leftIcon={<Lock size={17} color={DS.color.text2} />}
          />
          <XInput
            label="Referral Code (Optional)"
            value={referral}
            onChangeText={setReferral}
            autoCapitalize="characters"
            placeholder="Enter referral code"
            leftIcon={<UserCheck size={17} color={DS.color.text2} />}
          />

          {/* Terms */}
          <Pressable onPress={() => setAgreed(v => !v)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: DS.space.sm }}>
            <View style={{ width: 20, height: 20, borderRadius: DS.radius.xs, borderWidth: 1.5, borderColor: agreed ? DS.color.gold : DS.color.border2, backgroundColor: agreed ? DS.color.gold : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              {agreed && <Text style={{ color: DS.color.bg, fontSize: 12, fontWeight: DS.font.extrabold }}>✓</Text>}
            </View>
            <Text style={{ flex: 1, color: DS.color.text2, fontSize: DS.font.xs, lineHeight: 18 }}>
              I agree to the{' '}
              <Text style={{ color: DS.color.gold }}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={{ color: DS.color.gold }}>Privacy Policy</Text>
            </Text>
          </Pressable>

          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
            </View>
          )}

          <XButton label="Create Account" onPress={handleSignUp} loading={loading} fullWidth />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: DS.space.xl, gap: 4 }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Already have an account?</Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable onPress={() => {}}><Text style={{ color: DS.color.gold, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>Sign In</Text></Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
