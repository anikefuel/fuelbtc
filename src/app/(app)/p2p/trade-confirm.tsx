// P2P Trade Confirmation — enter amount, select payment method, confirm
import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ShieldCheck, Star, Clock, ChevronDown } from 'lucide-react-native';
import { getAdById, getMyPaymentAccounts, createTrade, type P2PAd, type P2PPaymentAccount } from '@/services/p2p.service';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import type { RelativePathString } from 'expo-router';

const fiatSymbols: Record<string, string> = {
  NGN: '₦', USD: '$', EUR: '€', GBP: '£', KES: 'KSh', GHS: '₵',
  ZAR: 'R', UGX: 'USh', TZS: 'TSh', AED: 'د.إ', INR: '₹', PKR: '₨',
  IDR: 'Rp', MYR: 'RM', BRL: 'R$', MXN: '$', TRY: '₺', EGP: 'E£',
};
const fSym = (code: string) => fiatSymbols[code] ?? code + ' ';

export default function TradeConfirm() {
  const { adId, side } = useLocalSearchParams<{ adId: string; side: string }>();
  const router = useRouter();
  const [ad, setAd] = useState<P2PAd | null>(null);
  const [accounts, setAccounts] = useState<P2PPaymentAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [fiatAmount, setFiatAmount] = useState('');
  const [selectedPayment, setSelectedPayment] = useState('');
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);

  useEffect(() => {
    (async () => {
      if (!adId) return;
      const [loadedAd, loadedAccounts] = await Promise.all([
        getAdById(adId),
        getMyPaymentAccounts(),
      ]);
      setAd(loadedAd);
      setAccounts(loadedAccounts);
      if (loadedAd?.paymentMethods[0]) setSelectedPayment(loadedAd.paymentMethods[0]);
      setLoading(false);
    })();
  }, [adId]);

  if (loading || !ad) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={DS.color.gold} size="large" />
      </View>
    );
  }

  const m = ad.merchant;
  const cryptoAmount = fiatAmount && ad.price > 0 ? Number(fiatAmount) / ad.price : 0;
  const withinLimits = Number(fiatAmount) >= ad.minLimit && Number(fiatAmount) <= ad.maxLimit;
  const hasEnough = cryptoAmount <= ad.availableAmount;
  const canSubmit = fiatAmount && withinLimits && hasEnough && selectedPayment && !submitting;

  const isBuy = side === 'Buy';
  const ctaColor = isBuy ? DS.color.buy : DS.color.sell;

  const pctButtons = [25, 50, 75, 100];

  async function handleConfirm() {
    if (!canSubmit || !ad) return;
    setSubmitting(true);
    setError('');
    try {
      const tradeId = await createTrade({
        adId: ad.id,
        cryptoAmount,
        fiatAmount: Number(fiatAmount),
        paymentMethod: selectedPayment,
      });
      router.replace(`/(app)/p2p/active-trade?tradeId=${tradeId}` as RelativePathString);
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Failed to create trade. Please try again.'));
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: DS.space.sm, padding: 4 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>
          {isBuy ? 'Buy' : 'Sell'} {ad.asset}
        </Text>
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: DS.space.md, gap: DS.space.md, paddingBottom: 120 }}>
        {/* Merchant Info Card */}
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, marginBottom: DS.space.sm }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: DS.color.gold, fontSize: DS.font.base, fontWeight: DS.font.bold }}>
                {(m?.displayName ?? 'U')[0].toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base }}>{m?.displayName ?? 'Merchant'}</Text>
                {m?.isVerified && <ShieldCheck size={14} color={DS.color.buy} />}
                {m?.isOnline && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: DS.color.buy }} />}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, marginTop: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Star size={11} color={DS.color.gold} fill={DS.color.gold} />
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{ad.tradeCount} trades</Text>
                </View>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>·</Text>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{ad.completionRate}% completion</Text>
                {ad.avgReleaseTime > 0 && (
                  <>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>·</Text>
                    <Clock size={10} color={DS.color.text3} />
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>{ad.avgReleaseTime}m avg release</Text>
                  </>
                )}
              </View>
            </View>
          </View>

          {/* Price row */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: DS.space.sm, borderTopWidth: 1, borderTopColor: DS.color.border }}>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Price</Text>
            <Text style={{ color: DS.color.gold, fontSize: DS.font.base, fontWeight: DS.font.bold }}>
              {fSym(ad.fiat)}{ad.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {ad.asset}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: DS.space.xs }}>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Available</Text>
            <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>{ad.availableAmount.toLocaleString()} {ad.asset}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: DS.space.xs }}>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Limit</Text>
            <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>
              {fSym(ad.fiat)}{ad.minLimit.toLocaleString()} – {fSym(ad.fiat)}{ad.maxLimit.toLocaleString()}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: DS.space.xs }}>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>Payment window</Text>
            <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>{ad.paymentWindow} minutes</Text>
          </View>
          {ad.terms && (
            <View style={{ marginTop: DS.space.sm, padding: DS.space.sm, backgroundColor: DS.color.surface, borderRadius: DS.radius.md }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 3 }}>MERCHANT TERMS</Text>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{ad.terms}</Text>
            </View>
          )}
        </View>

        {/* Amount input */}
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.base, fontWeight: DS.font.bold }}>Trade Amount</Text>

          <View style={{ borderWidth: 1, borderColor: DS.color.border, borderRadius: DS.radius.lg, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: DS.space.sm, gap: 8, backgroundColor: DS.color.surface }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, width: 40 }}>Pay</Text>
              <TextInput
                value={fiatAmount}
                onChangeText={setFiatAmount}
                keyboardType="decimal-pad"
                placeholder={`${fSym(ad.fiat)}${ad.minLimit.toLocaleString()}`}
                placeholderTextColor={DS.color.text3}
                style={{ flex: 1, color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}
              />
              <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.sm, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>{ad.fiat}</Text>
              </View>
            </View>
            <View style={{ height: 1, backgroundColor: DS.color.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: DS.space.sm, gap: 8, backgroundColor: DS.color.surface }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, width: 40 }}>Get</Text>
              <Text style={{ flex: 1, color: cryptoAmount > 0 ? DS.color.text1 : DS.color.text3, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>
                {cryptoAmount > 0 ? cryptoAmount.toFixed(6) : '0.000000'}
              </Text>
              <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: DS.color.border }}>
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>{ad.asset}</Text>
              </View>
            </View>
          </View>

          {/* Quick % buttons */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {pctButtons.map(pct => (
              <Pressable
                key={pct}
                onPress={() => setFiatAmount(String(Math.floor(ad.maxLimit * pct / 100)))}
                style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}
              >
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{pct}%</Text>
              </Pressable>
            ))}
          </View>

          {fiatAmount && !withinLimits && (
            <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>
              Amount must be between {fSym(ad.fiat)}{ad.minLimit.toLocaleString()} and {fSym(ad.fiat)}{ad.maxLimit.toLocaleString()}
            </Text>
          )}
        </View>

        {/* Payment method selector */}
        <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: DS.space.sm }}>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.base, fontWeight: DS.font.bold }}>Payment Method</Text>
          <Pressable
            onPress={() => setShowPaymentPicker(true)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}
          >
            <Text style={{ color: selectedPayment ? DS.color.text1 : DS.color.text3, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>
              {selectedPayment || 'Select payment method'}
            </Text>
            <ChevronDown size={16} color={DS.color.text2} />
          </Pressable>

          {showPaymentPicker && (
            <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: DS.color.border }}>
              {ad.paymentMethods.map(pm => (
                <Pressable
                  key={pm}
                  onPress={() => { setSelectedPayment(pm); setShowPaymentPicker(false); }}
                  style={{ padding: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: selectedPayment === pm ? DS.color.goldBg : 'transparent' }}
                >
                  <Text style={{ color: selectedPayment === pm ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold }}>{pm}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Security notice */}
        <View style={{ backgroundColor: '#F59E0B15', borderRadius: DS.radius.lg, padding: DS.space.sm, flexDirection: 'row', gap: DS.space.sm, borderWidth: 1, borderColor: '#F59E0B30' }}>
          <ShieldCheck size={18} color="#F59E0B" />
          <Text style={{ flex: 1, color: DS.color.text2, fontSize: DS.font.xs }}>
            Crypto will be locked in escrow before the trade begins. Only release after confirming payment received in your account.
          </Text>
        </View>

        {error ? (
          <Text style={{ color: DS.color.sell, fontSize: DS.font.sm, textAlign: 'center' }}>{error}</Text>
        ) : null}
      </ScrollView>

      {/* CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: DS.space.md, backgroundColor: DS.color.bg, borderTopWidth: 1, borderTopColor: DS.color.border }}>
        <Pressable
          onPress={handleConfirm}
          style={{ backgroundColor: canSubmit ? ctaColor : DS.color.border, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.base }}>
              Confirm {isBuy ? 'Buy' : 'Sell'} {cryptoAmount > 0 ? `${cryptoAmount.toFixed(6)} ${ad.asset}` : ''}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
