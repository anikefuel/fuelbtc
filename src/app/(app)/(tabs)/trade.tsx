// Trade Hub tab — entry point for Spot and Futures trading
// Shows both trading modes prominently plus a live market overview strip
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  BarChart2, TrendingUp, ArrowRight, Zap, ChevronRight,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import { TradingService } from '@/services';
import { PriceChange } from '@/components/shared/PriceChange';
import type { MarketTicker } from '@/services/trading.service';
import type { RelativePathString } from 'expo-router';

const C = DS.color;

interface PairTicker { symbol: string; price: number; pct: number; }

export default function TradeHubTab() {
  const router = useRouter();
  const [tickers, setTickers]     = useState<PairTicker[]>([]);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadTickers = useCallback(async () => {
    setLoading(true);
    try {
      const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT'];
      const results = await Promise.allSettled(
        SYMBOLS.map(s => TradingService.getTicker(s, s))
      );
      setTickers(results
        .map((r, i) => r.status === 'fulfilled'
          ? { symbol: SYMBOLS[i].replace('USDT', '/USDT'), price: r.value.price, pct: r.value.priceChangePct }
          : null
        )
        .filter(Boolean) as PairTicker[]
      );
    } catch { /* ignore */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    (async () => { await loadTickers(); })();
  }, [loadTickers]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTickers(); }} tintColor={C.gold} />}
    >
      {/* ── Header ── */}
      <View style={{ paddingTop: 56, paddingHorizontal: 20, paddingBottom: 8 }}>
        <Text style={{ color: C.text1, fontSize: 28, fontWeight: DS.font.extrabold, letterSpacing: -0.5 }}>Trade</Text>
        <Text style={{ color: C.text3, fontSize: DS.font.sm, marginTop: 2 }}>Spot & Futures · Real wallet integration</Text>
      </View>

      {/* ── Mode Cards ── */}
      <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 8 }}>

        {/* Spot */}
        <Pressable
          onPress={() => router.push('/(app)/trade/spot' as RelativePathString)}
          style={{ backgroundColor: C.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.buy + '22', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.buy + '40' }}>
                <BarChart2 size={24} color={C.buy} />
              </View>
              <View>
                <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 18 }}>Spot Trading</Text>
                <Text style={{ color: C.text3, fontSize: DS.font.sm, marginTop: 2 }}>Buy & sell at market or limit price</Text>
              </View>
            </View>
            <ChevronRight size={20} color={C.text3} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {['Market', 'Limit', 'Stop-Limit', 'OCO'].map(t => (
              <View key={t} style={{ backgroundColor: C.buy + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: C.buy, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{t}</Text>
              </View>
            ))}
          </View>
        </Pressable>

        {/* Futures */}
        <Pressable
          onPress={() => router.push('/(app)/trade/futures' as RelativePathString)}
          style={{ backgroundColor: C.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.gold + '22', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.gold + '40' }}>
                <TrendingUp size={24} color={C.gold} />
              </View>
              <View>
                <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 18 }}>Futures Trading</Text>
                <Text style={{ color: C.text3, fontSize: DS.font.sm, marginTop: 2 }}>USDT-margined perpetuals · up to 125×</Text>
              </View>
            </View>
            <ChevronRight size={20} color={C.text3} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {['Cross Margin', 'Isolated', 'TP/SL', 'Liquidation Guard'].map(t => (
              <View key={t} style={{ backgroundColor: C.gold + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: C.gold, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{t}</Text>
              </View>
            ))}
          </View>
          {/* Live badge */}
          <View style={{ position: 'absolute', top: 14, right: 44, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.gold + '20', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Zap size={10} color={C.gold} fill={C.gold} />
            <Text style={{ color: C.gold, fontSize: 9, fontWeight: DS.font.bold }}>LIVE WS</Text>
          </View>
        </Pressable>
      </View>

      {/* ── Market Overview ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: C.text1, fontSize: DS.font.md, fontWeight: DS.font.bold }}>Market Overview</Text>
        <Pressable onPress={() => router.push('/(app)/(tabs)/markets' as RelativePathString)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ color: C.gold, fontSize: DS.font.sm }}>All Markets</Text>
          <ArrowRight size={14} color={C.gold} />
        </Pressable>
      </View>

      {loading && tickers.length === 0 ? (
        <ActivityIndicator color={C.gold} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={tickers}
          keyExtractor={item => item.symbol}
          scrollEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push('/(app)/trade/spot' as RelativePathString)}
              style={{ backgroundColor: C.card, borderRadius: DS.radius.xl, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.goldBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text style={{ color: C.gold, fontWeight: DS.font.bold, fontSize: 11 }}>{item.symbol.split('/')[0].slice(0,3)}</Text>
              </View>
              <Text style={{ color: C.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, flex: 1 }}>{item.symbol}</Text>
              <Text style={{ color: C.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm, marginRight: 12 }}>
                {item.price < 1 ? item.price.toFixed(4) : item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              <PriceChange value={item.pct} />
            </Pressable>
          )}
        />
      )}
    </ScrollView>
  );
}

