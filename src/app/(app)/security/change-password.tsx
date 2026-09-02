// Change Password screen — uses Edge Function, requires current password
import { useState } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Eye, EyeOff, Lock, CheckCircle } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { changePassword } from '@/services/auth.service';
import { XInput } from '@/components/shared/XInput';
import { XButton } from '@/components/shared/XButton';

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
  const colors = ['', '#F6465D', '#F0B90B', '#F0B90B', '#0ECB81', '#0ECB81'];
  const labels = ['', 'Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const color = colors[score] ?? DS.color.border;
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
        {[1,2,3,4,5].map(i => (
          <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= score ? color : DS.color.border }} />
        ))}
      </View>
      {password.length > 0 && <Text style={{ color, fontSize: DS.font.xxs }}>{labels[score]}</Text>}
    </View>
  );
}

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [current, setCurrent]   = useState('');
  const [newPw, setNewPw]       = useState('');
  const [confirm, setConfirm]   = useState('');
  const [show, setShow]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);

  async function handleChange() {
    if (!current) { setError('Please enter your current password'); return; }
    if (!newPw) { setError('Please enter a new password'); return; }
    if (newPw.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(newPw) || !/[0-9]/.test(newPw)) { setError('Password must include an uppercase letter and a number'); return; }
    if (newPw !== confirm) { setError('Passwords do not match'); return; }
    if (newPw === current) { setError('New password must differ from current password'); return; }

    setError(''); setLoading(true);
    try {
      await changePassword(current, newPw);
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'center', alignItems: 'center', paddingHorizontal: DS.space.lg }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${DS.color.buy}20`, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.lg }}>
          <CheckCircle size={36} color={DS.color.buy} />
        </View>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.xl, fontWeight: DS.font.extrabold, textAlign: 'center', marginBottom: DS.space.sm }}>Password Changed</Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', marginBottom: DS.space.xl }}>
          Your password has been updated. Other sessions have been signed out.
        </Text>
        <XButton label="Back to Security" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Change Password</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: DS.space.lg, gap: DS.space.md }} keyboardShouldPersistTaps="handled">
        <XInput
          label="Current Password"
          value={current}
          onChangeText={t => { setCurrent(t); if (error) setError(''); }}
          secureTextEntry={!show}
          placeholder="Enter current password"
          leftIcon={<Lock size={17} color={DS.color.text2} />}
          rightIcon={show ? <EyeOff size={17} color={DS.color.text2} /> : <Eye size={17} color={DS.color.text2} />}
          onRightIconPress={() => setShow(v => !v)}
        />
        <View style={{ gap: 8 }}>
          <XInput
            label="New Password"
            value={newPw}
            onChangeText={t => { setNewPw(t); if (error) setError(''); }}
            secureTextEntry={!show}
            placeholder="At least 8 characters"
            leftIcon={<Lock size={17} color={DS.color.text2} />}
          />
          <StrengthBar password={newPw} />
        </View>
        <XInput
          label="Confirm New Password"
          value={confirm}
          onChangeText={t => { setConfirm(t); if (error) setError(''); }}
          secureTextEntry={!show}
          placeholder="Repeat new password"
          leftIcon={<Lock size={17} color={DS.color.text2} />}
        />

        {!!error && (
          <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, padding: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
            <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{error}</Text>
          </View>
        )}

        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.md, padding: DS.space.md, gap: 6 }}>
          {[
            { label: '8+ characters', ok: newPw.length >= 8 },
            { label: 'One uppercase letter', ok: /[A-Z]/.test(newPw) },
            { label: 'One number', ok: /[0-9]/.test(newPw) },
            { label: 'Passwords match', ok: !!confirm && newPw === confirm },
          ].map(({ label, ok }) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={13} color={ok ? DS.color.buy : DS.color.text3} />
              <Text style={{ color: ok ? DS.color.text1 : DS.color.text3, fontSize: DS.font.xs }}>{label}</Text>
            </View>
          ))}
        </View>

        <XButton label="Update Password" onPress={handleChange} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
