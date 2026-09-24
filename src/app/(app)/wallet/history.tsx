// Wallet History — all transaction types: deposits, withdrawals, internal, wallet transfers, escrows
import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, ArrowLeftRight,
  Shield, Users, Clock,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import { WalletService } from '@/services';
import type {
  DepositRecord, WithdrawalRecord, InternalTransfer,
  WalletTransfer, EscrowRecord,
} from '@/services/wallet.service';
import { WALLET_LABELS } from '@/services/wallet.service';

type TxType = 'all' | 'deposits' | 'withdrawals' | 'transfers' | 'escrow';
const TX_TABS: { id: TxType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'deposits', label: 'Deposits' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'escrow', label: 'Escrow' },
];

type TxItem =
  | { kind: 'deposit';    data: DepositRecord }
  | { kind: 'withdrawal'; data: WithdrawalRecord }
  | { kind: 'internal';   data: InternalTransfer; isSender: boolean }
  | { kind: 'self';       data: WalletTransfer }
  | { kind: 'escrow';     data: EscrowRecord };

const STATUS_COLORS: Record<string, string> = {
  pending: DS.color.warn, confirming: DS.color.info, credited: DS.color.buy,
  completed: DS.color.buy, failed: DS.color.sell, rejected: DS.color.sell,
  cancelled: DS.color.text3, security_review: DS.color.info, approved: DS.color.info,
  locked: DS.color.warn, released: DS.color.buy, refunded: DS.color.info,
  frozen: DS.color.sell, disputed: DS.color.sell, expired: DS.color.text3,
};

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TxCard({ item, userId }: { item: TxItem; userId: string }) {
  if (item.kind === 'deposit') {
    const d = item.data;
    return (
      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${DS.color.buy}18`, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowDownLeft size={18} color={DS.color.buy} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: DS.color.text1, fontSize: 14, fontWeight: DS.font.semibold }}>Deposit</Text>
            <Text style={{ color: DS.color.text3, fontSize: 11 }}>{d.network} · {fmtDate(d.createdAt)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: DS.color.buy, fontSize: 15, fontWeight: DS.font.bold }}>+{d.amount} {d.asset}</Text>
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: `${STATUS_COLORS[d.status] ?? DS.color.text3}18`, borderRadius: DS.radius.xs, marginTop: 2 }}>
              <Text style={{ color: STATUS_COLORS[d.status] ?? DS.color.text3, fontSize: 10, fontWeight: DS.font.bold, textTransform: 'capitalize' }}>{d.status}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (item.kind === 'withdrawal') {
    const w = item.data;
    return (
      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${DS.color.sell}18`, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowUpRight size={18} color={DS.color.sell} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: DS.color.text1, fontSize: 14, fontWeight: DS.font.semibold }}>Withdrawal</Text>
            <Text style={{ color: DS.color.text3, fontSize: 11 }}>{w.network} · {fmtDate(w.createdAt)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: DS.color.sell, fontSize: 15, fontWeight: DS.font.bold }}>-{w.amount} {w.asset}</Text>
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: `${STATUS_COLORS[w.status] ?? DS.color.text3}18`, borderRadius: DS.radius.xs, marginTop: 2 }}>
              <Text style={{ color: STATUS_COLORS[w.status] ?? DS.color.text3, fontSize: 10, fontWeight: DS.font.bold, textTransform: 'capitalize' }}>{w.status.replace('_', ' ')}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (item.kind === 'internal') {
    const t = item.data;
    const color = item.isSender ? DS.color.sell : DS.color.buy;
    const sign  = item.isSender ? '-' : '+';
    return (
      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${color}18`, alignItems: 'center', justifyContent: 'center' }}>
            <Users size={18} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: DS.color.text1, fontSize: 14, fontWeight: DS.font.semibold }}>{item.isSender ? 'Sent' : 'Received'}</Text>
            <Text style={{ color: DS.color.text3, fontSize: 11 }}>{fmtDate(t.createdAt)}{t.note ? ` · ${t.note}` : ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color, fontSize: 15, fontWeight: DS.font.bold }}>{sign}{item.isSender ? t.amount : t.netAmount} {t.asset}</Text>
            {t.reference && <Text style={{ color: DS.color.text3, fontSize: 10, marginTop: 2 }}>{t.reference}</Text>}
          </View>
        </View>
      </View>
    );
  }

  if (item.kind === 'self') {
    const t = item.data;
    return (
      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${DS.color.info}18`, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeftRight size={18} color={DS.color.info} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: DS.color.text1, fontSize: 14, fontWeight: DS.font.semibold }}>Wallet Transfer</Text>
            <Text style={{ color: DS.color.text3, fontSize: 11 }}>
              {WALLET_LABELS[t.fromWallet]} → {WALLET_LABELS[t.toWallet]} · {fmtDate(t.createdAt)}
            </Text>
          </View>
          <Text style={{ color: DS.color.info, fontSize: 15, fontWeight: DS.font.bold }}>{t.amount} {t.asset}</Text>
        </View>
      </View>
    );
  }

  if (item.kind === 'escrow') {
    const e = item.data;
    const color = STATUS_COLORS[e.status] ?? DS.color.text3;
    return (
      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${color}18`, alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={18} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: DS.color.text1, fontSize: 14, fontWeight: DS.font.semibold }}>Escrow</Text>
            <Text style={{ color: DS.color.text3, fontSize: 11 }}>{e.escrowType} · {fmtDate(e.createdAt)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: DS.color.text1, fontSize: 15, fontWeight: DS.font.bold }}>{e.amount} {e.asset}</Text>
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: `${color}18`, borderRadius: DS.radius.xs, marginTop: 2 }}>
              <Text style={{ color, fontSize: 10, fontWeight: DS.font.bold, textTransform: 'capitalize' }}>{e.status}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return null;
}

export default function HistoryScreen() {
  useLocalSearchParams<{ walletType?: string }>();
  const [tab, setTab] = useState<TxType>('all');
  const [items, setItems] = useState<TxItem[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await (await import('@/client/supabase')).supabase.auth.getUser();
      const uid = user?.id ?? '';
      setUserId(uid);

      const [deps, wds, ints, selfTs, escs] = await Promise.all([
        WalletService.getDeposits(50),
        WalletService.getWithdrawals(50),
        WalletService.getInternalTransfers(50),
        WalletService.getWalletTransfers(50),
        WalletService.getEscrows(),
      ]);

      const all: TxItem[] = [
        ...deps.map(d => ({ kind: 'deposit' as const, data: d })),
        ...wds.map(d => ({ kind: 'withdrawal' as const, data: d })),
        ...ints.map(d => ({ kind: 'internal' as const, data: d, isSender: d.senderId === uid })),
        ...selfTs.map(d => ({ kind: 'self' as const, data: d })),
        ...escs.map(d => ({ kind: 'escrow' as const, data: d })),
      ].sort((a, b) => {
        const da = 'createdAt' in a.data ? a.data.createdAt : '';
        const db = 'createdAt' in b.data ? b.data.createdAt : '';
        return db.localeCompare(da);
      });

      setItems(all);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const filtered = items.filter(i => {
    if (tab === 'all') return true;
    if (tab === 'deposits') return i.kind === 'deposit';
    if (tab === 'withdrawals') return i.kind === 'withdrawal';
    if (tab === 'transfers') return i.kind === 'internal' || i.kind === 'self';
    if (tab === 'escrow') return i.kind === 'escrow';
    return true;
  });

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.md }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontSize: 20, fontWeight: DS.font.bold, flex: 1 }}>Transaction History</Text>
      </View>

      {/* Filter tabs */}
      <View style={{ paddingHorizontal: DS.space.md, marginBottom: DS.space.md }}>
        <FlatList
          data={TX_TABS} horizontal showsHorizontalScrollIndicator={false}
          keyExtractor={t => t.id}
          contentContainerStyle={{ gap: DS.space.xs }}
          renderItem={({ item: t }) => (
            <Pressable onPress={() => setTab(t.id)}
              style={{ paddingHorizontal: DS.space.md, paddingVertical: DS.space.xxs, borderRadius: DS.radius.full, borderWidth: 1.5, borderColor: tab === t.id ? DS.color.gold : DS.color.border, backgroundColor: tab === t.id ? DS.color.goldBg : DS.color.surface }}>
              <Text style={{ color: tab === t.id ? DS.color.gold : DS.color.text2, fontSize: 13, fontWeight: tab === t.id ? DS.font.semibold : DS.font.regular }}>{t.label}</Text>
            </Pressable>
          )}
        />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Clock size={48} color={DS.color.text3} strokeWidth={1.2} />
          <Text style={{ color: DS.color.text2, fontSize: 16, fontWeight: DS.font.semibold, marginTop: DS.space.md }}>No transactions yet</Text>
          <Text style={{ color: DS.color.text3, fontSize: 13, marginTop: DS.space.xs }}>Your history will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingHorizontal: DS.space.md, paddingBottom: DS.space.xxxl, gap: DS.space.xxs }}
          contentInsetAdjustmentBehavior="automatic"
          renderItem={({ item }) => <TxCard item={item} userId={userId} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
        />
      )}
    </View>
  );
}
