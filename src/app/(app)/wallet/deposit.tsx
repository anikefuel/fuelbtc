// Deposit — asset + network selector, real Binance address, real QR, history
import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  RefreshControl, TextInput,
} from 'react-native';
import { useFocusEffect, router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft, Copy, AlertTriangle, ChevronDown,
  CheckCircle, Clock, Search, X, WifiOff,
} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { DS } from '@/lib/design';
import { WalletService } from '@/services';
import type { AssetNetwork, DepositRecord } from '@/services/wallet.service';

const SUPPORTED_ASSETS = ['BTC','ETH','USDT','USDC','BNB','SOL','XRP','TRX','LTC','DOGE'];

const STATUS_CONFIG = {
  pending:    { color: DS.color.warn,  label: 'Pending' },
  confirming: { color: DS.color.info,  label: 'Confirming' },
  credited:   { color: DS.color.buy,   label: 'Credited' },
  rejected:   { color: DS.color.sell,  label: 'Rejected' },
};

function AssetPicker({ selected, onSelect, onClose }: {
  selected: string; onSelect: (a: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = SUPPORTED_ASSETS.filter(a =>
    a.toLowerCase().includes(search.toLowerCase()) ||
    (WalletService.ASSET_META[a]?.name ?? '').toLowerCase().includes(search.toLowerCase())
  );
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={onClose} style={{ padding: 4 }}><X size={22} color={DS.color.text2} /></Pressable>
        <Text style={{ color: DS.color.text1, fontSize: 18, fontWeight: DS.font.bold, flex: 1 }}>Select Asset</Text>
      </View>
      <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingHorizontal: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
        <Search size={16} color={DS.color.text3} />
        <TextInput
          value={search} onChangeText={setSearch} placeholder="Search asset..."
          placeholderTextColor={DS.color.text3}
          style={{ flex: 1, color: DS.color.text1, paddingVertical: DS.space.sm, paddingHorizontal: DS.space.xs, fontSize: 14 }}
        />
      </View>
      <ScrollView>
        {filtered.map(a => {
          const meta = WalletService.ASSET_META[a];
          const color = { BTC:'#F7931A',ETH:'#627EEA',USDT:'#26A17B',USDC:'#2775CA',BNB:'#F0B90B',SOL:'#9945FF',XRP:'#346AA9',TRX:'#EF0027' }[a] ?? DS.color.gold;
          return (
            <Pressable key={a} onPress={() => { onSelect(a); onClose(); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: a === selected ? DS.color.surface : 'transparent' }}>
              <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center', marginRight: DS.space.md }}>
                <Text style={{ color, fontSize: 11, fontWeight: DS.font.bold }}>{a.slice(0,3)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: DS.color.text1, fontSize: 15, fontWeight: DS.font.semibold }}>{a}</Text>
                <Text style={{ color: DS.color.text3, fontSize: 12 }}>{meta?.name ?? a}</Text>
              </View>
              {a === selected && <CheckCircle size={18} color={DS.color.gold} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function DepositScreen() {
  const { asset: initAsset } = useLocalSearchParams<{ asset?: string }>();

  const [asset, setAsset] = useState(initAsset ?? 'USDT');
  const [networks, setNetworks] = useState<AssetNetwork[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<AssetNetwork | null>(null);
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState<string | undefined>();
  const [addrError, setAddrError] = useState('');
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const [copied, setCopied] = useState<'address' | 'memo' | null>(null);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [tab, setTab] = useState<'address' | 'history'>('address');
  const [refreshing, setRefreshing] = useState(false);

  const loadNetworks = useCallback(async (a: string) => {
    setLoading(true);
    setAddress('');
    setMemo(undefined);
    setAddrError('');
    try {
      const nets = await WalletService.getAssetNetworks(a);
      setNetworks(nets);
      if (nets.length > 0) setSelectedNetwork(nets[0]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAddress = useCallback(async (a: string, net: AssetNetwork) => {
    if (!net.depositEnabled) {
      setAddress('');
      setMemo(undefined);
      setAddrError('Deposits are currently disabled for this network.');
      return;
    }
    setAddrLoading(true);
    setAddrError('');
    setAddress('');
    setMemo(undefined);
    try {
      const result = await WalletService.getOrCreateDepositAddress(a, net.network);
      setAddress(result.address);
      setMemo(result.memo);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Deposit address unavailable';
      setAddrError(msg);
    } finally {
      setAddrLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const deps = await WalletService.getDeposits(20, asset);
    setDeposits(deps);
  }, [asset]);

  useFocusEffect(useCallback(() => {
    loadNetworks(asset);
    loadHistory();
  }, [asset, loadNetworks, loadHistory]));

  useEffect(() => {
    if (selectedNetwork) loadAddress(asset, selectedNetwork);
  }, [asset, selectedNetwork, loadAddress]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  };

  const copyToClipboard = async (text: string, type: 'address' | 'memo') => {
    if (process.env.EXPO_OS === 'web') {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const fmtDate = (d: string) => new Date(d).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (showAssetPicker) {
    return <AssetPicker selected={asset} onSelect={setAsset} onClose={() => setShowAssetPicker(false)} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.md }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontSize: 20, fontWeight: DS.font.bold, flex: 1 }}>Deposit</Text>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', marginHorizontal: DS.space.md, marginBottom: DS.space.md, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: 3 }}>
        {(['address', 'history'] as const).map(t => (
          <Pressable key={t} onPress={() => setTab(t)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: DS.space.xs, borderRadius: DS.radius.sm, backgroundColor: tab === t ? DS.color.card : 'transparent' }}>
            <Text style={{ color: tab === t ? DS.color.text1 : DS.color.text3, fontSize: 13, fontWeight: tab === t ? DS.font.semibold : DS.font.regular, textTransform: 'capitalize' }}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'address' ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}>
          {/* Asset Selector */}
          <Pressable onPress={() => setShowAssetPicker(true)}
            style={{ marginHorizontal: DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: DS.color.text3, fontSize: 11, marginBottom: 2 }}>Asset</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
                <Text style={{ color: DS.color.text1, fontSize: 18, fontWeight: DS.font.bold }}>{asset}</Text>
                <Text style={{ color: DS.color.text2, fontSize: 13 }}>{WalletService.ASSET_META[asset]?.name}</Text>
              </View>
            </View>
            <ChevronDown size={18} color={DS.color.text2} />
          </Pressable>

          {/* Network Selector */}
          {networks.length > 0 && (
            <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Network</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                  {networks.map(n => (
                    <Pressable key={n.network} onPress={() => setSelectedNetwork(n)}
                      style={{
                        paddingHorizontal: DS.space.md, paddingVertical: DS.space.xs,
                        borderRadius: DS.radius.full, borderWidth: 1.5,
                        borderColor: selectedNetwork?.network === n.network ? DS.color.gold : DS.color.border,
                        backgroundColor: selectedNetwork?.network === n.network ? DS.color.goldBg : DS.color.surface,
                      }}>
                      <Text style={{ color: selectedNetwork?.network === n.network ? DS.color.gold : DS.color.text2, fontSize: 13, fontWeight: DS.font.medium }}>{n.networkLabel}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Address Display */}
          {selectedNetwork && (
            <View style={{ marginHorizontal: DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.lg, borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.sm }}>
              {addrLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: DS.space.lg }}>
                  <ActivityIndicator color={DS.color.gold} />
                  <Text style={{ color: DS.color.text3, fontSize: 12, marginTop: DS.space.xs }}>Fetching address from Binance…</Text>
                </View>
              ) : addrError ? (
                /* ── Error state — never show a fake address ── */
                <View style={{ alignItems: 'center', paddingVertical: DS.space.lg, gap: DS.space.sm }}>
                  <WifiOff size={36} color={DS.color.sell} strokeWidth={1.5} />
                  <Text style={{ color: DS.color.sell, fontSize: 14, fontWeight: DS.font.semibold, textAlign: 'center' }}>
                    {addrError.includes('permission') ? 'Provider permission missing' :
                     addrError.includes('testnet') ? 'Testnet unsupported' :
                     addrError.includes('configured') ? 'Binance provider not connected' :
                     addrError.includes('disabled') ? 'Deposits disabled for this network' :
                     'Deposit address unavailable'}
                  </Text>
                  <Text style={{ color: DS.color.text3, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>{addrError}</Text>
                  <Pressable
                    onPress={() => loadAddress(asset, selectedNetwork)}
                    style={{ marginTop: DS.space.xs, paddingHorizontal: DS.space.lg, paddingVertical: DS.space.xs, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.full, borderWidth: 1, borderColor: DS.color.gold }}>
                    <Text style={{ color: DS.color.gold, fontSize: 13, fontWeight: DS.font.semibold }}>Retry</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {/* Real QR Code from exact Binance address */}
                  <View style={{ alignItems: 'center', marginBottom: DS.space.lg }}>
                    {address ? (
                      <View style={{ padding: 10, backgroundColor: '#ffffff', borderRadius: DS.radius.md }}>
                        <QRCode
                          value={address}
                          size={160}
                          color="#000000"
                          backgroundColor="#ffffff"
                        />
                      </View>
                    ) : (
                      <View style={{ width: 180, height: 180, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
                        <ActivityIndicator color={DS.color.gold} />
                      </View>
                    )}
                  </View>

                  {/* Address */}
                  <Text style={{ color: DS.color.text2, fontSize: 11, marginBottom: 4 }}>Deposit Address</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, gap: DS.space.xs }}>
                    <Text style={{ flex: 1, color: DS.color.text1, fontSize: 12, fontFamily: 'monospace' }} numberOfLines={2}>{address || '—'}</Text>
                    <Pressable onPress={() => address && copyToClipboard(address, 'address')}
                      style={{ padding: 6, backgroundColor: copied === 'address' ? DS.color.goldBg : 'transparent', borderRadius: DS.radius.xs }}>
                      {copied === 'address'
                        ? <CheckCircle size={18} color={DS.color.gold} />
                        : <Copy size={18} color={DS.color.text2} />}
                    </Pressable>
                  </View>

                  {/* Memo */}
                  {selectedNetwork.hasMemo && memo && (
                    <View style={{ marginTop: DS.space.sm }}>
                      <Text style={{ color: DS.color.text2, fontSize: 11, marginBottom: 4 }}>{selectedNetwork.memoLabel ?? 'Memo / Tag'}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, gap: DS.space.xs }}>
                        <Text style={{ flex: 1, color: DS.color.gold, fontSize: 16, fontWeight: DS.font.bold }}>{memo}</Text>
                        <Pressable onPress={() => copyToClipboard(memo, 'memo')}
                          style={{ padding: 6, backgroundColor: copied === 'memo' ? DS.color.goldBg : 'transparent', borderRadius: DS.radius.xs }}>
                          {copied === 'memo' ? <CheckCircle size={18} color={DS.color.gold} /> : <Copy size={18} color={DS.color.text2} />}
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* Network Info */}
                  <View style={{ marginTop: DS.space.md, gap: DS.space.xxs }}>
                    {[
                      ['Min Deposit', `${selectedNetwork.minDeposit} ${asset}`],
                      ['Confirmations', String(selectedNetwork.requiredConfs)],
                      ['Expected Arrival', selectedNetwork.estimatedArrival],
                    ].map(([label, val]) => (
                      <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: DS.color.text3, fontSize: 12 }}>{label}</Text>
                        <Text style={{ color: DS.color.text2, fontSize: 12, fontWeight: DS.font.medium }}>{val}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* Warning */}
          <View style={{ marginHorizontal: DS.space.md, backgroundColor: `${DS.color.warn}15`, borderRadius: DS.radius.lg, padding: DS.space.md, flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.lg, borderWidth: 1, borderColor: `${DS.color.warn}30` }}>
            <AlertTriangle size={16} color={DS.color.warn} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, color: DS.color.text2, fontSize: 12, lineHeight: 18 }}>
              Only send <Text style={{ color: DS.color.warn, fontWeight: DS.font.semibold }}>{asset}</Text> via the {selectedNetwork?.networkLabel ?? 'selected'} network to this address. Sending the wrong asset or using the wrong network may result in permanent loss.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
        >
          {deposits.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <Clock size={40} color={DS.color.text3} strokeWidth={1.2} />
              <Text style={{ color: DS.color.text2, fontSize: 15, fontWeight: DS.font.semibold, marginTop: DS.space.md }}>No deposits yet</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: DS.space.md, gap: DS.space.xxs }}>
              {deposits.map(d => {
                const sc = STATUS_CONFIG[d.status] ?? { color: DS.color.text3, label: d.status };
                return (
                  <View key={d.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: DS.color.text1, fontSize: 15, fontWeight: DS.font.semibold }}>{d.amount} {d.asset}</Text>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: `${sc.color}18`, borderRadius: DS.radius.xs }}>
                        <Text style={{ color: sc.color, fontSize: 11, fontWeight: DS.font.bold }}>{sc.label}</Text>
                      </View>
                    </View>
                    <Text style={{ color: DS.color.text3, fontSize: 11 }}>{d.network} · {fmtDate(d.createdAt)}</Text>
                    {d.txHash && <Text style={{ color: DS.color.text3, fontSize: 10, marginTop: 2 }} numberOfLines={1}>TX: {d.txHash}</Text>}
                    {d.status === 'confirming' && (
                      <View style={{ flexDirection: 'row', gap: 4, marginTop: DS.space.xs, alignItems: 'center' }}>
                        <View style={{ flex: 1, height: 3, backgroundColor: DS.color.surface, borderRadius: 2 }}>
                          <View style={{ width: `${Math.min(100, (d.confirmations / d.requiredConfs) * 100)}%`, height: 3, backgroundColor: DS.color.info, borderRadius: 2 }} />
                        </View>
                        <Text style={{ color: DS.color.text3, fontSize: 10 }}>{d.confirmations}/{d.requiredConfs}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
