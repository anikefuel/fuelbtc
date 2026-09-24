import { useState, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, Pressable, RefreshControl, Platform, StatusBar } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Bell, Eye, EyeOff, ChevronRight, TrendingUp, ArrowDownLeft, ArrowUpRight, Repeat2, Sparkles, Zap } from 'lucide-react-native';
import Svg, { Path, Circle } from 'react-native-svg';
// MOCK_TRANSACTIONS removed — home activity uses real ledger entries only
import { Sparkline } from '@/components/shared/Sparkline';
import { PriceChange } from '@/components/shared/PriceChange';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { CoinIcon } from '@/components/shared/CoinIcon';
import { SkeletonCard, SkeletonList } from '@/components/shared/LoadingState';
import { EmptyState } from '@/components/shared/EmptyState';
import { useMarkets } from '@/hooks/useMarkets';
import { useNotifications } from '@/hooks/useNotifications';
import { PortfolioService, LedgerService } from '@/services';
import type { PortfolioAsset } from '@/services/portfolio.service';
import type { LedgerEntry } from '@/services/ledger.service';
import { entryTypeLabel, isCredit } from '@/services/ledger.service';
import type { RelativePathString } from 'expo-router';
import { DS } from '@/lib/design';


function DonutChart({ segments }: { segments: { value: number; color: string }[] }) {
  const total = useMemo(() => segments.reduce((s, x) => s + x.value, 0), [segments]);
  if (total === 0) return null;
  const r = 44, cx = 52, cy = 52, stroke = 12;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.map((seg) => {
    const pct = seg.value / total;
    const dash = pct * circumference;
    const el = (
      <Path
        key={seg.color + offset}
        d={`M ${cx} ${cy - r}`}
        stroke={seg.color}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset * circumference}
        fill="none"
        strokeLinecap="round"
        transform={`rotate(${offset * 360 - 90}, ${cx}, ${cy})`}
      />
    );
    offset += pct;
    return el;
  });
  return (
    <Svg width={104} height={104}>
      <Circle cx={cx} cy={cy} r={r} stroke={DS.color.border} strokeWidth={stroke} fill="none" />
      {arcs}
    </Svg>
  );
}

const QUICK_ACTIONS = [
  { label: 'Deposit',  Icon: ArrowDownLeft,  color: DS.color.buy,  bg: DS.color.buyBg,  route: '/(app)/(tabs)/wallet' },
  { label: 'Withdraw', Icon: ArrowUpRight,   color: DS.color.sell, bg: DS.color.sellBg, route: '/(app)/(tabs)/wallet' },
  { label: 'Trade',    Icon: Repeat2,        color: DS.color.gold, bg: DS.color.goldBg, route: '/(app)/(tabs)/trade'  },
  { label: 'Earn',     Icon: Sparkles,       color: DS.color.info, bg: DS.color.infoBg, route: '/(app)/(tabs)/earn'   },
];

const TX_ICONS: Record<string, typeof ArrowDownLeft> = {
  deposit: ArrowDownLeft, deposit_credit: ArrowDownLeft,
  withdrawal: ArrowUpRight, withdrawal_debit: ArrowUpRight,
  trade: Repeat2, trade_debit: Repeat2, trade_credit: Repeat2,
  reward: Sparkles,
};

