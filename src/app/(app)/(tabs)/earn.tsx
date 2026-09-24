import { useState, useCallback, useRef } from 'react';
import { invokeEdgeFunction, toUserMessage } from '@/lib/errors';
import {
  View, Text, Pressable, ScrollView, Modal, TextInput,
  ActivityIndicator, FlatList,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { TrendingUp, Lock, Zap, ChevronRight, X, AlertCircle, CheckCircle2 } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { supabase } from '@/client/supabase';

const C = DS.color;

// ── Types ─────────────────────────────────────────────────────────────────────
interface EarnProduct {
  id: string;
  name: string;
  asset: string;
  earn_type: 'flexible' | 'fixed' | 'staking';
  apy: number;
  min_amount: number;
  duration_days: number | null;
  is_active: boolean;
}

interface EarnSub {
  id: string;
  product_id: string;
  asset: string;
  amount: number;
  earned_total: number;
  status: 'active' | 'redeemed' | 'matured';
  start_date: string;
  end_date: string | null;
  maturity_at: string | null;
  product?: EarnProduct;
  pendingYield?: number;
}

type EarnType = 'flexible' | 'fixed' | 'staking';

const SECTION_TABS: { label: string; type: EarnType }[] = [
  { label: 'Flexible', type: 'flexible' },
  { label: 'Fixed',    type: 'fixed' },
  { label: 'Staking',  type: 'staking' },
];
const ASSET_ICONS: Record<string, string> = { USDT: '💵', BTC: '₿', ETH: 'Ξ', EXX: '✦', SOL: '◎', BNB: '⬡', ETH2: 'Ξ' };

function fmtNum(n: number, dp = 6) { return n.toFixed(dp).replace(/\.?0+$/, '') || '0'; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }); }

