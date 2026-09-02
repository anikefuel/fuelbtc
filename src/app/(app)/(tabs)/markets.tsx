import { useCallback } from 'react';
import { View, Text, Pressable, TextInput, FlatList, RefreshControl, ScrollView, Platform, StatusBar } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Search, Star, TrendingUp, TrendingDown, ArrowUpDown, Wifi, WifiOff, Clock } from 'lucide-react-native';
import { Sparkline } from '@/components/shared/Sparkline';
import { PriceChange } from '@/components/shared/PriceChange';
import { CoinIcon } from '@/components/shared/CoinIcon';
import { SkeletonList } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { useMarkets } from '@/hooks/useMarkets';
import { DS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

const TABS = ['All', 'Spot', 'Futures', 'Favorites'] as const;

export default function MarketsTab() {
  const router = useRouter();
  const {
    filtered, isLoading, error,
    search, setSearch,
    activeTab, setActiveTab,
    sortKey, sortAsc, handleSort,
    favorites, toggleFavorite, isWatchlisted,
    refresh,
    streamState,
  } = useMarkets();

  useFocusEffect(useCallback(() => {
    (async () => { await refresh(); })();
  }, [refresh]));

  // Navigate to the correct trading screen on row tap
  const handleCoinPress = useCallback((symbol: string, marketType: 'spot' | 'futures') => {
    const pair = `${symbol}USDT`;
    if (marketType === 'futures') {
      router.push(`/(app)/trade/futures?symbol=${pair}` as RelativePathString);
    } else {
      router.push(`/(app)/trade/spot?symbol=${pair}` as RelativePathString);
    }
  }, [router]);

  if (error) return <ErrorState message={error} onRetry={refresh} />;

  const pt = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8;

  // Stream status badge
  const streamBadge = streamState === 'live'
    ? { icon: <Wifi size={10} color="#22c55e" />, label: 'Live', color: '#22c55e' }
    : streamState === 'reconnecting'
    ? { icon: <Clock size={10} color="#f59e0b" />, label: 'Reconnecting', color: '#f59e0b' }
    : streamState === 'rest_fallback'
    ? { icon: <Clock size={10} color="#f59e0b" />, label: 'Delayed', color: '#f59e0b' }
    : { icon: <WifiOff size={10} color={DS.color.text3} />, label: 'Offline', color: DS.color.text3 };

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: pt, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, backgroundColor: DS.color.bg, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.extrabold, fontSize: DS.font.xl }}>Markets</Text>
          <View style={{ flexDirection: 'row', gap: DS.space.xs, alignItems: 'center' }}>
            {/* Stream health badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: DS.color.card, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: DS.color.border }}>
              {streamBadge.icon}
              <Text style={{ color: streamBadge.color, fontSize: DS.font.xxxs, fontWeight: DS.font.semibold }}>{streamBadge.label}</Text>
            </View>
            <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TrendingUp size={11} color={DS.color.buy} />
              <Text style={{ color: DS.color.buy, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                {filtered.filter(c => c.change24h >= 0).length} Gainers
              </Text>
            </View>
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TrendingDown size={11} color={DS.color.sell} />
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                {filtered.filter(c => c.change24h < 0).length} Losers
              </Text>
            </View>
          </View>
        </View>

        {/* Search bar */}
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.sm, flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.sm, marginBottom: DS.space.sm, borderWidth: 1.5, borderColor: DS.color.border }}>
          <Search size={15} color={DS.color.text2} />
          <TextInput
            style={{ flex: 1, color: DS.color.text1, fontSize: DS.font.sm, paddingVertical: 10, paddingLeft: 8 }}
            placeholder="Search markets..."
            placeholderTextColor={DS.color.text3}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Category tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
            {TABS.map(t => (
              <Pressable
                key={t}
                onPress={() => setActiveTab(t)}
                style={{
                  paddingHorizontal: DS.space.md, paddingVertical: 7, borderRadius: DS.radius.full,
                  backgroundColor: activeTab === t ? DS.color.gold : DS.color.card,
                  borderWidth: 1,
                  borderColor: activeTab === t ? DS.color.gold : DS.color.border,
                }}
              >
                <Text style={{ color: activeTab === t ? DS.color.bg : DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Column headers */}
      <View style={{ flexDirection: 'row', paddingHorizontal: DS.space.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: DS.color.bgAlt }}>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs, flex: 2.2, letterSpacing: 0.4 }}>PAIR</Text>
        <Pressable onPress={() => handleSort('price')} style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
          <Text style={{ color: sortKey === 'price' ? DS.color.gold : DS.color.text2, fontSize: DS.font.xxs, letterSpacing: 0.4 }}>PRICE</Text>
          <ArrowUpDown size={10} color={sortKey === 'price' ? DS.color.gold : DS.color.text3} />
        </Pressable>
        <Pressable onPress={() => handleSort('change24h')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
          <Text style={{ color: sortKey === 'change24h' ? DS.color.gold : DS.color.text2, fontSize: DS.font.xxs, letterSpacing: 0.4 }}>24H</Text>
          <ArrowUpDown size={10} color={sortKey === 'change24h' ? DS.color.gold : DS.color.text3} />
        </Pressable>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs, flex: 1, textAlign: 'center', letterSpacing: 0.4 }}>CHART</Text>
      </View>

      {isLoading && filtered.length === 0 ? (
        <View style={{ padding: DS.space.md }}>
          <SkeletonList count={8} />
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No results" subtitle={`No coins match "${search}"`} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => `${item.symbol}-${item.marketType}`}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={DS.color.gold} />}
          contentInsetAdjustmentBehavior="automatic"
          renderItem={({ item: coin, index }) => {
            const pos    = coin.change24h >= 0;
            const isFav  = isWatchlisted(coin.symbol);
            return (
              <Pressable
                onPress={() => handleCoinPress(coin.symbol, coin.marketType ?? 'spot')}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: index % 2 === 0 ? DS.color.bg : DS.color.bgAlt }}
              >
                <View style={{ flex: 2.2, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                  <Pressable onPress={() => toggleFavorite(coin.symbol)} hitSlop={8}>
                    <Star size={13} color={isFav ? DS.color.gold : DS.color.text3} fill={isFav ? DS.color.gold : 'none'} />
                  </Pressable>
                  <CoinIcon symbol={coin.symbol} size={32} />
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{coin.symbol}<Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>/USDT</Text></Text>
                      {coin.marketType === 'futures' && (
                        <View style={{ backgroundColor: DS.color.gold + '22', borderRadius: 3, paddingHorizontal: 4 }}>
                          <Text style={{ color: DS.color.gold, fontSize: DS.font.xxxs, fontWeight: DS.font.semibold }}>PERP</Text>
                        </View>
                      )}
                      {coin.isLive && (
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#22c55e' }} />
                      )}
                    </View>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxxs }}>Vol {coin.volume}</Text>
                  </View>
                </View>
                <View style={{ flex: 1.3 }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, textAlign: 'right' }}>
                    ${coin.price < 1 ? coin.price.toFixed(5) : coin.price.toLocaleString()}
                  </Text>
                  {coin.isDelayed && (
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxxs, textAlign: 'right' }}>Delayed</Text>
                  )}
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <PriceChange value={coin.change24h} size="sm" showBg />
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Sparkline data={coin.sparkline} positive={pos} width={56} height={24} showFill />
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
