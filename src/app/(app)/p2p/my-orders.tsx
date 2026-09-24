// P2P My Orders — full order history with status filters
// KYC Tier 1 required to trade P2P
import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, ShieldCheck, Clock, ChevronRight } from 'lucide-react-native';
import { getMyTrades, type P2PTrade, type P2PTradeStatus } from '@/services/p2p.service';
import { supabase } from '@/client/supabase';
import { getProfile } from '@/services/auth.service';
import { KycGateBanner } from '@/components/shared/KycGate';
import { DS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

const STATUS_FILTERS = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'awaiting_payment' as P2PTradeStatus },
  { label: 'Completed', value: 'released' as P2PTradeStatus },
  { label: 'Disputed', value: 'disputed' as P2PTradeStatus },
  { label: 'Cancelled', value: 'cancelled' as P2PTradeStatus },
];

const STATUS_COLORS: Record<string, string> = {
  pending: '#6B7280',
  awaiting_payment: '#F59E0B',
  payment_marked: '#8B5CF6',
  awaiting_release: '#0EA5E9',
  released: '#10B981',
  cancelled: '#EF4444',
  expired: '#EF4444',
  disputed: '#F97316',
  refunded: '#6B7280',
};

const fiatSymbols: Record<string, string> = {
  NGN: '₦', USD: '$', EUR: '€', GBP: '£', KES: 'KSh', GHS: '₵',
  ZAR: 'R', UGX: 'USh', TZS: 'TSh', AED: 'د.إ', INR: '₹',
};
const fSym = (code: string) => fiatSymbols[code] ?? code + ' ';

export default function MyOrders() {
  const router = useRouter();
  const [trades, setTrades] = useState<P2PTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<P2PTradeStatus | undefined>(undefined);
  const [userId, setUserId] = useState<string | null>(null);
  const [userTier, setUserTier] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
      setLoading(true);
      try {
        const [data2, profile] = await Promise.all([
          getMyTrades(filter),
          getProfile(),
        ]);
        setTrades(data2);
        setUserTier(profile?.kyc_tier ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, [filter]));

  const onRefresh = async () => {
    setRefreshing(true);
    const data2 = await getMyTrades(filter).catch(() => [] as P2PTrade[]);
    setTrades(data2);
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: DS.space.sm, padding: 4 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>My P2P Orders</Text>
      </View>

      {/* KYC Tier 1 gate banner */}
      <View style={{ paddingHorizontal: DS.space.md, paddingTop: DS.space.sm }}>
        <KycGateBanner requiredTier="tier1" featureName="P2P Trading" userTier={userTier} />
      </View>

      {/* Status filter tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        {STATUS_FILTERS.map(f => (
          <Pressable key={String(f.value)}
            onPress={() => setFilter(f.value)}
            style={{ marginRight: DS.space.sm, paddingHorizontal: 12, paddingVertical: 6, borderRadius: DS.radius.full, backgroundColor: filter === f.value ? DS.color.gold : DS.color.card, borderWidth: 1, borderColor: filter === f.value ? DS.color.gold : DS.color.border }}>
            <Text style={{ color: filter === f.value ? DS.color.bg : DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : (
        <FlatList
          data={trades}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm, paddingBottom: 80 }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: DS.space.sm }}>
              <ShieldCheck size={48} color={DS.color.text3} />
              <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold }}>No orders found</Text>
            </View>
          }
          renderItem={({ item: trade }) => {
            const isBuyer = trade.buyerId === userId;
            const statusColor = STATUS_COLORS[trade.status] ?? DS.color.text2;
            return (
              <Pressable
                onPress={() => router.push(`/(app)/p2p/active-trade?tradeId=${trade.id}` as RelativePathString)}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ backgroundColor: isBuyer ? DS.color.buy + '20' : DS.color.sell + '20', borderRadius: DS.radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: isBuyer ? DS.color.buy : DS.color.sell, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>{isBuyer ? 'BUY' : 'SELL'}</Text>
                    </View>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>#{trade.tradeNumber?.slice(-8)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                    <Text style={{ color: statusColor, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{trade.status.replace('_', ' ')}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: DS.space.xs }}>
                  <View>
                    <Text style={{ color: DS.color.gold, fontSize: DS.font.xl, fontWeight: DS.font.extrabold }}>
                      {trade.cryptoAmount.toFixed(6)} {trade.asset}
                    </Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>
                      {fSym(trade.fiat)}{trade.fiatAmount.toLocaleString()}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={DS.color.text2} />
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
                  <Clock size={11} color={DS.color.text3} />
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
                    {new Date(trade.createdAt).toLocaleDateString()} · {trade.paymentMethod}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
