// Spot Trading Terminal — live order book, real Binance orders, wallet-integrated
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, FlatList,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView,
  type DimensionValue,
} from 'react-native';
import Svg, { Rect, Line, Path as SvgPath } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';
import { ChevronDown, RefreshCw, Info, Zap } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { toUserMessage } from '@/lib/errors';
import { TradingService } from '@/services';
import type {
  TradingPair, OrderRecord, OrderTypeV2, MarketTicker, TradeFill,
} from '@/services/trading.service';
import type { ProviderOrderBook, ProviderTrade, ProviderCandle } from '@/services/trading.provider';

const C = DS.color;

// ── Precision helpers (Binance exchange filters) ─────────────────────────────
function stepSize(precision: number): number {
  return Math.pow(10, -Math.max(0, precision));
}

function roundToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  const step = stepSize(precision);
  return parseFloat((Math.floor(value / step) * step).toFixed(precision));
}

function validateOrderInput(params: {
  side: 'Buy' | 'Sell';
  orderType: OrderTypeV2;
  qty: number;
  price?: number;
  stopPrice?: number;
  quoteOrderQty?: number;
  pair: TradingPair;
  availableBase: number;
  availableQuote: number;
}): { ok: true } | { ok: false; message: string } {
  const { side, orderType, qty, price, stopPrice, quoteOrderQty, pair, availableBase, availableQuote } = params;

  if (orderType === 'market' && side === 'Buy' && quoteOrderQty) {
    if (quoteOrderQty <= 0) return { ok: false, message: 'Enter a valid USDT amount' };
    if (quoteOrderQty > availableQuote) return { ok: false, message: `Insufficient USDT (available ${availableQuote.toFixed(2)})` };
    if (quoteOrderQty < pair.minNotional) return { ok: false, message: `Minimum order value is ${pair.minNotional} USDT` };
    return { ok: true };
  }

  if (qty <= 0) return { ok: false, message: 'Enter a valid quantity' };
  if (qty < pair.minQty) return { ok: false, message: `Minimum quantity is ${pair.minQty} ${pair.baseAsset}` };
  if (qty > pair.maxQty) return { ok: false, message: `Maximum quantity is ${pair.maxQty} ${pair.baseAsset}` };

  if (orderType !== 'market' && (!price || price <= 0)) {
    return { ok: false, message: 'Enter a valid price' };
  }
  if ((orderType === 'stop_limit' || orderType === 'stop_market') && (!stopPrice || stopPrice <= 0)) {
    return { ok: false, message: 'Enter a valid stop price' };
  }

  const checkPrice = orderType === 'market' ? (price ?? 0) : (price ?? 0);
  if (orderType !== 'market' && checkPrice > 0 && qty * checkPrice < pair.minNotional) {
    return { ok: false, message: `Minimum order value is ${pair.minNotional} USDT` };
  }

  if (side === 'Buy') {
    const required = orderType === 'market' ? (quoteOrderQty ?? qty * (price ?? 0)) : qty * (price ?? 0);
    if (required > availableQuote) return { ok: false, message: `Insufficient USDT (available ${availableQuote.toFixed(2)})` };
  } else {
    if (qty > availableBase) return { ok: false, message: `Insufficient ${pair.baseAsset} (available ${availableBase.toFixed(pair.qtyPrecision)})` };
  }

  return { ok: true };
}