// ── Subscribe Modal ───────────────────────────────────────────────────────────
function SubscribeModal({
  product, visible, onClose, onSuccess,
}: {
  product: EarnProduct | null;
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState(false);

  const reset = () => { setAmount(''); setError(''); setDone(false); setLoading(false); };

  const handleClose = () => { reset(); onClose(); };

  const handleSubscribe = async () => {
    if (!product) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount'); return; }
    if (amt < product.min_amount) { setError(`Minimum is ${product.min_amount} ${product.asset}`); return; }

    setLoading(true); setError('');
    try {
      const idem = `earn_sub_${product.id}_${Date.now()}`;
      await invokeEdgeFunction('earn-subscribe', {
        product_id: product.id, amount: amt, idempotency_key: idem,
      });
      setDone(true);
      setTimeout(() => { reset(); onSuccess(); }, 1400);
    } catch (e) {
      setError(toUserMessage(e, 'Subscription failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  if (!product) return null;
  const daily = ((parseFloat(amount || '0') * product.apy) / 100 / 365);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 17 }}>Subscribe — {product.name}</Text>
            <Pressable onPress={handleClose}><X size={20} color={C.text2} /></Pressable>
          </View>

          {done ? (
            <View style={{ alignItems: 'center', paddingVertical: 28 }}>
              <CheckCircle2 size={48} color={C.buy} />
              <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 16, marginTop: 14 }}>Subscribed!</Text>
              <Text style={{ color: C.text2, fontSize: 13, marginTop: 6 }}>{fmtNum(parseFloat(amount), 6)} {product.asset} is now earning</Text>
            </View>
          ) : (
            <>
              {/* Stats */}
              <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, padding: 12, marginBottom: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>APY</Text>
                  <Text style={{ color: C.gold, fontWeight: DS.font.bold, fontSize: 14 }}>{product.apy}%</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Min Amount</Text>
                  <Text style={{ color: C.text1, fontSize: 12 }}>{product.min_amount} {product.asset}</Text>
                </View>
                {product.duration_days && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: C.text2, fontSize: 12 }}>Lock Period</Text>
                    <Text style={{ color: C.text1, fontSize: 12 }}>{product.duration_days} Days</Text>
                  </View>
                )}
              </View>

              {/* Amount input */}
              <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 6, borderWidth: 1, borderColor: error ? C.sell : C.border }}>
                <TextInput
                  style={{ flex: 1, color: C.text1, fontSize: 16, paddingVertical: 13 }}
                  placeholder={`Amount (${product.asset})`}
                  placeholderTextColor={C.text3}
                  value={amount}
                  onChangeText={v => { setAmount(v); setError(''); }}
                  keyboardType="decimal-pad"
                />
                <Text style={{ color: C.text2, fontSize: 13 }}>{product.asset}</Text>
              </View>
              {error !== '' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <AlertCircle size={13} color={C.sell} />
                  <Text style={{ color: C.sell, fontSize: 12 }}>{error}</Text>
                </View>
              )}

              {/* Daily estimate */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 }}>
                <Text style={{ color: C.text2, fontSize: 12 }}>Est. Daily Earnings</Text>
                <Text style={{ color: C.buy, fontWeight: DS.font.semibold, fontSize: 13 }}>
                  +{fmtNum(daily, 8)} {product.asset}
                </Text>
              </View>

              <Pressable
                onPress={handleSubscribe}
                disabled={loading}
                style={{ backgroundColor: C.gold, borderRadius: DS.radius.md, paddingVertical: 14, alignItems: 'center' }}
              >
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={{ color: '#000', fontWeight: DS.font.extrabold, fontSize: 15 }}>Confirm Subscription</Text>
                }
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Redeem confirmation modal ─────────────────────────────────────────────────
function RedeemModal({
  sub, visible, onClose, onSuccess,
}: {
  sub: EarnSub | null;
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);
  const [payout, setPayout]   = useState(0);

  const reset = () => { setLoading(false); setError(''); setDone(false); setPayout(0); };
  const handleClose = () => { reset(); onClose(); };

  const handleRedeem = async () => {
    if (!sub) return;
    setLoading(true); setError('');
    try {
      const data = await invokeEdgeFunction<{ payout: number }>('earn-redeem', {
        subscription_id: sub.id,
      });
      setPayout(data.payout ?? 0);
      setDone(true);
      setTimeout(() => { reset(); onSuccess(); }, 1600);
    } catch (e) {
      setError(toUserMessage(e, 'Redemption failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  if (!sub) return null;
  const isLocked = sub.maturity_at ? new Date(sub.maturity_at) > new Date() : false;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 17 }}>Redeem</Text>
            <Pressable onPress={handleClose}><X size={20} color={C.text2} /></Pressable>
          </View>

          {done ? (
            <View style={{ alignItems: 'center', paddingVertical: 28 }}>
              <CheckCircle2 size={48} color={C.buy} />
              <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 16, marginTop: 14 }}>Redeemed!</Text>
              <Text style={{ color: C.text2, fontSize: 13, marginTop: 6 }}>{fmtNum(payout, 6)} {sub.asset} returned to wallet</Text>
            </View>
          ) : (
            <>
              <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, padding: 14, marginBottom: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Principal</Text>
                  <Text style={{ color: C.text1, fontSize: 13, fontWeight: DS.font.semibold }}>{fmtNum(sub.amount, 6)} {sub.asset}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text2, fontSize: 12 }}>Accrued Yield</Text>
                  <Text style={{ color: C.buy, fontSize: 13, fontWeight: DS.font.semibold }}>+{fmtNum(sub.pendingYield ?? 0, 8)} {sub.asset}</Text>
                </View>
                {sub.maturity_at && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: C.text2, fontSize: 12 }}>Maturity</Text>
                    <Text style={{ color: isLocked ? C.sell : C.buy, fontSize: 12 }}>{fmtDate(sub.maturity_at)}</Text>
                  </View>
                )}
              </View>

              {isLocked && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${C.sell}18`, borderRadius: DS.radius.md, padding: 10, marginBottom: 14 }}>
                  <Lock size={14} color={C.sell} />
                  <Text style={{ color: C.sell, fontSize: 12, flex: 1 }}>
                    Fixed term not yet matured. Early redemption is not available.
                  </Text>
                </View>
              )}

              {error !== '' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <AlertCircle size={13} color={C.sell} />
                  <Text style={{ color: C.sell, fontSize: 12, flex: 1 }}>{error}</Text>
                </View>
              )}

              <Pressable
                onPress={handleRedeem}
                disabled={loading || isLocked}
                style={{ backgroundColor: isLocked ? C.surface : C.gold, borderRadius: DS.radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: isLocked ? 1 : 0, borderColor: C.border }}
              >
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={{ color: isLocked ? C.text3 : '#000', fontWeight: DS.font.extrabold, fontSize: 15 }}>
                      {isLocked ? 'Locked' : 'Confirm Redemption'}
                    </Text>
                }
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function EarnTab() {
  const [activeSection, setActiveSection] = useState<EarnType>('flexible');
  const [products,   setProducts]   = useState<EarnProduct[]>([]);
  const [subs,       setSubs]       = useState<EarnSub[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [subModal,   setSubModal]   = useState<EarnProduct | null>(null);
  const [redeemSub,  setRedeemSub]  = useState<EarnSub | null>(null);
  const [view,       setView]       = useState<'products' | 'my'>('products');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, subsRes] = await Promise.allSettled([
        supabase.from('earn_products').select('*').eq('is_active', true).order('earn_type').order('apy'),
        supabase.from('earn_subscriptions').select('*').in('status', ['active', 'matured']).order('start_date', { ascending: false }),
      ]);

      const prods: EarnProduct[] = prodRes.status === 'fulfilled' ? (prodRes.value.data ?? []) as EarnProduct[] : [];
      setProducts(prods);

      if (subsRes.status === 'fulfilled' && subsRes.value.data) {
        const rawSubs = subsRes.value.data as EarnSub[];
        // Attach product info + fetch pending yield
        const enriched = await Promise.all(rawSubs.map(async s => {
          const prod = prods.find(p => p.id === s.product_id);
          const { data: yieldRows } = await supabase
            .from('earn_yield_entries')
            .select('yield_amount')
            .eq('subscription_id', s.id)
            .eq('settled', false);
          const pendingYield = (yieldRows ?? []).reduce((acc: number, r: { yield_amount: number }) => acc + Number(r.yield_amount), 0);
          return { ...s, product: prod, pendingYield };
        }));
        setSubs(enriched);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { (async () => { await load(); })(); }, [load]));

  const filtered = products.filter(p => p.earn_type === activeSection);
  const activeSubs = subs.filter(s => s.status === 'active');
  const totalEarned = subs.reduce((a, s) => a + Number(s.earned_total ?? 0), 0);
  const totalPending = subs.reduce((a, s) => a + (s.pendingYield ?? 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Top nav: Products / My Earn */}
      <View style={{ paddingTop: 52, paddingHorizontal: 16, paddingBottom: 0 }}>
        <Text style={{ color: C.text1, fontWeight: DS.font.extrabold, fontSize: 22, marginBottom: 14 }}>Earn</Text>
        <View style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: DS.radius.md, padding: 4, marginBottom: 16 }}>
          {(['products', 'my'] as const).map(v => (
            <Pressable key={v} onPress={() => setView(v)}
              style={{ flex: 1, paddingVertical: 9, borderRadius: DS.radius.sm, backgroundColor: view === v ? C.gold : 'transparent', alignItems: 'center' }}>
              <Text style={{ color: view === v ? '#000' : C.text2, fontWeight: DS.font.semibold, fontSize: 13 }}>
                {v === 'products' ? 'Products' : `My Earn${activeSubs.length > 0 ? ` (${activeSubs.length})` : ''}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.gold} size="large" />
        </View>
      ) : view === 'my' ? (
        /* ── My Earn tab ── */
        <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic">
          {/* Summary card */}
          <View style={{ marginHorizontal: 16, marginBottom: 14 }}>
            <View style={{ backgroundColor: C.card, borderRadius: DS.radius.xl, padding: 18, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.text2, fontSize: 12, marginBottom: 4 }}>Total Earned (All Time)</Text>
              <Text style={{ color: C.gold, fontSize: 28, fontWeight: DS.font.extrabold, marginBottom: 10 }}>
                ≈ ${fmtNum(totalEarned + totalPending, 2)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 24 }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 11 }}>Pending Yield</Text>
                  <Text style={{ color: C.buy, fontSize: 14, fontWeight: DS.font.semibold }}>+{fmtNum(totalPending, 6)}</Text>
                </View>
                <View>
                  <Text style={{ color: C.text3, fontSize: 11 }}>Active Plans</Text>
                  <Text style={{ color: C.text1, fontSize: 14, fontWeight: DS.font.semibold }}>{activeSubs.length}</Text>
                </View>
              </View>
            </View>
          </View>

          {subs.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ color: C.text3, fontSize: 14 }}>No active subscriptions.</Text>
              <Pressable onPress={() => setView('products')} style={{ marginTop: 12 }}>
                <Text style={{ color: C.gold, fontWeight: DS.font.semibold, fontSize: 14 }}>Browse Products →</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 40 }}>
              {subs.map(s => (
                <View key={s.id} style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 16, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${C.gold}22`, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 16 }}>{ASSET_ICONS[s.asset] ?? '●'}</Text>
                      </View>
                      <View>
                        <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 14 }}>{s.product?.name ?? s.asset}</Text>
                        <Text style={{ color: C.text3, fontSize: 11 }}>Since {fmtDate(s.start_date)}</Text>
                      </View>
                    </View>
                    <View style={{ backgroundColor: s.status === 'active' ? `${C.buy}22` : `${C.gold}22`, borderRadius: DS.radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: s.status === 'active' ? C.buy : C.gold, fontSize: 10, fontWeight: DS.font.bold, textTransform: 'uppercase' }}>{s.status}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                    <View>
                      <Text style={{ color: C.text3, fontSize: 10 }}>Principal</Text>
                      <Text style={{ color: C.text1, fontSize: 13, fontWeight: DS.font.semibold }}>{fmtNum(s.amount, 6)} {s.asset}</Text>
                    </View>
                    <View>
                      <Text style={{ color: C.text3, fontSize: 10 }}>APY</Text>
                      <Text style={{ color: C.gold, fontSize: 13, fontWeight: DS.font.bold }}>{s.product?.apy ?? '—'}%</Text>
                    </View>
                    <View>
                      <Text style={{ color: C.text3, fontSize: 10 }}>Pending Yield</Text>
                      <Text style={{ color: C.buy, fontSize: 13, fontWeight: DS.font.semibold }}>+{fmtNum(s.pendingYield ?? 0, 8)} {s.asset}</Text>
                    </View>
                  </View>

                  {s.maturity_at && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <Lock size={12} color={C.text3} />
                      <Text style={{ color: C.text3, fontSize: 11 }}>Matures {fmtDate(s.maturity_at)}</Text>
                    </View>
                  )}

                  {s.status === 'active' && (
                    <Pressable onPress={() => setRedeemSub(s)}
                      style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
                      <Text style={{ color: C.text1, fontWeight: DS.font.semibold, fontSize: 13 }}>Redeem</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        /* ── Products tab ── */
        <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic">
          {/* Section tabs */}
          <View style={{ paddingHorizontal: 16, marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: DS.radius.md, padding: 4 }}>
              {SECTION_TABS.map(st => (
                <Pressable key={st.type} onPress={() => setActiveSection(st.type)}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: DS.radius.sm, backgroundColor: activeSection === st.type ? C.gold : 'transparent', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {st.type === 'flexible' && <Zap        size={12} color={activeSection === st.type ? '#000' : C.text2} />}
                    {st.type === 'fixed'    && <Lock       size={12} color={activeSection === st.type ? '#000' : C.text2} />}
                    {st.type === 'staking'  && <TrendingUp size={12} color={activeSection === st.type ? '#000' : C.text2} />}
                    <Text style={{ color: activeSection === st.type ? '#000' : C.text2, fontWeight: DS.font.semibold, fontSize: 13 }}>{st.label}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 40 }}>
            {filtered.length === 0 && (
              <Text style={{ color: C.text3, textAlign: 'center', paddingTop: 40 }}>No products available</Text>
            )}
            {filtered.map(product => {
              const mySub = subs.find(s => s.product_id === product.id && s.status === 'active');
              return (
                <View key={product.id} style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 16, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 40, height: 40, borderRadius: DS.radius.full, backgroundColor: `${C.gold}22`, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 18 }}>{ASSET_ICONS[product.asset] ?? '●'}</Text>
                      </View>
                      <View>
                        <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 15 }}>{product.name}</Text>
                        <Text style={{ color: C.text2, fontSize: 11 }}>Min {product.min_amount} {product.asset}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: C.gold, fontSize: 20, fontWeight: DS.font.extrabold }}>{product.apy}%</Text>
                      <Text style={{ color: C.text2, fontSize: 10 }}>APY</Text>
                    </View>
                  </View>

                  {product.duration_days && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <Lock size={13} color={C.text2} />
                      <Text style={{ color: C.text2, fontSize: 12 }}>Lock Period: {product.duration_days} Days</Text>
                    </View>
                  )}

                  {mySub && (
                    <View style={{ backgroundColor: `${C.buy}12`, borderRadius: DS.radius.sm, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 }}>
                      <Text style={{ color: C.buy, fontSize: 12 }}>Active: {fmtNum(mySub.amount, 6)} {product.asset} · +{fmtNum(mySub.pendingYield ?? 0, 8)} pending</Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => setSubModal(product)}
                      style={{ flex: 1, backgroundColor: C.gold, borderRadius: DS.radius.md, paddingVertical: 11, alignItems: 'center' }}>
                      <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: 13 }}>Subscribe</Text>
                    </Pressable>
                    {mySub && (
                      <Pressable onPress={() => setRedeemSub(mySub)}
                        style={{ flex: 1, backgroundColor: C.surface, borderRadius: DS.radius.md, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
                        <Text style={{ color: C.text1, fontSize: 13 }}>Redeem</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      <SubscribeModal
        product={subModal}
        visible={!!subModal}
        onClose={() => setSubModal(null)}
        onSuccess={() => { setSubModal(null); load(); }}
      />
      <RedeemModal
        sub={redeemSub}
        visible={!!redeemSub}
        onClose={() => setRedeemSub(null)}
        onSuccess={() => { setRedeemSub(null); load(); }}
      />
    </View>
  );
}
