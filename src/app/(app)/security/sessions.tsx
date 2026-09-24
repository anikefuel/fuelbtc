// Active Sessions screen — real data from user_sessions table
// recordCurrentSession() is called on focus to ensure this device is always present
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Monitor, Smartphone, AlertTriangle } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { getActiveSessions, revokeSession, signOutAllOtherSessions, recordCurrentSession } from '@/services/auth.service';
import type { UserSession } from '@/services/auth.service';
import { StatusBadge } from '@/components/shared/StatusBadge';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Active now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SessionsScreen() {
  const router = useRouter();
  const [sessions, setSessions]   = useState<UserSession[]>([]);
  const [loading, setLoading]     = useState(true);
  const [revoking, setRevoking]   = useState<string | null>(null);
  const [error, setError]         = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        // Ensure current session is recorded so it always appears in the list
        await recordCurrentSession();
        const data = await getActiveSessions();
        if (active) setSessions(data);
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load sessions');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  async function handleRevoke(id: string) {
    setRevoking(id); setError('');
    try {
      await revokeSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to revoke session');
    } finally {
      setRevoking(null);
    }
  }

  async function handleRevokeAll() {
    setRevoking('all'); setError('');
    try {
      await signOutAllOtherSessions();
      setSessions(prev => prev.filter(s => s.is_current));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to sign out other sessions');
    } finally {
      setRevoking(null);
    }
  }

  const others = sessions.filter(s => !s.is_current);

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Active Sessions</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm }}>
          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
              <AlertTriangle size={14} color={DS.color.sell} />
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
            </View>
          )}

          {sessions.length === 0 && !error && (
            <View style={{ alignItems: 'center', paddingTop: DS.space.xl }}>
              <Monitor size={40} color={DS.color.text3} />
              <Text style={{ color: DS.color.text2, marginTop: DS.space.sm }}>No sessions found</Text>
            </View>
          )}

          {sessions.map(s => (
            <View key={s.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: s.is_current ? `${DS.color.buy}40` : DS.color.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, flex: 1 }}>
                  <View style={{ width: 40, height: 40, borderRadius: DS.radius.full, backgroundColor: s.is_current ? DS.color.buyBg : DS.color.surface, alignItems: 'center', justifyContent: 'center' }}>
                    {s.browser ? <Monitor size={18} color={s.is_current ? DS.color.buy : DS.color.text2} /> : <Smartphone size={18} color={s.is_current ? DS.color.buy : DS.color.text2} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
                      {s.device_name ?? s.browser ?? 'Unknown Device'}
                    </Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>
                      {[s.os, s.city, s.country_code].filter(Boolean).join(' · ')}
                    </Text>
                    {s.ip_address && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>IP: {s.ip_address}</Text>}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {s.is_current && <StatusBadge status="active" label="THIS DEVICE" size="xs" />}
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{timeAgo(s.last_active_at)}</Text>
                </View>
              </View>
              {!s.is_current && (
                <Pressable
                  onPress={() => handleRevoke(s.id)}
                  disabled={revoking === s.id}
                  style={{ marginTop: DS.space.sm, backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: `${DS.color.sell}30` }}
                >
                  {revoking === s.id ? <ActivityIndicator size={14} color={DS.color.sell} /> : <Text style={{ color: DS.color.sell, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Revoke Session</Text>}
                </Pressable>
              )}
            </View>
          ))}

          {others.length > 1 && (
            <Pressable
              onPress={handleRevokeAll}
              disabled={revoking === 'all'}
              style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center', borderWidth: 1, borderColor: `${DS.color.sell}30` }}
            >
              {revoking === 'all' ? <ActivityIndicator color={DS.color.sell} /> : <Text style={{ color: DS.color.sell, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Sign Out All Other Devices</Text>}
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
}
