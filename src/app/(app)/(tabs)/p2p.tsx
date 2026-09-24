// P2P Marketplace — full Binance-style P2P with coin/fiat selectors, filters, ad cards
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, FlatList, TextInput, Modal,
  ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SlidersHorizontal, X, ChevronDown, Star,
  Clock, Zap, Plus, Wifi, Wallet, Bell,
} from 'lucide-react-native';
import {
  getP2PAds, getP2PAssets, getP2PFiats, getP2PCountries, getP2PPaymentMethods,
  getUnreadNotificationCount,
  type P2PAd, type P2PAsset, type P2PFiat, type P2PCountry, type P2PPaymentMethod,
  type P2PAdsFilter,
} from '@/services/p2p.service';
import { supabase } from '@/client/supabase';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import type { RelativePathString } from 'expo-router';

type Side = 'Buy' | 'Sell';

// ─── Fiat symbol helper ──────────────────────────────────────────────────────
const fiatSymbols: Record<string, string> = {
  NGN: '₦', USD: '$', EUR: '€', GBP: '£', KES: 'KSh', GHS: '₵',
  ZAR: 'R', UGX: 'USh', TZS: 'TSh', AED: 'د.إ', INR: '₹', PKR: '₨',
  IDR: 'Rp', MYR: 'RM', BRL: 'R$', MXN: '$', TRY: '₺', EGP: 'E£',
};
const fiatSym = (code: string) => fiatSymbols[code] ?? code + ' ';

// ─── Merchant badges ─────────────────────────────────────────────────────────
function MerchantBadges({ m }: { m: P2PAd['merchant'] }) {
  if (!m) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
      {m.isVerified && <Badge label="Verified" color={DS.color.buy} />}
      {m.isPro && <Badge label="Pro" color={DS.color.gold} />}
      {m.completionRate >= 95 && <Badge label="High CR" color="#8B5CF6" />}
      {m.avgReleaseTime > 0 && m.avgReleaseTime <= 5 && <Badge label="Fast" color="#0EA5E9" />}
    </View>
  );
}
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ backgroundColor: color + '22', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: 9, fontWeight: DS.font.bold }}>{label}</Text>
    </View>
  );
}

// ─── Ad Card ─────────────────────────────────────────────────────────────────
function AdCard({ ad, side, onPress }: { ad: P2PAd; side: Side; onPress: () => void }) {
  const m = ad.merchant;
  const initial = (m?.displayName ?? 'U')[0].toUpperCase();
  const ctaBg = side === 'Buy' ? DS.color.buy : DS.color.sell;

  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}
    >
      {/* Merchant row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.gold + '40' }}>
            <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{initial}</Text>
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{m?.displayName ?? 'Merchant'}</Text>
              {m?.isOnline && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: DS.color.buy }} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Star size={10} color={DS.color.gold} fill={DS.color.gold} />
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>
                {ad.tradeCount} trades · {ad.completionRate}%
              </Text>
              {ad.avgReleaseTime > 0 && (
                <>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>·</Text>
                  <Clock size={9} color={DS.color.text3} />
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{ad.avgReleaseTime}m release</Text>
                </>
              )}
            </View>
          </View>
        </View>
        <MerchantBadges m={m} />
      </View>

      {/* Price */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 }}>
        <Text style={{ color: DS.color.gold, fontSize: 24, fontWeight: DS.font.extrabold, letterSpacing: -0.5 }}>
          {fiatSym(ad.fiat)}{ad.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, marginBottom: 4, marginLeft: 5 }}>/ {ad.asset}</Text>
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', gap: 20, marginBottom: 10 }}>
        <View>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxxs, letterSpacing: 0.4 }}>AVAILABLE</Text>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>
            {ad.availableAmount.toLocaleString()} {ad.asset}
          </Text>
        </View>
        <View>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxxs, letterSpacing: 0.4 }}>LIMIT ({ad.fiat})</Text>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>
            {fiatSym(ad.fiat)}{ad.minLimit.toLocaleString()} – {fiatSym(ad.fiat)}{ad.maxLimit.toLocaleString()}
          </Text>
        </View>
        <View>
          <Text style={{ color: DS.color.text3, fontSize: DS.font.xxxs, letterSpacing: 0.4 }}>WINDOW</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Zap size={10} color={DS.color.gold} />
            <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{ad.paymentWindow}m</Text>
          </View>
        </View>
      </View>

      {/* Payment methods */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', flex: 1 }}>
          {ad.paymentMethods.slice(0, 3).map(pm => (
            <View key={pm} style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xxxs }}>{pm}</Text>
            </View>
          ))}
          {ad.paymentMethods.length > 3 && (
            <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xs, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxxs }}>+{ad.paymentMethods.length - 3}</Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={onPress}
          style={{ backgroundColor: ctaBg, borderRadius: DS.radius.md, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.xs }}>{side}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Selector Modal ───────────────────────────────────────────────────────────