// ── Candle Chart ──────────────────────────────────────────────────────────────
function CandleChart({ candles }: { candles: ProviderCandle[] }) {
  if (!candles.length) return <View style={{ width: '100%', height: 150, backgroundColor: C.surface, borderRadius: DS.radius.md }} />;
  const W = 340, H = 150, pad = 6;
  const prices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...prices), maxP = Math.max(...prices), range = maxP - minP || 1;
  const cw = (W - pad * 2) / candles.length;
  const toY = (p: number) => pad + ((maxP - p) / range) * (H - pad * 2);
  return (
    <Svg width={W} height={H}>
      {candles.map((c, i) => {
        const x = pad + i * cw + cw / 2;
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

// ── Order Book + Depth Chart ──────────────────────────────────────────────────
interface DepthLevel { price: number; qty: number; total: number; cumTotal: number }

function buildDepthLevels(
  levels: { price: number; qty: number }[],
  side: 'ask' | 'bid',
  maxRows = 20,
): DepthLevel[] {
  const rows = levels.slice(0, maxRows);
  let cum = 0;
  return (side === 'ask' ? rows.reverse() : rows).map(l => {
    cum += l.qty;
    return { price: l.price, qty: l.qty, total: l.price * l.qty, cumTotal: cum };
  });
}

function DepthChart({ book }: { book: ProviderOrderBook }) {
  const W = 340, H = 120, PAD = 8;
  const asks = book.asks.slice(0, 20).map(a => ({ price: a.price, qty: a.qty }));
  const bids = book.bids.slice(0, 20).map(b => ({ price: b.price, qty: b.qty }));

  // Build cumulative depth
  let cumAsk = 0, cumBid = 0;
  const askDepth = asks.map(a => { cumAsk += a.qty; return { price: a.price, cum: cumAsk }; });
  const bidDepth = bids.map(b => { cumBid += b.qty; return { price: b.price, cum: cumBid }; });

  if (!askDepth.length && !bidDepth.length) return null;

  const allPrices = [...askDepth.map(a => a.price), ...bidDepth.map(b => b.price)];
  const minPrice  = Math.min(...allPrices);
  const maxPrice  = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice || 1;
  const maxCum    = Math.max(...askDepth.map(a => a.cum), ...bidDepth.map(b => b.cum), 1);
  const chartW    = W - PAD * 2;
  const chartH    = H - PAD * 2;

  const px = (price: number) => PAD + ((price - minPrice) / priceRange) * chartW;
  const py = (cum: number)   => PAD + chartH - (cum / maxCum) * chartH;

  // Build SVG path strings
  const bidPath = bidDepth.length
    ? bidDepth.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.price).toFixed(1)},${py(p.cum).toFixed(1)}`).join(' ')
      + ` L${px(bidDepth[bidDepth.length - 1].price).toFixed(1)},${(PAD + chartH).toFixed(1)} L${PAD},${(PAD + chartH).toFixed(1)} Z`
    : '';
  const askPath = askDepth.length
    ? askDepth.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.price).toFixed(1)},${py(p.cum).toFixed(1)}`).join(' ')
      + ` L${px(askDepth[askDepth.length - 1].price).toFixed(1)},${(PAD + chartH).toFixed(1)} L${px(askDepth[0].price).toFixed(1)},${(PAD + chartH).toFixed(1)} Z`
    : '';

  const midPrice = bidDepth.length && askDepth.length
    ? ((bidDepth[0]?.price ?? 0) + (askDepth[0]?.price ?? 0)) / 2
    : null;

  return (
    <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, overflow: 'hidden', marginBottom: 8 }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Bid fill */}
        {bidPath ? <SvgPath d={bidPath} fill={`${C.buy}28`} stroke={C.buy} strokeWidth={1.2} /> : null}
        {/* Ask fill */}
        {askPath ? <SvgPath d={askPath} fill={`${C.sell}28`} stroke={C.sell} strokeWidth={1.2} /> : null}
        {/* Mid-price vertical line */}
        {midPrice !== null ? (
          <Line
            x1={px(midPrice).toFixed(1)} y1={PAD.toString()}
            x2={px(midPrice).toFixed(1)} y2={(PAD + chartH).toString()}
            stroke={C.gold} strokeWidth={1} strokeDasharray="3,3"
          />
        ) : null}
      </Svg>
      {/* Price labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: PAD, paddingBottom: 4 }}>
        <Text style={{ color: C.buy,  fontSize: 9 }}>{bidDepth[0]?.price.toFixed(2) ?? ''}</Text>
        {midPrice !== null && <Text style={{ color: C.gold, fontSize: 9 }}>mid {midPrice.toFixed(2)}</Text>}
        <Text style={{ color: C.sell, fontSize: 9 }}>{askDepth[askDepth.length - 1]?.price.toFixed(2) ?? ''}</Text>
      </View>
    </View>
  );
}

type BookView = 'combined' | 'bids' | 'asks';

function OrderBookPanel({ book, pricePrecision }: { book: ProviderOrderBook | null; pricePrecision: number }) {
  const [bookView, setBookView] = React.useState<BookView>('combined');
  const [showDepth, setShowDepth] = React.useState(true);

  if (!book) return <ActivityIndicator color={C.gold} style={{ margin: 16 }} />;

  const fmt = (n: number) => n.toFixed(pricePrecision);
  const askLevels = buildDepthLevels(book.asks.slice(0, 12).map(a => ({ price: a.price, qty: a.qty })), 'ask', 12);
  const bidLevels = buildDepthLevels(book.bids.slice(0, 12).map(b => ({ price: b.price, qty: b.qty })), 'bid', 12);
  const maxAskCum = askLevels.length ? askLevels[askLevels.length - 1].cumTotal : 1;
  const maxBidCum = bidLevels.length ? bidLevels[bidLevels.length - 1].cumTotal : 1;
  const spread    = book.asks.length && book.bids.length
    ? ((book.asks[0].price - book.bids[0].price) / book.asks[0].price * 100).toFixed(3)
    : '—';

  return (
    <View style={{ flex: 1 }}>
      {/* Depth chart toggle + view selector */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {(['combined','bids','asks'] as BookView[]).map(v => (
            <Pressable key={v} onPress={() => setBookView(v)}
              style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
                backgroundColor: bookView === v ? C.surface : 'transparent',
                borderWidth: 1, borderColor: bookView === v ? C.gold : C.border }}>
              <Text style={{ color: bookView === v ? C.gold : C.text3, fontSize: 10, textTransform: 'capitalize' }}>{v}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => setShowDepth(s => !s)}
          style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
            backgroundColor: showDepth ? C.surface : 'transparent',
            borderWidth: 1, borderColor: showDepth ? C.gold : C.border }}>
          <Text style={{ color: showDepth ? C.gold : C.text3, fontSize: 10 }}>Depth Chart</Text>
        </Pressable>
      </View>

      {/* Depth visualisation */}
      {showDepth && <DepthChart book={book} />}

      {/* Spread indicator */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 2, marginHorizontal: 8, backgroundColor: C.surface, borderRadius: DS.radius.xs, marginBottom: 4 }}>
        <Text style={{ color: C.text3, fontSize: 10 }}>Spread </Text>
        <Text style={{ color: C.gold, fontSize: 10, fontWeight: DS.font.semibold }}>{spread}%</Text>
      </View>

      {/* Column headers */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ color: C.text3, fontSize: 10, flex: 1.2 }}>Price (USDT)</Text>
        <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>Amount</Text>
        <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>Total</Text>
        <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>Depth</Text>
      </View>

      {/* Ask rows (sells) */}
      {bookView !== 'bids' && askLevels.slice().reverse().map((a, i) => {
        const barPct = `${(a.cumTotal / maxAskCum * 100).toFixed(0)}%` as DimensionValue;
        return (
          <View key={`a${i}`} style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 2, position: 'relative' }}>
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: barPct, backgroundColor: `${C.sell}15` }} />
            <Text style={{ color: C.sell, fontSize: 11, flex: 1.2, fontVariant: ['tabular-nums'] }}>{fmt(a.price)}</Text>
            <Text style={{ color: C.text2, fontSize: 11, flex: 1, textAlign: 'right' }}>{a.qty.toFixed(4)}</Text>
            <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>{a.total.toFixed(0)}</Text>
            <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>{a.cumTotal.toFixed(2)}</Text>
          </View>
        );
      })}

      {/* Mid-price separator */}
      {bookView === 'combined' && book.bids.length && book.asks.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 3, marginVertical: 2 }}>
          <Text style={{ color: C.gold, fontSize: 12, fontWeight: DS.font.bold, fontVariant: ['tabular-nums'] }}>
            {fmt((book.asks[0].price + book.bids[0].price) / 2)}
          </Text>
          <Text style={{ color: C.text3, fontSize: 10, marginLeft: 6 }}>last</Text>
        </View>
      ) : null}

      {/* Bid rows (buys) */}
      {bookView !== 'asks' && bidLevels.map((b, i) => {
        const barPct = `${(b.cumTotal / maxBidCum * 100).toFixed(0)}%` as DimensionValue;
        return (
          <View key={`b${i}`} style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 2, position: 'relative' }}>
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: barPct, backgroundColor: `${C.buy}15` }} />
            <Text style={{ color: C.buy, fontSize: 11, flex: 1.2, fontVariant: ['tabular-nums'] }}>{fmt(b.price)}</Text>
            <Text style={{ color: C.text2, fontSize: 11, flex: 1, textAlign: 'right' }}>{b.qty.toFixed(4)}</Text>
            <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>{b.total.toFixed(0)}</Text>
            <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>{b.cumTotal.toFixed(2)}</Text>
          </View>
        );
      })}
    </View>
  );
}


