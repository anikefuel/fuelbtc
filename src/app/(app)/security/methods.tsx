// Security Methods — enable/disable individual verification factors
// Shows live status from Supabase MFA API + passkeys table + backup_codes table
// At least one strong method (TOTP or Passkey) must always remain active.
import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, Switch,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, ShieldCheck, Smartphone, Mail, Key, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import {
  getVerifiedTOTPFactor, getPasskeys, getBackupCodeCount,
  syncSecurityPreferences, upsertSecurityPreferences,
} from '@/services/auth.service';
import type { SecurityPreferences } from '@/services/auth.service';
import type { RelativePathString } from 'expo-router';

type MethodStatus = 'enabled' | 'disabled' | 'not_configured' | 'loading';

interface MethodInfo {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  status: MethodStatus;
  detail: string;
  canToggle: boolean;
  setupRoute?: string;
}

function statusColor(s: MethodStatus) {
  if (s === 'enabled') return DS.color.buy;
  if (s === 'not_configured') return DS.color.text3;
  return DS.color.text2;
}
function statusLabel(s: MethodStatus) {
  if (s === 'enabled') return 'Enabled';
  if (s === 'disabled') return 'Disabled';
  if (s === 'not_configured') return 'Not configured';
  return '…';
}
function StatusIcon({ s }: { s: MethodStatus }) {
  if (s === 'enabled') return <CheckCircle size={16} color={DS.color.buy} />;
  if (s === 'not_configured') return <XCircle size={16} color={DS.color.text3} />;
  if (s === 'loading') return <Clock size={16} color={DS.color.text3} />;
  return <XCircle size={16} color={DS.color.sell} />;
}