function SelectorModal<T>({
  visible, title, items, selected, getKey, getLabel, onSelect, onClose,
}: {
  visible: boolean; title: string;
  items: T[]; selected: string;
  getKey: (i: T) => string; getLabel: (i: T) => string;
  onSelect: (key: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>{title}</Text>
          <Pressable onPress={onClose} style={{ padding: 4 }}>
            <X size={20} color={DS.color.text2} />
          </Pressable>
        </View>
        <ScrollView contentInsetAdjustmentBehavior="automatic">
          <View style={{ padding: DS.space.md, gap: DS.space.xs }}>
            <Pressable
              onPress={() => { onSelect(''); onClose(); }}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: DS.space.sm, borderRadius: DS.radius.lg, backgroundColor: selected === '' ? DS.color.goldBg : DS.color.card }}
            >
              <Text style={{ color: selected === '' ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold }}>All</Text>
              {selected === '' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DS.color.gold }} />}
            </Pressable>
            {items.map(item => {
              const key = getKey(item);
              const isSelected = key === selected;
              return (
                <Pressable
                  key={key}
                  onPress={() => { onSelect(key); onClose(); }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: DS.space.sm, borderRadius: DS.radius.lg, backgroundColor: isSelected ? DS.color.goldBg : DS.color.card }}
                >
                  <Text style={{ color: isSelected ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold }}>{getLabel(item)}</Text>
                  {isSelected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DS.color.gold }} />}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Filter Drawer ────────────────────────────────────────────────────────────
function FilterDrawer({
  visible, onClose,
  paymentMethods, selectedPayment, onSelectPayment,
  verifiedOnly, onToggleVerified,
  onlineOnly, onToggleOnline,
  minCompletion, onMinCompletion,
  sortBy, onSortBy,
  onApply,
}: {
  visible: boolean; onClose: () => void;
  paymentMethods: P2PPaymentMethod[]; selectedPayment: string; onSelectPayment: (v: string) => void;
  verifiedOnly: boolean; onToggleVerified: () => void;
  onlineOnly: boolean; onToggleOnline: () => void;
  minCompletion: string; onMinCompletion: (v: string) => void;
  sortBy: string; onSortBy: (v: string) => void;
  onApply: () => void;
}) {
  const sorts = [
    { key: 'price', label: 'Best Price' },
    { key: 'completion_rate', label: 'Completion Rate' },
    { key: 'avg_release_time', label: 'Fastest Release' },
    { key: 'trade_count', label: 'Most Trades' },
  ];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>Filters</Text>
          <Pressable onPress={onClose}><X size={20} color={DS.color.text2} /></Pressable>
        </View>
        <ScrollView contentInsetAdjustmentBehavior="automatic">
          <View style={{ padding: DS.space.md, gap: DS.space.lg }}>
            {/* Sort */}
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: 8 }}>SORT BY</Text>
              <View style={{ gap: 6 }}>
                {sorts.map(s => (
                  <Pressable key={s.key} onPress={() => onSortBy(s.key)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: DS.space.sm, borderRadius: DS.radius.lg, backgroundColor: sortBy === s.key ? DS.color.goldBg : DS.color.card }}>
                    <Text style={{ color: sortBy === s.key ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>{s.label}</Text>
                    {sortBy === s.key && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DS.color.gold }} />}
                  </Pressable>
                ))}
              </View>
            </View>
            {/* Payment method */}
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: 8 }}>PAYMENT METHOD</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[{ slug: '', name: 'All' }, ...paymentMethods].map(pm => (
                    <Pressable key={pm.slug} onPress={() => onSelectPayment(pm.slug)}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: DS.radius.full, backgroundColor: selectedPayment === pm.slug ? DS.color.gold : DS.color.card }}>
                      <Text style={{ color: selectedPayment === pm.slug ? DS.color.bg : DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{pm.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
            {/* Toggles */}
            <View style={{ gap: 10 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>FILTERS</Text>
              {[
                { label: 'Verified merchants only', value: verifiedOnly, toggle: onToggleVerified },
                { label: 'Online merchants only', value: onlineOnly, toggle: onToggleOnline },
              ].map(item => (
                <Pressable key={item.label} onPress={item.toggle}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: DS.space.sm, borderRadius: DS.radius.lg, backgroundColor: DS.color.card }}>
                  <Text style={{ color: DS.color.text1, fontSize: DS.font.sm }}>{item.label}</Text>
                  <View style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: item.value ? DS.color.gold : DS.color.border, justifyContent: 'center', paddingHorizontal: 2 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: item.value ? 'flex-end' : 'flex-start' }} />
                  </View>
                </Pressable>
              ))}
            </View>
            {/* Min completion */}
            <View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: 8 }}>MIN COMPLETION RATE (%)</Text>
              <TextInput
                value={minCompletion}
                onChangeText={onMinCompletion}
                keyboardType="numeric" placeholder="e.g. 90"
                placeholderTextColor={DS.color.text3}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, color: DS.color.text1, borderWidth: 1, borderColor: DS.color.border }}
              />
            </View>
          </View>
        </ScrollView>
        <View style={{ padding: DS.space.md, borderTopWidth: 1, borderTopColor: DS.color.border }}>
          <Pressable onPress={onApply}
            style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center' }}>
            <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Apply Filters</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main P2P Screen ──────────────────────────────────────────────────────────
