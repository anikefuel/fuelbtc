// P2P Payment Accounts — manage your payment methods
import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, Modal, TextInput, ScrollView, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus, Trash2, ChevronDown, CreditCard, X } from 'lucide-react-native';
import {
  getMyPaymentAccounts, addPaymentAccount, deletePaymentAccount,
  getP2PPaymentMethods, getP2PFiats, getP2PCountries,
  type P2PPaymentAccount, type P2PPaymentMethod, type P2PFiat, type P2PCountry,
} from '@/services/p2p.service';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';

export default function PaymentAccounts() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<P2PPaymentAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [methods, setMethods] = useState<P2PPaymentMethod[]>([]);
  const [fiats, setFiats] = useState<P2PFiat[]>([]);
  const [countries, setCountries] = useState<P2PCountry[]>([]);

  // Form state
  const [paymentMethod, setPaymentMethod] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [fiatCode, setFiatCode] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    (async () => {
      const [accts, m, f, c] = await Promise.all([
        getMyPaymentAccounts(), getP2PPaymentMethods(), getP2PFiats(), getP2PCountries(),
      ]);
      setAccounts(accts); setMethods(m); setFiats(f); setCountries(c);
      setLoading(false);
    })();
  }, []));

  async function handleAdd() {
    if (!paymentMethod || !accountName || !accountNumber) {
      setError('Payment method, account name and number are required');
      return;
    }
    setSubmitting(true); setError('');
    try {
      await addPaymentAccount({ paymentMethod, accountName, accountNumber, bankName: bankName || undefined, fiatCode: fiatCode || undefined, countryCode: countryCode || undefined, extraInfo: extraInfo || undefined });
      const updated = await getMyPaymentAccounts();
      setAccounts(updated);
      setShowAdd(false);
      resetForm();
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Failed to add account'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await deletePaymentAccount(id);
    setAccounts(prev => prev.filter(a => a.id !== id));
  }

  function resetForm() {
    setPaymentMethod(''); setAccountName(''); setAccountNumber('');
    setBankName(''); setFiatCode(''); setCountryCode(''); setExtraInfo(''); setError('');
  }

  const Field = ({ label, value, onChange, placeholder, multiline = false }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
  }) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={DS.color.text3} multiline={multiline} numberOfLines={multiline ? 3 : 1}
        style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, color: DS.color.text1, borderWidth: 1, borderColor: DS.color.border, textAlignVertical: multiline ? 'top' : 'center' }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
          <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
            <ArrowLeft size={22} color={DS.color.text1} />
          </Pressable>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>Payment Methods</Text>
        </View>
        <Pressable onPress={() => setShowAdd(true)}
          style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Plus size={14} color={DS.color.bg} />
          <Text style={{ color: DS.color.bg, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>Add</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : (
        <FlatList
          data={accounts}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm, paddingBottom: 80 }}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: DS.space.sm }}>
              <CreditCard size={48} color={DS.color.text3} />
              <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold }}>No payment accounts</Text>
              <Text style={{ color: DS.color.text3, fontSize: DS.font.sm, textAlign: 'center' }}>Add your bank or payment accounts to receive fiat payments</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>{item.accountName}</Text>
                  {item.isVerified && (
                    <View style={{ backgroundColor: DS.color.buy + '20', borderRadius: DS.radius.xs, paddingHorizontal: 5, paddingVertical: 2 }}>
                      <Text style={{ color: DS.color.buy, fontSize: DS.font.xxxs, fontWeight: DS.font.bold }}>VERIFIED</Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: DS.color.gold, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>{item.paymentMethod}</Text>
                {item.bankName && <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{item.bankName}</Text>}
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>●●●●●●{item.accountNumber.slice(-4)}</Text>
                {item.fiatCode && <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>{item.fiatCode}{item.countryCode ? ` · ${item.countryCode}` : ''}</Text>}
              </View>
              <Pressable onPress={() => handleDelete(item.id)} style={{ padding: DS.space.sm }}>
                <Trash2 size={18} color={DS.color.sell} />
              </Pressable>
            </View>
          )}
        />
      )}

      {/* Add modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setShowAdd(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: DS.space.md, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
            <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>Add Payment Account</Text>
            <Pressable onPress={() => { setShowAdd(false); resetForm(); }}><X size={22} color={DS.color.text2} /></Pressable>
          </View>
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: DS.space.md, gap: DS.space.md, paddingBottom: 100 }}>
            {/* Payment method picker */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>PAYMENT METHOD *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {methods.map(m => (
                    <Pressable key={m.slug} onPress={() => setPaymentMethod(m.name)}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: DS.radius.full, backgroundColor: paymentMethod === m.name ? DS.color.gold : DS.color.card, borderWidth: 1, borderColor: paymentMethod === m.name ? DS.color.gold : DS.color.border }}>
                      <Text style={{ color: paymentMethod === m.name ? DS.color.bg : DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{m.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>

            <Field label="ACCOUNT NAME *" value={accountName} onChange={setAccountName} placeholder="Full name on account" />
            <Field label="ACCOUNT NUMBER / IDENTIFIER *" value={accountNumber} onChange={setAccountNumber} placeholder="Account number, phone, email..." />
            <Field label="BANK / PROVIDER NAME" value={bankName} onChange={setBankName} placeholder="e.g. GTBank, OPay..." />

            {/* Fiat */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>CURRENCY</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[{ code: '', name: 'Any' }, ...fiats].map(f => (
                    <Pressable key={f.code} onPress={() => setFiatCode(f.code)}
                      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: DS.radius.full, backgroundColor: fiatCode === f.code ? DS.color.gold : DS.color.card, borderWidth: 1, borderColor: fiatCode === f.code ? DS.color.gold : DS.color.border }}>
                      <Text style={{ color: fiatCode === f.code ? DS.color.bg : DS.color.text2, fontSize: DS.font.xs }}>{f.code || 'Any'}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>

            <Field label="EXTRA INSTRUCTIONS" value={extraInfo} onChange={setExtraInfo} placeholder="Any extra payment instructions..." multiline />

            {error ? <Text style={{ color: DS.color.sell, fontSize: DS.font.sm }}>{error}</Text> : null}
          </ScrollView>
          <View style={{ padding: DS.space.md, borderTopWidth: 1, borderTopColor: DS.color.border }}>
            <Pressable onPress={handleAdd}
              style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center' }}>
              {submitting ? <ActivityIndicator color={DS.color.bg} /> : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold }}>Save Account</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
