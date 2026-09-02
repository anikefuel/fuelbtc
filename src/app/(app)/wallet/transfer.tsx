// Transfer — wallet-to-wallet (self) and internal (user-to-user)
import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import {
  ArrowLeft, ArrowLeftRight, Users, AlertTriangle, CheckCircle,
  ChevronDown, X,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import { WalletService } from '@/services';
import type { WalletBalance, WalletType } from '@/services/wallet.service';
import { WALLET_LABELS } from '@/services/wallet.service';

const SUPPORTED_ASSETS = ['BTC','ETH','USDT','USDC','BNB','SOL','XRP','TRX','LTC','DOGE'];
const SELF_TRANSFER_PAIRS: [WalletType, WalletType][] = [
  ['spot','funding'], ['funding','spot'],
  ['funding','p2p'],  ['p2p','funding'],
  ['spot','p2p'],     ['p2p','spot'],
];

type TabType = 'self' | 'internal';

function AssetSelector({ asset, onPress }: { asset: string; onPress: () => void }) {
  const color = { BTC:'#F7931A',ETH:'#627EEA',USDT:'#26A17B',USDC:'#2775CA',BNB:'#F0B90B',SOL:'#9945FF',XRP:'#346AA9',TRX:'#EF0027' }[asset] ?? DS.color.gold;
  return (
    <Pressable onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: DS.space.sm }}>
      <View style={{ width: 32, height: 32, borderRadius: DS.radius.full, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color, fontSize: 9, fontWeight: DS.font.bold }}>{asset.slice(0,3)}</Text>
      </View>
      <Text style={{ flex: 1, color: DS.color.text1, fontSize: 17, fontWeight: DS.font.bold }}>{asset}</Text>
      <ChevronDown size={18} color={DS.color.text2} />
    </Pressable>
  );
}

