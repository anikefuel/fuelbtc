// Withdraw — secure withdrawal flow with fee, limit, balance checks
// Step-up verification required before submission
// KYC Tier 2 required to submit withdrawals
import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, ActivityIndicator,
  KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { useFocusEffect, router, useLocalSearchParams } from 'expo-router';
import { useStepUp } from '@/components/security/StepUpProvider';
import {
  ArrowLeft, AlertTriangle, ChevronDown, Shield, CheckCircle,
  Clock, X, Search,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import { WalletService } from '@/services';
import type { AssetNetwork, WalletBalance, WithdrawalRecord } from '@/services/wallet.service';
import { getProfile } from '@/services/auth.service';
import { KycGateBanner, hasTierAccess } from '@/components/shared/KycGate';

const SUPPORTED_ASSETS = ['BTC','ETH','USDT','USDC','BNB','SOL','XRP','TRX','LTC','DOGE'];

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending:         { color: DS.color.warn,  label: 'Pending' },
  security_review: { color: DS.color.info,  label: 'In Review' },
  approved:        { color: DS.color.info,  label: 'Approved' },
  broadcasting:    { color: DS.color.info,  label: 'Broadcasting' },
  completed:       { color: DS.color.buy,   label: 'Completed' },
  failed:          { color: DS.color.sell,  label: 'Failed' },
  rejected:        { color: DS.color.sell,  label: 'Rejected' },
  cancelled:       { color: DS.color.text3, label: 'Cancelled' },
};

