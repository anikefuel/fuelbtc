// Trade Hub — entry point for Spot and Futures trading
// KYC Tier 1 required for all trading features
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, TrendingUp, BarChart2, Zap } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { TradingService } from '@/services';
import { getProfile } from '@/services/auth.service';
import { KycGateBanner } from '@/components/shared/KycGate';
import type { RelativePathString } from 'expo-router';

const C = DS.color;

type MarketRow = { symbol: string; displaySymbol: string; price: number; changePct: number };

export default function TradeHub() {
  const router = useRouter();
  const [market, setMarket] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userTier, setUserTier] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pairs, profile] = await Promise.all([
        TradingService.getSpotPairs(),
        getProfile(),
      ]);
      setUserTier(profile?.kyc_tier ?? null);
      const top5 = pairs.slice(0, 5);
      const rows = await Promise.all(
        top5.map(async p => {
          try {
            const t = await TradingService.getTicker(p.symbol, p.providerSymbol);
            return {
              symbol: p.symbol,
              displaySymbol: `${p.baseAsset}/${p.quoteAsset}`,
              price: t.price,
              changePct: t.priceChangePct,
            };
          } catch {
            return { symbol: p.symbol, displaySymbol: `${p.baseAsset}/${p.quoteAsset}`, price: 0, changePct: 0 };
          }
        })
      );
      setMarket(rows);
    } catch {
      // market strip is non-critical
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { (async () => { await load(); })(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <ArrowLeft size={22} color={C.text1} />
        </Pressable>
        <Text style={{ color: C.text1, fontWeight: DS.font.extrabold, fontSize: 18 }}>Trade</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* KYC Tier 1 gate banner */}
        <KycGateBanner requiredTier="tier1" featureName="Trading" userTier={userTier} />
        {/* Spot card */}
        <Pressable
          onPress={() => router.push('/(app)/trade/spot' as RelativePathString)}
          style={{ backgroundColor: C.card, borderRadius: DS.radius.xl, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: C.border }}
        >
          <View style={{ width: 48, height: 48, borderRadius: DS.radius.full, backgroundColor: `${C.gold}22`, alignItems: 'center', justifyContent: 'center' }}>
            <BarChart2 size={24} color={C.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 17 }}>Spot Trading</Text>
            <Text style={{ color: C.text3, fontSize: 12, marginTop: 3 }}>Buy &amp; sell crypto at market or limit price</Text>
          </View>
          <Zap size={16} color={C.gold} />
        </Pressable>

        {/* Futures card */}
        <Pressable
          onPress={() => router.push('/(app)/trade/futures' as RelativePathString)}
          style={{ backgroundColor: C.card, borderRadius: DS.radius.xl, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: C.border }}
        >
          <View style={{ width: 48, height: 48, borderRadius: DS.radius.full, backgroundColor: `${C.sell}22`, alignItems: 'center', justifyContent: 'center' }}>
            <TrendingUp size={24} color={C.sell} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 17 }}>Futures (USDT-M)</Text>
            <Text style={{ color: C.text3, fontSize: 12, marginTop: 3 }}>Trade perpetuals with leverage up to 125×</Text>
          </View>
          <Zap size={16} color={C.sell} />
        </Pressable>

        {/* Live market strip */}
        <View style={{ backgroundColor: C.card, borderRadius: DS.radius.xl, padding: 16, borderWidth: 1, borderColor: C.border }}>
          <Text style={{ color: C.text2, fontSize: 11, fontWeight: DS.font.semibold, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>Market Overview</Text>
          {loading ? (
            <ActivityIndicator color={C.gold} />
          ) : market.length === 0 ? (
            <Text style={{ color: C.text3, fontSize: 13 }}>No market data available</Text>
          ) : (
            market.map(m => (
              <View key={m.symbol} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7 }}>
                <Text style={{ color: C.text1, fontWeight: DS.font.semibold, fontSize: 13, flex: 1 }}>{m.displaySymbol}</Text>
                <Text style={{ color: C.text1, fontSize: 13, flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {m.price > 0 ? m.price.toLocaleString('en', { maximumFractionDigits: 4 }) : '—'}
                </Text>
                <Text style={{ color: m.changePct >= 0 ? C.buy : C.sell, fontSize: 12, width: 68, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {m.changePct >= 0 ? '+' : ''}{m.changePct.toFixed(2)}%
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}