export default function HomeTab() {
  const router = useRouter();
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [portfolio, setPortfolio] = useState<{ totalUsd: number; assets: PortfolioAsset[] }>({ totalUsd: 0, assets: [] });
  const [recentActivity, setRecentActivity] = useState<LedgerEntry[]>([]);
  const [loadingWallet, setLoadingWallet] = useState(true);

  const { coins, refresh: refreshMarkets } = useMarkets({ autoRefreshMs: 0 });
  const { unreadCount } = useNotifications();

  const loadWalletData = useCallback(async () => {
    try {
      const [port, entries] = await Promise.all([
        PortfolioService.getPortfolio(),
        LedgerService.getLedgerEntries({ limit: 8 }),
      ]);
      setPortfolio({ totalUsd: port.totalUsd, assets: port.assets });
      setRecentActivity(entries);
    } catch { /* silently degrade — show last known */ }
    finally { setLoadingWallet(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    (async () => { await Promise.all([loadWalletData(), refreshMarkets()]); })();
  }, [loadWalletData, refreshMarkets]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadWalletData(), refreshMarkets()]);
    setRefreshing(false);
  }, [loadWalletData, refreshMarkets]);

  // totalUsd comes from PortfolioService (single source of truth)
  const totalUsd = portfolio.totalUsd;

  const donutSegments = useMemo(() =>
    portfolio.assets.slice(0, 6).map(a => ({
      value: a.usdValue, color: a.color,
    })), [portfolio.assets]);

  const donutLabels = useMemo(() => {
    const total = portfolio.totalUsd || 1;
    return portfolio.assets.slice(0, 6).map(a => ({
      label: a.asset,
      color: a.color,
      pct: `${((a.usdValue / total) * 100).toFixed(1)}%`,
    }));
  }, [portfolio]);

  const marketCoins = coins.slice(0, 6);
  const activityItems = recentActivity;
  const assetCount = portfolio.assets.length; // portfolio is source of truth — no raw accounts state
  const pt = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: DS.color.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
    >
      {/* ── Header ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: DS.space.md, paddingTop: pt, paddingBottom: DS.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.goldBg, borderWidth: 1.5, borderColor: DS.color.gold + '60', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={18} color={DS.color.gold} fill={DS.color.gold} />
          </View>
          <View>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Welcome back</Text>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>ExchangeX</Text>
          </View>
        </View>
        <Pressable onPress={() => router.push('/(app)/profile' as RelativePathString)} style={{ position: 'relative', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Bell size={22} color={DS.color.text2} />
          {unreadCount > 0 && (
            <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: DS.radius.full, backgroundColor: DS.color.sell, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <Text style={{ color: '#fff', fontSize: 9, fontWeight: DS.font.extrabold }}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ── Portfolio Balance Card ── */}
      <View style={{ marginHorizontal: DS.space.md, marginTop: DS.space.xs, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.lg, borderWidth: 1, borderColor: DS.color.border }}>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, letterSpacing: 0.4, marginBottom: 6 }}>TOTAL PORTFOLIO VALUE</Text>
        <Pressable onPress={() => setBalanceHidden(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {loadingWallet ? (
            <View style={{ gap: 8 }}>
              <View style={{ width: 160, height: 36, backgroundColor: DS.color.surface, borderRadius: DS.radius.sm }} />
              <View style={{ width: 80, height: 14, backgroundColor: DS.color.surface, borderRadius: DS.radius.xs }} />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.xxxl, fontWeight: DS.font.extrabold, letterSpacing: -0.5 }}>
                {balanceHidden ? '••••••' : `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <TrendingUp size={13} color={DS.color.buy} />
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
                  {assetCount > 0 ? `${assetCount} assets in ledger` : 'Deposit to get started'}
                </Text>
              </View>
            </View>
          )}
          {balanceHidden ? <EyeOff size={20} color={DS.color.text2} /> : <Eye size={20} color={DS.color.text2} />}
        </Pressable>

        {/* Quick Actions */}
        <View style={{ flexDirection: 'row', marginTop: DS.space.md, gap: DS.space.xs }}>
          {QUICK_ACTIONS.map(({ label, Icon, color, bg, route }) => (
            <Pressable
              key={label}
              onPress={() => router.push(route as RelativePathString)}
              style={{ flex: 1, alignItems: 'center', gap: 6 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: DS.radius.full, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color + '30' }}>
                <Icon size={19} color={color} />
              </View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs, fontWeight: DS.font.medium }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── Asset Allocation ── */}
      <View style={{ marginHorizontal: DS.space.md, marginTop: DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
        <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.base, marginBottom: DS.space.sm }}>Asset Allocation</Text>
        {donutSegments.length === 0 ? (
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', paddingVertical: DS.space.md }}>
            No assets yet — deposit to see your allocation
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.md }}>
            <DonutChart segments={donutSegments} />
            <View style={{ flex: 1, gap: 8 }}>
              {donutLabels.map(l => (
                <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                  <View style={{ width: 8, height: 8, borderRadius: DS.radius.full, backgroundColor: l.color }} />
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, flex: 1 }}>{l.label}</Text>
                  <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{l.pct}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* ── Market Overview ── */}
      <View style={{ marginHorizontal: DS.space.md, marginTop: DS.space.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.base }}>Market</Text>
          <Pressable onPress={() => router.push('/(app)/(tabs)/markets' as RelativePathString)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text style={{ color: DS.color.gold, fontSize: DS.font.xs }}>See All</Text>
            <ChevronRight size={13} color={DS.color.gold} />
          </Pressable>
        </View>
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden' }}>
          {marketCoins.length === 0 ? (
            <SkeletonList count={4} />
          ) : marketCoins.map((coin, i) => (
            <Pressable
              key={coin.symbol}
              onPress={() => router.push('/(app)/(tabs)/markets' as RelativePathString)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, borderBottomWidth: i < marketCoins.length - 1 ? 1 : 0, borderBottomColor: DS.color.border }}
            >
              <CoinIcon symbol={coin.symbol} size={36} style={{ marginRight: DS.space.sm }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{coin.symbol}</Text>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>{coin.name}</Text>
              </View>
              <View style={{ alignItems: 'center', marginRight: DS.space.md }}>
                <Sparkline data={coin.sparkline} positive={coin.change24h >= 0} width={56} height={26} showFill />
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
                  ${coin.price < 1 ? coin.price.toFixed(4) : coin.price.toLocaleString()}
                </Text>
                <PriceChange value={coin.change24h} size="sm" showBg />
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── Recent Activity ── */}
      <View style={{ marginHorizontal: DS.space.md, marginTop: DS.space.md, marginBottom: DS.space.xxxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.base }}>Recent Activity</Text>
          <Pressable onPress={() => router.push('/(app)/(tabs)/wallet' as RelativePathString)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text style={{ color: DS.color.gold, fontSize: DS.font.xs }}>History</Text>
            <ChevronRight size={13} color={DS.color.gold} />
          </Pressable>
        </View>
        {loadingWallet ? (
          <SkeletonCard rows={3} />
        ) : activityItems.length === 0 ? (
          <EmptyState icon="📋" title="No activity yet" subtitle="Your transactions will appear here" actionLabel="Start Trading" onAction={() => router.push('/(app)/(tabs)/trade' as RelativePathString)} />
        ) : (
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden' }}>
            {activityItems.map((item, i) => {
              const entry = item as LedgerEntry;
              const credit = isCredit(entry.entryType);
              const color = credit ? DS.color.buy : DS.color.sell;
              const IconComp = TX_ICONS[entry.entryType] ?? ArrowDownLeft;
              return (
                <View key={entry.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, borderBottomWidth: i < activityItems.length - 1 ? 1 : 0, borderBottomColor: DS.color.border }}>
                  <View style={{ width: 38, height: 38, borderRadius: DS.radius.full, backgroundColor: credit ? DS.color.buyBg : DS.color.sellBg, alignItems: 'center', justifyContent: 'center', marginRight: DS.space.sm, borderWidth: 1, borderColor: color + '30' }}>
                    <IconComp size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.medium, fontSize: DS.font.sm }}>{entryTypeLabel(entry.entryType)}</Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>{new Date(entry.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <Text style={{ color, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
                    {credit ? '+' : '-'}{Math.abs(credit ? entry.credit : entry.debit).toFixed(6)} {entry.asset}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
