// P2P Dispute — open a dispute for an active trade
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, AlertTriangle, ShieldCheck } from 'lucide-react-native';
import { getTradeById, openDispute, getDisputeByTradeId, DISPUTE_REASONS, type P2PTrade, type P2PDispute } from '@/services/p2p.service';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import type { RelativePathString } from 'expo-router';

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Open — Awaiting Admin',
  under_review: 'Under Review',
  waiting_buyer: 'Waiting for Buyer',
  waiting_seller: 'Waiting for Seller',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

export default function DisputeScreen() {
  const { tradeId } = useLocalSearchParams<{ tradeId: string }>();
  const router = useRouter();
  const [trade, setTrade] = useState<P2PTrade | null>(null);
  const [existing, setExisting] = useState<P2PDispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [selectedReason, setSelectedReason] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    (async () => {
      if (!tradeId) return;
      const [t, d] = await Promise.all([getTradeById(tradeId), getDisputeByTradeId(tradeId)]);
      setTrade(t); setExisting(d); setLoading(false);
    })();
  }, [tradeId]);

  async function handleSubmit() {
    if (!selectedReason) { setError('Please select a reason'); return; }
    if (!trade) return;
    setSubmitting(true); setError('');
    try {
      await openDispute(trade.id, selectedReason, description || undefined);
      router.back();
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Failed to open dispute'));
      setSubmitting(false);
    }
  }

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={DS.color.gold} size="large" />
    </View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: DS.space.sm, padding: 4 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>Dispute Trade</Text>
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: DS.space.md, gap: DS.space.lg, paddingBottom: 120 }}>
        {/* Warning banner */}
        <View style={{ backgroundColor: '#EF444420', borderRadius: DS.radius.xl, padding: DS.space.md, flexDirection: 'row', gap: DS.space.sm, borderWidth: 1, borderColor: '#EF444440' }}>
          <AlertTriangle size={22} color="#EF4444" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#EF4444', fontWeight: DS.font.bold, marginBottom: 4 }}>Open a Dispute</Text>
            <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
              Opening a dispute will freeze this trade and notify the admin team. Please only proceed if you have a genuine issue. False disputes may result in account suspension.
            </Text>
          </View>
        </View>

        {/* Existing dispute */}
        {existing && (
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: DS.space.sm }}>
              <ShieldCheck size={18} color={DS.color.gold} />
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>Dispute Already Filed</Text>
            </View>
            <View style={{ gap: DS.space.xs }}>
              {[['Reason', existing.reason], ['Status', DISPUTE_STATUS_LABELS[existing.status] ?? existing.status], ['Filed', new Date(existing.createdAt).toLocaleDateString()]].map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>{k}</Text>
                  <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>{v}</Text>
                </View>
              ))}
              {existing.adminNote && (
                <View style={{ marginTop: DS.space.sm, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm }}>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 2 }}>ADMIN NOTE</Text>
                  <Text style={{ color: DS.color.text1, fontSize: DS.font.xs }}>{existing.adminNote}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Form — only if no existing dispute */}
        {!existing && (
          <>
            {/* Reason selection */}
            <View style={{ gap: 10 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>SELECT REASON</Text>
              {DISPUTE_REASONS.map(r => (
                <Pressable key={r} onPress={() => setSelectedReason(r)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: selectedReason === r ? DS.color.goldBg : DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, borderWidth: 1, borderColor: selectedReason === r ? DS.color.gold : DS.color.border }}>
                  <Text style={{ color: selectedReason === r ? DS.color.gold : DS.color.text1, fontWeight: selectedReason === r ? DS.font.bold : DS.font.regular, flex: 1 }}>{r}</Text>
                  {selectedReason === r && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DS.color.gold }} />}
                </Pressable>
              ))}
            </View>

            {/* Description */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>DESCRIPTION (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Describe the issue in detail..."
                placeholderTextColor={DS.color.text3}
                multiline numberOfLines={4}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, color: DS.color.text1, borderWidth: 1, borderColor: DS.color.border, textAlignVertical: 'top', minHeight: 100 }}
              />
            </View>

            <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, padding: DS.space.sm }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>
                💡 Evidence upload will be available in a future update. Please describe your issue clearly in the description field.
              </Text>
            </View>

            {error ? <Text style={{ color: DS.color.sell, fontSize: DS.font.sm }}>{error}</Text> : null}
          </>
        )}
      </ScrollView>

      {!existing && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: DS.space.md, backgroundColor: DS.color.bg, borderTopWidth: 1, borderTopColor: DS.color.border }}>
          <Pressable onPress={handleSubmit}
            style={{ backgroundColor: DS.color.sell, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center' }}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: DS.font.bold }}>Submit Dispute</Text>}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
