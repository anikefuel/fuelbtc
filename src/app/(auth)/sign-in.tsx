import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import type { RelativePathString } from 'expo-router';
import { Eye, EyeOff, Lock, Mail, Zap } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { XInput } from '@/components/shared/XInput';
import { XButton } from '@/components/shared/XButton';
import { DS } from '@/lib/design';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSignIn() {
    if (!email || !password) { setError('Please fill in all fields'); return; }
    setError(''); setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (err) {
      if (err.message.includes('Invalid login credentials')) {
        setError('Incorrect email or password. Please try again.');
      } else if (err.message.includes('Email not confirmed')) {
        setError('Please verify your email address before signing in.');
      } else if (err.message.includes('Too many')) {
        setError('Too many login attempts. Please wait a few minutes.');
      } else {
        setError(err.message);
      }
      return;
    }
    router.replace('/');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: DS.space.lg, paddingVertical: DS.space.xxxl }} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: DS.space.xl }}>
          <View style={{
            width: 68, height: 68, borderRadius: DS.radius.xl,
            backgroundColor: DS.color.goldBg,
            borderWidth: 1.5, borderColor: DS.color.gold + '60',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: DS.space.md,
          }}>
            <Zap size={32} color={DS.color.gold} fill={DS.color.gold} />
          </View>
          <Text style={{ fontSize: DS.font.xxl, fontWeight: DS.font.extrabold, color: DS.color.text1, letterSpacing: 0.5 }}>
            ExchangeX
          </Text>
          <Text style={{ fontSize: DS.font.sm, color: DS.color.text2, marginTop: 6 }}>
            Sign in to your account
          </Text>
        </View>

        {/* Form */}
        <View style={{ gap: DS.space.md }}>
          <XInput
            label="Email Address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="Enter your email"
            leftIcon={<Mail size={17} color={DS.color.text2} />}
          />
          <XInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            placeholder="Enter your password"
            leftIcon={<Lock size={17} color={DS.color.text2} />}
            rightIcon={showPw ? <EyeOff size={17} color={DS.color.text2} /> : <Eye size={17} color={DS.color.text2} />}
            onRightIconPress={() => setShowPw(v => !v)}
          />

          {/* Forgot password */}
          <Pressable onPress={() => router.push('/(auth)/forgot-password' as RelativePathString)} style={{ alignSelf: 'flex-end' }}>
            <Text style={{ color: DS.color.gold, fontSize: DS.font.xs, fontWeight: DS.font.medium }}>
              Forgot Password?
            </Text>
          </Pressable>

          {error ? (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
            </View>
          ) : null}

          <XButton label="Sign In" onPress={handleSignIn} loading={loading} fullWidth />

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, marginVertical: DS.space.xs }}>
            <View style={{ flex: 1, height: 1, backgroundColor: DS.color.border }} />
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>OR</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: DS.color.border }} />
          </View>

          <XButton label="Continue with Google (Coming Soon)" onPress={() => {}} variant="outline" fullWidth disabled />
        </View>

        {/* Footer */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: DS.space.xl, gap: 4 }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>{"Don't have an account?"}</Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable onPress={() => {}}>
              <Text style={{ color: DS.color.gold, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>Sign Up</Text>
            </Pressable>
          </Link>
        </View>

        <Text style={{ color: DS.color.text3, fontSize: 11, textAlign: 'center', marginTop: DS.space.lg, lineHeight: 16 }}>
          By signing in you agree to our Terms of Service and Privacy Policy
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
