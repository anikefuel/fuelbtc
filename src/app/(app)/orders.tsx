// Orders screen — real open orders + order history from the backend
import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, FlatList, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, RefreshCw, X, AlertTriangle } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TradingService } from '@/services';
import type { OrderRecord } from '@/services/trading.service';

const C = DS.color;

type OrderTab = 'Open' | 'History';
type OrderStatusFilter = 'All' | 'Filled' | 'Cancelled' | 'Partial';

const STATUS_BADGE_MAP: Record<string, 'active' | 'pending' | 'cancelled' | 'completed'> = {
  open: 'active',
  pending: 'active',
  partially_filled: 'pending',
  filled: 'completed',
  cancelled: 'cancelled',
  rejected: 'cancelled',
  expired: 'cancelled',
  failed: 'cancelled',
};

function OrderCard({ order, showCancel, onCancel }: { order: OrderRecord; showCancel?: boolean; onCancel?: (id: string) => void }) {
  const fillPct = order.quantity > 0 ? (order.filledQty / order.quantity) * 100 : 0;
  const sideColor = order.side === 'buy' ? C.buy : C.sell;
  const badgeStatus = STATUS_BADGE_MAP[order.status] ?? 'pending';

  return (
    <View style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ backgroundColor: `${sideColor}22`, borderRadius: DS.radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: sideColor, fontSize: 12, fontWeight: DS.font.bold }}>{order.side.toUpperCase()}</Text>
          </View>
          <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 14 }}>{order.symbol}</Text>
          <Text style={{ color: C.text2, fontSize: 12 }}>{order.orderType.replace('_', '-').toUpperCase()}</Text>
        </View>
        <StatusBadge status={badgeStatus} label={order.status.replace('_', ' ').toUpperCase()} size="xs" />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <View>
          <Text style={{ color: C.text3, fontSize: 10, marginBottom: 2 }}>Price</Text>
          <Text style={{ color: C.text1, fontSize: 13, fontWeight: DS.font.semibold }}>
            {order.orderType === 'market' ? 'Market' : (order.price ?? 0).toLocaleString()}
          </Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: C.text3, fontSize: 10, marginBottom: 2 }}>Amount</Text>
          <Text style={{ color: C.text1, fontSize: 13, fontWeight: DS.font.semibold }}>{order.quantity}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: C.text3, fontSize: 10, marginBottom: 2 }}>Filled</Text>
          <Text style={{ color: C.text1, fontSize: 13, fontWeight: DS.font.semibold }}>{order.filledQty.toFixed(6)}</Text>
        </View>
      </View>

      {order.status !== 'cancelled' && order.status !== 'rejected' && (
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: C.text3, fontSize: 10 }}>Fill Progress</Text>
            <Text style={{ color: C.text3, fontSize: 10 }}>{fillPct.toFixed(1)}%</Text>
          </View>
          <View style={{ height: 4, backgroundColor: C.surface, borderRadius: 2 }}>
            <View style={{ height: 4, width: `${fillPct}%` as `${number}%`, backgroundColor: sideColor, borderRadius: 2 }} />
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: C.text3, fontSize: 11 }}>{new Date(order.createdAt).toLocaleString()}</Text>
        <Text style={{ color: C.text3, fontSize: 11 }}>#{order.id.slice(0, 8)}</Text>
        {showCancel && (order.status === 'open' || order.status === 'pending') && (
          <Pressable
            onPress={() => onCancel?.(order.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${C.sell}22`, borderRadius: DS.radius.sm, paddingHorizontal: 10, paddingVertical: 5 }}
          >
            <X size={12} color={C.sell} />
            <Text style={{ color: C.sell, fontSize: 12, fontWeight: DS.font.semibold }}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function OrdersScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<OrderTab>('Open');
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('All');
  const [openOrders, setOpenOrders] = useState<OrderRecord[]>([]);
  const [history, setHistory] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [open, hist] = await Promise.all([
        TradingService.getOpenOrders(),
        TradingService.getOrderHistory({ limit: 50 }),
      ]);
      setOpenOrders(open);
      setHistory(hist);
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load orders'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { (async () => { await load(); })(); }, [load]));

  const handleCancel = async (orderId: string) => {
    if (cancelling) return;
    setCancelling(orderId);
    try {
      await TradingService.cancelOrder(orderId);
      await load();
    } catch (e) {
      setError(toUserMessage(e, 'Cancel failed'));
    } finally {
      setCancelling(null);
    }
  };

  const handleCancelAll = async () => {
    if (cancelling || openOrders.length === 0) return;
    setCancelling('all');
    try {
      await Promise.all(
        openOrders
          .filter(o => o.status === 'open' || o.status === 'pending')
          .map(o => TradingService.cancelOrder(o.id))
      );
      await load();
    } catch (e) {
      setError(toUserMessage(e, 'Cancel all failed'));
    } finally {
      setCancelling(null);
    }
  };

  const filteredHistory = history.filter(o => {
    if (statusFilter === 'All') return true;
    if (statusFilter === 'Filled') return o.status === 'filled';
    if (statusFilter === 'Cancelled') return ['cancelled', 'rejected', 'expired'].includes(o.status);
    if (statusFilter === 'Partial') return o.status === 'partially_filled';
    return true;
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <ArrowLeft size={22} color={C.text1} />
        </Pressable>
        <Text style={{ color: C.text1, fontWeight: DS.font.extrabold, fontSize: 18, flex: 1 }}>Orders</Text>
        <Pressable onPress={() => { (async () => { await load(); })(); }} style={{ padding: 6 }}>
          <RefreshCw size={18} color={C.text2} />
        </Pressable>
      </View>

      {/* Error banner */}
      {error !== '' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, padding: 12, backgroundColor: `${C.sell}18`, borderRadius: DS.radius.md }}>
          <AlertTriangle size={16} color={C.sell} />
          <Text style={{ color: C.sell, fontSize: 13, flex: 1 }}>{error}</Text>
        </View>
      )}

      {/* Tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        {(['Open', 'History'] as OrderTab[]).map(t => (
          <Pressable
            key={t}
            onPress={() => setActiveTab(t)}
            style={{ paddingHorizontal: 20, paddingVertical: 9, borderRadius: DS.radius.md, backgroundColor: activeTab === t ? C.gold : C.card, borderWidth: 1, borderColor: activeTab === t ? C.gold : C.border }}
          >
            <Text style={{ color: activeTab === t ? '#000' : C.text2, fontWeight: DS.font.semibold, fontSize: 13 }}>{t}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        {activeTab === 'Open' && openOrders.length > 0 && (
          <View style={{ backgroundColor: `${C.gold}22`, borderRadius: DS.radius.md, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center' }}>
            <Text style={{ color: C.gold, fontSize: 12, fontWeight: DS.font.bold }}>{openOrders.length} Active</Text>
          </View>
        )}
      </View>

      {/* History filter pills */}
      {activeTab === 'History' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['All', 'Filled', 'Cancelled', 'Partial'] as OrderStatusFilter[]).map(f => (
              <Pressable
                key={f}
                onPress={() => setStatusFilter(f)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: DS.radius.sm, backgroundColor: statusFilter === f ? `${C.gold}22` : 'transparent', borderWidth: 1, borderColor: statusFilter === f ? C.gold : C.border }}
              >
                <Text style={{ color: statusFilter === f ? C.gold : C.text2, fontSize: 12, fontWeight: DS.font.semibold }}>{f}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.gold} size="large" />
        </View>
      ) : activeTab === 'Open' ? (
        <FlatList
          data={openOrders}
          keyExtractor={o => o.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={
            openOrders.filter(o => o.status === 'open' || o.status === 'pending').length > 0 ? (
              <Pressable
                onPress={handleCancelAll}
                disabled={cancelling === 'all'}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginBottom: 12, opacity: cancelling === 'all' ? 0.5 : 1 }}
              >
                <X size={14} color={C.sell} />
                <Text style={{ color: C.sell, fontSize: 13, fontWeight: DS.font.semibold }}>
                  {cancelling === 'all' ? 'Cancelling…' : 'Cancel All'}
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>📋</Text>
              <Text style={{ color: C.text1, fontSize: 16, fontWeight: DS.font.semibold }}>No Open Orders</Text>
              <Text style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>Place a trade to see your orders here</Text>
            </View>
          }
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              showCancel
              onCancel={handleCancel}
            />
          )}
        />
      ) : (
        <FlatList
          data={filteredHistory}
          keyExtractor={o => o.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>📜</Text>
              <Text style={{ color: C.text1, fontSize: 16, fontWeight: DS.font.semibold }}>No History</Text>
              <Text style={{ color: C.text2, fontSize: 13, marginTop: 4 }}>Completed and cancelled orders appear here</Text>
            </View>
          }
          renderItem={({ item }) => <OrderCard order={item} />}
        />
      )}
    </View>
  );
}
