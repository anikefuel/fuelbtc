// Profile — premium account management screen with real Supabase data
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Switch, TextInput, Platform, StatusBar, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  Shield, ShieldCheck, Bell, Globe, Gift, LogOut, ChevronRight,
  CheckCircle, Lock, Eye, AlertTriangle, Smartphone, Copy,
  Key, Monitor, Moon, Sun, HelpCircle, FileText,
  ChevronLeft, Zap, BarChart2, MailCheck, RefreshCw, Edit2, Camera, Settings,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useNotifications } from '@/hooks/useNotifications';
import { useTheme } from '@/stores/ThemeStore';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';
import { getProfile, syncEmailVerified, resendVerificationEmail, updateProfile } from '@/services/auth.service';
import type { UserProfile } from '@/services/auth.service';

type ProfileSection = 'main' | 'kyc' | 'security' | 'notifications' | 'referral' | 'apikeys' | 'sessions' | 'theme' | 'edit';

const TIER_STATUS_COLOR = { completed: DS.color.buy, pending: DS.color.gold, locked: DS.color.text3 };

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const pt = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8;
  return (
    <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
      <Pressable onPress={onBack} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
        <ChevronLeft size={18} color={DS.color.text1} />
      </Pressable>
      <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>{title}</Text>
    </View>
  );
}