function AssetPicker({ selected, onSelect, onClose }: { selected: string; onSelect: (a: string) => void; onClose: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={onClose} style={{ padding: 4 }}><X size={22} color={DS.color.text2} /></Pressable>
        <Text style={{ color: DS.color.text1, fontSize: 18, fontWeight: DS.font.bold }}>Select Asset</Text>
      </View>
      <ScrollView>
        {SUPPORTED_ASSETS.map(a => {
          const c = { BTC:'#F7931A',ETH:'#627EEA',USDT:'#26A17B',USDC:'#2775CA',BNB:'#F0B90B',SOL:'#9945FF',XRP:'#346AA9',TRX:'#EF0027' }[a] ?? DS.color.gold;
          return (
            <Pressable key={a} onPress={() => { onSelect(a); onClose(); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: DS.space.md, paddingVertical: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
              <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${c}22`, alignItems: 'center', justifyContent: 'center', marginRight: DS.space.md }}>
                <Text style={{ color: c, fontSize: 11, fontWeight: DS.font.bold }}>{a.slice(0,3)}</Text>
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

export default function TransferScreen() {
  const [tab, setTab] = useState<TabType>('self');
  const [asset, setAsset] = useState('USDT');
  const [fromWallet, setFromWallet] = useState<WalletType>('spot');
  const [toWallet, setToWallet] = useState<WalletType>('funding');
  const [amount, setAmount] = useState('');
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  // Internal transfer state
  const [recipient, setRecipient] = useState('');
  const [recipientInfo, setRecipientInfo] = useState<{ id: string; displayName: string } | null>(null);
  const [recipientError, setRecipientError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [note, setNote] = useState('');

  const loadBalances = useCallback(async () => {
    setLoading(true);
    try {
      const bals = await WalletService.getWalletBalances();
      setBalances(bals);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadBalances(); }, [loadBalances]));

  const getBalance = (wt: WalletType, a: string) => {
    const b = balances.find(b => b.walletType === wt && b.asset === a);
    return b?.availableBalance ?? 0;
  };

  const swapWallets = () => {
    setFromWallet(toWallet);
    setToWallet(fromWallet);
    setError('');
  };

  const lookupRecipient = async () => {
    if (!recipient.trim()) return;
    setLookingUp(true);
    setRecipientError('');
    setRecipientInfo(null);
    try {
      const result = await WalletService.lookupRecipient(recipient.trim());
      if (result) setRecipientInfo(result);
      else setRecipientError('User not found. Try email, username, or UID.');
    } finally {
      setLookingUp(false);
    }
  };

  const handleSelfTransfer = async () => {
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    const avail = getBalance(fromWallet, asset);
    if (amt > avail) { setError(`Insufficient balance in ${WALLET_LABELS[fromWallet]}.`); return; }
    if (fromWallet === toWallet) { setError('Source and destination must differ.'); return; }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await WalletService.selfTransfer({ asset, fromWallet, toWallet, amount: amt });
      setSuccess(`Transferred ${amt} ${asset} from ${WALLET_LABELS[fromWallet]} to ${WALLET_LABELS[toWallet]}.`);
      setAmount('');
      await loadBalances();
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Transfer failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleInternalTransfer = async () => {
    if (!recipientInfo) { setRecipientError('Look up recipient first.'); return; }
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    const avail = getBalance('spot', asset);
    if (amt > avail) { setError(`Insufficient balance. Available: ${avail} ${asset}.`); return; }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await WalletService.sendInternalTransfer({
        recipientIdentifier: recipientInfo.id,
        asset, amount: amt, walletType: 'spot', note: note.trim() || undefined,
      });
      setSuccess(`Sent ${amt} ${asset} to ${recipientInfo.displayName}.`);
      setAmount('');
      setRecipient('');
      setRecipientInfo(null);
      setNote('');
      await loadBalances();
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Transfer failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (showAssetPicker) {
    return <AssetPicker selected={asset} onSelect={a => { setAsset(a); setAmount(''); setError(''); }} onClose={() => setShowAssetPicker(false)} />;
  }

  const fromAvail = getBalance(fromWallet, asset);
  const spotAvail = getBalance('spot', asset);

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 56, paddingHorizontal: DS.space.md, paddingBottom: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.md }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}><ArrowLeft size={22} color={DS.color.text1} /></Pressable>
        <Text style={{ color: DS.color.text1, fontSize: 20, fontWeight: DS.font.bold, flex: 1 }}>Transfer</Text>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', marginHorizontal: DS.space.md, marginBottom: DS.space.lg, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: 3 }}>
        {([['self', 'Wallet Transfer', ArrowLeftRight], ['internal', 'Send to User', Users]] as const).map(([t, label, Icon]) => (
          <Pressable key={t} onPress={() => { setTab(t); setError(''); setSuccess(''); }}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: DS.space.xs, borderRadius: DS.radius.sm, backgroundColor: tab === t ? DS.color.card : 'transparent' }}>
            <Icon size={14} color={tab === t ? DS.color.text1 : DS.color.text3} />
            <Text style={{ color: tab === t ? DS.color.text1 : DS.color.text3, fontSize: 12, fontWeight: tab === t ? DS.font.semibold : DS.font.regular }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Asset */}
        <View style={{ paddingHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
          <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Asset</Text>
          <AssetSelector asset={asset} onPress={() => setShowAssetPicker(true)} />
        </View>

        {tab === 'self' ? (
          <>
            {/* From / To wallets */}
            <View style={{ paddingHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
                {/* From */}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>From</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {(['spot','funding','p2p'] as WalletType[]).map(wt => (
                        <Pressable key={wt} onPress={() => { setFromWallet(wt); if (wt === toWallet) setToWallet(wt === 'spot' ? 'funding' : 'spot'); setError(''); }}
                          style={{ paddingHorizontal: DS.space.sm, paddingVertical: DS.space.xxs, borderRadius: DS.radius.full, borderWidth: 1.5, borderColor: fromWallet === wt ? DS.color.gold : DS.color.border, backgroundColor: fromWallet === wt ? DS.color.goldBg : DS.color.surface }}>
                          <Text style={{ color: fromWallet === wt ? DS.color.gold : DS.color.text2, fontSize: 12, fontWeight: DS.font.medium, textTransform: 'capitalize' }}>{wt}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                  <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 4 }}>Available: {fromAvail.toFixed(4)} {asset}</Text>
                </View>

                {/* Swap button */}
                <Pressable onPress={swapWallets}
                  style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border, marginTop: 16 }}>
                  <ArrowLeftRight size={16} color={DS.color.gold} />
                </Pressable>

                {/* To */}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>To</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {(['spot','funding','p2p'] as WalletType[]).map(wt => (
                        <Pressable key={wt} onPress={() => { setToWallet(wt); setError(''); }}
                          disabled={wt === fromWallet}
                          style={{ paddingHorizontal: DS.space.sm, paddingVertical: DS.space.xxs, borderRadius: DS.radius.full, borderWidth: 1.5, borderColor: toWallet === wt ? DS.color.info : DS.color.border, backgroundColor: toWallet === wt ? `${DS.color.info}15` : DS.color.surface, opacity: wt === fromWallet ? 0.4 : 1 }}>
                          <Text style={{ color: toWallet === wt ? DS.color.info : DS.color.text2, fontSize: 12, fontWeight: DS.font.medium, textTransform: 'capitalize' }}>{wt}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                  <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 4 }}>Balance: {getBalance(toWallet, asset).toFixed(4)} {asset}</Text>
                </View>
              </View>
            </View>

            {/* Amount */}
            <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.lg }}>
              <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Amount</Text>
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                  value={amount} onChangeText={t => { setAmount(t.replace(/[^0-9.]/g, '')); setError(''); }}
                  placeholder="0.00" placeholderTextColor={DS.color.text3}
                  keyboardType="decimal-pad"
                  style={{ flex: 1, color: DS.color.text1, fontSize: 24, fontWeight: DS.font.bold }}
                />
                <Text style={{ color: DS.color.text2, fontSize: 14, marginRight: DS.space.sm }}>{asset}</Text>
                <Pressable onPress={() => setAmount(fromAvail.toString())}
                  style={{ paddingHorizontal: DS.space.sm, paddingVertical: DS.space.xxs, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.xs, borderWidth: 1, borderColor: DS.color.gold }}>
                  <Text style={{ color: DS.color.gold, fontSize: 11, fontWeight: DS.font.bold }}>MAX</Text>
                </Pressable>
              </View>
              <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 4 }}>Internal wallet transfers are free and instant.</Text>
            </View>

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

            <Pressable onPress={handleSelfTransfer} disabled={submitting || loading}
              style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.xxxl, backgroundColor: submitting ? DS.color.surface : DS.color.info, borderRadius: DS.radius.lg, paddingVertical: DS.space.md, alignItems: 'center' }}>
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: DS.font.bold }}>Transfer Now</Text>}
            </Pressable>
          </>
        ) : (
          <>
            {/* Recipient */}
            <View style={{ paddingHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Recipient (Email / Username / UID)</Text>
              <View style={{ flexDirection: 'row', gap: DS.space.xs }}>
                <TextInput
                  value={recipient} onChangeText={t => { setRecipient(t); setRecipientInfo(null); setRecipientError(''); }}
                  placeholder="Enter email, username, or UID"
                  placeholderTextColor={DS.color.text3}
                  style={{ flex: 1, backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, color: DS.color.text1, fontSize: 14, borderWidth: 1, borderColor: DS.color.border }}
                  autoCapitalize="none" autoCorrect={false}
                />
                <Pressable onPress={lookupRecipient} disabled={lookingUp || !recipient.trim()}
                  style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.md, alignItems: 'center', justifyContent: 'center', opacity: !recipient.trim() ? 0.5 : 1 }}>
                  {lookingUp ? <ActivityIndicator color="#000" size="small" /> : <Text style={{ color: '#000', fontSize: 13, fontWeight: DS.font.bold }}>Find</Text>}
                </Pressable>
              </View>
              {recipientError ? <Text style={{ color: DS.color.sell, fontSize: 12, marginTop: 4 }}>{recipientError}</Text> : null}
              {recipientInfo && (
                <View style={{ marginTop: DS.space.xs, backgroundColor: `${DS.color.buy}15`, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: DS.space.sm, alignItems: 'center' }}>
                  <CheckCircle size={16} color={DS.color.buy} />
                  <Text style={{ color: DS.color.buy, fontSize: 13, fontWeight: DS.font.semibold }}>{recipientInfo.displayName}</Text>
                </View>
              )}
            </View>

            {/* Amount */}
            <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Amount</Text>
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                  value={amount} onChangeText={t => { setAmount(t.replace(/[^0-9.]/g, '')); setError(''); }}
                  placeholder="0.00" placeholderTextColor={DS.color.text3}
                  keyboardType="decimal-pad"
                  style={{ flex: 1, color: DS.color.text1, fontSize: 24, fontWeight: DS.font.bold }}
                />
                <Text style={{ color: DS.color.text2, fontSize: 14, marginRight: DS.space.sm }}>{asset}</Text>
                <Pressable onPress={() => setAmount(spotAvail.toString())}
                  style={{ paddingHorizontal: DS.space.sm, paddingVertical: DS.space.xxs, backgroundColor: DS.color.goldBg, borderRadius: DS.radius.xs, borderWidth: 1, borderColor: DS.color.gold }}>
                  <Text style={{ color: DS.color.gold, fontSize: 11, fontWeight: DS.font.bold }}>MAX</Text>
                </Pressable>
              </View>
              <Text style={{ color: DS.color.text3, fontSize: 11, marginTop: 4 }}>Available: {spotAvail.toFixed(4)} {asset} (Spot)</Text>
            </View>

            {/* Note */}
            <View style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.lg }}>
              <Text style={{ color: DS.color.text2, fontSize: 12, marginBottom: DS.space.xs }}>Note (Optional)</Text>
              <TextInput
                value={note} onChangeText={setNote}
                placeholder="Add a note..."
                placeholderTextColor={DS.color.text3}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.md, color: DS.color.text1, fontSize: 14, borderWidth: 1, borderColor: DS.color.border }}
                maxLength={120}
              />
            </View>

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

            <Pressable onPress={handleInternalTransfer} disabled={submitting || !recipientInfo}
              style={{ marginHorizontal: DS.space.md, marginBottom: DS.space.xxxl, backgroundColor: !recipientInfo || submitting ? DS.color.surface : DS.color.buy, borderRadius: DS.radius.lg, paddingVertical: DS.space.md, alignItems: 'center' }}>
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: submitting || !recipientInfo ? DS.color.text3 : '#000', fontSize: 16, fontWeight: DS.font.bold }}>Send {asset}</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
