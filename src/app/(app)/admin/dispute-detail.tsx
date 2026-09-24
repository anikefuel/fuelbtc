// Admin Dispute Resolution — full adjudication screen for a single P2P dispute
// Shows trade context, dispute reason, chat history, evidence, and admin decision controls.
import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput,
  ActivityIndicator, KeyboardAvoidingView, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, ShieldCheck, AlertTriangle, CheckCircle, XCircle,
  MessageCircle, User, Scale, Clock, RefreshCw,
} from 'lucide-react-native';
import {
  adminGetDisputeDetail, adminResolveDispute, adminReleaseTrade, adminRefundTrade,
  type P2PDispute, type P2PTrade, type P2PTradeMessage,
} from '@/services/p2p.service';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';

type Decision = 'release_to_buyer' | 'refund_to_seller' | 'reject_dispute';

const STATUS_COLOR: Record<string, string> = {
  open: DS.color.sell,
  under_review: DS.color.warn,
  resolved: DS.color.buy,
  rejected: DS.color.text3,
  closed: DS.color.text3,
};

const TRADE_STATUS_COLOR: Record<string, string> = {
  awaiting_payment: DS.color.warn,
  payment_marked: DS.color.warn,
  awaiting_release: DS.color.gold,
  disputed: DS.color.sell,
  released: DS.color.buy,
  refunded: DS.color.text2,
  cancelled: DS.color.text3,
};

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
      <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>{label}</Text>
      <Text style={{ color: valueColor ?? DS.color.text1, fontSize: DS.font.xs, fontWeight: DS.font.semibold, flexShrink: 1, textAlign: 'right', marginLeft: 12 }} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, marginBottom: DS.space.sm, borderWidth: 1, borderColor: DS.color.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: DS.space.sm }}>
        {icon}
        <Text style={{ color: DS.color.text1, fontSize: DS.font.sm, fontWeight: DS.font.bold }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export default function DisputeDetailScreen() {
  const { disputeId } = useLocalSearchParams<{ disputeId: string }>();
  const router = useRouter();

  type DetailType = P2PDispute & { trade?: P2PTrade; messages?: P2PTradeMessage[] };
  const [detail, setDetail] = useState<DetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!disputeId) return;
    setLoading(true);
    try {
      const data = await adminGetDisputeDetail(disputeId);
      setDetail(data);
      setAdminNote(data.adminNote ?? '');
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load dispute details.'));
    } finally {
      setLoading(false);
    }
  }, [disputeId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDecision = async (decision: Decision) => {
    if (!detail || submitting) return;
    if (!adminNote.trim()) { setError('Please enter an admin note before adjudicating.'); return; }
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      if (decision === 'release_to_buyer') {
        // Mark dispute resolved in buyer's favor, then release escrow
        await adminResolveDispute(
          detail.id, 'resolved',
          adminNote.trim(),
          detail.trade?.buyerId,
        );
        await adminReleaseTrade(detail.tradeId);
        setSuccess('Dispute resolved — funds released to buyer.');
      } else if (decision === 'refund_to_seller') {
        // Mark dispute resolved in seller's favor, then refund escrow
        await adminResolveDispute(
          detail.id, 'resolved',
          adminNote.trim(),
          detail.trade?.sellerId,
        );
        await adminRefundTrade(detail.tradeId);
        setSuccess('Dispute resolved — funds refunded to seller.');
      } else {
        // Reject without touching escrow
        await adminResolveDispute(detail.id, 'rejected', adminNote.trim());
        setSuccess('Dispute rejected — no funds moved.');
      }
      await load();
    } catch (e) {
      setError(toUserMessage(e, 'Failed to process decision. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const isResolved = detail?.status === 'resolved' || detail?.status === 'rejected';

  const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString() : '—';
  const shortId = (id?: string) => id ? id.slice(0, 8) + '…' : '—';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DS.color.bg }} behavior="padding">
      {/* Header */}
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, backgroundColor: DS.color.bg, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={() => router.back()} style={{ padding: 6 }}>
          <ArrowLeft size={22} color={DS.color.text1} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: DS.color.text1, fontSize: DS.font.lg, fontWeight: DS.font.bold }}>
            Dispute #{shortId(disputeId)}
          </Text>
          {detail && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS_COLOR[detail.status] ?? DS.color.text3 }} />
              <Text style={{ color: STATUS_COLOR[detail.status] ?? DS.color.text3, fontSize: DS.font.xs, fontWeight: DS.font.semibold, textTransform: 'uppercase' }}>
                {detail.status.replace('_', ' ')}
              </Text>
            </View>
          )}
        </View>
        <Pressable onPress={load} style={{ padding: 6 }}>
          <RefreshCw size={18} color={DS.color.text2} />
        </Pressable>
      </View>

      {loading && !detail ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={DS.color.gold} size="large" />
        </View>
      ) : !detail ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: DS.space.xl }}>
          <AlertTriangle size={40} color={DS.color.sell} />
          <Text style={{ color: DS.color.text1, fontSize: DS.font.md, fontWeight: DS.font.bold, marginTop: DS.space.md }}>Dispute Not Found</Text>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', marginTop: 6 }}>{error || 'Could not load dispute details.'}</Text>
        </View>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: DS.space.md, paddingBottom: 80 }}>

          {/* Feedback banners */}
          {!!error && (
            <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: DS.color.sell + '40' }}>
              <AlertTriangle size={16} color={DS.color.sell} />
              <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
            </View>
          )}
          {!!success && (
            <View style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: DS.color.buy + '40' }}>
              <CheckCircle size={16} color={DS.color.buy} />
              <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, flex: 1 }}>{success}</Text>
            </View>
          )}

          {/* ── Dispute Info ── */}
          <Section title="Dispute Details" icon={<Scale size={16} color={DS.color.sell} />}>
            <InfoRow label="Dispute ID"      value={detail.id} />
            <InfoRow label="Raised By"       value={shortId(detail.raisedBy)} />
            <InfoRow label="Reason"          value={detail.reason} valueColor={DS.color.warn} />
            <InfoRow label="Opened"          value={fmt(detail.createdAt)} />
            {detail.description ? (
              <View style={{ marginTop: DS.space.xs }}>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>DESCRIPTION</Text>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, lineHeight: 18 }}>{detail.description}</Text>
              </View>
            ) : null}
            {detail.evidenceUrls?.length > 0 && (
              <View style={{ marginTop: DS.space.xs }}>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>EVIDENCE ({detail.evidenceUrls.length} file{detail.evidenceUrls.length !== 1 ? 's' : ''})</Text>
                {detail.evidenceUrls.map((url, i) => (
                  <Text key={i} style={{ color: DS.color.gold, fontSize: DS.font.xs, marginBottom: 2 }} numberOfLines={1}>{url}</Text>
                ))}
              </View>
            )}
            {detail.adminNote ? (
              <View style={{ marginTop: DS.space.xs, backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.xs }}>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 3 }}>PREVIOUS ADMIN NOTE</Text>
                <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{detail.adminNote}</Text>
              </View>
            ) : null}
          </Section>

          {/* ── Trade Info ── */}
          {detail.trade ? (
            <Section title="Trade Details" icon={<ShieldCheck size={16} color={DS.color.gold} />}>
              <InfoRow label="Trade #"        value={detail.trade.tradeNumber ?? shortId(detail.trade.id)} />
              <InfoRow label="Status"         value={detail.trade.status.replace('_', ' ').toUpperCase()} valueColor={TRADE_STATUS_COLOR[detail.trade.status]} />
              <InfoRow label="Asset"          value={`${detail.trade.cryptoAmount} ${detail.trade.asset}`} valueColor={DS.color.gold} />
              <InfoRow label="Fiat Amount"    value={`${detail.trade.fiatAmount?.toLocaleString()} ${detail.trade.fiat}`} />
              <InfoRow label="Price"          value={`${detail.trade.price} ${detail.trade.fiat}`} />
              <InfoRow label="Payment Method" value={detail.trade.paymentMethod} />
              <InfoRow label="Buyer ID"       value={shortId(detail.trade.buyerId)} />
              <InfoRow label="Seller ID"      value={shortId(detail.trade.sellerId)} />
              <InfoRow label="Escrow Released" value={detail.trade.escrowReleased ? 'Yes' : 'No'} valueColor={detail.trade.escrowReleased ? DS.color.buy : DS.color.sell} />
              <InfoRow label="Created"        value={fmt(detail.trade.createdAt)} />
              {detail.trade.paidAt     && <InfoRow label="Paid At"     value={fmt(detail.trade.paidAt)} />}
              {detail.trade.releasedAt && <InfoRow label="Released At" value={fmt(detail.trade.releasedAt)} />}
            </Section>
          ) : null}

          {/* ── Chat History ── */}
          {(detail.messages?.length ?? 0) > 0 && (
            <Section title={`Chat History (${detail.messages!.length} messages)`} icon={<MessageCircle size={16} color={DS.color.text2} />}>
              {detail.messages!.map(msg => (
                <View key={msg.id} style={{ marginBottom: DS.space.xs, paddingBottom: DS.space.xs, borderBottomWidth: 1, borderBottomColor: DS.color.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    {msg.isSystem
                      ? <ShieldCheck size={11} color={DS.color.gold} />
                      : <User size={11} color={DS.color.text3} />
                    }
                    <Text style={{ color: msg.isSystem ? DS.color.gold : DS.color.text3, fontSize: DS.font.xxs, fontWeight: DS.font.semibold }}>
                      {msg.isSystem ? 'System' : shortId(msg.senderId)}
                    </Text>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginLeft: 'auto' }}>
                      {fmt(msg.createdAt)}
                    </Text>
                  </View>
                  {!!msg.message && (
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, lineHeight: 17 }}>{msg.message}</Text>
                  )}
                </View>
              ))}
            </Section>
          )}

          {/* ── Admin Decision ── */}
          <Section title="Admin Adjudication" icon={<Scale size={16} color={isResolved ? DS.color.text3 : DS.color.gold} />}>
            {isResolved ? (
              <View style={{ alignItems: 'center', paddingVertical: DS.space.md }}>
                <CheckCircle size={32} color={detail.status === 'resolved' ? DS.color.buy : DS.color.text3} />
                <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, marginTop: DS.space.xs, fontSize: DS.font.sm }}>
                  {detail.status === 'resolved' ? 'Dispute Resolved' : 'Dispute Rejected'}
                </Text>
                {detail.resolvedAt && (
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, marginTop: 4 }}>
                    {fmt(detail.resolvedAt)}
                  </Text>
                )}
                {detail.adminNote && (
                  <View style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, padding: DS.space.sm, marginTop: DS.space.sm, width: '100%' }}>
                    <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 4 }}>ADMIN NOTE</Text>
                    <Text style={{ color: DS.color.text2, fontSize: DS.font.xs }}>{detail.adminNote}</Text>
                  </View>
                )}
                {detail.resolvedInFavorOf && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: DS.space.sm }}>
                    <ShieldCheck size={14} color={DS.color.buy} />
                    <Text style={{ color: DS.color.buy, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>
                      Resolved in favour of: {shortId(detail.resolvedInFavorOf)}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <>
                {/* Escrow warning if already released */}
                {detail.trade?.escrowReleased && (
                  <View style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, padding: DS.space.sm, marginBottom: DS.space.sm, flexDirection: 'row', gap: 8 }}>
                    <AlertTriangle size={14} color={DS.color.warn} />
                    <Text style={{ color: DS.color.warn, fontSize: DS.font.xs, flex: 1 }}>
                      Escrow already released — fund movement actions will fail. You can still reject the dispute.
                    </Text>
                  </View>
                )}

                {/* Admin note input */}
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, marginBottom: 6, letterSpacing: 0.5 }}>
                  ADMIN NOTE <Text style={{ color: DS.color.sell }}>*</Text>
                </Text>
                <TextInput
                  value={adminNote}
                  onChangeText={setAdminNote}
                  placeholder="Document your decision rationale (required)…"
                  placeholderTextColor={DS.color.text3}
                  multiline
                  numberOfLines={4}
                  style={{
                    backgroundColor: DS.color.surface, borderRadius: DS.radius.md,
                    borderWidth: 1, borderColor: DS.color.border,
                    padding: DS.space.sm, color: DS.color.text1,
                    fontSize: DS.font.xs, minHeight: 80, textAlignVertical: 'top',
                    marginBottom: DS.space.md,
                  }}
                />

                {/* Decision buttons */}
                <View style={{ gap: DS.space.xs }}>
                  {/* Release to buyer */}
                  <Pressable
                    onPress={() => handleDecision('release_to_buyer')}
                    disabled={submitting}
                    style={{ backgroundColor: DS.color.buyBg, borderRadius: DS.radius.md, paddingVertical: 14, paddingHorizontal: DS.space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: DS.color.buy + '40', opacity: submitting ? 0.6 : 1 }}>
                    {submitting ? <ActivityIndicator size="small" color={DS.color.buy} /> : (
                      <>
                        <CheckCircle size={16} color={DS.color.buy} />
                        <Text style={{ color: DS.color.buy, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Release Funds to Buyer</Text>
                      </>
                    )}
                  </Pressable>

                  {/* Refund to seller */}
                  <Pressable
                    onPress={() => handleDecision('refund_to_seller')}
                    disabled={submitting}
                    style={{ backgroundColor: DS.color.warnBg, borderRadius: DS.radius.md, paddingVertical: 14, paddingHorizontal: DS.space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: DS.color.warn + '40', opacity: submitting ? 0.6 : 1 }}>
                    {submitting ? <ActivityIndicator size="small" color={DS.color.warn} /> : (
                      <>
                        <XCircle size={16} color={DS.color.warn} />
                        <Text style={{ color: DS.color.warn, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Refund Escrow to Seller</Text>
                      </>
                    )}
                  </Pressable>

                  {/* Reject dispute */}
                  <Pressable
                    onPress={() => handleDecision('reject_dispute')}
                    disabled={submitting}
                    style={{ backgroundColor: DS.color.surface, borderRadius: DS.radius.md, paddingVertical: 14, paddingHorizontal: DS.space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: DS.color.border, opacity: submitting ? 0.6 : 1 }}>
                    <Scale size={16} color={DS.color.text2} />
                    <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold, fontSize: DS.font.sm }}>Reject Dispute (No Action)</Text>
                  </Pressable>
                </View>

                {/* Decision explainers */}
                <View style={{ marginTop: DS.space.sm, gap: 5 }}>
                  {[
                    { icon: '🟢', text: 'Release to Buyer: seller paid, buyer confirmed — release funds from escrow to buyer.' },
                    { icon: '🟡', text: 'Refund to Seller: buyer failed to pay or fraudulent claim — return escrow to seller.' },
                    { icon: '⚪', text: 'Reject Dispute: insufficient evidence — dispute closed, no funds moved.' },
                  ].map(({ icon, text }) => (
                    <View key={icon} style={{ flexDirection: 'row', gap: 8 }}>
                      <Text style={{ fontSize: 11 }}>{icon}</Text>
                      <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs, flex: 1, lineHeight: 16 }}>{text}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </Section>

          {/* Timeline */}
          <Section title="Timeline" icon={<Clock size={16} color={DS.color.text2} />}>
            <InfoRow label="Dispute Opened" value={fmt(detail.createdAt)} />
            {detail.trade?.createdAt  && <InfoRow label="Trade Created"  value={fmt(detail.trade.createdAt)} />}
            {detail.trade?.paidAt     && <InfoRow label="Payment Marked" value={fmt(detail.trade.paidAt)} />}
            {detail.resolvedAt        && <InfoRow label="Resolved At"    value={fmt(detail.resolvedAt)} />}
          </Section>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
