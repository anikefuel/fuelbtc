// Security Preferences — per-action verification method configuration
// Users configure what verification methods are required for each sensitive action.
import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, Modal,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, ChevronRight, Shield, AlertTriangle, Check, Info } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { getSecurityPreferences, syncSecurityPreferences, upsertSecurityPreferences } from '@/services/auth.service';
import type { SecurityPreferences } from '@/services/auth.service';

type PrefKey = keyof Pick<SecurityPreferences,
  'pref_login' | 'pref_withdrawal' | 'pref_p2p_release' | 'pref_security_change' |
  'pref_new_address' | 'pref_password_change' | 'pref_api_key' | 'pref_large_transfer'
>;

type PrefOption = {
  value: string;
  label: string;
  description: string;
  allowedForHighRisk?: boolean;
};

const PREF_OPTIONS: PrefOption[] = [
  { value: 'totp',       label: 'Authenticator only',    description: '6-digit TOTP code from your authenticator app.',            allowedForHighRisk: true },
  { value: 'passkey',    label: 'Passkey only',          description: 'Face ID, fingerprint, PIN, or hardware key.',               allowedForHighRisk: true },
  { value: 'email_otp',  label: 'Email code only',       description: 'One-time code sent to your account email.',                 allowedForHighRisk: false },
  { value: 'any_strong', label: 'Any strong method',     description: 'TOTP or Passkey — whichever you have enabled.',             allowedForHighRisk: true },
  { value: 'two_strong', label: 'Two methods required',  description: 'Must complete a strong method plus email confirmation.',    allowedForHighRisk: true },
  { value: 'all_enabled','label': 'All enabled methods', description: 'Complete every verification method you have set up.',       allowedForHighRisk: true },
];

interface ActionConfig {
  key: PrefKey;
  label: string;
  description: string;
  isHighRisk: boolean;
  recommended: string;
}

const ACTIONS: ActionConfig[] = [
  { key: 'pref_login',           label: 'Login Verification',       description: 'When signing into your account.',                        isHighRisk: false, recommended: 'any_strong' },
  { key: 'pref_withdrawal',      label: 'Withdrawal Approval',      description: 'When submitting a crypto withdrawal.',                   isHighRisk: true,  recommended: 'two_strong' },
  { key: 'pref_p2p_release',     label: 'P2P Escrow Release',       description: 'When releasing funds in a P2P trade.',                   isHighRisk: true,  recommended: 'any_strong' },
  { key: 'pref_security_change', label: 'Security Setting Change',  description: 'When modifying 2FA or passkeys.',                        isHighRisk: true,  recommended: 'two_strong' },
  { key: 'pref_new_address',     label: 'New Withdrawal Address',   description: 'When adding an address to your whitelist.',              isHighRisk: true,  recommended: 'two_strong' },
  { key: 'pref_password_change', label: 'Password Change',          description: 'When updating your account password.',                   isHighRisk: false, recommended: 'any_strong' },
  { key: 'pref_api_key',         label: 'API Key Creation',         description: 'When generating a new API key.',                        isHighRisk: false, recommended: 'any_strong' },
  { key: 'pref_large_transfer',  label: 'Large Internal Transfer',  description: 'When moving large amounts between your wallets.',        isHighRisk: true,  recommended: 'two_strong' },
];

function optionLabel(value: string) {
  return PREF_OPTIONS.find(o => o.value === value)?.label ?? value;
}