// ── Recent Trades ─────────────────────────────────────────────────────────────
function RecentTradesPanel({ trades, pricePrecision }: { trades: ProviderTrade[]; pricePrecision: number }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: C.text3, fontSize: 10, flex: 1 }}>Price (USDT)</Text>
        <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'center' }}>Amount</Text>
        <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>Time</Text>
      </View>
      {trades.slice(0, 20).map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: t.isBuyerMaker ? C.sell : C.buy, fontSize: 11, flex: 1, fontVariant: ['tabular-nums'] }}>
            {t.price.toFixed(pricePrecision)}
          </Text>
          <Text style={{ color: C.text2, fontSize: 11, flex: 1, textAlign: 'center' }}>{t.qty.toFixed(4)}</Text>
          <Text style={{ color: C.text3, fontSize: 11, flex: 1, textAlign: 'right' }}>
            {new Date(t.time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── Order Form ────────────────────────────────────────────────────────────────
const ORDER_TYPE_LABELS: Record<OrderTypeV2, string> = {
  market: 'Market', limit: 'Limit', stop_market: 'Stop Market',
  stop_limit: 'Stop-Limit', take_profit_market: 'TP Market',
  take_profit_limit: 'TP Limit', stop_loss: 'Stop Loss',
  oco: 'OCO', trailing_stop: 'Trailing Stop',
};
const SPOT_ORDER_TYPES: OrderTypeV2[] = ['market','limit','stop_limit','stop_market'];
const PCT_STEPS = [25, 50, 75, 100];
const TIME_FRAMES = ['1m','5m','15m','1h','4h','1D'];

type ViewMode = 'chart' | 'orderbook' | 'trades';

export default function SpotTradingScreen() {
  const [pairs, setPairs]           = useState<TradingPair[]>([]);
  const [pair, setPair]             = useState<TradingPair | null>(null);
  const [ticker, setTicker]         = useState<MarketTicker | null>(null);
  const [book, setBook]             = useState<ProviderOrderBook | null>(null);
  const [recentTrades, setRecent]   = useState<ProviderTrade[]>([]);
  const [candles, setCandles]       = useState<ProviderCandle[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderRecord[]>([]);
  const [orderHistory, setHistory]  = useState<OrderRecord[]>([]);
  const [tradeFills, setTradeFills] = useState<TradeFill[]>([]);
  const [spotBalance, setBalance]   = useState<{ base: number; quote: number }>({ base: 0, quote: 0 });

  const [side, setSide]             = useState<'Buy' | 'Sell'>('Buy');
  const [orderType, setOrderType]   = useState<OrderTypeV2>('limit');
  const [priceInput, setPriceInput] = useState('');
  const [stopInput, setStopInput]   = useState('');
  const [qtyInput, setQtyInput]     = useState('');
  const [timeframe, setTimeframe]   = useState('1h');
  const [viewMode, setViewMode]     = useState<ViewMode>('chart');
  const [bottomTab, setBottomTab]   = useState<'open' | 'history' | 'trades'>('open');
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [showPairPicker, setShowPairPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [useQuoteAmount, setUseQuoteAmount] = useState(false);
  const [wsStatus, setWsStatus]     = useState<'connecting' | 'live' | 'reconnecting' | 'disconnected'>('disconnected');

  const wsRef    = useRef<WebSocket | null>(null);
  const wsSymRef = useRef<string>('');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSubmitKey  = useRef<string>('');

  // ── Load pairs once ──────────────────────────────────────────────
  // ── Load spot pairs ───────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const ps = await TradingService.getSpotPairs();
        setPairs(ps);
        if (!pair && ps.length > 0) setPair(ps[0]);
      } catch (e) {
        setError(toUserMessage(e, 'Failed to load trading pairs'));
      }
    })();
  }, []));

  // ── Load market data (candles + balances) when pair/timeframe changes ──
  const loadMarketData = useCallback(async () => {
    if (!pair) return;
    setLoading(true);
    try {
      const [tickerData, bookData, tradesData, candlesData, bal] = await Promise.allSettled([
        TradingService.getTicker(pair.symbol, pair.providerSymbol),
        TradingService.getOrderBook(pair.symbol, pair.providerSymbol, 20),
        TradingService.getRecentTrades(pair.symbol, pair.providerSymbol, 50),
        TradingService.getCandles(pair.symbol, timeframe, 80, pair.providerSymbol),
        Promise.all([
          TradingService.getTradingBalance(pair.baseAsset, 'spot'),
          TradingService.getTradingBalance(pair.quoteAsset, 'spot'),
        ]),
      ]);
      if (tickerData.status === 'fulfilled') { setTicker(tickerData.value); setPriceInput(tickerData.value.price.toFixed(pair.pricePrecision)); }
      if (bookData.status === 'fulfilled')   setBook(bookData.value);
      if (tradesData.status === 'fulfilled') setRecent(tradesData.value);
      if (candlesData.status === 'fulfilled') setCandles(candlesData.value);
      if (bal.status === 'fulfilled') setBalance({ base: bal.value[0], quote: bal.value[1] });
    } finally { setLoading(false); setRefreshing(false); }
  }, [pair, timeframe]);

  const loadOrders = useCallback(async () => {
    if (!pair) return;
    const [open, hist, fills] = await Promise.allSettled([
      TradingService.getOpenOrders(pair.symbol),
      TradingService.getOrderHistory({ symbol: pair.symbol, marketType: 'spot', limit: 30 }),
      TradingService.getTradeFills({ symbol: pair.symbol, limit: 30 }),
    ]);
    if (open.status === 'fulfilled')  setOpenOrders(open.value);
    if (hist.status === 'fulfilled')  setHistory(hist.value);
    if (fills.status === 'fulfilled') setTradeFills(fills.value);
  }, [pair]);

  // ── WebSocket live feed (ticker + depth) with auto-reconnect ──────────────
  const cleanupWS = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    wsSymRef.current = '';
  }, []);

  const connectWS = useCallback((p: TradingPair) => {
    const sym = (p.providerSymbol ?? p.symbol).toLowerCase().replace('_perp','').replace('/','');
    if (wsRef.current && wsSymRef.current === sym && wsRef.current.readyState === WebSocket.OPEN) return;

    cleanupWS();
    wsSymRef.current = sym;
    setWsStatus('connecting');

    const streams = `${sym}@ticker/${sym}@depth20@100ms`;
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('live');
      // Binance combined streams do not echo ping; we use a keep-alive timer to detect stale sockets
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: 'ping' }));
        }
      }, 20_000);
    };

    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data as string) as { stream?: string; data?: Record<string, unknown>; ping?: unknown };
        if ('ping' in raw) return;
        if (!raw.stream || !raw.data) return;

        if (raw.stream.endsWith('@ticker')) {
          const d = raw.data;
          setTicker(prev => prev ? {
            ...prev,
            price:          parseFloat(d.c as string),
            priceChange:    parseFloat(d.p as string),
            priceChangePct: parseFloat(d.P as string),
            high24h:        parseFloat(d.h as string),
            low24h:         parseFloat(d.l as string),
            volume24h:      parseFloat(d.v as string),
            quoteVolume24h: parseFloat(d.q as string),
          } : prev);
        } else if (raw.stream.includes('@depth20')) {
          const d = raw.data as { bids: string[][]; asks: string[][] };
          setBook({
            bids: (d.bids ?? []).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })),
            asks: (d.asks ?? []).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })),
            lastUpdateId: Date.now(),
          } as ProviderOrderBook);
        }
      } catch { /* malformed frame — ignore */ }
    };

    ws.onerror = () => {
      setWsStatus('reconnecting');
      cleanupWS();
      reconnectTimer.current = setTimeout(() => connectWS(p), 3_000);
    };

    ws.onclose = () => {
      if (wsSymRef.current === sym) {
        setWsStatus('reconnecting');
        reconnectTimer.current = setTimeout(() => connectWS(p), 3_000);
      }
    };
  }, [cleanupWS]);

  useFocusEffect(useCallback(() => {
    loadMarketData();
    loadOrders();
    if (pair) connectWS(pair);
    // Auto-refresh open orders every 15 s to catch fills from order-sync
    const refreshInterval = setInterval(() => { loadOrders(); }, 15_000);
    return () => {
      clearInterval(refreshInterval);
      cleanupWS();
      setWsStatus('disconnected');
    };
  }, [loadMarketData, loadOrders, pair, connectWS, cleanupWS]));

  // Reconnect WS when pair changes mid-session
  useEffect(() => {
    if (pair) connectWS(pair);
  }, [pair, connectWS]);

  // Reset form inputs when pair changes to avoid stale precision values
  useEffect(() => {
    setQtyInput('');
    setStopInput('');
    setUseQuoteAmount(false);
  }, [pair?.symbol]);

  // ── Derived ───────────────────────────────────────────────────────
  const rawInput    = parseFloat(qtyInput || '0');
  const qty         = useQuoteAmount ? 0 : rawInput;
  const quoteAmount = useQuoteAmount ? rawInput : 0;
  const price       = parseFloat(priceInput || '0');
  const stopPrice   = parseFloat(stopInput || '0');

  // Snapped values per Binance filters
  const snappedQty   = pair ? roundToPrecision(qty, pair.qtyPrecision) : qty;
  const snappedQuote = pair ? roundToPrecision(quoteAmount, pair.pricePrecision) : quoteAmount;
  const snappedPrice = pair ? roundToPrecision(price, pair.pricePrecision) : price;
  const total        = snappedQty * snappedPrice;
  const maxQty       = side === 'Buy'
    ? (snappedPrice > 0 ? spotBalance.quote / snappedPrice : 0)
    : spotBalance.base;
  const maxQuote     = spotBalance.quote;

  const setPct = (pct: number) => {
    if (!pair) return;
    if (useQuoteAmount && side === 'Buy') {
      const raw = maxQuote * pct / 100;
      setQtyInput(raw.toFixed(pair.pricePrecision));
    } else if (maxQty > 0) {
      const raw = maxQty * pct / 100;
      setQtyInput(roundToPrecision(raw, pair.qtyPrecision).toFixed(pair.qtyPrecision));
    }
  };

  // ── Place order (via spot-order-place Edge Function) ─────────────
  const handleSubmit = async () => {
    if (!pair || submitting) return;
    setError(''); setSuccess('');

    const quoteOrderQty = (orderType === 'market' && side === 'Buy' && useQuoteAmount)
      ? snappedQuote
      : undefined;

    const validation = validateOrderInput({
      side, orderType,
      qty: snappedQty,
      price: snappedPrice,
      stopPrice,
      quoteOrderQty,
      pair,
      availableBase: spotBalance.base,
      availableQuote: spotBalance.quote,
    });
    if (!validation.ok) { setError(validation.message); return; }

    // Idempotency key — prevents double-submission if user taps twice.
    // If the exact same key was already sent in this session, skip the call.
    const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `idk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (lastSubmitKey.current === idempotencyKey) return;
    lastSubmitKey.current = idempotencyKey;

    setSubmitting(true);
    try {
      const result = await TradingService.placeSpotOrder({
        symbol:         pair.symbol,
        baseAsset:      pair.baseAsset,
        quoteAsset:     pair.quoteAsset,
        side:           side === 'Buy' ? 'buy' : 'sell',
        orderType,
        quantity:       quoteOrderQty ? undefined : snappedQty,
        quoteOrderQty,
        price:          orderType === 'market' ? undefined : snappedPrice,
        stopPrice:      (orderType === 'stop_limit' || orderType === 'stop_market') ? stopPrice || undefined : undefined,
        idempotencyKey,
      });
      const statusLabel = result.status === 'filled' ? 'Filled' : result.status === 'open' ? 'Open' : result.status;
      setSuccess(`Order ${statusLabel}! ID: ${result.orderId.slice(0, 8)}…`);
      setQtyInput('');
      setStopInput('');
      await Promise.all([loadOrders(), loadMarketData()]);
    } catch (e) {
      setError(toUserMessage(e, 'Order placement failed. Please try again.'));
      lastSubmitKey.current = ''; // allow retry after error
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (orderId: string) => {
    try {
      await TradingService.cancelOrder(orderId);
      await Promise.all([loadOrders(), loadMarketData()]);
    } catch (e) {
      setError(toUserMessage(e, 'Failed to cancel order.'));
    }
  };

  const fmtStatus = (s: string) => s.replace('_',' ').toUpperCase();
  const statusColor = (s: string) => {
    if (s === 'filled') return C.buy;
    if (s === 'cancelled' || s === 'rejected') return C.sell;
    if (s === 'partially_filled') return C.warn;
    return C.info;
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header: Pair selector + price ─────────────────────────── */}
      <View style={{ paddingTop: 52, paddingHorizontal: 14, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={() => setShowPairPicker(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 16 }}>
          <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 18 }}>{pair?.symbol.replace('USDT','') ?? '—'}/USDT</Text>
          <ChevronDown size={16} color={C.text2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: ticker && ticker.priceChangePct >= 0 ? C.buy : C.sell, fontWeight: DS.font.bold, fontSize: 18 }}>
            {ticker ? ticker.price.toFixed(pair?.pricePrecision ?? 2) : '—'}
          </Text>
          {ticker && (
            <Text style={{ color: ticker.priceChangePct >= 0 ? C.buy : C.sell, fontSize: 11 }}>
              {ticker.priceChangePct >= 0 ? '+' : ''}{ticker.priceChangePct.toFixed(2)}%
            </Text>
          )}
        </View>
        {ticker && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: C.text3, fontSize: 10 }}>24h H: <Text style={{ color: C.text2 }}>{ticker.high24h.toFixed(pair?.pricePrecision ?? 2)}</Text></Text>
            <Text style={{ color: C.text3, fontSize: 10 }}>24h L: <Text style={{ color: C.text2 }}>{ticker.low24h.toFixed(pair?.pricePrecision ?? 2)}</Text></Text>
          </View>
        )}
        <View style={{ marginLeft: 10, alignItems: 'center' }}>
          <View style={{
            width: 8, height: 8, borderRadius: 4,
            backgroundColor: wsStatus === 'live' ? C.buy : wsStatus === 'connecting' ? C.warn : C.sell,
          }} />
          <Text style={{ color: C.text3, fontSize: 8, marginTop: 2, textTransform: 'capitalize' }}>{wsStatus}</Text>
        </View>
      </View>

      {/* ── Pair picker ────────────────────────────────────────────── */}
      {showPairPicker && (
        <View style={{ position: 'absolute', top: 100, left: 0, right: 0, zIndex: 99, backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border, maxHeight: 360 }}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <TextInput
              value={pairSearch}
              onChangeText={setPairSearch}
              placeholder="Search pair (e.g. BTC)"
              placeholderTextColor={C.text3}
              autoCapitalize="characters"
              style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, color: C.text1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 }}
            />
          </View>
          <FlatList
            data={pairs.filter(p =>
              p.baseAsset.toUpperCase().includes(pairSearch.trim().toUpperCase()) ||
              p.symbol.toUpperCase().includes(pairSearch.trim().toUpperCase())
            )}
            keyExtractor={p => p.symbol}
            ListEmptyComponent={(
              <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 20 }}>No pairs found</Text>
            )}
            renderItem={({ item: p }) => (
              <Pressable onPress={() => { setPair(p); setShowPairPicker(false); setPairSearch(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ color: C.text1, fontWeight: DS.font.semibold, flex: 1 }}>{p.baseAsset}/USDT</Text>
                <Text style={{ color: C.text2, fontSize: 12 }}>{p.takerFee * 100}% fee</Text>
              </Pressable>
            )}
          />
        </View>
      )}

      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMarketData(); loadOrders(); }} tintColor={C.gold} />}
        >
          {/* ── View mode switcher ─────────────────────────────────── */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, gap: 8 }}>
            {(['chart','orderbook','trades'] as ViewMode[]).map(m => (
              <Pressable key={m} onPress={() => setViewMode(m)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: DS.radius.md,
                         backgroundColor: viewMode === m ? C.surface : 'transparent',
                         borderWidth: 1, borderColor: viewMode === m ? C.gold : C.border }}>
                <Text style={{ color: viewMode === m ? C.gold : C.text2, fontSize: 12, fontWeight: DS.font.medium, textTransform: 'capitalize' }}>{m}</Text>
              </Pressable>
            ))}
          </View>

          {/* ── Chart view ─────────────────────────────────────────── */}
          {viewMode === 'chart' && (
            <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                {TIME_FRAMES.map(tf => (
                  <Pressable key={tf} onPress={() => setTimeframe(tf)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: DS.radius.sm,
                             backgroundColor: timeframe === tf ? C.goldBg : 'transparent' }}>
                    <Text style={{ color: timeframe === tf ? C.gold : C.text3, fontSize: 11 }}>{tf}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ alignItems: 'center', backgroundColor: C.card, borderRadius: DS.radius.md, padding: 8, borderWidth: 1, borderColor: C.border }}>
                {loading ? <ActivityIndicator color={C.gold} style={{ height: 150 }} /> : <CandleChart candles={candles} />}
              </View>
            </View>
          )}

          {/* ── Order book view ────────────────────────────────────── */}
          {viewMode === 'orderbook' && (
            <View style={{ backgroundColor: C.card, margin: 12, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, paddingVertical: 8 }}>
              <OrderBookPanel book={book} pricePrecision={pair?.pricePrecision ?? 2} />
            </View>
          )}

          {/* ── Trades view ────────────────────────────────────────── */}
          {viewMode === 'trades' && (
            <View style={{ backgroundColor: C.card, margin: 12, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, paddingVertical: 8 }}>
              <RecentTradesPanel trades={recentTrades} pricePrecision={pair?.pricePrecision ?? 2} />
            </View>
          )}

          {/* ── Order Form ─────────────────────────────────────────── */}
          <View style={{ backgroundColor: C.card, margin: 12, borderRadius: DS.radius.xl, borderWidth: 1, borderColor: C.border, padding: 16 }}>
            {/* Side */}
            <View style={{ flexDirection: 'row', marginBottom: 14, gap: 8 }}>
              {(['Buy','Sell'] as const).map(s => (
                <Pressable key={s} onPress={() => setSide(s)} style={{ flex: 1, paddingVertical: 10, borderRadius: DS.radius.md,
                    backgroundColor: side === s ? (s === 'Buy' ? C.buy : C.sell) : C.surface,
                    alignItems: 'center', borderWidth: 1, borderColor: side === s ? 'transparent' : C.border }}>
                  <Text style={{ color: side === s ? '#000' : C.text2, fontWeight: DS.font.bold, fontSize: 14 }}>{s}</Text>
                </Pressable>
              ))}
            </View>

            {/* Order type */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {SPOT_ORDER_TYPES.map(ot => (
                <Pressable key={ot} onPress={() => { setOrderType(ot); setQtyInput(''); }}
                  style={{ marginRight: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: DS.radius.md,
                           backgroundColor: orderType === ot ? C.goldBg : C.surface,
                           borderWidth: 1, borderColor: orderType === ot ? C.gold : C.border }}>
                  <Text style={{ color: orderType === ot ? C.gold : C.text2, fontSize: 12 }}>{ORDER_TYPE_LABELS[ot]}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Market-buy quote-amount toggle */}
            {orderType === 'market' && side === 'Buy' && (
              <Pressable onPress={() => { setUseQuoteAmount(v => !v); setQtyInput(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: C.gold,
                               backgroundColor: useQuoteAmount ? C.gold : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {useQuoteAmount && <Text style={{ color: C.bg, fontSize: 10, fontWeight: DS.font.bold }}>✓</Text>}
                </View>
                <Text style={{ color: C.text2, fontSize: 12 }}>Buy by USDT amount</Text>
              </Pressable>
            )}

            {/* Balance */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Info size={12} color={C.text3} />
                <Text style={{ color: C.text3, fontSize: 11 }}>Avail:</Text>
                <Text style={{ color: C.text2, fontSize: 11, fontWeight: DS.font.semibold }}>
                  {side === 'Buy'
                    ? `${spotBalance.quote.toFixed(2)} USDT`
                    : `${spotBalance.base.toFixed(pair?.qtyPrecision ?? 5)} ${pair?.baseAsset ?? ''}`}
                </Text>
              </View>
              <Pressable onPress={loadMarketData}>
                <RefreshCw size={14} color={C.text3} />
              </Pressable>
            </View>

            {/* Stop price (for stop orders) */}
            {(orderType === 'stop_limit' || orderType === 'stop_market') && (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ color: C.text3, fontSize: 11, marginBottom: 4 }}>Stop Price (USDT)</Text>
                <TextInput
                  value={stopInput} onChangeText={setStopInput}
                  placeholder="0.00" placeholderTextColor={C.text3}
                  keyboardType="decimal-pad"
                  style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, color: C.text1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }}
                />
              </View>
            )}

            {/* Price (for non-market) */}
            {orderType !== 'market' && (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ color: C.text3, fontSize: 11, marginBottom: 4 }}>Price (USDT)</Text>
                <TextInput
                  value={priceInput} onChangeText={setPriceInput}
                  placeholder="0.00" placeholderTextColor={C.text3}
                  keyboardType="decimal-pad"
                  style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, color: C.text1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }}
                />
              </View>
            )}

            {/* Quantity / Quote amount */}
            <View style={{ marginBottom: 8 }}>
              <Text style={{ color: C.text3, fontSize: 11, marginBottom: 4 }}>
                {useQuoteAmount ? 'Amount (USDT)' : `Amount (${pair?.baseAsset ?? '—'})`}
              </Text>
              <TextInput
                value={qtyInput}
                onChangeText={text => {
                  // Only allow valid decimal input
                  const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                  setQtyInput(cleaned);
                }}
                placeholder={useQuoteAmount ? '0.00' : '0.00000'}
                placeholderTextColor={C.text3}
                keyboardType="decimal-pad"
                style={{ backgroundColor: C.surface, borderRadius: DS.radius.md, borderWidth: 1, borderColor: C.border, color: C.text1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }}
              />
            </View>

            {/* Percentage quick-fill */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
              {PCT_STEPS.map(pct => (
                <Pressable key={pct} onPress={() => setPct(pct)}
                  style={{ flex: 1, backgroundColor: C.surface, borderRadius: DS.radius.sm, borderWidth: 1, borderColor: C.border, paddingVertical: 5, alignItems: 'center' }}>
                  <Text style={{ color: C.text2, fontSize: 11 }}>{pct}%</Text>
                </Pressable>
              ))}
            </View>

            {/* Total / Notional */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 2 }}>
              <Text style={{ color: C.text3, fontSize: 12 }}>
                {useQuoteAmount ? 'Buying ≈' : (orderType === 'market' ? 'Estimated total ≈' : 'Total ≈')}
              </Text>
              <Text style={{ color: C.text2, fontSize: 12, fontWeight: DS.font.semibold }}>
                {useQuoteAmount
                  ? `${(snappedQuote / (ticker?.price ?? 1)).toFixed(pair?.qtyPrecision ?? 5)} ${pair?.baseAsset ?? ''}`
                  : `${total.toFixed(2)} USDT`}
              </Text>
            </View>

            {/* Fee info */}
            {pair && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 2 }}>
                <Text style={{ color: C.text3, fontSize: 11 }}>Fee ({pair.takerFee * 100}%)</Text>
                <Text style={{ color: C.text3, fontSize: 11 }}>
                  ≈ {((useQuoteAmount ? snappedQuote : total) * pair.takerFee).toFixed(4)} USDT
                </Text>
              </View>
            )}

            {/* Error / Success */}
            {error !== '' && (
              <View style={{ backgroundColor: C.sellBg, borderRadius: DS.radius.md, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: C.sell }}>
                <Text style={{ color: C.sell, fontSize: 12, lineHeight: 18 }}>{error}</Text>
              </View>
            )}
            {success !== '' && <Text style={{ color: C.buy, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{success}</Text>}

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={{ backgroundColor: side === 'Buy' ? C.buy : C.sell, borderRadius: DS.radius.lg, paddingVertical: 14, alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting
                ? <ActivityIndicator color="#000" />
                : <Text style={{ color: '#000', fontWeight: DS.font.bold, fontSize: 16 }}>{side} {pair?.baseAsset ?? ''}</Text>
              }
            </Pressable>
          </View>

          {/* ── Open Orders / History / Trades ───────────────────── */}
          <View style={{ margin: 12 }}>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
              {(['open','history','trades'] as const).map(tab => (
                <Pressable key={tab} onPress={() => setBottomTab(tab)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: DS.radius.md, alignItems: 'center',
                           backgroundColor: bottomTab === tab ? C.surface : 'transparent',
                           borderWidth: 1, borderColor: bottomTab === tab ? C.gold : C.border }}>
                  <Text style={{ color: bottomTab === tab ? C.gold : C.text2, fontSize: 12, fontWeight: DS.font.semibold }}>
                    {tab === 'open' ? `Open (${openOrders.length})` : tab === 'history' ? 'History' : 'Trades'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {bottomTab === 'open' && loading && openOrders.length === 0 && (
              <ActivityIndicator color={C.gold} style={{ marginVertical: 24 }} />
            )}
            {bottomTab === 'open' && !loading && openOrders.length === 0 && (
              <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>No open orders</Text>
            )}
            {bottomTab === 'open' && openOrders.map(o => (
              <View key={o.id} style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Text style={{ color: o.side === 'buy' ? C.buy : C.sell, fontWeight: DS.font.bold, fontSize: 13 }}>{o.side.toUpperCase()}</Text>
                    <Text style={{ color: C.text2, fontSize: 12 }}>{ORDER_TYPE_LABELS[o.orderType]}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <View style={{ backgroundColor: `${statusColor(o.status)}20`, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: statusColor(o.status), fontSize: 10, fontWeight: DS.font.semibold }}>{fmtStatus(o.status)}</Text>
                    </View>
                    <Pressable onPress={() => handleCancel(o.id)} style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.sellBg, borderRadius: DS.radius.sm, borderWidth: 1, borderColor: C.sell }}>
                      <Text style={{ color: C.sell, fontSize: 11, fontWeight: DS.font.semibold }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <Text style={{ color: C.text3, fontSize: 11 }}>Qty: <Text style={{ color: C.text2 }}>{o.quantity}</Text></Text>
                  {o.price ? <Text style={{ color: C.text3, fontSize: 11 }}>@ <Text style={{ color: C.text2 }}>{o.price}</Text></Text> : null}
                  <Text style={{ color: C.text3, fontSize: 11 }}>Filled: <Text style={{ color: C.text2 }}>{o.filledQty.toFixed(4)}</Text></Text>
                </View>
                {o.providerOrderId ? (
                  <Text style={{ color: C.text3, fontSize: 10, marginTop: 3 }}>Binance #{o.providerOrderId}</Text>
                ) : null}
              </View>
            ))}

            {bottomTab === 'history' && loading && orderHistory.length === 0 && (
              <ActivityIndicator color={C.gold} style={{ marginVertical: 24 }} />
            )}
            {bottomTab === 'history' && !loading && orderHistory.length === 0 && (
              <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>No order history</Text>
            )}
            {bottomTab === 'history' && orderHistory.map(o => (
              <View key={o.id} style={{ backgroundColor: C.card, borderRadius: DS.radius.lg, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ color: o.side === 'buy' ? C.buy : C.sell, fontWeight: DS.font.bold, fontSize: 13 }}>{o.side.toUpperCase()}</Text>
                    <Text style={{ color: C.text2, fontSize: 12 }}>{ORDER_TYPE_LABELS[o.orderType]}</Text>
                  </View>
                  <View style={{ backgroundColor: `${statusColor(o.status)}20`, borderRadius: DS.radius.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: statusColor(o.status), fontSize: 10, fontWeight: DS.font.semibold }}>{fmtStatus(o.status)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                  <Text style={{ color: C.text3, fontSize: 11 }}>Qty: <Text style={{ color: C.text2 }}>{o.quantity}</Text></Text>
                  {o.avgFillPrice ? <Text style={{ color: C.text3, fontSize: 11 }}>Avg: <Text style={{ color: C.text2 }}>{o.avgFillPrice.toFixed(2)}</Text></Text> : null}
                  <Text style={{ color: C.text3, fontSize: 11 }}>Fee: <Text style={{ color: C.text2 }}>{o.fee.toFixed(6)} {o.feeAsset ?? 'USDT'}</Text></Text>
                  <Text style={{ color: C.text3, fontSize: 11 }}>{new Date(o.createdAt).toLocaleDateString()}</Text>
                </View>
                {o.providerOrderId ? (
                  <Text style={{ color: C.text3, fontSize: 10, marginTop: 3 }}>Binance #{o.providerOrderId}</Text>
                ) : null}
              </View>
            ))}

            {bottomTab === 'trades' && loading && tradeFills.length === 0 && (
              <ActivityIndicator color={C.gold} style={{ marginVertical: 24 }} />
            )}
            {bottomTab === 'trades' && !loading && tradeFills.length === 0 && (
              <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>No trade fills yet</Text>
            )}
            {bottomTab === 'trades' && (
              <View>
                {/* Column headers */}
                <View style={{ flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 6 }}>
                  <Text style={{ color: C.text3, fontSize: 10, flex: 1.2 }}>Price</Text>
                  <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>Qty</Text>
                  <Text style={{ color: C.text3, fontSize: 10, flex: 1, textAlign: 'right' }}>Fee</Text>
                  <Text style={{ color: C.text3, fontSize: 10, flex: 1.2, textAlign: 'right' }}>Time</Text>
                </View>
                {tradeFills.map(fill => (
                  <View key={fill.id} style={{ flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 5,
                    borderBottomWidth: 1, borderBottomColor: C.border }}>
                    <Text style={{ color: fill.side === 'buy' ? C.buy : C.sell, fontSize: 12, flex: 1.2, fontVariant: ['tabular-nums'] }}>
                      {fill.fillPrice.toFixed(pair?.pricePrecision ?? 2)}
                    </Text>
                    <Text style={{ color: C.text2, fontSize: 12, flex: 1, textAlign: 'right' }}>{fill.fillQty.toFixed(5)}</Text>
                    <Text style={{ color: C.text3, fontSize: 11, flex: 1, textAlign: 'right' }}>
                      {fill.fee.toFixed(5)} {fill.feeAsset}
                    </Text>
                    <Text style={{ color: C.text3, fontSize: 11, flex: 1.2, textAlign: 'right' }}>
                      {new Date(fill.createdAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}