function MenuRow({ icon, label, sub, bg, iconColor, onPress, badge }: {
  icon: React.ReactNode; label: string; sub: string; bg: string; iconColor?: string; onPress?: () => void; badge?: string;
}) {
  return (
    <Pressable onPress={onPress ?? (() => {})} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
      <View style={{ width: 38, height: 38, borderRadius: DS.radius.full, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', marginRight: DS.space.md }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.medium, fontSize: DS.font.sm }}>{label}</Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{sub}</Text>
      </View>
      {badge && (
        <View style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.full, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginRight: DS.space.xs }}>
          <Text style={{ color: DS.color.bg, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>{badge}</Text>
        </View>
      )}
      <ChevronRight size={16} color={DS.color.text3} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const [section, setSection] = useState<ProfileSection>('main');
  const { unreadCount, markAllRead } = useNotifications();
  const { mode, setMode, isDark } = useTheme();

  const [notifs, setNotifs] = useState({ trade: true, deposit: true, p2p: true, earn: true, security: true, marketing: false });
  const [antiPhishing, setAntiPhishing] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [verifyResending, setVerifyResending] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');

  // Edit profile form state
  const [editForm, setEditForm] = useState({
    full_name: '', phone: '', phone_country_code: '+1',
    country: '', nationality: '', state_province: '', city: '',
    street_address: '', apt_suite: '', postal_code: '',
    date_of_birth: '', preferred_currency: 'USD', avatar_url: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  const pt = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8;

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      try {
        await syncEmailVerified();
        const p = await getProfile();
        if (active) {
          setProfile(p);
          setAntiPhishing(p?.anti_phishing_code ?? '');
        }
      } catch (e) {
        console.error('[Profile] load error', e);
      } finally {
        if (active) setProfileLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  async function handleResendVerification() {
    setVerifyResending(true); setVerifyMsg('');
    try {
      await resendVerificationEmail();
      setVerifyMsg('Verification email sent! Check your inbox.');
    } catch (e: unknown) {
      setVerifyMsg(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setVerifyResending(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/' as RelativePathString);
  }

  const displayName = profile?.full_name || profile?.username || profile?.email?.split('@')[0] || 'User';
  const initials = displayName.slice(0, 1).toUpperCase();
  const twoFaEnabled = profile?.two_fa_enabled ?? false;

  // Populate edit form when entering the edit section
  function openEdit() {
    setEditForm({
      full_name:          profile?.full_name          ?? '',
      phone:              profile?.phone              ?? '',
      phone_country_code: profile?.phone_country_code ?? '+1',
      country:            profile?.country            ?? '',
      nationality:        profile?.nationality        ?? '',
      state_province:     profile?.state_province     ?? '',
      city:               profile?.city               ?? '',
      street_address:     profile?.street_address     ?? '',
      apt_suite:          profile?.apt_suite          ?? '',
      postal_code:        profile?.postal_code        ?? '',
      date_of_birth:      profile?.date_of_birth      ?? '',
      preferred_currency: profile?.preferred_currency ?? 'USD',
      avatar_url:         profile?.avatar_url         ?? '',
    });
    setEditError('');
    setEditSuccess(false);
    setSection('edit');
  }

  async function handleSaveProfile() {
    setEditSaving(true); setEditError(''); setEditSuccess(false);
    try {
      await updateProfile({
        full_name:          editForm.full_name.trim()          || undefined,
        phone:              editForm.phone.trim()              || undefined,
        phone_country_code: editForm.phone_country_code.trim() || undefined,
        country:            editForm.country.trim()            || undefined,
        nationality:        editForm.nationality.trim()        || undefined,
        state_province:     editForm.state_province.trim()     || undefined,
        city:               editForm.city.trim()               || undefined,
        street_address:     editForm.street_address.trim()     || undefined,
        apt_suite:          editForm.apt_suite.trim()          || undefined,
        postal_code:        editForm.postal_code.trim()        || undefined,
        date_of_birth:      editForm.date_of_birth.trim()      || undefined,
        preferred_currency: editForm.preferred_currency        || undefined,
        avatar_url:         editForm.avatar_url.trim()         || undefined,
      });
      // Reload profile so identity card reflects changes
      const p = await getProfile();
      setProfile(p);
      setEditSuccess(true);
      setTimeout(() => setSection('main'), 1200);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Failed to save changes. Please try again.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handlePickPhoto() {
    if (photoUploading) return;
    setPhotoUploading(true); setEditError('');
    try {
      const IP = await import('expo-image-picker');
      const perm = await IP.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setEditError('Photo library access denied. Enable it in device Settings.');
        return;
      }
      const result = await IP.launchImageLibraryAsync({
        mediaTypes: IP.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const uri = result.assets[0].uri;

      // Upload to Supabase Storage avatars bucket using expo/fetch + ArrayBuffer
      // Path: {user_id}/avatar.jpg so RLS foldername check passes
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { fetch: expoFetch } = await import('expo/fetch');
      const resp = await expoFetch(uri);
      const arrayBuffer = await resp.arrayBuffer();
      const path = `${user.id}/avatar.jpg`;

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, arrayBuffer, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      // Bust cache with timestamp param
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      setEditForm(prev => ({ ...prev, avatar_url: publicUrl }));
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Photo upload failed.');
    } finally {
      setPhotoUploading(false);
    }
  }

  // ── Edit Profile ──────────────────────────────────────────────────────────
  if (section === 'edit') {
    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
            <Pressable onPress={() => setSection('main')} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
              <ChevronLeft size={18} color={DS.color.text1} />
            </Pressable>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Edit Profile</Text>
          </View>
          <Pressable onPress={handleSaveProfile} disabled={editSaving} style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.md, paddingVertical: 8 }}>
            {editSaving ? <ActivityIndicator color={DS.color.bg} size="small" /> : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.md }} keyboardShouldPersistTaps="handled">
          {/* Avatar */}
          <View style={{ alignItems: 'center', paddingVertical: DS.space.sm }}>
            <Pressable onPress={handlePickPhoto} style={{ position: 'relative' }}>
              {editForm.avatar_url ? (
                <Image source={{ uri: editForm.avatar_url }} style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: DS.color.gold }} />
              ) : (
                <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: DS.color.gold + '60' }}>
                  <Text style={{ color: DS.color.gold, fontWeight: DS.font.extrabold, fontSize: DS.font.xxl }}>{initials}</Text>
                </View>
              )}
              <View style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: DS.color.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: DS.color.bg }}>
                {photoUploading ? <ActivityIndicator size="small" color={DS.color.bg} /> : <Camera size={14} color={DS.color.bg} />}
              </View>
            </Pressable>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: DS.space.xs }}>Tap to change photo</Text>
          </View>

          {/* Success / error banners */}
          {editSuccess && (
            <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: DS.color.buy + '40' }}>
              <CheckCircle size={14} color={DS.color.buy} />
              <Text style={{ color: DS.color.buy, fontSize: DS.font.xs }}>Profile updated successfully!</Text>
            </View>
          )}
          {!!editError && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{editError}</Text>
            </View>
          )}

          {/* Fields */}
          <View style={{ gap: DS.space.sm }}>
            {/* Full Name */}
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Full Name</Text>
              <TextInput value={editForm.full_name} onChangeText={t => setEditForm(p => ({ ...p, full_name: t }))} placeholder="Your full name" placeholderTextColor={DS.color.text3} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>

            {/* Identity */}
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginTop: DS.space.xs }}>IDENTITY</Text>
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Nationality</Text>
              <TextInput value={editForm.nationality} onChangeText={t => setEditForm(p => ({ ...p, nationality: t }))} placeholder="e.g. American" placeholderTextColor={DS.color.text3} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Date of Birth</Text>
              <TextInput value={editForm.date_of_birth} onChangeText={t => setEditForm(p => ({ ...p, date_of_birth: t }))} placeholder="YYYY-MM-DD" placeholderTextColor={DS.color.text3} keyboardType="numbers-and-punctuation" style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>

            {/* Contact */}
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginTop: DS.space.xs }}>CONTACT</Text>
            <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
              <View style={{ width: 80 }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Code</Text>
                <TextInput value={editForm.phone_country_code} onChangeText={t => setEditForm(p => ({ ...p, phone_country_code: t }))} placeholder="+1" placeholderTextColor={DS.color.text3} keyboardType="phone-pad" style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Phone Number</Text>
                <TextInput value={editForm.phone} onChangeText={t => setEditForm(p => ({ ...p, phone: t }))} placeholder="555 000 0000" placeholderTextColor={DS.color.text3} keyboardType="phone-pad" style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
              </View>
            </View>

            {/* Address */}
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginTop: DS.space.xs }}>ADDRESS</Text>
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Country of Residence</Text>
              <TextInput value={editForm.country} onChangeText={t => setEditForm(p => ({ ...p, country: t }))} placeholder="e.g. United States" placeholderTextColor={DS.color.text3} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>State / Province / Region</Text>
              <TextInput value={editForm.state_province} onChangeText={t => setEditForm(p => ({ ...p, state_province: t }))} placeholder="e.g. California" placeholderTextColor={DS.color.text3} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>City</Text>
              <TextInput value={editForm.city} onChangeText={t => setEditForm(p => ({ ...p, city: t }))} placeholder="e.g. San Francisco" placeholderTextColor={DS.color.text3} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Street Address</Text>
              <TextInput value={editForm.street_address} onChangeText={t => setEditForm(p => ({ ...p, street_address: t }))} placeholder="123 Main Street" placeholderTextColor={DS.color.text3} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>
            <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Apt / Suite <Text style={{ color: DS.color.text3 }}>(optional)</Text></Text>
                <TextInput value={editForm.apt_suite} onChangeText={t => setEditForm(p => ({ ...p, apt_suite: t }))} placeholder="Apt 4B" placeholderTextColor={DS.color.text3} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Postal / ZIP Code</Text>
                <TextInput value={editForm.postal_code} onChangeText={t => setEditForm(p => ({ ...p, postal_code: t }))} placeholder="94102" placeholderTextColor={DS.color.text3} keyboardType="numbers-and-punctuation" style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
              </View>
            </View>

            {/* Preferred Currency */}
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginTop: DS.space.xs }}>DISPLAY</Text>
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Preferred Currency</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: DS.space.xs }}>
                {['USD', 'EUR', 'GBP', 'USDT', 'BTC', 'BNB'].map(c => (
                  <Pressable key={c} onPress={() => setEditForm(p => ({ ...p, preferred_currency: c }))}
                    style={{ paddingHorizontal: DS.space.md, paddingVertical: 8, borderRadius: DS.radius.full, backgroundColor: editForm.preferred_currency === c ? DS.color.gold : DS.color.card, borderWidth: 1, borderColor: editForm.preferred_currency === c ? DS.color.gold : DS.color.border }}>
                    <Text style={{ color: editForm.preferred_currency === c ? DS.color.bg : DS.color.text2, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Avatar URL */}
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 6 }}>Avatar URL <Text style={{ color: DS.color.text3 }}>(optional — or tap photo above)</Text></Text>
              <TextInput value={editForm.avatar_url} onChangeText={t => setEditForm(p => ({ ...p, avatar_url: t }))} placeholder="https://..." placeholderTextColor={DS.color.text3} autoCapitalize="none" style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.md, fontSize: DS.font.base }} />
            </View>
          </View>

          {/* Save button (bottom) */}
          <Pressable
            onPress={handleSaveProfile}
            disabled={editSaving}
            style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center', marginTop: DS.space.sm }}
          >
            {editSaving
              ? <ActivityIndicator color={DS.color.bg} />
              : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Save Changes</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── KYC — redirect to dedicated screen ───────────────────────────────────
  if (section === 'kyc') {
    router.push('/(app)/kyc' as RelativePathString);
    setSection('main');
    return null;
  }

  // ── Security — now a dedicated screen ────────────────────────────────────
  if (section === 'security') {
    router.push('/(app)/security' as RelativePathString);
    setSection('main');
    return null;
  }

  // ── Sessions — now in security screen ──────────────────────────────────
  if (section === 'sessions') {
    router.push('/(app)/security/sessions' as RelativePathString);
    setSection('main');
    return null;
  }

  // ── API Keys ──────────────────────────────────────────────────────────────
  if (section === 'apikeys') {
    const apiKeys = [
      { id: '1', label: 'Trading Bot',       key: 'exx_live_Xk9m...3Yp2', permissions: ['Read', 'Trade'], created: '2024-05-10', lastUsed: '2 hours ago', active: true },
      { id: '2', label: 'Portfolio Tracker', key: 'exx_live_Bq4r...7Lw8', permissions: ['Read'],           created: '2024-04-01', lastUsed: '1 day ago',   active: true },
    ];
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
            <Pressable onPress={() => setSection('main')} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
              <ChevronLeft size={18} color={DS.color.text1} />
            </Pressable>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>API Keys</Text>
          </View>
          <Pressable onPress={() => {}} style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.md, paddingVertical: 7, borderWidth: 1, borderColor: DS.color.gold + '50' }}>
            <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>+ Create Key</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm }}>
          <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.xs, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.warn + '30' }}>
            <AlertTriangle size={13} color={DS.color.warn} />
            <Text style={{ flex: 1, color: DS.color.warn, fontSize: DS.font.xxs, lineHeight: 16 }}>Never share your API keys. ExchangeX will never ask for them.</Text>
          </View>
          {apiKeys.map(key => (
            <View key={key.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base }}>{key.label}</Text>
                <StatusBadge status={key.active ? 'active' : 'cancelled'} size="xs" />
              </View>
              <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.sm, marginBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' }}>{key.key}</Text>
                <Copy size={13} color={DS.color.text3} />
              </View>
              <View style={{ flexDirection: 'row', gap: DS.space.xs, marginBottom: DS.space.sm, flexWrap: 'wrap' }}>
                {key.permissions.map(p => (
                  <View key={p} style={{ backgroundColor: DS.color.infoBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.info + '30' }}>
                    <Text style={{ color: DS.color.info, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{p}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Created {key.created}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Last used {key.lastUsed}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: DS.space.xs, marginTop: DS.space.sm }}>
                <Pressable onPress={() => {}} style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}>
                  <Text style={{ color: DS.color.text1, fontSize: DS.font.xs }}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => {}} style={{ flex: 1, backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: DS.color.sell + '30' }}>
                  <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  if (section === 'notifications') return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
          <Pressable onPress={() => setSection('main')} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <ChevronLeft size={18} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Notifications</Text>
        </View>
        {unreadCount > 0 && (
          <Pressable onPress={markAllRead} style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 6, borderWidth: 1, borderColor: DS.color.gold + '50' }}>
            <Text style={{ color: DS.color.gold, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Mark all read ({unreadCount})</Text>
          </Pressable>
        )}
      </View>
      <View style={{ margin: DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: DS.color.border }}>
        {(Object.entries(notifs) as [keyof typeof notifs, boolean][]).map(([key, val], i, arr) => (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: DS.space.md, paddingVertical: 14, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: DS.color.border }}>
            <Text style={{ color: DS.color.text1, fontSize: DS.font.sm }}>
              {String(key).replace(/([A-Z])/g, ' $1').trim().replace(/^\w/, c => c.toUpperCase())} Alerts
            </Text>
            <Switch value={val} onValueChange={v => setNotifs(prev => ({ ...prev, [key]: v }))} trackColor={{ false: DS.color.border, true: DS.color.gold }} thumbColor="#fff" />
          </View>
        ))}
      </View>
    </View>
  );

  // ── Theme ─────────────────────────────────────────────────────────────────
  if (section === 'theme') {
    const options = [
      { label: 'Dark Mode',    value: 'dark' as const,   icon: <Moon size={18} color={DS.color.text2} /> },
      { label: 'Light Mode',   value: 'light' as const,  icon: <Sun size={18} color={DS.color.gold} /> },
      { label: 'System Default', value: 'system' as const, icon: <Monitor size={18} color={DS.color.info} /> },
    ];
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <SubHeader title="Theme" onBack={() => setSection('main')} />
        <View style={{ margin: DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: DS.color.border }}>
          {options.map((opt, i) => (
            <Pressable key={opt.value} onPress={() => setMode(opt.value)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: 16, borderBottomWidth: i < options.length - 1 ? 1 : 0, borderBottomColor: DS.color.border }}>
              <View style={{ width: 38, height: 38, borderRadius: DS.radius.full, backgroundColor: DS.color.surface, alignItems: 'center', justifyContent: 'center', marginRight: DS.space.md }}>{opt.icon}</View>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.base, flex: 1 }}>{opt.label}</Text>
              {mode === opt.value && <CheckCircle size={18} color={DS.color.gold} fill={DS.color.gold} />}
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // ── Referral ──────────────────────────────────────────────────────────────
  if (section === 'referral') return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <SubHeader title="Referral Program" onBack={() => setSection('main')} />
      <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm }}>
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.lg, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <View style={{ width: 60, height: 60, borderRadius: DS.radius.full, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.sm }}>
            <Gift size={28} color={DS.color.gold} />
          </View>
          <Text style={{ color: DS.color.gold, fontSize: DS.font.xxl, fontWeight: DS.font.extrabold }}>$1,245.80</Text>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 3 }}>Total Commissions Earned</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: DS.space.sm }}>
          <View style={{ flex: 1, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.gold, fontSize: DS.font.xxl, fontWeight: DS.font.extrabold }}>48</Text>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Total Referrals</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.buy, fontSize: DS.font.xxl, fontWeight: DS.font.extrabold }}>20%</Text>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Commission Rate</Text>
          </View>
        </View>
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, letterSpacing: 0.3, marginBottom: 6 }}>YOUR REFERRAL CODE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.sm, padding: DS.space.md }}>
            <Text style={{ flex: 1, color: DS.color.gold, fontWeight: DS.font.extrabold, fontSize: DS.font.lg, letterSpacing: 3 }}>EXX-REF-XK82</Text>
            <Pressable onPress={() => {}} style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, paddingHorizontal: DS.space.sm, paddingVertical: 7, borderWidth: 1, borderColor: DS.color.gold + '50' }}>
              <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>Copy</Text>
            </Pressable>
          </View>
        </View>
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.base, marginBottom: DS.space.sm }}>Recent Referrals</Text>
          {[
            { uid: 'EXX...A3B4', date: '2024-06-18', commission: '$24.50' },
            { uid: 'EXX...C5D6', date: '2024-06-12', commission: '$89.20' },
            { uid: 'EXX...E7F8', date: '2024-06-01', commission: '$12.80' },
          ].map((ref, i) => (
            <View key={ref.uid} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: i < 2 ? 1 : 0, borderBottomColor: DS.color.border }}>
              <View>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.medium, fontSize: DS.font.sm }}>{ref.uid}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{ref.date}</Text>
              </View>
              <Text style={{ color: DS.color.buy, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>+{ref.commission}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  // ── Main Profile Screen ───────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.extrabold, fontSize: DS.font.xl }}>Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Identity Card */}
        <View style={{ margin: DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.lg, borderWidth: 1, borderColor: DS.color.border }}>
          {/* Email verification banner */}
          {profile && !profile.email_verified && (
            <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs, borderWidth: 1, borderColor: DS.color.warn + '40' }}>
              <AlertTriangle size={14} color={DS.color.warn} />
              <Text style={{ flex: 1, color: DS.color.warn, fontSize: DS.font.xxs, lineHeight: 16 }}>Email not verified. Verify to unlock full features.</Text>
              <Pressable onPress={handleResendVerification} disabled={verifyResending} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {verifyResending ? <ActivityIndicator size={12} color={DS.color.warn} /> : <RefreshCw size={12} color={DS.color.warn} />}
                <Text style={{ color: DS.color.warn, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>Resend</Text>
              </Pressable>
            </View>
          )}
          {!!verifyMsg && <Text style={{ color: DS.color.buy, fontSize: DS.font.xxs, marginBottom: DS.space.xs }}>{verifyMsg}</Text>}

          {profileLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: DS.space.md }}>
              <ActivityIndicator color={DS.color.gold} />
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.md, marginBottom: DS.space.md }}>
                {profile?.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={{ width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: DS.color.gold + '60' }} />
                ) : (
                  <View style={{ width: 60, height: 60, borderRadius: DS.radius.full, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: DS.color.gold + '60' }}>
                    <Text style={{ color: DS.color.gold, fontWeight: DS.font.extrabold, fontSize: DS.font.xl }}>{initials}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.extrabold, fontSize: DS.font.lg }}>{displayName}</Text>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{profile?.email ?? ''}</Text>
                  <View style={{ flexDirection: 'row', gap: DS.space.xs, marginTop: 6, flexWrap: 'wrap' }}>
                    <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.gold + '40' }}>
                      <Text style={{ color: DS.color.gold, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>VIP {profile?.vip_level ?? 0}</Text>
                    </View>
                    <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.buy + '40' }}>
                      <Text style={{ color: DS.color.buy, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>
                        KYC {profile?.kyc_tier ?? 'Unverified'}
                      </Text>
                    </View>
                    {profile?.email_verified && (
                      <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.buy + '40' }}>
                        <Text style={{ color: DS.color.buy, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>✓ Email</Text>
                      </View>
                    )}
                    {twoFaEnabled && (
                      <View style={{ backgroundColor: DS.color.infoBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.info + '40' }}>
                        <Text style={{ color: DS.color.info, fontSize: DS.font.xxxs, fontWeight: DS.font.extrabold }}>2FA On</Text>
                      </View>
                    )}
                  </View>
                </View>
                {/* Edit button */}
                <Pressable onPress={openEdit} style={{ width: 32, height: 32, borderRadius: DS.radius.full, backgroundColor: DS.color.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
                  <Edit2 size={14} color={DS.color.text2} />
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', paddingTop: DS.space.sm, borderTopWidth: 1, borderTopColor: DS.color.border }}>
                {[
                  { label: 'UID', val: profile?.uid ?? '—', color: DS.color.text1 },
                  { label: 'Referral', val: profile?.referral_code ?? '—', color: DS.color.gold },
                  { label: 'Member Since', val: profile?.created_at ? new Date(profile.created_at).getFullYear().toString() : '—', color: DS.color.text1 },
                ].map(stat => (
                  <View key={stat.label} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 3 }}>{stat.label}</Text>
                    <Text style={{ color: stat.color, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>{stat.val}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        {/* Account section */}
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, fontWeight: DS.font.extrabold, marginHorizontal: DS.space.md, marginBottom: DS.space.xs, letterSpacing: 1 }}>ACCOUNT</Text>
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, marginHorizontal: DS.space.md, marginBottom: DS.space.md, overflow: 'hidden', borderWidth: 1, borderColor: DS.color.border }}>
          <MenuRow icon={<ShieldCheck size={18} color={DS.color.buy} />} label="KYC Verification" sub={profile?.kyc_tier === 'tier2' ? 'Tier 2 Verified' : profile?.kyc_tier === 'tier1' ? 'Tier 1 — Start Identity' : 'Not Verified'} bg={DS.color.buyBg} onPress={() => setSection('kyc')} />
          <MenuRow icon={<Shield size={18} color={DS.color.info} />} label="Security Settings" sub={twoFaEnabled ? '2FA Active' : '2FA Disabled'} bg={DS.color.infoBg} onPress={() => router.push('/(app)/security' as RelativePathString)} />
          <MenuRow icon={<Key size={18} color={DS.color.text2} />} label="API Keys" sub="2 keys active" bg={DS.color.surface} onPress={() => setSection('apikeys')} />
          <MenuRow icon={<Gift size={18} color={DS.color.gold} />} label="Referral Program" sub="$1,245 earned · 48 referrals" bg={DS.color.goldBg} onPress={() => setSection('referral')} />
        </View>

        {/* Preferences */}
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, fontWeight: DS.font.extrabold, marginHorizontal: DS.space.md, marginBottom: DS.space.xs, letterSpacing: 1 }}>PREFERENCES</Text>
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, marginHorizontal: DS.space.md, marginBottom: DS.space.md, overflow: 'hidden', borderWidth: 1, borderColor: DS.color.border }}>
          <MenuRow icon={<Bell size={18} color={DS.color.gold} />} label="Notifications" sub={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'} bg={DS.color.warnBg} onPress={() => setSection('notifications')} badge={unreadCount > 0 ? String(unreadCount) : undefined} />
          <MenuRow icon={isDark ? <Moon size={18} color={DS.color.text2} /> : <Sun size={18} color={DS.color.gold} />} label="Theme" sub={mode === 'system' ? 'System Default' : mode === 'dark' ? 'Dark Mode' : 'Light Mode'} bg={DS.color.surface} onPress={() => setSection('theme')} />
          <MenuRow icon={<Globe size={18} color={DS.color.info} />} label="Language" sub="English" bg={DS.color.infoBg} />
        </View>

        {/* Support */}
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, fontWeight: DS.font.extrabold, marginHorizontal: DS.space.md, marginBottom: DS.space.xs, letterSpacing: 1 }}>SUPPORT</Text>
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, marginHorizontal: DS.space.md, marginBottom: DS.space.md, overflow: 'hidden', borderWidth: 1, borderColor: DS.color.border }}>
          <MenuRow icon={<HelpCircle size={18} color={DS.color.info} />} label="Help Center" sub="FAQs and guides" bg={DS.color.infoBg} />
          <MenuRow icon={<FileText size={18} color={DS.color.text2} />} label="Terms & Privacy" sub="Legal documents" bg={DS.color.surface} />
        </View>

        {/* Admin link */}
        <Pressable onPress={() => router.push('/(app)/admin' as RelativePathString)}
          style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm, backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xl, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.md, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
          <View style={{ width: 40, height: 40, borderRadius: DS.radius.full, backgroundColor: DS.color.sell + '20', alignItems: 'center', justifyContent: 'center' }}>
            <BarChart2 size={18} color={DS.color.sell} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Admin Dashboard</Text>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Platform management</Text>
          </View>
          <ChevronRight size={16} color={DS.color.sell} />
        </Pressable>

        {/* Sign Out */}
        <Pressable onPress={handleSignOut}
          style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.xxxl + DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
          <LogOut size={18} color={DS.color.sell} />
          <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
