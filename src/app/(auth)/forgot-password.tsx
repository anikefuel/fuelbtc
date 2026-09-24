// Forgot Password screen — sends real Supabase password reset email
import { useState } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Mail, ArrowLeft, Zap, CheckCircle } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { XInput } from '@/components/shared/XInput';
import { XButton } from '@/components/shared/XButton';
import { DS } from '@/lib/design';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [sent, setSent]         = useState(false);

  async function handleSend() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError('Please enter your email address'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError('Please enter a valid email address'); return; }

    setError(''); setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'exchangex://reset-password',
    });
    setLoading(false);

    // Always show success (don't reveal whether email exists — security best practice)
    if (err) {
      console.error('[ForgotPassword]', err.message);
      // Only surface non-revealing errors
      if (err.message.toLowerCase().includes('rate limit')) {
        setError('Too many requests. Please wait a few minutes and try again.');
        return;
      }
    }
    setSent(true);
  }

  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, paddingHorizontal: DS.space.lg, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${DS.color.buy}20`, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.lg }}>
          <CheckCircle size={36} color={DS.color.buy} />
        </View>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.xl, fontWeight: DS.font.extrabold, textAlign: 'center', marginBottom: DS.space.sm }}>
          Check Your Email
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 22, marginBottom: DS.space.xl }}>
          If an account with <Text style={{ color: DS.color.gold }}>{email.trim().toLowerCase()}</Text> exists, we sent a password reset link. Check your inbox and spam folder.
        </Text>
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, textAlign: 'center', lineHeight: 18, marginBottom: DS.space.xl }}>
          {"The link expires in 1 hour. If you don't receive it, check the email address or try again."}
        </Text>
        <Pressable onPress={() => router.back()} style={{ borderWidth: 1, borderColor: DS.color.border, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.xl, paddingVertical: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>Back to Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: DS.space.lg, paddingTop: 60, paddingBottom: DS.space.xl }} keyboardShouldPersistTaps="handled">
        {/* Back */}
        <Pressable onPress={() => router.back()} style={{ marginBottom: DS.space.xl, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={18} color={DS.color.text2} />
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Back to Sign In</Text>
        </Pressable>

        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: DS.space.xl }}>
          <View style={{ width: 56, height: 56, borderRadius: DS.radius.xl, backgroundColor: DS.color.goldBg, borderWidth: 1.5, borderColor: `${DS.color.gold}60`, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.md }}>
            <Zap size={26} color={DS.color.gold} fill={DS.color.gold} />
          </View>
          <Text style={{ fontSize: DS.font.xl, fontWeight: DS.font.extrabold, color: DS.color.text1 }}>Reset Password</Text>
          <Text style={{ fontSize: DS.font.sm, color: DS.color.text2, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
            {"Enter the email address linked to your account and we'll send a reset link."}
          </Text>
        </View>

        <View style={{ gap: DS.space.md }}>
          <XInput
            label="Email Address"
            value={email}
            onChangeText={t => { setEmail(t); if (error) setError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="your@email.com"
            leftIcon={<Mail size={17} color={DS.color.text2} />}
          />

          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
            </View>
          )}

          <XButton label="Send Reset Link" onPress={handleSend} loading={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
