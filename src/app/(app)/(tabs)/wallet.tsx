// Wallet Hub — overview of all wallet types with quick actions
import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import {
  Wallet, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Eye, EyeOff,
  ChevronRight, TrendingUp, Shield, Clock, Layers, AlertTriangle,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import { WalletService, PortfolioService } from '@/services';
import type { WalletBalance, WalletType } from '@/services/wallet.service';
import { WALLET_LABELS } from '@/services/wallet.service';
import type { PortfolioSummary } from '@/services/portfolio.service';

const WALLET_ICONS: Record<WalletType, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  spot: Layers,
  funding: Wallet,
  p2p: ArrowLeftRight,
  escrow: Shield,
  futures: TrendingUp,
  margin: TrendingUp,
  earn: TrendingUp,
};

const WALLET_COLORS: Record<WalletType, string> = {
  spot: DS.color.gold,
  funding: DS.color.info,
  p2p: DS.color.buy,
  escrow: DS.color.warn,
  futures: DS.color.sell,
  margin: '#9945FF',
  earn: '#0ECB81',
};

type WalletGroup = { walletType: WalletType; totalUsd: number; balances: WalletBalance[]; assetCount: number };

const VISIBLE_WALLET_TYPES: WalletType[] = ['spot', 'funding', 'p2p', 'escrow'];

