// Security Hub — central security dashboard
// 2FA status is read from mfa.listFactors() (source of truth), NOT profiles.two_fa_enabled
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  Lock, Smartphone, Monitor, Clock, Key, Fingerprint, Shield,
  ChevronRight, ArrowLeft, CheckCircle, AlertTriangle, List, Settings, SlidersHorizontal,
} from 'lucide-react-native';
import type { RelativePathString } from 'expo-router';
import { DS } from '@/lib/design';
import { getProfile, getBackupCodeCount, getVerifiedTOTPFactor } from '@/services/auth.service';
import type { UserProfile } from '@/services/auth.service';

export default function SecurityHubScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [backupCount, setBackupCount] = useState(0);
  const [twoFaOn, setTwoFaOn] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [p, bc, verifiedFactor] = await Promise.all([
          getProfile(),
          getBackupCodeCount(),
          getVerifiedTOTPFactor(),
        ]);
        if (active) {
          setProfile(p);
          setBackupCount(bc);
          // Source of truth: actual MFA factor, not profiles.two_fa_enabled
          setTwoFaOn(verifiedFactor !== null);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  type SecurityItem = {
    icon: React.ReactNode;
    label: string;
    sub: string;
    bg: string;
    route: string;
    warn?: boolean;
    badge?: string;
  };

  const items: SecurityItem[] = [
    {
      icon: <Lock size={18} color={DS.color.info} />,
      label: 'Change Password',
      sub: 'Update your account password',
      bg: DS.color.infoBg,
      route: '/(app)/security/change-password',
    },
    {
      icon: <Smartphone size={18} color={twoFaOn ? DS.color.buy : DS.color.gold} />,
      label: 'Two-Factor Authentication',
      sub: twoFaOn ? 'TOTP enabled' : 'Not enabled — recommended',
      bg: twoFaOn ? DS.color.buyBg : DS.color.goldBg,
      route: '/(app)/security/totp-setup',
      warn: !twoFaOn,
      badge: twoFaOn && backupCount > 0 ? `${backupCount} backup codes` : (!twoFaOn ? 'OFF' : undefined),
    },
    {
      icon: <Fingerprint size={18} color={DS.color.info} />,
      label: 'Passkeys & Biometric',
      sub: 'Face ID / Fingerprint / Security key',
      bg: DS.color.infoBg,
      route: '/(app)/security/passkeys',
    },
    {
      icon: <Monitor size={18} color={DS.color.text2} />,
      label: 'Active Sessions',
      sub: 'Manage devices signed in',
      bg: DS.color.surface,
      route: '/(app)/security/sessions',
    },
    {
      icon: <Clock size={18} color={DS.color.text2} />,
      label: 'Login History',
      sub: 'Recent sign-in activity',
      bg: DS.color.surface,
      route: '/(app)/security/login-history',
    },
    {
      icon: <List size={18} color={DS.color.text2} />,
      label: 'Withdrawal Address Whitelist',
      sub: 'Manage trusted withdrawal addresses',
      bg: DS.color.surface,
      route: '/(app)/security/whitelist',
    },
    {
      icon: <Settings size={18} color={DS.color.info} />,
      label: 'Security Methods',
      sub: 'Enable / disable TOTP, Passkey, Email, Backup codes',
      bg: DS.color.infoBg,
      route: '/(app)/security/methods',
    },
    {
      icon: <SlidersHorizontal size={18} color={DS.color.gold} />,
      label: 'Security Preferences',
      sub: 'Choose verification per action (login, withdrawal…)',
      bg: DS.color.goldBg,
      route: '/(app)/security/preferences',
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Security</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm }}>
          {/* Security score card */}
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, marginBottom: DS.space.sm }}>
              <Shield size={20} color={twoFaOn ? DS.color.buy : DS.color.gold} />
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Security Status</Text>
            </View>
            <View style={{ gap: 8 }}>
              {[
                { label: 'Email verified', ok: profile?.email_verified ?? false },
                { label: 'Two-factor authentication (TOTP)', ok: twoFaOn },
                { label: 'Backup codes generated', ok: backupCount > 0 },
              ].map(({ label, ok }) => (
                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
                  {ok ? <CheckCircle size={14} color={DS.color.buy} /> : <AlertTriangle size={14} color={DS.color.warn} />}
                  <Text style={{ color: ok ? DS.color.text1 : DS.color.warn, fontSize: DS.font.sm }}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          {items.map(item => (
            <Pressable
              key={item.label}
              onPress={() => router.push(item.route as RelativePathString)}
              style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, borderWidth: 1, borderColor: item.warn ? `${DS.color.warn}50` : DS.color.border }}
            >
              <View style={{ width: 40, height: 40, borderRadius: DS.radius.full, backgroundColor: item.bg, alignItems: 'center', justifyContent: 'center' }}>
                {item.icon}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{item.label}</Text>
                <Text style={{ color: item.warn ? DS.color.warn : DS.color.text2, fontSize: DS.font.xs }}>{item.sub}</Text>
              </View>
              {item.badge && (
                <View style={{ backgroundColor: item.warn ? DS.color.warnBg : DS.color.buyBg, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Text style={{ color: item.warn ? DS.color.warn : DS.color.buy, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{item.badge}</Text>
                </View>
              )}
              <ChevronRight size={16} color={DS.color.text3} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
