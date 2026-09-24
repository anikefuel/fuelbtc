// P2P Trade Review — rate the trade counterparty
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ThumbsUp, ThumbsDown, Star } from 'lucide-react-native';
import { getTradeById, submitReview, type P2PTrade } from '@/services/p2p.service';
import { supabase } from '@/client/supabase';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import type { RelativePathString } from 'expo-router';

export default function TradeReview() {
  const { tradeId } = useLocalSearchParams<{ tradeId: string }>();
  const router = useRouter();
  const [trade, setTrade] = useState<P2PTrade | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
      if (tradeId) {
        const t = await getTradeById(tradeId);
        setTrade(t);
      }
      setLoading(false);
    })();
  }, [tradeId]);

  const revieweeId = userId === trade?.buyerId ? trade?.sellerId : trade?.buyerId;
  const revieweeName = userId === trade?.buyerId ? 'Seller' : 'Buyer';
  const alreadyRated = userId === trade?.buyerId ? trade?.buyerRated : trade?.sellerRated;

  async function handleSubmit() {
    if (!rating) { setError('Please select a rating'); return; }
    if (!trade || !revieweeId) return;
    setSubmitting(true); setError('');
    try {
      await submitReview(trade.id, revieweeId, rating, comment || undefined);
      setDone(true);
    } catch (e: unknown) {
      setError(toUserMessage(e, 'Failed to submit review'));
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
        <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>Rate Trade</Text>
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: DS.space.md, gap: DS.space.xl, alignItems: 'center', paddingTop: 40, paddingBottom: 120 }}>
        {done || alreadyRated ? (
          <View style={{ alignItems: 'center', gap: DS.space.md }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: DS.color.buy + '20', alignItems: 'center', justifyContent: 'center' }}>
              <Star size={40} color={DS.color.gold} fill={DS.color.gold} />
            </View>
            <Text style={{ color: DS.color.text1, fontSize: DS.font.xl, fontWeight: DS.font.bold }}>Review Submitted!</Text>
            <Text style={{ color: DS.color.text2, textAlign: 'center' }}>Thank you for rating this trade. Your feedback helps build trust in the P2P community.</Text>
            <Pressable onPress={() => router.push('/(app)/(tabs)/p2p' as RelativePathString)}
              style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.xl, paddingHorizontal: 32, paddingVertical: DS.space.sm, marginTop: DS.space.md }}>
              <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold }}>Back to Marketplace</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ alignItems: 'center', gap: DS.space.sm }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: DS.color.gold + '40' }}>
                <Text style={{ color: DS.color.gold, fontSize: 24, fontWeight: DS.font.bold }}>
                  {revieweeName[0]}
                </Text>
              </View>
              <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>How was the {revieweeName}?</Text>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center' }}>
                Trade #{trade?.tradeNumber?.slice(-8)} · {trade?.cryptoAmount.toFixed(4)} {trade?.asset}
              </Text>
            </View>

            {/* Rating buttons */}
            <View style={{ flexDirection: 'row', gap: DS.space.xl }}>
              <Pressable onPress={() => setRating(1)}
                style={{ alignItems: 'center', gap: 8, opacity: rating !== null && rating !== 1 ? 0.4 : 1 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: rating === 1 ? DS.color.buy : DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: rating === 1 ? DS.color.buy : DS.color.border }}>
                  <ThumbsUp size={32} color={rating === 1 ? '#fff' : DS.color.text2} />
                </View>
                <Text style={{ color: rating === 1 ? DS.color.buy : DS.color.text2, fontWeight: DS.font.bold }}>Positive</Text>
              </Pressable>
              <Pressable onPress={() => setRating(-1)}
                style={{ alignItems: 'center', gap: 8, opacity: rating !== null && rating !== -1 ? 0.4 : 1 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: rating === -1 ? DS.color.sell : DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: rating === -1 ? DS.color.sell : DS.color.border }}>
                  <ThumbsDown size={32} color={rating === -1 ? '#fff' : DS.color.text2} />
                </View>
                <Text style={{ color: rating === -1 ? DS.color.sell : DS.color.text2, fontWeight: DS.font.bold }}>Negative</Text>
              </Pressable>
            </View>

            {/* Comment */}
            <View style={{ width: '100%', gap: 6 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>COMMENT (optional)</Text>
              <TextInput
                value={comment} onChangeText={setComment}
                placeholder="Share your experience..."
                placeholderTextColor={DS.color.text3}
                multiline numberOfLines={3}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, padding: DS.space.sm, color: DS.color.text1, borderWidth: 1, borderColor: DS.color.border, textAlignVertical: 'top', minHeight: 80 }}
              />
            </View>

            {error ? <Text style={{ color: DS.color.sell, fontSize: DS.font.sm }}>{error}</Text> : null}
          </>
        )}
      </ScrollView>

      {!done && !alreadyRated && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: DS.space.md, backgroundColor: DS.color.bg, borderTopWidth: 1, borderTopColor: DS.color.border }}>
          <Pressable onPress={handleSubmit}
            style={{ backgroundColor: rating ? DS.color.gold : DS.color.border, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center' }}>
            {submitting ? <ActivityIndicator color={DS.color.bg} /> : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold }}>Submit Review</Text>}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
