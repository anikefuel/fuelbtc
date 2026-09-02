// P2P Active Trade — full trade lifecycle with timer, payment instructions, chat, release
// Step-up verification required before crypto release
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, FlatList, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, ShieldCheck, Clock, MessageCircle, AlertTriangle, CheckCircle, Send, ChevronRight, Copy, Eye, EyeOff } from 'lucide-react-native';
import {
  getTradeById, getTradeMessages, sendTradeMessage, markPaymentSent, releaseCrypto, cancelTrade,
  getTradePaymentDetails,
  type P2PTrade, type P2PTradeMessage,
} from '@/services/p2p.service';
import { supabase } from '@/client/supabase';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import { useStepUp } from '@/components/security/StepUpProvider';
import type { RelativePathString } from 'expo-router';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Created',
  awaiting_payment: 'Awaiting Payment',
  payment_marked: 'Payment Marked',
  awaiting_release: 'Awaiting Release',
  released: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  disputed: 'Disputed',
  refunded: 'Refunded',
};

const fiatSymbols: Record<string, string> = {
  NGN: '₦', USD: '$', EUR: '€', GBP: '£', KES: 'KSh', GHS: '₵',
  ZAR: 'R', UGX: 'USh', TZS: 'TSh', AED: 'د.إ', INR: '₹',
};
const fSym = (code: string) => fiatSymbols[code] ?? code + ' ';

function CountdownTimer({ dueAt }: { dueAt: string | undefined }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!dueAt) return;
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(dueAt).getTime() - Date.now()) / 1000));
      setSecs(diff);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [dueAt]);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  const urgent = secs < 300;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Clock size={14} color={urgent ? DS.color.sell : DS.color.gold} />
      <Text style={{ color: urgent ? DS.color.sell : DS.color.gold, fontWeight: DS.font.bold, fontSize: DS.font.base }}>{m}:{s}</Text>
    </View>
  );
}