export default function P2PMarketplace() {
  const router = useRouter();
  const [side, setSide] = useState<Side>('Buy');
  const [asset, setAsset] = useState('USDT');
  const [fiat, setFiat] = useState('NGN');

  const [assets, setAssets] = useState<P2PAsset[]>([]);
  const [fiats, setFiats] = useState<P2PFiat[]>([]);
  const [countries, setCountries] = useState<P2PCountry[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<P2PPaymentMethod[]>([]);
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Selectors
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [showFiatPicker, setShowFiatPicker] = useState(false);
  const [showFilter, setShowFilter] = useState(false);

  // Fund Balance modal
  const [showFundModal, setShowFundModal] = useState(false);
  const [fundAsset, setFundAsset] = useState('USDT');
  const [fundAmount, setFundAmount] = useState('');
  const [fundLoading, setFundLoading] = useState(false);
  const [fundSuccess, setFundSuccess] = useState('');
  const [fundError, setFundError] = useState('');
  const FUND_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP'];

  const handleFundBalance = async () => {
    const amt = parseFloat(fundAmount);
    if (!amt || amt <= 0) { setFundError('Enter a valid amount'); return; }
    setFundLoading(true); setFundError(''); setFundSuccess('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      // Ensure wallets exist for this user (safe no-op if already initialised)
      await supabase.rpc('ensure_user_wallets', { p_user_id: user.id });
      const { error } = await supabase.rpc('p2p_fund_wallet', {
        p_user_id: user.id, p_asset: fundAsset, p_amount: amt,
      });
      if (error) throw new Error(error.message);
      setFundSuccess(`${amt} ${fundAsset} funded to your spot wallet!`);
      setFundAmount('');
      setTimeout(() => { setShowFundModal(false); setFundSuccess(''); }, 2000);
    } catch (e) {
      setFundError(toUserMessage(e, 'Funding failed. Please try again.'));
    } finally { setFundLoading(false); }
  };

  // Filter state
  const [paymentFilter, setPaymentFilter] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [minCompletion, setMinCompletion] = useState('');
  const [sortBy, setSortBy] = useState<string>('price');

  // Load reference data once
  useEffect(() => {
    (async () => {
      const [a, f, c] = await Promise.all([getP2PAssets(), getP2PFiats(), getP2PCountries()]);
      setAssets(a); setFiats(f); setCountries(c);
    })();
  }, []);

  // Refresh unread count on focus
  useFocusEffect(useCallback(() => {
    getUnreadNotificationCount().then(setUnreadCount).catch(() => {});
  }, []));

  // Load payment methods when fiat changes
  useEffect(() => {
    getP2PPaymentMethods(fiat).then(setPaymentMethods).catch(() => {});
  }, [fiat]);

  const loadAds = useCallback(async () => {
    setLoading(true);
    try {
      const filter: P2PAdsFilter = {
        side: side.toLowerCase() as 'buy' | 'sell',
        asset, fiat,
        paymentMethod: paymentFilter || undefined,
        verifiedOnly: verifiedOnly || undefined,
        onlineOnly: onlineOnly || undefined,
        minCompletionRate: minCompletion ? Number(minCompletion) : undefined,
        sortBy: sortBy as P2PAdsFilter['sortBy'],
      };
      const result = await getP2PAds(filter);
      setAds(result);
    } catch {
      setAds([]);
    } finally {
      setLoading(false);
    }
  }, [side, asset, fiat, paymentFilter, verifiedOnly, onlineOnly, minCompletion, sortBy]);

  useFocusEffect(useCallback(() => { loadAds(); }, [loadAds]));

  const onRefresh = async () => { setRefreshing(true); await loadAds(); setRefreshing(false); };

  const handleAdPress = (ad: P2PAd) => {
    router.push(`/(app)/p2p/trade-confirm?adId=${ad.id}&side=${side}` as RelativePathString);
  };

  const selectedFiatSym = fiats.find(f2 => f2.code === fiat)?.symbol ?? fiat;

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, backgroundColor: DS.color.bg, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.xl, fontWeight: DS.font.extrabold }}>P2P Trading</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {/* Notification bell with unread badge */}
            <Pressable
              onPress={() => router.push('/(app)/p2p/notifications' as RelativePathString)}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
              <Bell size={16} color={unreadCount > 0 ? DS.color.gold : DS.color.text2} />
              {unreadCount > 0 && (
                <View style={{
                  position: 'absolute', top: -3, right: -3,
                  minWidth: 16, height: 16, borderRadius: 8,
                  backgroundColor: DS.color.sell,
                  alignItems: 'center', justifyContent: 'center',
                  paddingHorizontal: 3,
                }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: DS.font.bold }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => { setFundSuccess(''); setFundError(''); setShowFundModal(true); }}
              style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: DS.color.buy + '40' }}>
              <Wallet size={13} color={DS.color.buy} />
              <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>Fund</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/p2p/my-orders' as RelativePathString)}
              style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.md, paddingHorizontal: 12, paddingVertical: 7 }}>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>Orders</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/p2p/post-ad' as RelativePathString)}
              style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Plus size={14} color={DS.color.bg} />
              <Text style={{ color: DS.color.bg, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>Post Ad</Text>
            </Pressable>
          </View>
        </View>

        {/* Buy/Sell toggle */}
        <View style={{ flexDirection: 'row', backgroundColor: DS.color.surface, borderRadius: DS.radius.full, padding: 3, marginBottom: DS.space.sm }}>
          {(['Buy', 'Sell'] as Side[]).map(s => (
            <Pressable
              key={s}
              onPress={() => setSide(s)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: DS.radius.full, backgroundColor: side === s ? (s === 'Buy' ? DS.color.buy : DS.color.sell) : 'transparent', alignItems: 'center' }}
            >
              <Text style={{ color: side === s ? '#fff' : DS.color.text2, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{s}</Text>
            </Pressable>
          ))}
        </View>

        {/* Asset + Fiat selectors */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: DS.space.sm }}>
          <Pressable
            onPress={() => setShowAssetPicker(true)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>{asset}</Text>
            <ChevronDown size={14} color={DS.color.text2} />
          </Pressable>
          <Pressable
            onPress={() => setShowFiatPicker(true)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>{selectedFiatSym} {fiat}</Text>
            <ChevronDown size={14} color={DS.color.text2} />
          </Pressable>
          <Pressable
            onPress={() => setShowFilter(true)}
            style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border, justifyContent: 'center' }}>
            <SlidersHorizontal size={18} color={DS.color.text1} />
          </Pressable>
        </View>

        {/* Active filter chips */}
        {(paymentFilter || verifiedOnly || onlineOnly || minCompletion) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {paymentFilter && <Chip label={paymentFilter} onRemove={() => { setPaymentFilter(''); loadAds(); }} />}
              {verifiedOnly && <Chip label="Verified Only" onRemove={() => { setVerifiedOnly(false); loadAds(); }} />}
              {onlineOnly && <Chip label="Online Only" onRemove={() => { setOnlineOnly(false); loadAds(); }} />}
              {minCompletion && <Chip label={`≥${minCompletion}% CR`} onRemove={() => { setMinCompletion(''); loadAds(); }} />}
            </View>
          </ScrollView>
        )}
      </View>

      {/* Ad list */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : (
        <FlatList
          data={ads}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <AdCard ad={item} side={side} onPress={() => handleAdPress(item)} />}
          contentContainerStyle={{ padding: DS.space.md, paddingBottom: 100 }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: DS.space.sm }}>
              <Wifi size={48} color={DS.color.text3} />
              <Text style={{ color: DS.color.text2, fontSize: DS.font.base, fontWeight: DS.font.semibold }}>No ads available</Text>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, textAlign: 'center' }}>
                No {side} ads for {asset}/{fiat} right now.{'\n'}Try different filters or post your own ad.
              </Text>
            </View>
          }
        />
      )}

      {/* Fund Balance Modal */}
      <Modal visible={showFundModal} transparent animationType="slide" onRequestClose={() => setShowFundModal(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View style={{ backgroundColor: DS.color.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Wallet size={20} color={DS.color.buy} />
                <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>Fund Balance</Text>
              </View>
              <Pressable onPress={() => setShowFundModal(false)}>
                <X size={22} color={DS.color.text2} />
              </Pressable>
            </View>

            <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginBottom: 6 }}>Select Asset</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {FUND_ASSETS.map(a => (
                  <Pressable key={a} onPress={() => setFundAsset(a)}
                    style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: DS.radius.full,
                      backgroundColor: fundAsset === a ? DS.color.buy : DS.color.surface,
                      borderWidth: 1, borderColor: fundAsset === a ? DS.color.buy : DS.color.border }}>
                    <Text style={{ color: fundAsset === a ? '#fff' : DS.color.text2, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{a}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginBottom: 6 }}>Amount ({fundAsset})</Text>
            <TextInput
              value={fundAmount}
              onChangeText={setFundAmount}
              placeholder="0.00"
              placeholderTextColor={DS.color.text3}
              keyboardType="decimal-pad"
              style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, padding: 14,
                color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold,
                borderWidth: 1, borderColor: DS.color.border, marginBottom: 8 }}
            />
            {/* Quick amounts */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {['100', '500', '1000', '5000'].map(q => (
                <Pressable key={q} onPress={() => setFundAmount(q)}
                  style={{ flex: 1, padding: 8, borderRadius: DS.radius.md, backgroundColor: DS.color.surface,
                    borderWidth: 1, borderColor: DS.color.border, alignItems: 'center' }}>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{q}</Text>
                </Pressable>
              ))}
            </View>

            {fundError ? <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, marginBottom: 8, textAlign: 'center' }}>{fundError}</Text> : null}
            {fundSuccess ? <Text style={{ color: DS.color.buy, fontSize: DS.font.sm, marginBottom: 8, textAlign: 'center', fontWeight: DS.font.bold }}>{fundSuccess}</Text> : null}

            <Pressable onPress={handleFundBalance}
              style={{ backgroundColor: DS.color.buy, borderRadius: DS.radius.lg, padding: 16,
                alignItems: 'center', opacity: fundLoading ? 0.7 : 1 }}>
              {fundLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.md }}>Fund {fundAsset} Wallet</Text>}
            </Pressable>
            <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, textAlign: 'center', marginTop: 10 }}>
              Funds are credited to your Spot wallet and can be used for trading immediately.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Modals */}
      <SelectorModal
        visible={showAssetPicker} title="Select Asset" items={assets}
        selected={asset} getKey={i => i.symbol} getLabel={i => `${i.symbol} · ${i.name}`}
        onSelect={setAsset} onClose={() => setShowAssetPicker(false)}
      />
      <SelectorModal
        visible={showFiatPicker} title="Select Currency" items={fiats}
        selected={fiat} getKey={i => i.code} getLabel={i => `${i.symbol} ${i.code} · ${i.name}`}
        onSelect={setFiat} onClose={() => setShowFiatPicker(false)}
      />
      <FilterDrawer
        visible={showFilter} onClose={() => setShowFilter(false)}
        paymentMethods={paymentMethods} selectedPayment={paymentFilter} onSelectPayment={setPaymentFilter}
        verifiedOnly={verifiedOnly} onToggleVerified={() => setVerifiedOnly(v => !v)}
        onlineOnly={onlineOnly} onToggleOnline={() => setOnlineOnly(v => !v)}
        minCompletion={minCompletion} onMinCompletion={setMinCompletion}
        sortBy={sortBy} onSortBy={setSortBy}
        onApply={() => { setShowFilter(false); loadAds(); }}
      />
    </View>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: DS.color.gold + '40' }}>
      <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>{label}</Text>
      <Pressable onPress={onRemove}><X size={10} color={DS.color.gold} /></Pressable>
    </View>
  );
}