export default function SecurityPreferencesScreen() {
  const router = useRouter();
  const [prefs, setPrefs]       = useState<SecurityPreferences | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [editing, setEditing]   = useState<ActionConfig | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const p = await syncSecurityPreferences();
        if (active) setPrefs(p);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load preferences');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  async function handleSelect(action: ActionConfig, value: string) {
    if (!prefs) return;

    // High-risk actions cannot use email_otp alone
    if (action.isHighRisk && value === 'email_otp') {
      setError(`Email code alone is not allowed for "${action.label}". Please select a stronger method.`);
      return;
    }

    setEditing(null);
    setSaving(true); setError(''); setSuccess('');
    try {
      await upsertSecurityPreferences({ [action.key]: value });
      const updated = await getSecurityPreferences();
      if (updated) setPrefs(updated);
      setSuccess('Preference updated.');
      setTimeout(() => setSuccess(''), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save preference');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={DS.color.gold} />
      </View>
    );
  }

  const availableOptions = (action: ActionConfig) =>
    PREF_OPTIONS.filter(o => !action.isHighRisk || o.allowedForHighRisk !== false);

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, flex: 1 }}>Security Preferences</Text>
        {saving && <ActivityIndicator size={16} color={DS.color.gold} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm }}>
        {/* Info banner */}
        <View style={{ backgroundColor: `${DS.color.gold}18`, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: `${DS.color.gold}40`, flexDirection: 'row', gap: DS.space.sm, alignItems: 'flex-start', marginBottom: DS.space.xs }}>
          <Info size={16} color={DS.color.gold} style={{ marginTop: 1 }} />
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1 }}>
            {'Configure which verification methods are required for each sensitive action. High-risk actions cannot use email alone.'}
          </Text>
        </View>

        {!!error && (
          <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
            <AlertTriangle size={14} color={DS.color.sell} />
            <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
          </View>
        )}
        {!!success && (
          <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: `${DS.color.buy}40` }}>
            <Check size={14} color={DS.color.buy} />
            <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, flex: 1 }}>{success}</Text>
          </View>
        )}

        {/* Group 1: Login & Account */}
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginTop: DS.space.xs }}>ACCOUNT ACCESS</Text>
        {ACTIONS.filter(a => ['pref_login', 'pref_password_change'].includes(a.key)).map(action => (
          <ActionRow
            key={action.key}
            action={action}
            currentValue={prefs ? (prefs[action.key] as string) : action.recommended}
            onPress={() => { setEditing(action); setError(''); }}
          />
        ))}

        {/* Group 2: Financial */}
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginTop: DS.space.md }}>FINANCIAL ACTIONS</Text>
        {ACTIONS.filter(a => ['pref_withdrawal', 'pref_p2p_release', 'pref_new_address', 'pref_large_transfer'].includes(a.key)).map(action => (
          <ActionRow
            key={action.key}
            action={action}
            currentValue={prefs ? (prefs[action.key] as string) : action.recommended}
            onPress={() => { setEditing(action); setError(''); }}
          />
        ))}

        {/* Group 3: Security & API */}
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginTop: DS.space.md }}>SECURITY & API</Text>
        {ACTIONS.filter(a => ['pref_security_change', 'pref_api_key'].includes(a.key)).map(action => (
          <ActionRow
            key={action.key}
            action={action}
            currentValue={prefs ? (prefs[action.key] as string) : action.recommended}
            onPress={() => { setEditing(action); setError(''); }}
          />
        ))}
      </ScrollView>

      {/* Edit modal */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={() => setEditing(null)}>
          <Pressable style={{ backgroundColor: DS.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 34 }} onPress={() => {}}>
            <View style={{ padding: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base }}>{editing?.label}</Text>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 2 }}>{editing?.description}</Text>
              {editing?.isHighRisk && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: DS.space.xs }}>
                  <AlertTriangle size={12} color={DS.color.gold} />
                  <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs }}>High-risk action — email alone not permitted</Text>
                </View>
              )}
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {editing && availableOptions(editing).map(opt => {
                const currentVal = prefs ? (prefs[editing.key] as string) : editing.recommended;
                const isSelected = currentVal === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => handleSelect(editing, opt.value)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: DS.color.text1, fontWeight: isSelected ? DS.font.bold : DS.font.medium, fontSize: DS.font.sm }}>{opt.label}</Text>
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 2 }}>{opt.description}</Text>
                    </View>
                    {isSelected && <Check size={18} color={DS.color.gold} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ActionRow({ action, currentValue, onPress }: {
  action: ActionConfig;
  currentValue: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}
    >
      <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: action.isHighRisk ? `${DS.color.sell}18` : DS.color.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Shield size={16} color={action.isHighRisk ? DS.color.sell : DS.color.text2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{action.label}</Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 1 }}>{action.description}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: DS.color.gold }} />
          <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{optionLabel(currentValue)}</Text>
        </View>
      </View>
      <ChevronRight size={16} color={DS.color.text3} />
    </Pressable>
  );
}
