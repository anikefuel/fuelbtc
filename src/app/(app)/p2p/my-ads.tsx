// P2P My Ads — manage your posted ads
import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus, Pause, Play, Trash2, ChevronRight } from 'lucide-react-native';
import { getMyAds, updateAdStatus, type P2PAd } from '@/services/p2p.service';
import { DS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  active: { bg: DS.color.buy + '20', text: DS.color.buy },
  paused: { bg: '#F59E0B20', text: '#F59E0B' },
  completed: { bg: DS.color.text3 + '20', text: DS.color.text3 },
  deleted: { bg: DS.color.sell + '20', text: DS.color.sell },
};

const fiatSymbols: Record<string, string> = {
  NGN: '₦', USD: '$', EUR: '€', GBP: '£', KES: 'KSh', GHS: '₵', ZAR: 'R',
};
const fSym = (code: string) => fiatSymbols[code] ?? code + ' ';

export default function MyAds() {
  const router = useRouter();
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    loadAds();
  }, []));

  async function loadAds() {
    setLoading(true);
    const data = await getMyAds().catch(() => [] as P2PAd[]);
    setAds(data);
    setLoading(false);
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAds();
    setRefreshing(false);
  };

  async function toggleStatus(ad: P2PAd) {
    setActionId(ad.id);
    try {
      const next = ad.status === 'active' ? 'paused' : 'active';
      await updateAdStatus(ad.id, next);
      await loadAds();
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(ad: P2PAd) {
    setActionId(ad.id);
    try {
      await updateAdStatus(ad.id, 'deleted');
      await loadAds();
    } finally {
      setActionId(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
            <ArrowLeft size={22} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>My P2P Ads</Text>
        </View>
        <Pressable onPress={() => router.push('/(app)/p2p/post-ad' as RelativePathString)}
          style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Plus size={14} color={DS.color.bg} />
          <Text style={{ color: DS.color.bg, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>New Ad</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : (
        <FlatList
          data={ads.filter(a => a.status !== 'deleted')}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm, paddingBottom: 80 }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold, fontSize: DS.font.base }}>No ads posted yet</Text>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, textAlign: 'center' }}>Post your first P2P ad to start trading</Text>
            </View>
          }
          renderItem={({ item: ad }) => {
            const ss = STATUS_STYLES[ad.status] ?? STATUS_STYLES.paused;
            const isActioning = actionId === ad.id;
            return (
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                {/* Top row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ backgroundColor: ad.side === 'sell' ? DS.color.sell + '20' : DS.color.buy + '20', borderRadius: DS.radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: ad.side === 'sell' ? DS.color.sell : DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>{ad.side.toUpperCase()}</Text>
                    </View>
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>{ad.asset}/{ad.fiat}</Text>
                  </View>
                  <View style={{ backgroundColor: ss.bg, borderRadius: DS.radius.full, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: ss.text, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'capitalize' }}>{ad.status}</Text>
                  </View>
                </View>

                {/* Price & amounts */}
                <View style={{ marginBottom: DS.space.sm }}>
                  <Text style={{ color: DS.color.gold, fontSize: DS.font.xl, fontWeight: DS.font.extrabold }}>
                    {fSym(ad.fiat)}{ad.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>per {ad.asset}</Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 20, marginBottom: DS.space.sm }}>
                  <View>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>AVAILABLE</Text>
                    <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{ad.availableAmount.toLocaleString()} {ad.asset}</Text>
                  </View>
                  <View>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>LIMIT</Text>
                    <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{fSym(ad.fiat)}{ad.minLimit.toLocaleString()} – {fSym(ad.fiat)}{ad.maxLimit.toLocaleString()}</Text>
                  </View>
                  <View>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>TRADES</Text>
                    <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{ad.tradeCount}</Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={{ flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: DS.color.border, paddingTop: DS.space.sm }}>
                  {isActioning ? (
                    <ActivityIndicator color={DS.color.gold} size="small" />
                  ) : (
                    <>
                      <Pressable onPress={() => toggleStatus(ad)}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, paddingVertical: 8, borderWidth: 1, borderColor: DS.color.border }}>
                        {ad.status === 'active' ? <Pause size={14} color="#F59E0B" /> : <Play size={14} color={DS.color.buy} />}
                        <Text style={{ color: ad.status === 'active' ? '#F59E0B' : DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{ad.status === 'active' ? 'Pause' : 'Activate'}</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDelete(ad)}
                        style={{ backgroundColor: DS.color.sell + '15', borderRadius: DS.radius.lg, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: DS.color.sell + '30' }}>
                        <Trash2 size={16} color={DS.color.sell} />
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