export default function WalletHub() {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [hideBalances, setHideBalances] = useState(false);
  const [totalUsd, setTotalUsd] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      // Use PortfolioService as the single source of truth for prices + USD totals
      const [bals, port] = await Promise.all([
        WalletService.getWalletBalances(),
        PortfolioService.getPortfolio(),
      ]);
      setBalances(bals);
      // Build price map from portfolio assets (already priced correctly with USDT pairs)
      const priceMap: Record<string, number> = {};
      for (const a of port.assets) priceMap[a.asset] = a.priceUsd;
      setPrices(priceMap);
      setTotalUsd(port.totalUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { (async () => { await load(); })(); }, [load]));

  const onRefresh = () => { setRefreshing(true); (async () => { await load(); })(); };

  const groupByWalletType = (): WalletGroup[] => {
    const map = new Map<WalletType, WalletBalance[]>();
    for (const b of balances) {
      if (!VISIBLE_WALLET_TYPES.includes(b.walletType)) continue;
      const arr = map.get(b.walletType) ?? [];
      arr.push(b);
      map.set(b.walletType, arr);
    }
    return VISIBLE_WALLET_TYPES.map(wt => {
      const bals = map.get(wt) ?? [];
      let usd = 0;
      for (const b of bals) usd += b.availableBalance * (prices[b.asset] ?? 0);
      return { walletType: wt, totalUsd: usd, balances: bals, assetCount: bals.filter(b => b.balance > 0).length };
    });
  };

  const fmt = (n: number) => hideBalances ? '••••••' : `$${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtCrypto = (n: number, asset: string) => {
    if (hideBalances) return '••••';
    const dec = { BTC: 8, ETH: 6, SOL: 4, XRP: 4 }[asset] ?? 2;
    return n.toFixed(dec);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={DS.color.gold} size="large" />
      </View>
    );
  }

  if (error !== '') {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, justifyContent: 'center', alignItems: 'center', padding: DS.space.lg }}>
        <AlertTriangle size={40} color={DS.color.sell} style={{ marginBottom: DS.space.md }} />
        <Text style={{ color: DS.color.text1, fontSize: 16, fontWeight: DS.font.bold, textAlign: 'center', marginBottom: DS.space.sm }}>Failed to Load Wallet</Text>
        <Text style={{ color: DS.color.text3, fontSize: 13, textAlign: 'center', marginBottom: DS.space.lg }}>{error}</Text>
        <Pressable onPress={() => { setLoading(true); (async () => { await load(); })(); }}
          style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.xl, paddingVertical: DS.space.md }}>
          <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: 15 }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const groups = groupByWalletType();
  const spotBalances = balances.filter(b => b.walletType === 'spot' && b.balance > 0)
    .sort((a, b) => (b.availableBalance * (prices[b.asset] ?? 0)) - (a.availableBalance * (prices[a.asset] ?? 0)));

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: DS.color.text1, fontSize: 22, fontWeight: DS.font.bold }}>Wallet</Text>
          <Pressable onPress={() => setHideBalances(v => !v)}
            style={{ padding: 8 }}>
            {hideBalances
              ? <EyeOff size={20} color={DS.color.text2} />
              : <Eye size={20} color={DS.color.text2} />}
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Total Balance Card */}
        <View style={{
          marginHorizontal: DS.space.md, marginBottom: DS.space.md,
          backgroundColor: DS.color.card, borderRadius: DS.radius.xl,
          padding: DS.space.lg, borderWidth: 1, borderColor: DS.color.border,
        }}>
          <Text style={{ color: DS.color.text2, fontSize: 13, marginBottom: 6 }}>Total Balance (Estimated)</Text>
          <Text style={{ color: DS.color.text1, fontSize: 32, fontWeight: DS.font.bold, marginBottom: 4 }}>
            {fmt(totalUsd)}
          </Text>
          <Text style={{ color: DS.color.text3, fontSize: 12 }}>Spot + Funding + P2P</Text>

          {/* Quick Actions */}
          <View style={{ flexDirection: 'row', gap: DS.space.sm, marginTop: DS.space.lg }}>
            {[
              { label: 'Deposit', icon: ArrowDownLeft, color: DS.color.buy, route: '/(app)/wallet/deposit' },
              { label: 'Withdraw', icon: ArrowUpRight, color: DS.color.sell, route: '/(app)/wallet/withdraw' },
              { label: 'Transfer', icon: ArrowLeftRight, color: DS.color.info, route: '/(app)/wallet/transfer' },
              { label: 'History', icon: Clock, color: DS.color.text2, route: '/(app)/wallet/history' },
            ].map(({ label, icon: Icon, color, route }) => (
              <Pressable
                key={label}
                onPress={() => router.push(route as never)}
                style={{ flex: 1, alignItems: 'center', gap: 6 }}
              >
                <View style={{
                  width: 48, height: 48, borderRadius: DS.radius.full,
                  backgroundColor: DS.color.surface,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: DS.color.border,
                }}>
                  <Icon size={20} color={color} />
                </View>
                <Text style={{ color: DS.color.text2, fontSize: 11, fontWeight: DS.font.medium }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Wallet Type Cards */}
        <Text style={{ color: DS.color.text2, fontSize: 12, fontWeight: DS.font.semibold, letterSpacing: 0.8, paddingHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
          WALLET ACCOUNTS
        </Text>
        <View style={{ gap: DS.space.xs, paddingHorizontal: DS.space.md, marginBottom: DS.space.lg }}>
          {groups.map(g => {
            const Icon = WALLET_ICONS[g.walletType];
            const accentColor = WALLET_COLORS[g.walletType];
            const isComingSoon = ['futures', 'margin', 'earn'].includes(g.walletType);
            return (
              <Pressable
                key={g.walletType}
                onPress={() => !isComingSoon && router.push(`/(app)/wallet/history?walletType=${g.walletType}` as never)}
                style={{
                  backgroundColor: DS.color.card, borderRadius: DS.radius.lg,
                  padding: DS.space.md, flexDirection: 'row', alignItems: 'center',
                  borderWidth: 1, borderColor: DS.color.border,
                }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: DS.radius.md,
                  backgroundColor: `${accentColor}18`,
                  alignItems: 'center', justifyContent: 'center', marginRight: DS.space.md,
                }}>
                  <Icon size={20} color={accentColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: DS.color.text1, fontSize: 15, fontWeight: DS.font.semibold }}>
                      {WALLET_LABELS[g.walletType]}
                    </Text>
                    {isComingSoon && (
                      <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: DS.color.text3, fontSize: 9, fontWeight: DS.font.bold }}>SOON</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: DS.color.text3, fontSize: 12, marginTop: 2 }}>
                    {isComingSoon ? 'Coming soon' : `${g.assetCount} asset${g.assetCount !== 1 ? 's' : ''}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: DS.color.text1, fontSize: 15, fontWeight: DS.font.bold }}>
                    {isComingSoon ? '—' : fmt(g.totalUsd)}
                  </Text>
                  <ChevronRight size={16} color={DS.color.text3} style={{ marginTop: 2 }} />
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Spot Asset List */}
        {spotBalances.length > 0 && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontSize: 12, fontWeight: DS.font.semibold, letterSpacing: 0.8 }}>
                SPOT ASSETS
              </Text>
              <Pressable onPress={() => router.push('/(app)/wallet/history' as never)}>
                <Text style={{ color: DS.color.gold, fontSize: 12 }}>See All</Text>
              </Pressable>
            </View>
            <View style={{ gap: 1, paddingHorizontal: DS.space.md, marginBottom: DS.space.xxxl }}>
              {spotBalances.slice(0, 8).map(b => {
                const price = prices[b.asset] ?? 0;
                const usdVal = b.availableBalance * price;
                const meta = { BTC: '#F7931A', ETH: '#627EEA', USDT: '#26A17B', USDC: '#2775CA', BNB: '#F0B90B', SOL: '#9945FF', XRP: '#346AA9', TRX: '#EF0027' }[b.asset] ?? DS.color.text2;
                return (
                  <Pressable
                    key={b.asset}
                    onPress={() => router.push(`/(app)/wallet/deposit?asset=${b.asset}` as never)}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      backgroundColor: DS.color.card, padding: DS.space.md,
                      borderRadius: DS.radius.md, marginBottom: DS.space.xxs,
                      borderWidth: 1, borderColor: DS.color.border,
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: DS.radius.full,
                      backgroundColor: `${meta}22`, alignItems: 'center', justifyContent: 'center',
                      marginRight: DS.space.md,
                    }}>
                      <Text style={{ color: meta, fontSize: 11, fontWeight: DS.font.bold }}>{b.asset.slice(0, 3)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: DS.color.text1, fontSize: 14, fontWeight: DS.font.semibold }}>{b.asset}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 1 }}>
                        {WalletService.ASSET_META[b.asset]?.name ?? b.asset}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: DS.color.text1, fontSize: 14, fontWeight: DS.font.semibold }}>
                        {fmtCrypto(b.availableBalance, b.asset)}
                      </Text>
                      <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 1 }}>{fmt(usdVal)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {spotBalances.length === 0 && !loading && (
          <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: DS.space.lg }}>
            <Wallet size={48} color={DS.color.text3} strokeWidth={1.2} />
            <Text style={{ color: DS.color.text2, fontSize: 16, fontWeight: DS.font.semibold, marginTop: DS.space.md }}>
              No assets yet
            </Text>
            <Text style={{ color: DS.color.text3, fontSize: 13, textAlign: 'center', marginTop: DS.space.xs }}>
              Deposit crypto to get started
            </Text>
            <Pressable
              onPress={() => router.push('/(app)/wallet/deposit' as never)}
              style={{
                marginTop: DS.space.lg, backgroundColor: DS.color.gold, borderRadius: DS.radius.lg,
                paddingHorizontal: DS.space.lg, paddingVertical: DS.space.sm,
              }}
            >
              <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: 14 }}>Deposit Now</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