function AssetPicker({ selected, onSelect, onClose }: { selected: string; onSelect: (a: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = SUPPORTED_ASSETS.filter(a =>
    a.toLowerCase().includes(search.toLowerCase()) ||
    (WalletService.ASSET_META[a]?.name ?? '').toLowerCase().includes(search.toLowerCase())
  );
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={onClose} style={{ padding: 4 }}><X size={22} color={DS.color.text2} /></Pressable>
        <Text style={{ color: DS.color.text1, fontSize: 18, fontWeight: DS.font.bold }}>Select Asset</Text>
      </View>
      <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingHorizontal: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
        <Search size={16} color={DS.color.text3} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search asset..." placeholderTextColor={DS.color.text3}
          style={{ flex: 1, color: DS.color.text1, paddingVertical: DS.space.sm, paddingHorizontal: DS.space.xs, fontSize: 14 }} />
      </View>
      <ScrollView>
        {filtered.map(a => {
          const color = { BTC:'#F7931A',ETH:'#627EEA',USDT:'#26A17B',USDC:'#2775CA',BNB:'#F0B90B',SOL:'#9945FF',XRP:'#346AA9',TRX:'#EF0027' }[a] ?? DS.color.gold;
          return (
            <Pressable key={a} onPress={() => { onSelect(a); onClose(); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
              <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center', marginRight: DS.space.md }}>
                <Text style={{ color, fontSize: 11, fontWeight: DS.font.bold }}>{a.slice(0,3)}</Text>
              </View>
              <Text style={{ color: DS.color.text1, fontSize: 15, fontWeight: DS.font.semibold, flex: 1 }}>{a}</Text>
              {a === selected && <CheckCircle size={18} color={DS.color.gold} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function WithdrawScreen() {
  const { asset: initAsset } = useLocalSearchParams<{ asset?: string }>();
  const { requestStepUp } = useStepUp();

  const [asset, setAsset] = useState(initAsset ?? 'USDT');
  const [networks, setNetworks] = useState<AssetNetwork[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<AssetNetwork | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [toAddress, setToAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [tab, setTab] = useState<'form' | 'history'>('form');
  const [refreshing, setRefreshing] = useState(false);
  const [userTier, setUserTier] = useState<string | null>(null);
  const [tierLoading, setTierLoading] = useState(true);

  const loadData = useCallback(async (a: string) => {
    setLoading(true);
    setError('');
    try {
      const [nets, bal, hist] = await Promise.all([
        WalletService.getAssetNetworks(a),
        WalletService.getWalletBalance(a, 'spot'),
        WalletService.getWithdrawals(20, a),
      ]);
      setNetworks(nets);
      if (nets.length > 0) setSelectedNetwork(nets[0]);
      setBalance(bal);
      setWithdrawals(hist);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    (async () => {
      setTierLoading(true);
      try {
        const profile = await getProfile();
        setUserTier(profile?.kyc_tier ?? null);
      } finally {
        setTierLoading(false);
      }
      loadData(asset);
    })();
  }, [asset, loadData]));

  useEffect(() => {
    if (asset) loadData(asset);
  }, [asset, loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(asset);
    setRefreshing(false);
  };

  const available = balance?.availableBalance ?? 0;
  const fee = selectedNetwork?.withdrawalFee ?? 0;
  const receiveAmount = Math.max(0, Number(amount) - fee);

  const validate = () => {
    if (!hasTierAccess(userTier, 'tier2')) return 'Identity verification (Tier 2) required to withdraw.';
    if (!toAddress.trim()) return 'Recipient address is required.';
    if (selectedNetwork?.hasMemo && !memo.trim()) return `${selectedNetwork.memoLabel ?? 'Memo'} is required for this asset.`;
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) return 'Enter a valid amount.';
    if (amt < (selectedNetwork?.minWithdrawal ?? 0)) return `Minimum withdrawal is ${selectedNetwork?.minWithdrawal} ${asset}.`;
    if (amt > available) return `Insufficient balance. Available: ${available} ${asset}.`;
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    if (!selectedNetwork) return;

    // Require step-up verification before submitting withdrawal
    const token = await requestStepUp({
      action_type: 'withdrawal',
      amount: Number(amount),
      asset,
      destination: toAddress.trim(),
      description: `Authorize withdrawal of ${amount} ${asset} to ${toAddress.trim().slice(0, 12)}…`,
    });
    if (!token) return; // user cancelled

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await WalletService.submitWithdrawal({
        asset, network: selectedNetwork.network,
        toAddress: toAddress.trim(),
        memo: memo.trim() || undefined,
        amount: Number(amount),
        stepUpTokenId: token.token_id,
      });
      setSuccess(`Withdrawal of ${amount} ${asset} submitted successfully. Funds locked pending review.`);
      setToAddress('');
      setMemo('');
      setAmount('');
      await loadData(asset);
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Withdrawal failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const fmtDate = (d: string) => new Date(d).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (showAssetPicker) {
    return <AssetPicker selected={asset} onSelect={a => { setAsset(a); setAmount(''); setToAddress(''); setMemo(''); }} onClose={() => setShowAssetPicker(false)} />;
  }

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: DS.color.bg }}
    >
      {/* Header */}
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.md }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}><ArrowLeft size={22} color={DS.color.text1} /></Pressable>
        <Text style={{ color: DS.color.text1, fontSize: 20, fontWeight: DS.font.bold, flex: 1 }}>Withdraw</Text>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', marginHorizontal: DS.space.md, marginBottom: DS.space.md, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: 3 }}>
        {(['form', 'history'] as const).map(t => (
          <Pressable key={t} onPress={() => setTab(t)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: DS.space.xs, borderRadius: DS.radius.sm, backgroundColor: tab === t ? DS.color.card : 'transparent' }}>
            <Text style={{ color: tab === t ? DS.color.text1 : DS.color.text3, fontSize: 13, fontWeight: tab === t ? DS.font.semibold : DS.font.regular, textTransform: 'capitalize' }}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'form' ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}><ActivityIndicator color={DS.color.gold} /></View>
          ) : (
            <>
              {/* KYC tier gate banner */}
              <View style={{ marginHorizontal: DS.space.md }}>
                <KycGateBanner requiredTier="tier2" featureName="Withdrawals" userTier={tierLoading ? null : userTier} />
              </View>
              {/* Asset + Balance */}
              <View style={{ marginHorizontal: DS.space.md, flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.sm }}>
                <Pressable onPress={() => setShowAssetPicker(true)} style={{ flex: 1, backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}>
                  <Text style={{ flex: 1, color: DS.color.text1, fontSize: 18, fontWeight: DS.font.bold }}>{asset}</Text>
                  <ChevronDown size={18} color={DS.color.text2} />
                </Pressable>
                <View style={{ flex: 1, backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                  <Text style={{ color: DS.color.text3, fontSize: 11 }}>Available</Text>
                  <Text style={{ color: DS.color.text1, fontSize: 16, fontWeight: DS.font.bold, marginTop: 2 }}>{available.toFixed(4)}</Text>
                </View>
              </View>

              {/* Network */}
              {networks.length > 0 && (
                <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
                  <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Network</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                      {networks.map(n => (
                        <Pressable key={n.network} onPress={() => setSelectedNetwork(n)}
                          style={{ paddingHorizontal: DS.space.md, paddingVertical: DS.space.xs, borderRadius: DS.radius.full, borderWidth: 1.5, borderColor: selectedNetwork?.network === n.network ? DS.color.gold : DS.color.border, backgroundColor: selectedNetwork?.network === n.network ? DS.color.goldBg : DS.color.surface }}>
                          <Text style={{ color: selectedNetwork?.network === n.network ? DS.color.gold : DS.color.text2, fontSize: 13, fontWeight: DS.font.medium }}>{n.networkLabel}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* Address */}
              <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
                <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Recipient Address</Text>
                <TextInput
                  value={toAddress} onChangeText={t => { setToAddress(t); setError(''); }}
                  placeholder={`Enter ${asset} address`}
                  placeholderTextColor={DS.color.text3}
                  style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, color: DS.color.text1, fontSize: 13, borderWidth: 1, borderColor: DS.color.border, fontFamily: 'monospace' }}
                  autoCapitalize="none" autoCorrect={false}
                />
              </View>

              {/* Memo */}
              {selectedNetwork?.hasMemo && (
                <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
                  <Text style={{ color: DS.color.warn, fontSize: 12, marginBottom: DS.space.xs }}>
                    {selectedNetwork.memoLabel ?? 'Memo / Tag'} <Text style={{ color: DS.color.sell }}>(Required)</Text>
                  </Text>
                  <TextInput
                    value={memo} onChangeText={setMemo}
                    placeholder="Enter memo / tag"
                    placeholderTextColor={DS.color.text3}
                    style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, color: DS.color.text1, fontSize: 14, borderWidth: 1, borderColor: DS.color.warn }}
                    keyboardType="numeric"
                  />
                </View>
              )}

              {/* Amount */}
              <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
                <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Amount</Text>
                <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                      value={amount} onChangeText={t => { setAmount(t.replace(/[^0-9.]/g, '')); setError(''); }}
                      placeholder="0.00"
                      placeholderTextColor={DS.color.text3}
                      keyboardType="decimal-pad"
                      style={{ flex: 1, color: DS.color.text1, fontSize: 24, fontWeight: DS.font.bold }}
                    />
                    <Text style={{ color: DS.color.text2, fontSize: 16, fontWeight: DS.font.semibold, marginRight: DS.space.sm }}>{asset}</Text>
                    <Pressable onPress={() => setAmount(available.toString())}
                      style={{ paddingHorizontal: DS.space.sm, paddingVertical: DS.space.xxs, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.xs, borderWidth: 1, borderColor: DS.color.gold }}>
                      <Text style={{ color: DS.color.gold, fontSize: 11, fontWeight: DS.font.bold }}>MAX</Text>
                    </Pressable>
                  </View>
                  {Number(amount) > 0 && (
                    <View style={{ marginTop: DS.space.sm, flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: DS.color.text3, fontSize: 11 }}>Network Fee: {fee} {asset}</Text>
                      <Text style={{ color: DS.color.buy, fontSize: 11 }}>Receive: {receiveAmount.toFixed(6)} {asset}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Network info */}
              {selectedNetwork && (
                <View style={{ marginHorizontal: DS.space.md, backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: 6, marginBottom: DS.space.sm }}>
                  {[
                    ['Min Withdrawal', `${selectedNetwork.minWithdrawal} ${asset}`],
                    ['Network Fee', `${fee} ${asset}`],
                    ['Estimated Arrival', selectedNetwork.estimatedArrival],
                  ].map(([k, v]) => (
                    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: DS.color.text3, fontSize: 12 }}>{k}</Text>
                      <Text style={{ color: DS.color.text2, fontSize: 12, fontWeight: DS.font.medium }}>{v}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Security notice */}
              <View style={{ marginHorizontal: DS.space.md, backgroundColor: `${DS.color.info}12`, borderRadius: DS.radius.lg, padding: DS.space.md, flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.info}25` }}>
                <Shield size={16} color={DS.color.info} style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, color: DS.color.text2, fontSize: 12, lineHeight: 18 }}>
                  Withdrawals are subject to security review. Funds will be locked immediately and released after approval.
                </Text>
              </View>

              {/* Error / Success */}
              {error ? (
                <View style={{ marginHorizontal: DS.space.md, backgroundColor: `${DS.color.sell}15`, borderRadius: DS.radius.lg, padding: DS.space.md, flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.sm }}>
                  <AlertTriangle size={16} color={DS.color.sell} />
                  <Text style={{ flex: 1, color: DS.color.sell, fontSize: 13 }}>{error}</Text>
                </View>
              ) : null}
              {success ? (
                <View style={{ marginHorizontal: DS.space.md, backgroundColor: `${DS.color.buy}15`, borderRadius: DS.radius.lg, padding: DS.space.md, flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.sm }}>
                  <CheckCircle size={16} color={DS.color.buy} />
                  <Text style={{ flex: 1, color: DS.color.buy, fontSize: 13 }}>{success}</Text>
                </View>
              ) : null}

              {/* Submit */}
              <Pressable onPress={handleSubmit} disabled={submitting}
                style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.xxxl, backgroundColor: submitting ? DS.color.surface : DS.color.sell, borderRadius: DS.radius.lg, paddingVertical: DS.space.md, alignItems: 'center' }}>
                {submitting
                  ? <ActivityIndicator color={DS.color.text1} size="small" />
                  : <Text style={{ color: DS.color.text1, fontSize: 16, fontWeight: DS.font.bold }}>Withdraw {asset}</Text>}
              </Pressable>
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DS.color.gold} />}
        >
          {withdrawals.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <Clock size={40} color={DS.color.text3} strokeWidth={1.2} />
              <Text style={{ color: DS.color.text2, fontSize: 15, fontWeight: DS.font.semibold, marginTop: DS.space.md }}>No withdrawals yet</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: DS.space.md, gap: DS.space.xxs }}>
              {withdrawals.map(w => {
                const sc = STATUS_CONFIG[w.status] ?? { color: DS.color.text3, label: w.status };
                return (
                  <View key={w.id} style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: DS.color.sell, fontSize: 15, fontWeight: DS.font.semibold }}>-{w.amount} {w.asset}</Text>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: `${sc.color}18`, borderRadius: DS.radius.xs }}>
                        <Text style={{ color: sc.color, fontSize: 11, fontWeight: DS.font.bold }}>{sc.label}</Text>
                      </View>
                    </View>
                    <Text style={{ color: DS.color.text3, fontSize: 11 }}>{w.network} · {fmtDate(w.createdAt)}</Text>
                    <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 2 }} numberOfLines={1}>To: {w.toAddress}</Text>
                    {w.rejectionReason && <Text style={{ color: DS.color.sell, fontSize: 11, marginTop: 2 }}>Reason: {w.rejectionReason}</Text>}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
