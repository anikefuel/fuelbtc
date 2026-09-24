// P2P Post Ad — create buy/sell ad with all parameters
// KYC Tier 1 required to post ads
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, KeyboardAvoidingView, ActivityIndicator, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, X } from 'lucide-react-native';
import {
  getP2PAssets, getP2PFiats, getP2PCountries, getP2PPaymentMethods, createAd,
  type P2PAsset, type P2PFiat, type P2PCountry, type P2PPaymentMethod,
} from '@/services/p2p.service';
import { getProfile } from '@/services/auth.service';
import { KycGateBanner } from '@/components/shared/KycGate';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import type { RelativePathString } from 'expo-router';

export default function PostAd() {
  const router = useRouter();
  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [asset, setAsset] = useState('USDT');
  const [fiat, setFiat] = useState('NGN');
  const [priceType, setPriceType] = useState<'fixed' | 'floating'>('fixed');
  const [price, setPrice] = useState('');
  const [floatMargin, setFloatMargin] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [minLimit, setMinLimit] = useState('');
  const [maxLimit, setMaxLimit] = useState('');
  const [paymentWindow, setPaymentWindow] = useState('15');
  const [terms, setTerms] = useState('');
  const [autoReply, setAutoReply] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);

  const [assets, setAssets] = useState<P2PAsset[]>([]);
  const [fiats, setFiats] = useState<P2PFiat[]>([]);
  const [countries, setCountries] = useState<P2PCountry[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<P2PPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [userTier, setUserTier] = useState<string | null>(null);

  const [showAsset, setShowAsset] = useState(false);
  const [showFiat, setShowFiat] = useState(false);
  const [showCountry, setShowCountry] = useState(false);

  useEffect(() => {
    (async () => {
      const [a, f, c, profile] = await Promise.all([
        getP2PAssets(), getP2PFiats(), getP2PCountries(), getProfile(),
      ]);
      setAssets(a); setFiats(f); setCountries(c);
      setUserTier(profile?.kyc_tier ?? null);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    getP2PPaymentMethods(fiat, countryCode || undefined).then(setPaymentMethods).catch(() => {});
  }, [fiat, countryCode]);

  const togglePayment = (slug: string) => {
    setSelectedPayments(prev => prev.includes(slug) ? prev.filter(p => p !== slug) : [...prev, slug]);
  };

  const validate = () => {
    if (!price && priceType === 'fixed') return 'Enter a price';
    if (!totalAmount) return 'Enter total amount';
    if (!minLimit) return 'Enter minimum limit';
    if (!maxLimit) return 'Enter maximum limit';
    if (Number(minLimit) > Number(maxLimit)) return 'Min limit must be less than max limit';
    if (selectedPayments.length === 0) return 'Select at least one payment method';
    return '';
  };

  async function handleSubmit() {
    const err = validate();
    if (err) { setError(err); return; }
    setSubmitting(true); setError('');
    try {
      const adId = await createAd({
        side, asset, fiat,
        countryCode: countryCode || undefined,
        priceType,
        price: Number(price),
        floatMargin: floatMargin ? Number(floatMargin) : undefined,
        totalAmount: Number(totalAmount),
        minLimit: Number(minLimit),
        maxLimit: Number(maxLimit),
        paymentMethods: selectedPayments,
        paymentWindow: Number(paymentWindow) || 15,
        terms: terms || undefined,
        autoReply: autoReply || undefined,
      });
      router.replace('/(app)/(tabs)/p2p' as RelativePathString);
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Failed to post ad'));
      setSubmitting(false);
    }
  }

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={DS.color.gold} size="large" />
    </View>;
  }

  const PickerRow = ({ label, value, onPress }: { label: string; value: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
      <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{value || `Select ${label}`}</Text>
      <ChevronDown size={16} color={DS.color.text2} />
    </Pressable>
  );

  const Field = ({ label, value, onChange, placeholder, keyboardType = 'default', multiline = false }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'numeric'; multiline?: boolean;
  }) => (
    <View style={{ gap: 6 }}>
      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={DS.color.text3}
        keyboardType={keyboardType} multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, color: DS.color.text1, borderWidth: 1, borderColor: DS.color.border, textAlignVertical: multiline ? 'top' : 'center' }}
      />
    </View>
  );

  const selectedAsset = assets.find(a => a.symbol === asset);
  const selectedFiat = fiats.find(f => f.code === fiat);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: DS.space.sm, padding: 4 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>Post P2P Ad</Text>
      </View>

      {/* KYC Tier 1 gate banner */}
      <View style={{ paddingHorizontal: DS.space.md, paddingTop: DS.space.sm }}>
        <KycGateBanner requiredTier="tier1" featureName="Posting P2P Ads" userTier={userTier} />
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: DS.space.md, gap: DS.space.lg, paddingBottom: 120 }}>
        {/* Buy/Sell */}
        <View>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold, marginBottom: 8 }}>AD TYPE</Text>
          <View style={{ flexDirection: 'row', backgroundColor: DS.color.surface, borderRadius: DS.radius.full, padding: 3 }}>
            {(['sell', 'buy'] as const).map(s => (
              <Pressable key={s} onPress={() => setSide(s)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: DS.radius.full, backgroundColor: side === s ? (s === 'sell' ? DS.color.sell : DS.color.buy) : 'transparent', alignItems: 'center' }}>
                <Text style={{ color: side === s ? '#fff' : DS.color.text2, fontWeight: DS.font.bold, textTransform: 'capitalize' }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Asset & Fiat */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>CRYPTO & CURRENCY</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>Asset</Text>
              <PickerRow label="Asset" value={selectedAsset?.symbol ?? asset} onPress={() => setShowAsset(v => !v)} />
              {showAsset && (
                <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden' }}>
                  {assets.map(a => (
                    <Pressable key={a.symbol} onPress={() => { setAsset(a.symbol); setShowAsset(false); }}
                      style={{ padding: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: asset === a.symbol ? DS.color.goldBg : 'transparent' }}>
                      <Text style={{ color: asset === a.symbol ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold }}>{a.symbol} · {a.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>Currency</Text>
              <PickerRow label="Fiat" value={selectedFiat ? `${selectedFiat.symbol} ${selectedFiat.code}` : fiat} onPress={() => setShowFiat(v => !v)} />
              {showFiat && (
                <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden', maxHeight: 200 }}>
                  <ScrollView>
                    {fiats.map(f2 => (
                      <Pressable key={f2.code} onPress={() => { setFiat(f2.code); setShowFiat(false); }}
                        style={{ padding: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: fiat === f2.code ? DS.color.goldBg : 'transparent' }}>
                        <Text style={{ color: fiat === f2.code ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold }}>{f2.symbol} {f2.code} · {f2.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Price */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>PRICE SETTINGS</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['fixed', 'floating'] as const).map(pt => (
              <Pressable key={pt} onPress={() => setPriceType(pt)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: DS.radius.lg, backgroundColor: priceType === pt ? DS.color.goldBg : DS.color.card, alignItems: 'center', borderWidth: 1, borderColor: priceType === pt ? DS.color.gold : DS.color.border }}>
                <Text style={{ color: priceType === pt ? DS.color.gold : DS.color.text2, fontWeight: DS.font.semibold, fontSize: DS.font.sm, textTransform: 'capitalize' }}>{pt}</Text>
              </Pressable>
            ))}
          </View>
          {priceType === 'fixed'
            ? <Field label={`PRICE (${fiat} per ${asset})`} value={price} onChange={setPrice} placeholder="Enter price" keyboardType="decimal-pad" />
            : <Field label="FLOAT MARGIN (%)" value={floatMargin} onChange={setFloatMargin} placeholder="e.g. 2 = 2% above market" keyboardType="decimal-pad" />
          }
        </View>

        {/* Amounts */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>AMOUNTS</Text>
          <Field label={`TOTAL AMOUNT (${asset})`} value={totalAmount} onChange={setTotalAmount} placeholder="0.00" keyboardType="decimal-pad" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label={`MIN LIMIT (${fiat})`} value={minLimit} onChange={setMinLimit} placeholder="Min" keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={`MAX LIMIT (${fiat})`} value={maxLimit} onChange={setMaxLimit} placeholder="Max" keyboardType="decimal-pad" />
            </View>
          </View>
          <Field label="PAYMENT WINDOW (minutes)" value={paymentWindow} onChange={setPaymentWindow} placeholder="15" keyboardType="numeric" />
        </View>

        {/* Payment methods */}
        <View style={{ gap: 10 }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>PAYMENT METHODS</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {paymentMethods.map(pm => {
              const isSelected = selectedPayments.includes(pm.slug);
              return (
                <Pressable key={pm.slug} onPress={() => togglePayment(pm.slug)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: DS.radius.full, backgroundColor: isSelected ? DS.color.gold : DS.color.card, borderWidth: 1, borderColor: isSelected ? DS.color.gold : DS.color.border }}>
                  <Text style={{ color: isSelected ? DS.color.bg : DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{pm.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Country */}
        <View style={{ gap: 6 }}>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>COUNTRY (optional)</Text>
          <PickerRow label="Country" value={countries.find(c => c.code === countryCode)?.name ?? 'All countries'} onPress={() => setShowCountry(v => !v)} />
          {showCountry && (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden', maxHeight: 200 }}>
              <ScrollView>
                <Pressable onPress={() => { setCountryCode(''); setShowCountry(false); }}
                  style={{ padding: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: !countryCode ? DS.color.goldBg : 'transparent' }}>
                  <Text style={{ color: !countryCode ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold }}>All Countries</Text>
                </Pressable>
                {countries.map(c => (
                  <Pressable key={c.code} onPress={() => { setCountryCode(c.code); setShowCountry(false); }}
                    style={{ padding: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: countryCode === c.code ? DS.color.goldBg : 'transparent' }}>
                    <Text style={{ color: countryCode === c.code ? DS.color.gold : DS.color.text1, fontWeight: DS.font.semibold }}>{c.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Terms & Auto-reply */}
        <Field label="TERMS & CONDITIONS (optional)" value={terms} onChange={setTerms} placeholder="Enter your trading terms..." multiline />
        <Field label="AUTO-REPLY MESSAGE (optional)" value={autoReply} onChange={setAutoReply} placeholder="Auto message sent to buyer..." multiline />

        {error ? <Text style={{ color: DS.color.sell, fontSize: DS.font.sm }}>{error}</Text> : null}
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: DS.space.md, backgroundColor: DS.color.bg, borderTopWidth: 1, borderTopColor: DS.color.border }}>
        <Pressable onPress={handleSubmit}
          style={{ backgroundColor: side === 'sell' ? DS.color.sell : DS.color.buy, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center' }}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: DS.font.base }}>Post {side === 'sell' ? 'Sell' : 'Buy'} Ad</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