export default function SecurityMethodsScreen() {
  const router = useRouter();
  const [prefs, setPrefs]   = useState<SecurityPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [toggling, setToggling] = useState<string | null>(null);

  // Live method data
  const [totpEnabled, setTotpEnabled]       = useState(false);
  const [passkeyCount, setPasskeyCount]     = useState(0);
  const [backupCount, setBackupCount]       = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const [totpFactor, passkeys, bkCount, p] = await Promise.all([
          getVerifiedTOTPFactor(),
          getPasskeys(),
          getBackupCodeCount(),
          syncSecurityPreferences(),
        ]);
        if (!active) return;
        setTotpEnabled(!!totpFactor);
        setPasskeyCount(passkeys.length);
        setBackupCount(bkCount);
        setPrefs(p);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load security methods');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  const methods: MethodInfo[] = [
    {
      id:          'totp',
      label:       'Authenticator App (TOTP)',
      description: 'Use Google Authenticator, Authy, or any TOTP app to generate 6-digit codes.',
      icon:        <Smartphone size={20} color={totpEnabled ? DS.color.buy : DS.color.text2} />,
      status:      loading ? 'loading' : totpEnabled ? 'enabled' : 'not_configured',
      detail:      totpEnabled ? 'Active — verified factor' : 'Tap to set up',
      canToggle:   totpEnabled,
      setupRoute:  '/(app)/security/totp-setup',
    },
    {
      id:          'passkey',
      label:       'Passkey / Biometrics',
      description: 'Use Face ID, fingerprint, device PIN, or a hardware security key.',
      icon:        <Key size={20} color={passkeyCount > 0 ? DS.color.buy : DS.color.text2} />,
      status:      loading ? 'loading' : passkeyCount > 0 ? 'enabled' : 'not_configured',
      detail:      passkeyCount > 0 ? `${passkeyCount} device${passkeyCount !== 1 ? 's' : ''} registered` : 'Tap to register a device',
      canToggle:   passkeyCount > 0,
      setupRoute:  '/(app)/security/passkeys',
    },
    {
      id:          'email_otp',
      label:       'Email Verification Code',
      description: 'Receive a 6-digit code to your account email for confirmations.',
      icon:        <Mail size={20} color={DS.color.buy} />,
      status:      'enabled',
      detail:      'Always available (account email)',
      canToggle:   false,
    },
    {
      id:          'backup_codes',
      label:       'Backup Recovery Codes',
      description: 'One-time codes for account recovery when other methods are unavailable.',
      icon:        <ShieldCheck size={20} color={backupCount > 0 ? DS.color.gold : DS.color.text2} />,
      status:      loading ? 'loading' : backupCount > 0 ? 'enabled' : 'not_configured',
      detail:      backupCount > 0 ? `${backupCount} code${backupCount !== 1 ? 's' : ''} remaining` : 'Generate after enabling TOTP',
      canToggle:   false,
      setupRoute:  totpEnabled ? '/(app)/security/totp-setup' : undefined,
    },
  ];

  async function handleToggle(method: MethodInfo) {
    if (!method.canToggle || !prefs) return;
    // If trying to disable, check at-least-one-strong rule
    if (method.status === 'enabled') {
      const wouldHaveTotp    = method.id === 'totp'    ? false : totpEnabled;
      const wouldHavePasskey = method.id === 'passkey' ? false : passkeyCount > 0;
      if (!wouldHaveTotp && !wouldHavePasskey) {
        setError('You must keep at least one strong method (Authenticator or Passkey) active.');
        return;
      }
    }
    // Navigate to the manage screen (disable requires step-up on those screens)
    if (method.setupRoute) {
      router.push(method.setupRoute as RelativePathString);
    }
  }

  async function handleRefresh() {
    setLoading(true); setError('');
    try {
      const [totpFactor, passkeys, bkCount, p] = await Promise.all([
        getVerifiedTOTPFactor(),
        getPasskeys(),
        getBackupCodeCount(),
        syncSecurityPreferences(),
      ]);
      setTotpEnabled(!!totpFactor);
      setPasskeyCount(passkeys.length);
      setBackupCount(bkCount);
      setPrefs(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }

  const strongCount = (totpEnabled ? 1 : 0) + (passkeyCount > 0 ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg, flex: 1 }}>Security Methods</Text>
        <Pressable onPress={handleRefresh} disabled={loading} style={{ width: 36, height: 36, borderRadius: DS.radius.full, alignItems: 'center', justifyContent: 'center' }}>
          {loading ? <ActivityIndicator size={16} color={DS.color.gold} /> : <RefreshCw size={16} color={DS.color.text2} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.md }}>
        {/* Security strength summary */}
        <View style={{ backgroundColor: strongCount >= 2 ? DS.color.buyBg : strongCount === 1 ? `${DS.color.gold}22` : DS.color.sellBg, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: strongCount >= 2 ? `${DS.color.buy}40` : strongCount === 1 ? `${DS.color.gold}40` : `${DS.color.sell}40` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
            <ShieldCheck size={20} color={strongCount >= 2 ? DS.color.buy : strongCount === 1 ? DS.color.gold : DS.color.sell} />
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>
              {strongCount >= 2 ? 'Strong Security' : strongCount === 1 ? 'Basic Security' : 'No Strong Factors'}
            </Text>
          </View>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 4 }}>
            {strongCount >= 2
              ? `${strongCount} strong factors active. Your account is well protected.`
              : strongCount === 1
              ? 'Consider enabling a second strong factor for better protection.'
              : 'Enable Authenticator App or Passkey to protect your account.'}
          </Text>
        </View>

        {!!error && (
          <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
            <AlertTriangle size={14} color={DS.color.sell} />
            <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
          </View>
        )}

        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase', letterSpacing: 1 }}>VERIFICATION METHODS</Text>

        {methods.map(m => (
          <View key={m.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: m.status === 'enabled' ? `${DS.color.buy}30` : DS.color.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: DS.space.sm }}>
              <View style={{ width: 40, height: 40, borderRadius: DS.radius.full, backgroundColor: m.status === 'enabled' ? DS.color.buyBg : DS.color.surface, alignItems: 'center', justifyContent: 'center' }}>
                {m.icon}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, flex: 1 }}>{m.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <StatusIcon s={m.status} />
                    <Text style={{ color: statusColor(m.status), fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{statusLabel(m.status)}</Text>
                  </View>
                </View>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginTop: 2 }}>{m.description}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 4 }}>{m.detail}</Text>
              </View>
            </View>

            {/* Action button */}
            {m.setupRoute ? (
              <Pressable
                onPress={() => {
                  if (m.status === 'enabled' && m.canToggle) {
                    // Go to manage screen
                    router.push(m.setupRoute! as RelativePathString);
                  } else if (m.status === 'not_configured') {
                    router.push(m.setupRoute! as RelativePathString);
                  }
                }}
                style={{ marginTop: DS.space.sm, backgroundColor: m.status === 'enabled' ? DS.color.surface : DS.color.gold, borderRadius: DS.radius.md, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: m.status === 'enabled' ? DS.color.border : DS.color.gold }}
              >
                <Text style={{ color: m.status === 'enabled' ? DS.color.text2 : DS.color.bg, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
                  {m.status === 'enabled' ? 'Manage' : 'Set Up'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        {/* Warning about minimum requirement */}
        <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: DS.space.sm }}>
            <AlertTriangle size={16} color={DS.color.gold} style={{ marginTop: 1 }} />
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1 }}>
              {'You must keep at least one strong method active (Authenticator App or Passkey) at all times. Email verification alone is not sufficient for high-risk actions like withdrawals.'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
