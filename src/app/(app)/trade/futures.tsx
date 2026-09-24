// Futures Trading Terminal — USDT-margined perpetuals
// Live mark prices, real positions, wallet-integrated margin management
// All order placement routes through futures-order-place Edge Function
import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as TradingWallet from '@/services/trading-wallet.service';
import {
  View, Text, Pressable, ScrollView, TextInput, FlatList,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Modal,
} from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';
import {
  ChevronDown, AlertTriangle, TrendingUp, TrendingDown, RefreshCw,
  X, Plus, Minus, ChevronRight,
} from 'lucide-react-native';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import { TradingService, RiskEngine } from '@/services';
import type {
  TradingPair, PositionRecord, MarginModeV2, OrderRecord, FundingHistoryRecord,
} from '@/services/trading.service';
import type { ProviderCandle } from '@/services/trading.provider';

const C = DS.color;

// ── Candle Chart ──────────────────────────────────────────────────────────────
function CandleChart({ candles }: { candles: ProviderCandle[] }) {
  if (!candles.length) return <View style={{ width: '100%', height: 140, backgroundColor: C.surface, borderRadius: DS.radius.md }} />;
  const W = 340, H = 140, pad = 6;
  const prices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...prices), maxP = Math.max(...prices), range = maxP - minP || 1;
  const cw   = (W - pad * 2) / candles.length;
  const toY  = (p: number) => pad + ((maxP - p) / range) * (H - pad * 2);
  return (
    <Svg width={W} height={H}>
      {candles.map((c, i) => {
        const x   = pad + i * cw + cw / 2;
        const col = c.close >= c.open ? C.buy : C.sell;
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyBot = toY(Math.min(c.open, c.close));
        return (
          <React.Fragment key={i}>
            <Line x1={x} y1={toY(c.high)} x2={x} y2={toY(c.low)} stroke={col} strokeWidth={0.8} />
            <Rect x={x - cw * 0.35} y={bodyTop} width={cw * 0.7} height={Math.max(bodyBot - bodyTop, 1)} fill={col} />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// ── Margin ratio bar ──────────────────────────────────────────────────────────
function MarginRatioBar({ ratio }: { ratio: number }) {
  const pct = Math.min(ratio * 100, 100);
  const col = pct > 90 ? C.sell : pct > 75 ? C.warn : C.buy;
  return (
    <View style={{ height: 4, backgroundColor: C.surface, borderRadius: 2, overflow: 'hidden' }}>
      <View style={{ height: 4, width: `${pct}%` as `${number}%`, backgroundColor: col, borderRadius: 2 }} />
    </View>
  );
}

// ── Position card with margin management + partial close ──────────────────────
interface PositionCardProps {
  pos: PositionRecord;
  markPrice: number;
  onClose:       (pos: PositionRecord, pct: number) => void;
  onAddMargin:   (pos: PositionRecord) => void;
  onReduceMargin:(pos: PositionRecord) => void;
  closing: boolean;
}
function PositionCard({ pos, markPrice, onClose, onAddMargin, onReduceMargin, closing }: PositionCardProps) {
  const [closePct, setClosePct] = useState(100);
  const [showExtra, setShowExtra] = useState(false);
  const risk = RiskEngine.assessRisk({
    side: pos.side, size: pos.size, entryPrice: pos.entryPrice, markPrice,
    initialMargin: pos.initialMargin, leverage: pos.leverage,
    maintMarginRate: 0.005, cumFundingFee: pos.cumFundingFee,
  });
  const pnlColor = risk.unrealizedPnl >= 0 ? C.buy : C.sell;
  const pnlSign  = risk.unrealizedPnl >= 0 ? '+' : '';
  const pnlPct   = pos.initialMargin > 0 ? (risk.unrealizedPnl / pos.initialMargin * 100) : 0;
  const closeQty = (pos.size * closePct / 100);

  return (
    <View style={{ backgroundColor: C.card, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10, opacity: closing ? 0.5 : 1 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {pos.side === 'long'
            ? <TrendingUp size={14} color={C.buy} />
            : <TrendingDown size={14} color={C.sell} />}
          <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 14 }}>{pos.symbol.replace('_PERP','')}</Text>
          <View style={{ backgroundColor: pos.side === 'long' ? C.buyBg : C.sellBg, borderRadius: DS.radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: pos.side === 'long' ? C.buy : C.sell, fontSize: 10, fontWeight: DS.font.bold }}>
              {pos.side.toUpperCase()} {pos.leverage}×
            </Text>
          </View>
          <Text style={{ color: C.text3, fontSize: 10 }}>{pos.marginMode}</Text>
        </View>
        <Pressable onPress={() => setShowExtra(v => !v)}>
          <ChevronRight size={14} color={C.text3} style={{ transform: [{ rotate: showExtra ? '90deg' : '0deg' }] }} />
        </Pressable>
      </View>

      {/* PnL */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <View>
          <Text style={{ color: C.text3, fontSize: 10, marginBottom: 2 }}>Unrealized PnL</Text>
          <Text style={{ color: pnlColor, fontWeight: DS.font.bold, fontSize: 16 }}>
            {pnlSign}{risk.unrealizedPnl.toFixed(2)} USDT
          </Text>
          <Text style={{ color: pnlColor, fontSize: 11 }}>{pnlSign}{pnlPct.toFixed(2)}%</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: C.text3, fontSize: 10, marginBottom: 2 }}>Size</Text>
          <Text style={{ color: C.text1, fontSize: 14, fontWeight: DS.font.semibold }}>{pos.size}</Text>
          <Text style={{ color: C.text3, fontSize: 11 }}>{pos.notional.toFixed(2)} USDT</Text>
        </View>
      </View>

      {/* Price details */}
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
        <View>
          <Text style={{ color: C.text3, fontSize: 10 }}>Entry</Text>
          <Text style={{ color: C.text2, fontSize: 12 }}>{pos.entryPrice.toFixed(2)}</Text>
        </View>
        <View>
          <Text style={{ color: C.text3, fontSize: 10 }}>Mark</Text>
          <Text style={{ color: C.text2, fontSize: 12 }}>{markPrice.toFixed(2)}</Text>
        </View>
        <View>
          <Text style={{ color: C.text3, fontSize: 10 }}>Liq.</Text>
          <Text style={{ color: C.sell, fontSize: 12, fontWeight: DS.font.semibold }}>{(risk.liqPrice ?? 0).toFixed(2)}</Text>
        </View>
        <View>
          <Text style={{ color: C.text3, fontSize: 10 }}>Margin</Text>
          <Text style={{ color: C.text2, fontSize: 12 }}>{pos.initialMargin.toFixed(2)}</Text>
        </View>
      </View>

      {/* Margin ratio */}
      <View style={{ marginBottom: 10 }}>
        <MarginRatioBar ratio={risk.marginRatio} />
        <Text style={{ color: C.text3, fontSize: 9, marginTop: 2 }}>Margin ratio: {(risk.marginRatio * 100).toFixed(1)}%</Text>
      </View>

      {/* Risk warning */}
      {risk.isNearLiquidation && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, padding: 8, backgroundColor: C.sellBg, borderRadius: DS.radius.md }}>
          <AlertTriangle size={12} color={C.sell} />
          <Text style={{ color: C.sell, fontSize: 11, flex: 1 }}>Near liquidation — add margin or reduce position</Text>
        </View>
      )}

      {/* Partial close controls (expanded) */}
      {showExtra && (
        <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: C.border }}>
          <Text style={{ color: C.text2, fontSize: 12, fontWeight: DS.font.semibold, marginBottom: 8 }}>Close Position</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
            {[25,50,75,100].map(p => (
              <Pressable key={p} onPress={() => setClosePct(p)}
                style={{ flex: 1, paddingVertical: 6, borderRadius: DS.radius.sm, alignItems: 'center',
                         backgroundColor: closePct === p ? C.sellBg : C.card,
                         borderWidth: 1, borderColor: closePct === p ? C.sell : C.border }}>
                <Text style={{ color: closePct === p ? C.sell : C.text2, fontSize: 11 }}>{p}%</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: C.text3, fontSize: 11, marginBottom: 8 }}>
            Close {closeQty.toFixed(4)} of {pos.size} contracts
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              disabled={closing}
              onPress={() => onClose(pos, closePct)}
              style={{ flex: 1, backgroundColor: C.sell, borderRadius: DS.radius.md, paddingVertical: 10, alignItems: 'center', opacity: closing ? 0.6 : 1 }}>
              {closing
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={{ color: '#fff', fontWeight: DS.font.bold, fontSize: 13 }}>Close {closePct}%</Text>}
            </Pressable>
          </View>

          {/* Margin management (isolated only) */}
          {pos.marginMode === 'isolated' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable onPress={() => onAddMargin(pos)}
                style={{ flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center', alignItems: 'center',
                         backgroundColor: C.buyBg, borderRadius: DS.radius.md, paddingVertical: 8,
                         borderWidth: 1, borderColor: C.buy }}>
                <Plus size={12} color={C.buy} />
                <Text style={{ color: C.buy, fontSize: 12, fontWeight: DS.font.semibold }}>Add Margin</Text>
              </Pressable>
              <Pressable onPress={() => onReduceMargin(pos)}
                style={{ flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center', alignItems: 'center',
                         backgroundColor: C.warnBg, borderRadius: DS.radius.md, paddingVertical: 8,
                         borderWidth: 1, borderColor: C.warn }}>
                <Minus size={12} color={C.warn} />
                <Text style={{ color: C.warn, fontSize: 12, fontWeight: DS.font.semibold }}>Reduce</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* Quick close (collapsed) */}
      {!showExtra && (
        <Pressable onPress={() => onClose(pos, 100)} disabled={closing}
          style={{ paddingVertical: 9, backgroundColor: C.sellBg, borderRadius: DS.radius.md,
                   borderWidth: 1, borderColor: C.sell, alignItems: 'center', opacity: closing ? 0.6 : 1 }}>
          {closing
            ? <ActivityIndicator size="small" color={C.sell} />
            : <Text style={{ color: C.sell, fontSize: 12, fontWeight: DS.font.semibold }}>Close Position</Text>}
        </Pressable>
      )}
    </View>
  );
}

// ── Open order row ────────────────────────────────────────────────────────────
function OpenOrderRow({ order, onCancel, cancelling }: {
  order: OrderRecord;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const isBuy   = order.side === 'buy';
  const statusC = order.status === 'partially_filled' ? C.warn : C.text3;
  return (
    <View style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ color: isBuy ? C.buy : C.sell, fontWeight: DS.font.bold, fontSize: 12 }}>
              {isBuy ? 'LONG' : 'SHORT'}
            </Text>
            <Text style={{ color: C.text1, fontWeight: DS.font.semibold, fontSize: 12 }}>
              {order.symbol.replace('_PERP','')}
            </Text>
            <Text style={{ color: C.gold, fontSize: 10 }}>{order.leverage}×</Text>
            <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.xs, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ color: statusC, fontSize: 9 }}>{order.status.replace('_',' ').toUpperCase()}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Text style={{ color: C.text3, fontSize: 11 }}>
              Qty: <Text style={{ color: C.text2 }}>{order.quantity}</Text>
              {order.filledQty > 0 && <Text style={{ color: C.warn }}> ({order.filledQty} filled)</Text>}
            </Text>
            <Text style={{ color: C.text3, fontSize: 11 }}>
              {order.orderType === 'market' ? 'Market' : `@ ${order.price?.toFixed(2)}`}
            </Text>
            <Text style={{ color: C.text3, fontSize: 10 }}>
              {new Date(order.createdAt).toLocaleTimeString()}
            </Text>
          </View>
        </View>
        <Pressable onPress={() => onCancel(order.id)} disabled={cancelling}
          style={{ backgroundColor: C.sellBg, borderRadius: DS.radius.sm, padding: 8,
                   borderWidth: 1, borderColor: C.sell, opacity: cancelling ? 0.5 : 1 }}>
          {cancelling ? <ActivityIndicator size="small" color={C.sell} /> : <X size={12} color={C.sell} />}
        </Pressable>
      </View>
    </View>
  );
}

