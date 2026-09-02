// Admin: Unmatched Deposits review screen
// Shows Binance deposits that couldn't be auto-attributed to a user.
// Admin can: search for user, attribute deposit, or mark as ignored.

import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  TextInput, RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  AlertTriangle, Search, UserCheck, X, CheckCircle,
  Clock, Filter, RefreshCw,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { DS } from '@/lib/design';

interface UnmatchedDeposit {
  id:             string;
  provider_tx_id: string;
  asset:          string;
  network:        string | null;
  amount:         number;
  fee:            number;
  to_address:     string | null;
  tx_hash:        string | null;
  insert_time:    number | null;
  status:         string;
  attributed_to:  string | null;
  attributed_at:  string | null;
  note:           string | null;
  created_at:     string;
}

interface UserHit {
  id:    string;
  email: string;
  uid:   string;
}

type FilterStatus = 'pending' | 'attributed' | 'ignored' | 'all';

const STATUS_COLOR: Record<string, string> = {
  pending:    '#F59E0B',
  attributed: '#10B981',
  ignored:    '#6B7280',
};

export default function UnmatchedDeposits() {
  const [deposits, setDeposits]         = useState<UnmatchedDeposit[]>([]);
  const [loading, setLoading]           = useState(false);
  const [refreshing, setRefreshing]     = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');

  // Attribution modal state
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [selectedDep, setSelectedDep]   = useState<UnmatchedDeposit | null>(null);
  const [userSearch, setUserSearch]     = useState('');
  const [userResults, setUserResults]   = useState<UserHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [attributing, setAttributing]   = useState(false);
  const [actionMsg, setActionMsg]       = useState('');
  const [actionError, setActionError]   = useState('');

  // Ignore modal state
  const [ignoreId, setIgnoreId]         = useState<string | null>(null);
  const [ignoreNote, setIgnoreNote]     = useState('');
  const [ignoring, setIgnoring]         = useState(false);

  const loadDeposits = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('unmatched_deposits')
      .select('id,provider_tx_id,asset,network,amount,fee,to_address,tx_hash,insert_time,status,attributed_to,attributed_at,note,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    const { data } = await q;
    setDeposits((data ?? []) as UnmatchedDeposit[]);
    setLoading(false);
  }, [filterStatus]);

  useFocusEffect(useCallback(() => { loadDeposits(); }, [loadDeposits]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDeposits();
    setRefreshing(false);
  };

  const searchUsers = async (q: string) => {
    if (q.length < 2) { setUserResults([]); return; }
    setSearchLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id,email,uid')
      .or(`email.ilike.%${q}%,uid.ilike.%${q}%`)
      .limit(10);
    setUserResults((data ?? []) as UserHit[]);
    setSearchLoading(false);
  };

  const handleAttribute = async (dep: UnmatchedDeposit, user: UserHit) => {
    const { data: { user: adminUser } } = await supabase.auth.getUser();
    if (!adminUser) return;
    setAttributing(true);
    setActionError('');
    const { data, error } = await supabase.rpc('attribute_unmatched_deposit', {
      p_unmatched_id: dep.id,
      p_user_id:      user.id,
      p_admin_id:     adminUser.id,
    });
    setAttributing(false);
    if (error) { setActionError(error.message); return; }
    const result = data as { ok?: boolean; reason?: string } | null;
    if (!result?.ok) {
      setActionError(result?.reason ?? 'Attribution failed');
      return;
    }
    setActionMsg(`Credited ${dep.amount} ${dep.asset} to ${user.email}`);
    setSelectedId(null);
    setSelectedDep(null);
    setUserSearch('');
    setUserResults([]);
    await loadDeposits();
  };

  const handleIgnore = async () => {
    if (!ignoreId) return;
    const { data: { user: adminUser } } = await supabase.auth.getUser();
    if (!adminUser) return;
    setIgnoring(true);
    await supabase.rpc('ignore_unmatched_deposit', {
      p_unmatched_id: ignoreId,
      p_admin_id:     adminUser.id,
      p_note:         ignoreNote.trim() || null,
    });
    setIgnoring(false);
    setIgnoreId(null);
    setIgnoreNote('');
    await loadDeposits();
  };

  const fmtTime = (ms: number | null, iso?: string) => {
    const d = ms ? new Date(ms) : iso ? new Date(iso) : null;
    if (!d) return '—';
    return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const pendingCount  = deposits.filter(d => d.status === 'pending').length;

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <AlertTriangle size={18} color={DS.color.warn} />
          <Text style={{ color: DS.color.text1, fontSize: 17, fontWeight: DS.font.bold }}>
            Unmatched Deposits
          </Text>
          {pendingCount > 0 && (
            <View style={{ backgroundColor: DS.color.sell, borderRadius: DS.radius.full, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: DS.font.bold }}>{pendingCount}</Text>
            </View>
          )}
          <Pressable onPress={onRefresh} style={{ marginLeft: 'auto' as unknown as number }}>
            <RefreshCw size={16} color={DS.color.text2} />
          </Pressable>
        </View>
        <Text style={{ color: DS.color.text3, fontSize: 12, marginTop: 4 }}>
          {"Binance deposits that couldn't be auto-attributed to a user account."}
        </Text>
      </View>

      {/* Action feedback */}
      {actionMsg ? (
        <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.xs, backgroundColor: `${DS.color.buy}18`, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: DS.space.xs, borderWidth: 1, borderColor: `${DS.color.buy}30` }}>
          <CheckCircle size={14} color={DS.color.buy} />
          <Text style={{ flex: 1, color: DS.color.buy, fontSize: 12 }}>{actionMsg}</Text>
          <Pressable onPress={() => setActionMsg('')}><X size={14} color={DS.color.buy} /></Pressable>
        </View>
      ) : null}

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
        <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
          {(['pending', 'attributed', 'ignored', 'all'] as FilterStatus[]).map(f => (
            <Pressable key={f} onPress={() => setFilterStatus(f)}
              style={{ paddingHorizontal: DS.space.md, paddingVertical: DS.space.xxs, borderRadius: DS.radius.full, borderWidth: 1.5, borderColor: filterStatus === f ? DS.color.gold : DS.color.border, backgroundColor: filterStatus === f ? DS.color.goldBg : DS.color.surface }}>
              <Text style={{ color: filterStatus === f ? DS.color.gold : DS.color.text2, fontSize: 12, fontWeight: DS.font.medium, textTransform: 'capitalize' }}>{f}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* List */}
      {loading && !refreshing ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} />
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
          showsVerticalScrollIndicator={false}
        >
          {deposits.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <CheckCircle size={40} color={DS.color.buy} strokeWidth={1.2} />
              <Text style={{ color: DS.color.text2, fontSize: 15, fontWeight: DS.font.semibold, marginTop: DS.space.md }}>
                No {filterStatus === 'all' ? '' : filterStatus} unmatched deposits
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: DS.space.md, gap: DS.space.xs, paddingBottom: DS.space.xxxl }}>
              {deposits.map(dep => {
                const sc = STATUS_COLOR[dep.status] ?? DS.color.text3;
                return (
                  <View key={dep.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: dep.status === 'pending' ? `${DS.color.warn}40` : DS.color.border }}>
                    {/* Top row */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: DS.space.xs }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: DS.color.text1, fontSize: 16, fontWeight: DS.font.bold }}>
                          +{dep.amount} {dep.asset}
                        </Text>
                        <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 2 }}>
                          {dep.network ?? '—'} · {fmtTime(dep.insert_time, dep.created_at)}
                        </Text>
                      </View>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: `${sc}18`, borderRadius: DS.radius.xs }}>
                        <Text style={{ color: sc, fontSize: 11, fontWeight: DS.font.bold, textTransform: 'capitalize' }}>{dep.status}</Text>
                      </View>
                    </View>

                    {/* Address */}
                    {dep.to_address && (
                      <Text style={{ color: DS.color.text3, fontSize: 11, marginBottom: 2 }} numberOfLines={1}>
                        Address: {dep.to_address}
                      </Text>
                    )}
                    {dep.tx_hash && (
                      <Text style={{ color: DS.color.text3, fontSize: 11, marginBottom: DS.space.sm }} numberOfLines={1}>
                        TxHash: {dep.tx_hash}
                      </Text>
                    )}

                    {/* Attributed info */}
                    {dep.status === 'attributed' && dep.attributed_at && (
                      <Text style={{ color: DS.color.buy, fontSize: 11, marginBottom: DS.space.sm }}>
                        Attributed {fmtTime(null, dep.attributed_at)}
                      </Text>
                    )}
                    {dep.note && (
                      <Text style={{ color: DS.color.text3, fontSize: 11, marginBottom: DS.space.sm }}>
                        Note: {dep.note}
                      </Text>
                    )}

                    {/* Actions (pending only) */}
                    {dep.status === 'pending' && (
                      <View style={{ flexDirection: 'row', gap: DS.space.xs, marginTop: DS.space.xs }}>
                        <Pressable
                          onPress={() => { setSelectedId(dep.id); setSelectedDep(dep); setActionError(''); setUserSearch(''); setUserResults([]); }}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: DS.space.xs, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, paddingVertical: DS.space.xs, borderWidth: 1, borderColor: DS.color.gold }}>
                          <UserCheck size={14} color={DS.color.gold} />
                          <Text style={{ color: DS.color.gold, fontSize: 12, fontWeight: DS.font.semibold }}>Attribute to User</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => { setIgnoreId(dep.id); setIgnoreNote(''); }}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: DS.space.xs, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingVertical: DS.space.xs, paddingHorizontal: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                          <Filter size={14} color={DS.color.text2} />
                          <Text style={{ color: DS.color.text2, fontSize: 12 }}>Ignore</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* Attribution Modal */}
      {selectedId && selectedDep && (
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}
          onPress={() => { setSelectedId(null); setSelectedDep(null); setUserSearch(''); setUserResults([]); }}>
          <Pressable
            onPress={() => {/* prevent dismiss */}}
            style={{ backgroundColor: DS.color.card, borderTopLeftRadius: DS.radius.xl, borderTopRightRadius: DS.radius.xl, padding: DS.space.lg, paddingBottom: DS.space.xxxl }}>
            {/* Handle */}
            <View style={{ width: 36, height: 4, backgroundColor: DS.color.border, borderRadius: 2, alignSelf: 'center', marginBottom: DS.space.md }} />

            <Text style={{ color: DS.color.text1, fontSize: 17, fontWeight: DS.font.bold, marginBottom: DS.space.xs }}>
              Attribute Deposit
            </Text>
            <Text style={{ color: DS.color.text2, fontSize: 13, marginBottom: DS.space.md }}>
              Credit +{selectedDep.amount} {selectedDep.asset} to a user account.
            </Text>

            {/* Deposit summary */}
            <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.md, gap: 4 }}>
              {[
                ['TxID', selectedDep.provider_tx_id],
                ['Address', selectedDep.to_address ?? '—'],
                ['Network', selectedDep.network ?? '—'],
                ['Amount', `${selectedDep.amount} ${selectedDep.asset}`],
              ].map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: DS.color.text3, fontSize: 11 }}>{k}</Text>
                  <Text style={{ color: DS.color.text2, fontSize: 11, fontWeight: DS.font.medium, maxWidth: '65%', textAlign: 'right' }} numberOfLines={1}>{v}</Text>
                </View>
              ))}
            </View>

            {/* User search */}
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingHorizontal: DS.space.sm, borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.sm }}>
              <Search size={14} color={DS.color.text3} />
              <TextInput
                value={userSearch}
                onChangeText={t => { setUserSearch(t); searchUsers(t); }}
                placeholder="Search by email or UID…"
                placeholderTextColor={DS.color.text3}
                autoCapitalize="none"
                style={{ flex: 1, color: DS.color.text1, fontSize: 13, paddingVertical: DS.space.sm, marginLeft: DS.space.xs }}
              />
              {searchLoading && <ActivityIndicator size="small" color={DS.color.gold} />}
            </View>

            {/* User results */}
            {userResults.map(u => (
              <Pressable key={u.id}
                onPress={() => handleAttribute(selectedDep, u)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.xs, borderWidth: 1, borderColor: DS.color.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: DS.color.text1, fontSize: 13 }}>{u.email}</Text>
                  <Text style={{ color: DS.color.text3, fontSize: 11 }}>{u.uid}</Text>
                </View>
                {attributing
                  ? <ActivityIndicator size="small" color={DS.color.gold} />
                  : <UserCheck size={16} color={DS.color.gold} />
                }
              </Pressable>
            ))}

            {actionError ? (
              <View style={{ backgroundColor: `${DS.color.sell}18`, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.xs }}>
                <Text style={{ color: DS.color.sell, fontSize: 12 }}>{actionError}</Text>
              </View>
            ) : null}

            <Pressable onPress={() => { setSelectedId(null); setSelectedDep(null); setUserSearch(''); setUserResults([]); }}
              style={{ marginTop: DS.space.md, alignItems: 'center', paddingVertical: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontSize: 14 }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}

      {/* Ignore Modal */}
      {ignoreId && (
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}
          onPress={() => setIgnoreId(null)}>
          <Pressable
            onPress={() => {/* prevent dismiss */}}
            style={{ backgroundColor: DS.color.card, borderTopLeftRadius: DS.radius.xl, borderTopRightRadius: DS.radius.xl, padding: DS.space.lg, paddingBottom: DS.space.xxxl }}>
            <View style={{ width: 36, height: 4, backgroundColor: DS.color.border, borderRadius: 2, alignSelf: 'center', marginBottom: DS.space.md }} />
            <Text style={{ color: DS.color.text1, fontSize: 17, fontWeight: DS.font.bold, marginBottom: DS.space.xs }}>Ignore Deposit</Text>
            <Text style={{ color: DS.color.text2, fontSize: 13, marginBottom: DS.space.md }}>
              Mark this unmatched deposit as ignored. It will not be credited to any user.
            </Text>
            <TextInput
              value={ignoreNote}
              onChangeText={setIgnoreNote}
              placeholder="Reason / note (optional)"
              placeholderTextColor={DS.color.text3}
              style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, color: DS.color.text1, fontSize: 13, borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.md }}
            />
            <View style={{ flexDirection: 'row', gap: DS.space.sm }}>
              <Pressable onPress={() => setIgnoreId(null)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: DS.space.sm, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: DS.color.border }}>
                <Text style={{ color: DS.color.text2, fontSize: 14 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleIgnore} disabled={ignoring}
                style={{ flex: 1, alignItems: 'center', paddingVertical: DS.space.sm, backgroundColor: DS.color.sell, borderRadius: DS.radius.md }}>
                {ignoring
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 14, fontWeight: DS.font.semibold }}>Ignore</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}