export default function ActiveTrade() {
  const { tradeId } = useLocalSearchParams<{ tradeId: string }>();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [trade, setTrade] = useState<P2PTrade | null>(null);
  const [messages, setMessages] = useState<P2PTradeMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'info' | 'chat'>('info');
  const listRef = useRef<FlatList>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<{
    accountName: string; accountNumber: string; bankName?: string;
    extraInfo?: string; paymentMethod: string; fiatCode?: string;
  } | null>(null);
  const [showAccountNumber, setShowAccountNumber] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const loadTrade = useCallback(async () => {
    if (!tradeId) return;
    const [t, m] = await Promise.all([getTradeById(tradeId), getTradeMessages(tradeId)]);
    setTrade(t);
    setMessages(m);
    setLoading(false);
    // Fetch seller payment details for buyer when trade is active
    if (t && ['awaiting_payment', 'payment_marked', 'awaiting_release'].includes(t.status)) {
      try {
        const pd = await getTradePaymentDetails(tradeId);
        setPaymentDetails(pd);
      } catch {
        // Not a trade party or RPC not available yet — silently skip
      }
    }
  }, [tradeId]);

  useFocusEffect(useCallback(() => { loadTrade(); }, [loadTrade]));

  // Poll every 10s for live updates
  useEffect(() => {
    const id = setInterval(loadTrade, 10000);
    return () => clearInterval(id);
  }, [loadTrade]);

  if (loading || !trade) {
    return <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={DS.color.gold} size="large" />
    </View>;
  }

  const isBuyer = currentUserId === trade.buyerId;
  const isSeller = currentUserId === trade.sellerId;
  const s = trade.status;
  const isActive = !['released', 'cancelled', 'expired', 'refunded'].includes(s);
  const statusColor = s === 'released' ? DS.color.buy : s === 'disputed' ? DS.color.sell : s === 'payment_marked' ? DS.color.gold : DS.color.text2;

  async function handleMarkPaid() {
    if (actionLoading) return;
    setActionLoading(true); setError('');
    try { await markPaymentSent(trade!.id); await loadTrade(); }
    catch (e: unknown) { setError(toUserMessage(e, 'Failed to mark payment. Please try again.')); }
    finally { setActionLoading(false); }
  }
  async function handleRelease() {
    if (actionLoading || !trade) return;
    // Require step-up verification before releasing escrowed crypto
    const token = await requestStepUp({
      action_type: 'p2p_escrow_release',
      txn_id: trade.id,
      amount: trade.cryptoAmount,
      asset: trade.asset,
      description: `Authorize release of ${trade.cryptoAmount} ${trade.asset} from escrow for trade #${trade.id.slice(0, 8)}`,
    });
    if (!token) return; // user cancelled
    setActionLoading(true); setError('');
    try { await releaseCrypto(trade.id, token.token_id); await loadTrade(); }
    catch (e: unknown) { setError(toUserMessage(e, 'Failed to release funds. Please try again.')); }
    finally { setActionLoading(false); }
  }
  async function handleCancel() {
    if (actionLoading) return;
    setActionLoading(true); setError('');
    try { await cancelTrade(trade!.id, 'Cancelled by user'); await loadTrade(); }
    catch (e: unknown) { setError(toUserMessage(e, 'Failed to cancel trade. Please try again.')); }
    finally { setActionLoading(false); }
  }
  async function handleSendMsg() {
    if (!msgInput.trim() || sending) return;
    setSending(true);
    try { await sendTradeMessage(trade!.id, msgInput.trim()); setMsgInput(''); await loadTrade(); }
    finally { setSending(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>Trade #{trade.tradeNumber?.slice(-8)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
            <Text style={{ color: statusColor, fontSize: DS.font.xs }}>{STATUS_LABELS[s] ?? s}</Text>
          </View>
        </View>
        {isActive && (
          <Pressable onPress={() => router.push(`/(app)/p2p/dispute?tradeId=${trade.id}` as RelativePathString)}>
            <AlertTriangle size={20} color={DS.color.sell} />
          </Pressable>
        )}
        {!isActive && <View style={{ width: 30 }} />}
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
        {(['info', 'chat'] as const).map(t2 => (
          <Pressable key={t2} onPress={() => setActiveTab(t2)}
            style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: activeTab === t2 ? DS.color.gold : 'transparent' }}>
            <Text style={{ color: activeTab === t2 ? DS.color.gold : DS.color.text2, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>
              {t2 === 'info' ? 'Trade Info' : 'Chat'}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 'info' ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: DS.space.md, gap: DS.space.md, paddingBottom: 120 }}>
          {/* Timer */}
          {(s === 'awaiting_payment' || s === 'payment_marked') && trade.paymentDueAt && (
            <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.xl, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: DS.color.gold + '40' }}>
              <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold }}>Payment Due In</Text>
              <CountdownTimer dueAt={trade.paymentDueAt} />
            </View>
          )}

          {/* Trade summary */}
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, gap: DS.space.xs }}>
            <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.base, marginBottom: DS.space.xs }}>Trade Summary</Text>
            {[
              ['Asset', `${trade.cryptoAmount.toFixed(6)} ${trade.asset}`],
              ['Fiat Amount', `${fSym(trade.fiat)}${trade.fiatAmount.toLocaleString()}`],
              ['Price', `${fSym(trade.fiat)}${trade.price.toLocaleString()} / ${trade.asset}`],
              ['Payment Method', trade.paymentMethod],
              ['Role', isBuyer ? 'Buyer' : 'Seller'],
            ].map(([label, val]) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: DS.space.xs, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>{label}</Text>
                <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.semibold }}>{val}</Text>
              </View>
            ))}
          </View>

          {/* Buyer payment instructions */}
          {isBuyer && (s === 'awaiting_payment' || s === 'payment_marked') && (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: DS.space.sm }}>
                <ShieldCheck size={18} color={DS.color.buy} />
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold }}>Payment Instructions</Text>
              </View>

              {/* Amount summary */}
              <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.lg, padding: DS.space.sm, gap: DS.space.xs, marginBottom: DS.space.sm }}>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.sm }}>
                  Send <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold }}>{fSym(trade.fiat)}{trade.fiatAmount.toLocaleString()} {trade.fiat}</Text> via <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{trade.paymentMethod}</Text>
                </Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>
                  Reference: <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold }}>{trade.tradeNumber}</Text>
                </Text>
              </View>

              {/* Real seller payment details (from SECURITY DEFINER RPC — only visible to trade parties) */}
              {paymentDetails ? (
                <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.lg, padding: DS.space.sm, gap: 6, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
                  <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.bold, letterSpacing: 0.5 }}>SELLER PAYMENT ACCOUNT</Text>
                  {([
                    ['Account Name', paymentDetails.accountName],
                    paymentDetails.bankName ? ['Bank / Provider', paymentDetails.bankName] : null,
                    paymentDetails.fiatCode ? ['Currency', paymentDetails.fiatCode] : null,
                  ].filter(Boolean) as [string, string][]).map(([label, val]) => (
                    <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{label}</Text>
                      <Text style={{ color: DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>{val}</Text>
                    </View>
                  ))}
                  {/* Account number revealed on tap */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>Account Number</Text>
                    <Pressable onPress={() => setShowAccountNumber(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ color: DS.color.gold, fontSize: DS.font.xs, fontWeight: DS.font.bold }}>
                        {showAccountNumber ? paymentDetails.accountNumber : '••••' + paymentDetails.accountNumber.slice(-4)}
                      </Text>
                      {showAccountNumber
                        ? <EyeOff size={12} color={DS.color.gold} />
                        : <Eye size={12} color={DS.color.gold} />}
                    </Pressable>
                  </View>
                  {paymentDetails.extraInfo ? (
                    <View>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Instructions</Text>
                      <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{paymentDetails.extraInfo}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm }}>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, textAlign: 'center' }}>
                    Loading seller payment details…
                  </Text>
                </View>
              )}

              <View style={{ backgroundColor: '#EF444420', borderRadius: DS.radius.md, padding: DS.space.sm, borderWidth: 1, borderColor: '#EF444440' }}>
                <Text style={{ color: '#EF4444', fontSize: DS.font.xs }}>
                  {'⚠️ Do NOT include words like "crypto", "USDT", "BTC" in your payment reference. Only pay the exact amount shown above.'}
                </Text>
              </View>
            </View>
          )}

          {isSeller && s === 'payment_marked' && (
            <View style={{ backgroundColor: '#F59E0B15', borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: '#F59E0B40' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: DS.space.sm }}>
                <AlertTriangle size={18} color="#F59E0B" />
                <Text style={{ color: '#F59E0B', fontWeight: DS.font.bold }}>Verify Before Releasing</Text>
              </View>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, lineHeight: 20 }}>
                The buyer has marked payment as sent. Before releasing crypto:{'\n'}
                1. Log into your payment account{'\n'}
                2. Confirm you received exactly <Text style={{ color: DS.color.gold, fontWeight: DS.font.bold }}>{fSym(trade.fiat)}{trade.fiatAmount.toLocaleString()} {trade.fiat}</Text>{'\n'}
                {'3. Only then tap "Release Crypto"'}{'\n\n'}
                <Text style={{ color: '#EF4444', fontWeight: DS.font.semibold }}>Never release based on screenshots or verbal confirmation alone.</Text>
              </Text>
            </View>
          )}
          <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border, flexDirection: 'row', gap: DS.space.sm, alignItems: 'center' }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: DS.color.buy + '20', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={20} color={DS.color.buy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Escrow Protected</Text>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{trade.cryptoAmount.toFixed(6)} {trade.asset} is locked in escrow</Text>
            </View>
            {trade.escrowReleased && <CheckCircle size={18} color={DS.color.buy} />}
          </View>

          {error ? <Text style={{ color: DS.color.sell, fontSize: DS.font.sm, textAlign: 'center' }}>{error}</Text> : null}
        </ScrollView>
      ) : (
        // Chat tab
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: DS.space.md, gap: 8, paddingBottom: 80 }}
            contentInsetAdjustmentBehavior="automatic"
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              if (item.isSystem) {
                return (
                  <View style={{ alignSelf: 'center', backgroundColor: DS.color.goldBg, borderRadius: DS.radius.full, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: DS.color.gold + '30' }}>
                    <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, textAlign: 'center' }}>{item.message}</Text>
                  </View>
                );
              }
              const isMine = item.senderId === currentUserId;
              return (
                <View style={{ alignSelf: isMine ? 'flex-end' : 'flex-start', maxWidth: '80%', backgroundColor: isMine ? DS.color.gold : DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.sm, borderBottomRightRadius: isMine ? 4 : DS.radius.xl, borderBottomLeftRadius: isMine ? DS.radius.xl : 4 }}>
                  <Text style={{ color: isMine ? DS.color.bg : DS.color.text1, fontSize: DS.font.sm }}>{item.message}</Text>
                  <Text style={{ color: isMine ? DS.color.bg + 'aa' : DS.color.text3, fontSize: DS.font.xxxs, alignSelf: 'flex-end', marginTop: 2 }}>
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            }}
          />
          {isActive && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: DS.space.sm, borderTopWidth: 1, borderTopColor: DS.color.border, backgroundColor: DS.color.bg }}>
              <TextInput
                value={msgInput} onChangeText={setMsgInput}
                placeholder="Type a message..." placeholderTextColor={DS.color.text3}
                style={{ flex: 1, backgroundColor: DS.color.card, borderRadius: DS.radius.full, paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, color: DS.color.text1, borderWidth: 1, borderColor: DS.color.border }}
                returnKeyType="send" onSubmitEditing={handleSendMsg}
              />
              <Pressable onPress={handleSendMsg}
                style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: DS.color.gold, alignItems: 'center', justifyContent: 'center' }}>
                {sending ? <ActivityIndicator color={DS.color.bg} size="small" /> : <Send size={18} color={DS.color.bg} />}
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* Action buttons */}
      {isActive && activeTab === 'info' && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: DS.space.md, backgroundColor: DS.color.bg, borderTopWidth: 1, borderTopColor: DS.color.border, gap: DS.space.sm }}>
          {isBuyer && s === 'awaiting_payment' && (
            <Pressable onPress={handleMarkPaid}
              style={{ backgroundColor: DS.color.buy, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center' }}>
              {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: DS.font.bold }}>I Have Paid</Text>}
            </Pressable>
          )}
          {isSeller && s === 'payment_marked' && (
            <Pressable onPress={handleRelease}
              style={{ backgroundColor: DS.color.buy, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center' }}>
              {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: DS.font.bold }}>Release Crypto</Text>}
            </Pressable>
          )}
          {s === 'released' && (
            <Pressable onPress={() => router.push(`/(app)/p2p/review?tradeId=${trade.id}` as RelativePathString)}
              style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.xl, padding: DS.space.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold }}>Rate this Trade</Text>
              <ChevronRight size={16} color={DS.color.bg} />
            </Pressable>
          )}
          {(s === 'awaiting_payment') && (
            <Pressable onPress={handleCancel}
              style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.xl, padding: DS.space.sm, alignItems: 'center', borderWidth: 1, borderColor: DS.color.border }}>
              <Text style={{ color: DS.color.sell, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Cancel Trade</Text>
            </Pressable>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
