// Login History screen — reads security_logs
import { useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, LogIn, LogOut, ShieldAlert, Key, AlertTriangle } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { getSecurityLogs } from '@/services/auth.service';
import type { SecurityLog } from '@/services/auth.service';

const EVENT_CONFIG: Record<string, { label: string; color: string; Icon: typeof LogIn }> = {
  login_success:        { label: 'Login',            color: DS.color.buy,   Icon: LogIn },
  login_failed:         { label: 'Failed Login',     color: DS.color.sell,  Icon: AlertTriangle },
  password_changed:     { label: 'Password Changed', color: DS.color.warn,  Icon: Key },
  totp_enrolled:        { label: '2FA Enabled',      color: DS.color.buy,   Icon: ShieldAlert },
  totp_disabled:        { label: '2FA Disabled',     color: DS.color.sell,  Icon: ShieldAlert },
  session_revoked:      { label: 'Session Revoked',  color: DS.color.warn,  Icon: LogOut },
  passkey_enrolled:     { label: 'Passkey Added',    color: DS.color.buy,   Icon: Key },
  passkey_removed:      { label: 'Passkey Removed',  color: DS.color.sell,  Icon: Key },
  backup_code_used:     { label: 'Backup Code Used', color: DS.color.warn,  Icon: Key },
  step_up_completed:    { label: 'Step-up Verified', color: DS.color.buy,   Icon: ShieldAlert },
  withdrawal_approved:  { label: 'Withdrawal OK',    color: DS.color.buy,   Icon: ShieldAlert },
};

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

export default function LoginHistoryScreen() {
  const router = useRouter();
  const [logs, setLogs]       = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const data = await getSecurityLogs(100);
        if (active) setLogs(data);
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load history');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Login & Security History</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: DS.space.lg }}>
          <AlertTriangle size={32} color={DS.color.sell} />
          <Text style={{ color: DS.color.sell, marginTop: DS.space.sm, textAlign: 'center' }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={item => item.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: DS.space.md, gap: DS.space.xs }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: DS.space.xl }}>
              <Text style={{ color: DS.color.text2 }}>No security events recorded yet</Text>
            </View>
          }
          renderItem={({ item }) => {
            const cfg = EVENT_CONFIG[item.event_type] ?? { label: item.event_type, color: DS.color.text2, Icon: ShieldAlert };
            const { Icon, label, color } = cfg;
            return (
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
                <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${color}15`, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={16} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{label}</Text>
                  {item.ip_address && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>IP: {item.ip_address}{item.location ? ` · ${item.location}` : ''}</Text>}
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{formatTime(item.created_at)}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
