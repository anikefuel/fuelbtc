// P2P Notifications Screen — in-app notification bell list
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Bell, BellOff, CheckCheck, ShieldCheck, Clock, MessageCircle, XCircle, AlertTriangle } from 'lucide-react-native';
import {
  getP2PNotifications, markNotificationRead, markAllNotificationsRead,
  type P2PNotification,
} from '@/services/p2p.service';
import { DS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

const TYPE_ICON: Record<string, React.ReactNode> = {
  new_order:               <Bell size={16} color={DS.color.gold} />,
  payment_marked:          <CheckCheck size={16} color={DS.color.buy} />,
  payment_deadline:        <Clock size={16} color="#F59E0B" />,
  crypto_released:         <ShieldCheck size={16} color={DS.color.buy} />,
  trade_cancelled:         <XCircle size={16} color={DS.color.sell} />,
  trade_expired:           <Clock size={16} color={DS.color.text3} />,
  dispute_opened:          <AlertTriangle size={16} color={DS.color.sell} />,
  dispute_updated:         <MessageCircle size={16} color="#F59E0B" />,
  admin_decision:          <ShieldCheck size={16} color={DS.color.gold} />,
};

function NotificationItem({
  item, onPress,
}: { item: P2PNotification; onPress: (item: P2PNotification) => void }) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: DS.space.sm,
        padding: DS.space.md,
        backgroundColor: item.isRead ? DS.color.bg : DS.color.card,
        borderBottomWidth: 1, borderBottomColor: DS.color.border,
      }}
    >
      {/* Icon */}
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: DS.color.surface,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {TYPE_ICON[item.type] ?? <Bell size={16} color={DS.color.text2} />}
      </View>

      {/* Content */}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{
          color: item.isRead ? DS.color.text2 : DS.color.text1,
          fontSize: DS.font.sm,
          fontWeight: item.isRead ? DS.font.regular : DS.font.semibold,
        }}>
          {item.title}
        </Text>
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, lineHeight: 17 }}>
          {item.body}
        </Text>
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginTop: 2 }}>
          {new Date(item.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </Text>
      </View>

      {/* Unread dot */}
      {!item.isRead && (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DS.color.gold, marginTop: 4 }} />
      )}
    </Pressable>
  );
}

export default function P2PNotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<P2PNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getP2PNotifications(50);
      setNotifications(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handlePress = async (item: P2PNotification) => {
    if (!item.isRead) {
      await markNotificationRead(item.id);
      setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, isRead: true } : n));
    }
    if (item.tradeId) {
      router.push(`/(app)/p2p/active-trade?tradeId=${item.tradeId}` as RelativePathString);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm,
        borderBottomWidth: 1, borderBottomColor: DS.color.border,
      }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4, marginRight: DS.space.sm }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <Text style={{ flex: 1, color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>
          Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}
        </Text>
        {unreadCount > 0 && (
          <Pressable onPress={handleMarkAllRead} style={{ padding: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <CheckCheck size={16} color={DS.color.gold} />
            <Text style={{ color: DS.color.gold, fontSize: DS.font.xs }}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : notifications.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: DS.space.xl }}>
          <BellOff size={48} color={DS.color.text3} />
          <Text style={{ color: DS.color.text2, fontSize: DS.font.md, fontWeight: DS.font.semibold, marginTop: DS.space.md }}>
            No notifications yet
          </Text>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, marginTop: 6, textAlign: 'center' }}>
            Trade activity, payment updates, and dispute alerts will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <NotificationItem item={item} onPress={handlePress} />}
          contentInsetAdjustmentBehavior="automatic"
        />
      )}
    </View>
  );
}