// ── Margin management modal ───────────────────────────────────────────────────
function MarginModal({ pos, mode, futuresBalance, onConfirm, onClose, loading }: {
  pos: PositionRecord;
  mode: 'add' | 'reduce';
  futuresBalance: number;
  onConfirm: (amount: number) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [amt, setAmt] = useState('');
  const [err, setErr] = useState('');
  const maxAdd    = futuresBalance;
  const maxReduce = Math.max(0, pos.initialMargin - pos.maintMargin * 1.5);

  const handleConfirm = () => {
    const n = parseFloat(amt);
    if (!n || n <= 0) { setErr('Enter a valid amount'); return; }
    if (mode === 'add'    && n > maxAdd)    { setErr(`Max: ${maxAdd.toFixed(2)} USDT`); return; }
    if (mode === 'reduce' && n > maxReduce) { setErr(`Max safe reduction: ${maxReduce.toFixed(2)} USDT`); return; }
    setErr('');
    onConfirm(n);
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ backgroundColor: C.card, borderTopLeftRadius: DS.radius.xl, borderTopRightRadius: DS.radius.xl, padding: 20 }}
          onPress={e => e.stopPropagation()}>
          <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 16, marginBottom: 6 }}>
            {mode === 'add' ? 'Add Margin' : 'Reduce Margin'}
          </Text>
          <Text style={{ color: C.text3, fontSize: 12, marginBottom: 16 }}>
            {mode === 'add'
              ? `Available: ${maxAdd.toFixed(2)} USDT`
              : `Max safe reduction: ${maxReduce.toFixed(2)} USDT`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TextInput
              value={amt}
              onChangeText={v => { setAmt(v); setErr(''); }}
              placeholder="Amount (USDT)"
              placeholderTextColor={C.text3}
              keyboardType="decimal-pad"
              style={{ flex: 1, backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1,
                       borderColor: C.border, color: C.text1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }}
            />
            <Pressable onPress={() => setAmt(mode === 'add' ? maxAdd.toFixed(2) : maxReduce.toFixed(2))}
              style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, justifyContent: 'center' }}>
              <Text style={{ color: C.text2, fontSize: 12 }}>Max</Text>
            </Pressable>
          </View>
          {err !== '' && <Text style={{ color: C.sell, fontSize: 12, marginBottom: 8 }}>{err}</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={onClose}
              style={{ flex: 1, backgroundColor: C.surface, borderRadius: DS.radius.md, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.text2 }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={handleConfirm} disabled={loading}
              style={{ flex: 2, backgroundColor: mode === 'add' ? C.buy : C.warn, borderRadius: DS.radius.md, paddingVertical: 13, alignItems: 'center', opacity: loading ? 0.6 : 1 }}>
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={{ color: '#000', fontWeight: DS.font.bold }}>{mode === 'add' ? 'Add Margin' : 'Reduce Margin'}</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TIME_FRAMES   = ['1m','5m','15m','1h','4h','1d'];
const LEVERAGE_PRESETS = [1,2,3,5,10,20,25,50,75,100,125];
type BottomTab = 'positions' | 'orders' | 'history' | 'funding';

// ── Main screen ───────────────────────────────────────────────────────────────
export default function FuturesScreen() {
  // Pair / chart
  const [pairs,      setPairs]     = useState<TradingPair[]>([]);
  const [pair,       setPair]      = useState<TradingPair | null>(null);
  const [showPairPicker, setShowPair] = useState(false);
  const [candles,    setCandles]   = useState<ProviderCandle[]>([]);
  const [timeframe,  setTimeframe] = useState('15m');

  // Order form
  const [side,       setSide]      = useState<'Long'|'Short'>('Long');
  const [orderType,  setOrderType] = useState<'market'|'limit'>('market');
  const [leverage,   setLeverage]  = useState(10);
  const [marginMode, setMarginMode]= useState<MarginModeV2>('cross');
  const [priceInput, setPriceInput]= useState('');
  const [qtyInput,   setQtyInput]  = useState('');
  const [tpInput,    setTpInput]   = useState('');
  const [slInput,    setSlInput]   = useState('');
  const [showLeverage, setShowLev] = useState(false);

  // Transfer
  const [showTransfer,  setShowTransfer]  = useState(false);
  const [transferDir,   setTransferDir]   = useState<'spot_to_futures'|'futures_to_spot'>('spot_to_futures');
  const [transferAmt,   setTransferAmt]   = useState('');
  const [transferring,  setTransferring]  = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferMsg,   setTransferMsg]   = useState('');

  // Balances
  const [futuresBalance, setFutBal]  = useState(0);
  const [spotBalance,    setSpotBal] = useState(0);

  // Market data
  const [markData,  setMarkData] = useState<{ markPrice: number; indexPrice: number } | null>(null);
  const [funding,   setFunding]  = useState<{ fundingRate: number; fundingTime: number } | null>(null);

  // Positions / orders
  const [positions,   setPositions]   = useState<PositionRecord[]>([]);
  const [openOrders,  setOpenOrders]  = useState<OrderRecord[]>([]);
  const [posHistory,  setPosHistory]  = useState<PositionRecord[]>([]);
  const [orderHistory,setOrderHistory]= useState<OrderRecord[]>([]);
  const [fundingHist, setFundingHist] = useState<FundingHistoryRecord[]>([]);
  const [bottomTab,   setBottomTab]   = useState<BottomTab>('positions');

  // UI states
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing,    setClosing]    = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  // Margin modal
  const [marginModal, setMarginModal] = useState<{ pos: PositionRecord; mode: 'add'|'reduce' } | null>(null);
  const [marginLoading, setMarginLoading] = useState(false);

  // WebSocket
  const wsRef    = useRef<WebSocket | null>(null);
  const wsSymRef = useRef<string>('');

  // Load futures pairs from DB
  const loadPairs = useCallback(async () => {
    const pairsRes = await TradingService.getFuturesPairs?.() ?? [];
    if (pairsRes.length) {
      setPairs(pairsRes);
      setPair(prev => prev ?? pairsRes[0]);
    } else {
      // Fallback: load from trading_pairs with is_futures_ok
      const { supabase } = await import('@/client/supabase');
      const { data } = await supabase.from('trading_pairs')
        .select('*')
        .eq('is_futures_ok', true)
        .eq('status_v2', 'active')
        .order('sort_order', { ascending: true });
      const mapped = (data ?? []).map((r: Record<string,unknown>) => ({
        symbol:         r.symbol as string,
        baseAsset:      r.base_asset as string,
        quoteAsset:     r.quote_asset as string,
        marketType:     'futures' as const,
        status:         r.status_v2 as string,
        minQty:         Number(r.min_qty ?? 0),
        maxQty:         Number(r.max_qty ?? 0),
        stepSize:       Number(r.step_size ?? 0.001),
        minNotional:    Number(r.min_notional ?? 5),
        tickSize:       Number(r.tick_size ?? 0.01),
        makerFee:       Number(r.maker_fee ?? 0.0002),
        takerFee:       Number(r.taker_fee ?? 0.0004),
        maxLeverage:    Number(r.max_leverage ?? 125),
        pricePrecision: Number(r.price_precision ?? 2),
        qtyPrecision:   Number(r.qty_precision ?? 3),
        isFuturesOk:    Boolean(r.is_futures_ok),
        providerSymbol: (r.provider_symbol ?? (r.symbol as string).replace('_PERP','')) as string,
        sortOrder:      Number(r.sort_order ?? 0),
      }));
      setPairs(mapped);
      setPair(prev => prev ?? mapped[0] ?? null);
    }
  }, []);

  // WebSocket for live mark price
  const connectWS = useCallback((p: TradingPair) => {
    if (wsSymRef.current === p.symbol && wsRef.current?.readyState === WebSocket.OPEN) return;
    wsRef.current?.close();
    const binSym = (p.providerSymbol || p.symbol.replace('_PERP','')).toLowerCase();
    const url    = `wss://fstream.binance.com/ws/${binSym}@markPrice`;
    const ws     = new WebSocket(url);
    wsRef.current   = ws;
    wsSymRef.current = p.symbol;
    ws.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data as string) as Record<string,unknown>;
        if (d.e === 'markPriceUpdate') {
          setMarkData({ markPrice: parseFloat(d.p as string), indexPrice: parseFloat(d.i as string ?? d.p as string) });
          setFunding({ fundingRate: parseFloat(d.r as string ?? '0'), fundingTime: Number(d.T ?? 0) });
        }
      } catch { /* ignore parse errors */ }
    };
    ws.onerror = () => { wsSymRef.current = ''; };
  }, []);

  const loadMarkData = useCallback(async () => {
    if (!pair) return;
    try {
      const [mp, fr] = await Promise.all([
        TradingService.getMarkPrice(pair.symbol),
        TradingService.getFundingRate(pair.symbol),
      ]);
      setMarkData(mp);
      setFunding({ fundingRate: fr.fundingRate, fundingTime: fr.fundingTime });
    } catch { /* best effort */ }
  }, [pair]);

  const loadData = useCallback(async () => {
    if (!pair) return;
    setLoading(true);
    try {
      await TradingService.ensureFuturesWallet();
      const [candleRes, posRes, ordersRes, histRes, orderHistRes, fundingHistRes, balRes, spotBalRes, ma] =
        await Promise.allSettled([
          TradingService.getCandles(pair.symbol, timeframe, 80, pair.providerSymbol),
          TradingService.getOpenPositions(),
          TradingService.getOpenFuturesOrders(),
          TradingService.getPositionHistory(20),
          TradingService.getFuturesOrderHistory(30),
          TradingService.getFundingHistory(30),
          TradingWallet.getTradingBalance('USDT', 'futures'),
          TradingWallet.getTradingBalance('USDT', 'spot'),
          TradingService.getMarginAccount(pair.symbol),
        ]);

      if (candleRes.status      === 'fulfilled') setCandles(candleRes.value);
      if (posRes.status         === 'fulfilled') setPositions(posRes.value);
      if (ordersRes.status      === 'fulfilled') setOpenOrders(ordersRes.value);
      if (histRes.status        === 'fulfilled') setPosHistory(histRes.value);
      if (orderHistRes.status   === 'fulfilled') setOrderHistory(orderHistRes.value);
      if (fundingHistRes.status === 'fulfilled') setFundingHist(fundingHistRes.value);
      if (balRes.status         === 'fulfilled') setFutBal(balRes.value.available);
      if (spotBalRes.status     === 'fulfilled') setSpotBal(spotBalRes.value.available);
      if (ma.status             === 'fulfilled') {
        setLeverage(ma.value.leverage);
        setMarginMode(ma.value.marginMode);
      }
    } finally { setLoading(false); setRefreshing(false); }
    await loadMarkData();
  }, [pair, timeframe, loadMarkData]);

  useFocusEffect(useCallback(() => {
    (async () => { await loadPairs(); })();
    return () => { wsRef.current?.close(); wsRef.current = null; wsSymRef.current = ''; };
  }, [loadPairs]));

  // Load data when pair is available
  useEffect(() => {
    if (pair) { loadData(); connectWS(pair); }
  }, [pair, loadData, connectWS]);

  useEffect(() => {
    if (markData && orderType === 'market') {
      setPriceInput(markData.markPrice.toFixed(pair?.pricePrecision ?? 2));
    }
  }, [markData, orderType, pair]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const entryPrice = parseFloat(priceInput || '0');
  const size       = parseFloat(qtyInput   || '0');
  const notional   = size * entryPrice;
  const initMargin = notional / leverage;
  const liqPrice   = entryPrice > 0 ? RiskEngine.calcLiqPrice({
    side: side === 'Long' ? 'long' : 'short', entryPrice, leverage,
  }) : 0;
  const maxSize    = entryPrice > 0 ? RiskEngine.calcMaxPositionSize(futuresBalance, entryPrice, leverage) : 0;

  const setPct = (pct: number) => {
    if (maxSize <= 0 || entryPrice <= 0) return;
    setQtyInput((maxSize * pct / 100).toFixed(pair?.qtyPrecision ?? 3));
  };

  // ── Submit order ───────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!pair) return;
    setError(''); setSuccess('');
    if (size <= 0)       { setError('Enter a valid size'); return; }
    if (entryPrice <= 0) { setError('Price unavailable — try again'); return; }
    if (initMargin <= 0) { setError('Cannot calculate margin'); return; }
    if (!pair.isFuturesOk) { setError('Futures not available for this pair'); return; }
    if (initMargin > futuresBalance) {
      setError(`Insufficient margin. Need ${initMargin.toFixed(2)} USDT — tap Transfer to add funds.`);
      return;
    }
    setSubmitting(true);
    try {
      await TradingService.setMarginAccount(pair.symbol, leverage, marginMode);
      const result = await TradingService.openFuturesPosition({
        symbol:    pair.symbol,
        side:      side === 'Long' ? 'long' : 'short',
        size,
        entryPrice: orderType === 'market' ? (markData?.markPrice ?? entryPrice) : entryPrice,
        leverage,
        marginMode,
        orderType,
        tpPrice: tpInput ? parseFloat(tpInput) : undefined,
        slPrice: slInput ? parseFloat(slInput) : undefined,
      });
      const posMsg = result.positionId ? `Position: ${result.positionId.slice(0,8)}…` : `Order: ${result.orderId.slice(0,8)}…`;
      setSuccess(`${side} order placed! ${posMsg}`);
      setQtyInput(''); setTpInput(''); setSlInput('');
      await loadData();
    } catch (e) {
      setError(toUserMessage(e, 'Failed to place order. Please try again.'));
    } finally { setSubmitting(false); }
  };

  // ── Close position ─────────────────────────────────────────────────────────
  const handleClose = async (pos: PositionRecord, pct: number) => {
    setClosing(pos.id);
    setError(''); setSuccess('');
    try {
      const closeSize  = pct < 100 ? pos.size * pct / 100 : undefined;
      const closePrice = markData?.markPrice ?? pos.markPrice ?? pos.entryPrice;
      const pnl        = await TradingService.closeFuturesPosition(pos.id, closePrice, closeSize);
      setSuccess(`Position ${pct < 100 ? `${pct}% ` : ''}closed. PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
      await loadData();
    } catch (e) {
      setError(toUserMessage(e, 'Failed to close position.'));
    } finally { setClosing(null); }
  };

  // ── Cancel order ───────────────────────────────────────────────────────────
  const handleCancelOrder = async (orderId: string) => {
    setCancelling(orderId);
    setError(''); setSuccess('');
    try {
      await TradingService.cancelFuturesOrder(orderId);
      setSuccess('Order cancelled');
      await loadData();
    } catch (e) {
      setError(toUserMessage(e, 'Failed to cancel order.'));
    } finally { setCancelling(null); }
  };

  // ── Margin management ──────────────────────────────────────────────────────
  const handleMarginConfirm = async (amount: number) => {
    if (!marginModal) return;
    setMarginLoading(true);
    try {
      if (marginModal.mode === 'add') {
        await TradingService.addFuturesMargin(marginModal.pos.id, amount);
      } else {
        await TradingService.reduceFuturesMargin(marginModal.pos.id, amount);
      }
      setMarginModal(null);
      await loadData();
    } catch (e) {
      setError(toUserMessage(e, 'Margin update failed.'));
    } finally { setMarginLoading(false); }
  };

  // ── Funding countdown ──────────────────────────────────────────────────────
  const fundingCountdown = useCallback(() => {
    if (!funding) return '—';
    const ms = funding.fundingTime - Date.now();
    if (ms <= 0) return '00:00:00';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, [funding]);

  const currentPositions = positions.filter(p => pair ? p.symbol === pair.symbol : true);
  const currentOrders    = openOrders.filter(o => pair ? o.symbol === pair.symbol : true);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Margin management modal */}
      {marginModal && (
        <MarginModal
          pos={marginModal.pos}
          mode={marginModal.mode}
          futuresBalance={futuresBalance}
          onConfirm={handleMarginConfirm}
          onClose={() => setMarginModal(null)}
          loading={marginLoading}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={{ paddingTop: 52, paddingHorizontal: 14, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => setShowPair(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 12 }}>
          <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 17 }}>
            {pair ? pair.symbol.replace('USDT_PERP','').replace('_PERP','') + ' Perp' : '—'}
          </Text>
          <ChevronDown size={16} color={C.text2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 18 }}>
            {markData ? markData.markPrice.toFixed(pair?.pricePrecision ?? 2) : '—'}
          </Text>
          <Text style={{ color: C.text3, fontSize: 10 }}>Mark</Text>
        </View>
        {funding && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: funding.fundingRate >= 0 ? C.sell : C.buy, fontSize: 11, fontWeight: DS.font.semibold }}>
              {(funding.fundingRate * 100).toFixed(4)}%
            </Text>
            <Text style={{ color: C.text3, fontSize: 10 }}>Funding {fundingCountdown()}</Text>
          </View>
        )}
      </View>

      {/* ── Pair picker ────────────────────────────────────────────── */}
      {showPairPicker && (
        <View style={{ position: 'absolute', top: 100, left: 0, right: 0, zIndex: 99, backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border, maxHeight: 260 }}>
          <FlatList
            data={pairs}
            keyExtractor={p => p.symbol}
            renderItem={({ item: p }) => (
              <Pressable onPress={() => { setPair(p); setShowPair(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ color: C.text1, fontWeight: DS.font.semibold, flex: 1 }}>{p.symbol.replace('_PERP','')}-PERP</Text>
                <Text style={{ color: C.text2, fontSize: 12 }}>Max {p.maxLeverage}×</Text>
              </Pressable>
            )}
          />
        </View>
      )}

      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={C.gold} />}
        >
          {/* ── Chart ──────────────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              {TIME_FRAMES.map(tf => (
                <Pressable key={tf} onPress={() => setTimeframe(tf)}
                  style={{ marginRight: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: DS.radius.sm,
                           backgroundColor: timeframe === tf ? C.goldBg : 'transparent' }}>
                  <Text style={{ color: timeframe === tf ? C.gold : C.text3, fontSize: 11 }}>{tf}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={{ alignItems: 'center', backgroundColor: C.card, borderRadius: DS.radius.md, padding: 8, borderWidth: 1, borderColor: C.border }}>
              {loading ? <ActivityIndicator color={C.gold} style={{ height: 140 }} /> : <CandleChart candles={candles} />}
            </View>
          </View>

          {/* ── Order Form ─────────────────────────────────────────── */}
          <View style={{ backgroundColor: C.card, margin: 12, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: C.border, padding: 16 }}>
            {/* Long / Short */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {(['Long','Short'] as const).map(s => (
                <Pressable key={s} onPress={() => setSide(s)}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: DS.radius.md, alignItems: 'center',
                           backgroundColor: side === s ? (s === 'Long' ? C.buy : C.sell) : C.surface,
                           borderWidth: 1, borderColor: side === s ? 'transparent' : C.border }}>
                  <Text style={{ color: side === s ? '#000' : C.text2, fontWeight: DS.font.bold, fontSize: 14 }}>{s}</Text>
                </Pressable>
              ))}
            </View>

            {/* Margin mode + leverage */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {(['cross','isolated'] as MarginModeV2[]).map(m => (
                <Pressable key={m} onPress={() => setMarginMode(m)}
                  style={{ flex: 1, paddingVertical: 7, borderRadius: DS.radius.md, alignItems: 'center',
                           backgroundColor: marginMode === m ? C.surface : 'transparent',
                           borderWidth: 1, borderColor: marginMode === m ? C.gold : C.border }}>
                  <Text style={{ color: marginMode === m ? C.gold : C.text2, fontSize: 12, textTransform: 'capitalize' }}>{m}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setShowLev(v => !v)}
                style={{ flex: 1, paddingVertical: 7, borderRadius: DS.radius.md, alignItems: 'center',
                         backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.gold }}>
                <Text style={{ color: C.gold, fontWeight: DS.font.bold, fontSize: 13 }}>{leverage}×</Text>
              </Pressable>
            </View>

            {/* Leverage picker */}
            {showLeverage && (
              <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.text3, fontSize: 11, marginBottom: 8 }}>
                  Select Leverage (Max {pair?.maxLeverage ?? 125}×)
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {LEVERAGE_PRESETS.filter(l => !pair || l <= pair.maxLeverage).map(l => (
                    <Pressable key={l} onPress={() => { setLeverage(l); setShowLev(false); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: DS.radius.md,
                               backgroundColor: leverage === l ? C.goldBg : C.card,
                               borderWidth: 1, borderColor: leverage === l ? C.gold : C.border }}>
                      <Text style={{ color: leverage === l ? C.gold : C.text2, fontSize: 12, fontWeight: DS.font.semibold }}>{l}×</Text>
                    </Pressable>
                  ))}
                </View>
                {leverage >= 20 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 8, backgroundColor: C.warnBg, borderRadius: DS.radius.md }}>
                    <AlertTriangle size={14} color={C.warn} />
                    <Text style={{ color: C.warn, fontSize: 11, flex: 1 }}>High leverage greatly increases liquidation risk.</Text>
                  </View>
                )}
              </View>
            )}

            {/* Order type */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {(['market','limit'] as const).map(ot => (
                <Pressable key={ot} onPress={() => setOrderType(ot)}
                  style={{ flex: 1, paddingVertical: 7, borderRadius: DS.radius.md, alignItems: 'center',
                           backgroundColor: orderType === ot ? C.goldBg : C.surface,
                           borderWidth: 1, borderColor: orderType === ot ? C.gold : C.border }}>
                  <Text style={{ color: orderType === ot ? C.gold : C.text2, fontSize: 12, textTransform: 'capitalize' }}>{ot}</Text>
                </Pressable>
              ))}
            </View>

            {/* Available balance + Transfer */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <View>
                <Text style={{ color: C.text3, fontSize: 11 }}>
                  Futures: <Text style={{ color: C.text2, fontWeight: DS.font.semibold }}>{futuresBalance.toFixed(2)} USDT</Text>
                </Text>
                <Text style={{ color: C.text3, fontSize: 10 }}>
                  Spot: <Text style={{ color: C.text3 }}>{spotBalance.toFixed(2)} USDT</Text>
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Pressable onPress={() => { setShowTransfer(v => !v); setTransferError(''); setTransferMsg(''); setTransferAmt(''); }}
                  style={{ backgroundColor: C.goldBg, borderRadius: DS.radius.sm, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.gold }}>
                  <Text style={{ color: C.gold, fontSize: 11, fontWeight: DS.font.bold }}>Transfer</Text>
                </Pressable>
                <Pressable onPress={loadData}><RefreshCw size={13} color={C.text3} /></Pressable>
              </View>
            </View>

            {/* Inline Transfer Panel */}
            {showTransfer && (
              <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.gold + '60' }}>
                <Text style={{ color: C.gold, fontSize: 12, fontWeight: DS.font.bold, marginBottom: 8 }}>Margin Transfer</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                  {(['spot_to_futures','futures_to_spot'] as const).map(d => (
                    <Pressable key={d} onPress={() => setTransferDir(d)}
                      style={{ flex: 1, paddingVertical: 6, borderRadius: DS.radius.sm, alignItems: 'center',
                               backgroundColor: transferDir === d ? C.goldBg : C.card,
                               borderWidth: 1, borderColor: transferDir === d ? C.gold : C.border }}>
                      <Text style={{ color: transferDir === d ? C.gold : C.text3, fontSize: 11, fontWeight: DS.font.semibold }}>
                        {d === 'spot_to_futures' ? 'Spot → Futures' : 'Futures → Spot'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={{ color: C.text3, fontSize: 10, marginBottom: 6 }}>
                  Available: {transferDir === 'spot_to_futures' ? spotBalance.toFixed(2) : futuresBalance.toFixed(2)} USDT
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={transferAmt} onChangeText={setTransferAmt}
                    placeholder="Amount (USDT)" placeholderTextColor={C.text3} keyboardType="decimal-pad"
                    style={{ flex: 1, backgroundColor: C.card, borderRadius: DS.radius.sm, borderWidth: 1,
                             borderColor: C.border, color: C.text1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 }}
                  />
                  <Pressable onPress={() => setTransferAmt((transferDir === 'spot_to_futures' ? spotBalance : futuresBalance).toFixed(2))}
                    style={{ backgroundColor: C.surface, borderRadius: DS.radius.sm, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, justifyContent: 'center' }}>
                    <Text style={{ color: C.text2, fontSize: 11 }}>Max</Text>
                  </Pressable>
                </View>
                {transferError !== '' && <Text style={{ color: C.sell, fontSize: 11, marginTop: 6 }}>{transferError}</Text>}
                {transferMsg   !== '' && <Text style={{ color: C.buy,  fontSize: 11, marginTop: 6 }}>✓ {transferMsg}</Text>}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Pressable onPress={() => setShowTransfer(false)}
                    style={{ flex: 1, backgroundColor: C.card, borderRadius: DS.radius.sm, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
                    <Text style={{ color: C.text2, fontSize: 12 }}>Cancel</Text>
                  </Pressable>
                  <Pressable disabled={transferring} onPress={async () => {
                    const amt = parseFloat(transferAmt);
                    if (!amt || amt <= 0) { setTransferError('Enter a valid amount'); return; }
                    setTransferError(''); setTransferMsg('');
                    setTransferring(true);
                    try {
                      if (transferDir === 'spot_to_futures') {
                        await TradingWallet.spotToFuturesTransfer(amt);
                      } else {
                        await TradingWallet.futuresToSpotTransfer(amt);
                      }
                      setTransferMsg(`${amt.toFixed(2)} USDT transferred`);
                      setTransferAmt('');
                      await loadData();
                    } catch (e) {
                      setTransferError(toUserMessage(e, 'Transfer failed'));
                    } finally { setTransferring(false); }
                  }}
                    style={{ flex: 2, backgroundColor: C.gold, borderRadius: DS.radius.sm, paddingVertical: 9,
                             alignItems: 'center', opacity: transferring ? 0.6 : 1 }}>
                    {transferring
                      ? <ActivityIndicator size="small" color="#000" />
                      : <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: 12 }}>Confirm Transfer</Text>}
                  </Pressable>
                </View>
              </View>
            )}

            {/* Price (limit only) */}
            {orderType === 'limit' && (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ color: C.text3, fontSize: 11, marginBottom: 4 }}>Price (USDT)</Text>
                <TextInput value={priceInput} onChangeText={setPriceInput}
                  placeholder="0.00" placeholderTextColor={C.text3} keyboardType="decimal-pad"
                  style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, color: C.text1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }} />
              </View>
            )}

            {/* Size */}
            <View style={{ marginBottom: 8 }}>
              <Text style={{ color: C.text3, fontSize: 11, marginBottom: 4 }}>Size ({pair?.baseAsset ?? 'Contracts'})</Text>
              <TextInput value={qtyInput} onChangeText={setQtyInput}
                placeholder="0.000" placeholderTextColor={C.text3} keyboardType="decimal-pad"
                style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, color: C.text1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }} />
            </View>

            {/* % quick-fill */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
              {[25,50,75,100].map(pct => (
                <Pressable key={pct} onPress={() => setPct(pct)}
                  style={{ flex: 1, backgroundColor: C.surface, borderRadius: DS.radius.sm, borderWidth: 1, borderColor: C.border, paddingVertical: 5, alignItems: 'center' }}>
                  <Text style={{ color: C.text2, fontSize: 11 }}>{pct}%</Text>
                </Pressable>
              ))}
            </View>

            {/* TP / SL */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.buy, fontSize: 11, marginBottom: 4 }}>Take Profit</Text>
                <TextInput value={tpInput} onChangeText={setTpInput}
                  placeholder="TP Price" placeholderTextColor={C.text3} keyboardType="decimal-pad"
                  style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: `${C.buy}50`, color: C.text1, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.sell, fontSize: 11, marginBottom: 4 }}>Stop Loss</Text>
                <TextInput value={slInput} onChangeText={setSlInput}
                  placeholder="SL Price" placeholderTextColor={C.text3} keyboardType="decimal-pad"
                  style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: `${C.sell}50`, color: C.text1, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13 }} />
              </View>
            </View>

            {/* Position summary */}
            {size > 0 && entryPrice > 0 && (
              <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, padding: 12, marginBottom: 12, gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text3, fontSize: 12 }}>Notional</Text>
                  <Text style={{ color: C.text2, fontSize: 12 }}>{notional.toFixed(2)} USDT</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text3, fontSize: 12 }}>Req. Margin</Text>
                  <Text style={{ color: initMargin > futuresBalance ? C.sell : C.text2, fontSize: 12, fontWeight: DS.font.semibold }}>{initMargin.toFixed(2)} USDT</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text3, fontSize: 12 }}>Est. Liq. Price</Text>
                  <Text style={{ color: C.sell, fontSize: 12, fontWeight: DS.font.semibold }}>{liqPrice.toFixed(2)}</Text>
                </View>
              </View>
            )}

            {error   !== '' && <Text style={{ color: C.sell, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{error}</Text>}
            {success !== '' && <Text style={{ color: C.buy,  fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{success}</Text>}

            <Pressable onPress={handleSubmit} disabled={submitting}
              style={{ backgroundColor: side === 'Long' ? C.buy : C.sell, borderRadius: DS.radius.lg, paddingVertical: 14, alignItems: 'center', opacity: submitting ? 0.7 : 1 }}>
              {submitting
                ? <ActivityIndicator color="#000" />
                : <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: 16 }}>
                    Open {side} {leverage}× {pair?.baseAsset ?? ''}
                  </Text>}
            </Pressable>
          </View>

          {/* ── Bottom tabs: Positions / Orders / History / Funding ── */}
          <View style={{ marginHorizontal: 12, marginBottom: 24 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {([
                { key: 'positions', label: `Open (${currentPositions.length})` },
                { key: 'orders',    label: `Orders (${currentOrders.length})` },
                { key: 'history',   label: 'History' },
                { key: 'funding',   label: 'Funding' },
              ] as { key: BottomTab; label: string }[]).map(tab => (
                <Pressable key={tab.key} onPress={() => setBottomTab(tab.key)}
                  style={{ marginRight: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: DS.radius.md,
                           backgroundColor: bottomTab === tab.key ? C.surface : 'transparent',
                           borderWidth: 1, borderColor: bottomTab === tab.key ? C.gold : C.border }}>
                  <Text style={{ color: bottomTab === tab.key ? C.gold : C.text2, fontSize: 13, fontWeight: DS.font.semibold }}>
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* ── Positions tab ─── */}
            {bottomTab === 'positions' && (
              <>
                {currentPositions.length === 0 && (
                  <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 32, fontSize: 13 }}>No open positions</Text>
                )}
                {currentPositions.map(pos => (
                  <PositionCard
                    key={pos.id}
                    pos={pos}
                    markPrice={markData?.markPrice ?? pos.entryPrice}
                    onClose={handleClose}
                    onAddMargin={p => setMarginModal({ pos: p, mode: 'add' })}
                    onReduceMargin={p => setMarginModal({ pos: p, mode: 'reduce' })}
                    closing={closing === pos.id}
                  />
                ))}
              </>
            )}

            {/* ── Open orders tab ─── */}
            {bottomTab === 'orders' && (
              <>
                {currentOrders.length === 0 && (
                  <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 32, fontSize: 13 }}>No open orders</Text>
                )}
                {currentOrders.map(order => (
                  <OpenOrderRow
                    key={order.id}
                    order={order}
                    onCancel={handleCancelOrder}
                    cancelling={cancelling === order.id}
                  />
                ))}
              </>
            )}

            {/* ── History tab ─── */}
            {bottomTab === 'history' && (
              <>
                {posHistory.length === 0 && orderHistory.length === 0 && (
                  <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 32, fontSize: 13 }}>No history</Text>
                )}
                {posHistory.map((p, i) => (
                  <View key={i} style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <Text style={{ color: C.text1, fontWeight: DS.font.semibold, fontSize: 13 }}>
                          {p.symbol.replace('_PERP','')}
                        </Text>
                        <View style={{ backgroundColor: p.side === 'long' ? C.buyBg : C.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: p.side === 'long' ? C.buy : C.sell, fontSize: 10, fontWeight: DS.font.bold }}>
                            {p.side.toUpperCase()} {p.leverage}×
                          </Text>
                        </View>
                      </View>
                      <Text style={{ color: (p.realizedPnl ?? 0) >= 0 ? C.buy : C.sell, fontWeight: DS.font.bold, fontSize: 14 }}>
                        {(p.realizedPnl ?? 0) >= 0 ? '+' : ''}{(p.realizedPnl ?? 0).toFixed(2)} USDT
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
                      <Text style={{ color: C.text3, fontSize: 11 }}>Entry: <Text style={{ color: C.text2 }}>{p.entryPrice.toFixed(2)}</Text></Text>
                      <Text style={{ color: C.text3, fontSize: 11 }}>Size: <Text style={{ color: C.text2 }}>{p.size}</Text></Text>
                      <Text style={{ color: C.text3, fontSize: 11 }}>Closed: {p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '—'}</Text>
                    </View>
                  </View>
                ))}
                {orderHistory.slice(0,10).map((o, i) => (
                  <View key={i} style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: o.side === 'buy' ? C.buy : C.sell, fontWeight: DS.font.semibold, fontSize: 12 }}>
                        {o.side === 'buy' ? 'LONG' : 'SHORT'} {o.symbol.replace('_PERP','')}
                      </Text>
                      <View style={{ backgroundColor: o.status === 'filled' ? C.buyBg : C.sellBg, borderRadius: DS.radius.xs, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ color: o.status === 'filled' ? C.buy : C.sell, fontSize: 9 }}>{o.status.toUpperCase()}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Text style={{ color: C.text3, fontSize: 11 }}>Qty: <Text style={{ color: C.text2 }}>{o.quantity}</Text></Text>
                      <Text style={{ color: C.text3, fontSize: 11 }}>{o.orderType}</Text>
                      <Text style={{ color: C.text3, fontSize: 10 }}>{new Date(o.updatedAt).toLocaleDateString()}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* ── Funding history tab ─── */}
            {bottomTab === 'funding' && (
              <>
                {fundingHist.length === 0 && (
                  <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 32, fontSize: 13 }}>No funding payments</Text>
                )}
                {fundingHist.map((f, i) => (
                  <View key={i} style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: C.text1, fontWeight: DS.font.semibold, fontSize: 13 }}>
                        {f.symbol.replace('_PERP','')} <Text style={{ color: f.side === 'long' ? C.buy : C.sell, fontSize: 11 }}>{f.side.toUpperCase()}</Text>
                      </Text>
                      <Text style={{ color: f.feeAmount >= 0 ? C.sell : C.buy, fontWeight: DS.font.bold, fontSize: 14 }}>
                        {f.feeAmount >= 0 ? '-' : '+'}{Math.abs(f.feeAmount).toFixed(4)} USDT
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
                      <Text style={{ color: C.text3, fontSize: 11 }}>Rate: <Text style={{ color: C.text2 }}>{(f.fundingRate * 100).toFixed(4)}%</Text></Text>
                      <Text style={{ color: C.text3, fontSize: 11 }}>Size: <Text style={{ color: C.text2 }}>{f.size}</Text></Text>
                      <Text style={{ color: C.text3, fontSize: 10 }}>{new Date(f.periodTs).toLocaleString()}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

