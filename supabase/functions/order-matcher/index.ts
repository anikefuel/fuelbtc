// order-matcher Edge Function
// Called every ~15 seconds via pg_cron (4 staggered jobs per minute).
// Matches open limit buy/sell orders for BOTH spot and futures perpetuals.
// Spot:    settle via settle_matched_orders RPC (wallet debit/credit)
// Futures: settle via settle_matched_futures_orders RPC (position open/update + margin debit)

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FEE_RATE      = 0.001;  // 0.1% taker fee
const MARK_PRICE_CACHE = new Map<string, { price: number; ts: number }>();
const MARK_PRICE_TTL   = 5_000; // 5 s cache

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

interface Order {
  id: string;
  user_id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  side: 'buy' | 'sell';
  price: number;
  remaining_qty: number;
  filled_qty: number;
  fee_asset: string;
  leverage_v2: number;
  margin_mode: string;
  market_type_v2: string;
}

interface MatchResult { symbol: string; matched: number; errors: string[]; marketType: string }

// ── Mark price fetch from Binance FAPI (cached) ───────────────────────────────
async function getMarkPrice(symbol: string): Promise<number | null> {
  const cached = MARK_PRICE_CACHE.get(symbol);
  if (cached && Date.now() - cached.ts < MARK_PRICE_TTL) return cached.price;
  try {
    const provSym = symbol.replace(/[/_]/g, '').replace('PERP', '');
    const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${provSym}`);
    if (!res.ok) return null;
    const d = await res.json() as { markPrice: string };
    const price = parseFloat(d.markPrice);
    MARK_PRICE_CACHE.set(symbol, { price, ts: Date.now() });
    return price;
  } catch { return null; }
}

// ── Shared order-book matching logic ─────────────────────────────────────────
async function matchOrderPair(
  buy: Order, sell: Order,
  matchPrice: number,
  marketType: 'spot' | 'futures',
): Promise<{ error?: string }> {
  const matchQty = Math.min(buy.remaining_qty, sell.remaining_qty);
  if (matchQty <= 0) return { error: 'zero qty' };

  const feeBuy  = matchQty * FEE_RATE;
  const feeSell = (matchQty * matchPrice) * FEE_RATE;

  if (marketType === 'spot') {
    const { error } = await supabase.rpc('settle_matched_orders', {
      p_buy_order_id:  buy.id,
      p_sell_order_id: sell.id,
      p_match_qty:     matchQty,
      p_match_price:   matchPrice,
      p_fee_buy:       feeBuy,
      p_fee_sell:      feeSell,
    });
    if (error) return { error: error.message };

    // Write double-entry ledger entries for this fill (idempotent)
    await supabase.rpc('record_spot_fill', {
      p_buy_order_id:  buy.id,
      p_sell_order_id: sell.id,
      p_buyer_id:      buy.user_id,
      p_seller_id:     sell.user_id,
      p_base_asset:    buy.base_asset,
      p_quote_asset:   buy.quote_asset,
      p_fill_qty:      matchQty,
      p_fill_price:    matchPrice,
      p_buy_fee:       feeBuy,
      p_sell_fee:      feeSell,
      p_fee_asset:     buy.fee_asset ?? buy.quote_asset,
    }).catch((e: unknown) => {
      // Non-fatal: ledger write failure should not block settlement
      console.error('[order-matcher] record_spot_fill failed:', e instanceof Error ? e.message : e);
    });

    return {};
  } else {
    // Futures: settle position (open or update) + debit margin
    const markPrice = await getMarkPrice(buy.symbol) ?? matchPrice;
    const { error } = await supabase.rpc('settle_matched_futures_orders', {
      p_buy_order_id:  buy.id,
      p_sell_order_id: sell.id,
      p_match_qty:     matchQty,
      p_match_price:   matchPrice,
      p_mark_price:    markPrice,
      p_fee_buy:       feeBuy,
      p_fee_sell:      feeSell,
    });
    return error ? { error: error.message } : {};
  }
}

async function matchSymbol(symbol: string, marketType: 'spot' | 'futures'): Promise<MatchResult> {
  const result: MatchResult = { symbol, matched: 0, errors: [], marketType };

  const baseQuery = supabase
    .from('orders')
    .select('id,user_id,symbol,base_asset,quote_asset,side,price,remaining_qty,filled_qty,fee_asset,leverage_v2,margin_mode,market_type_v2')
    .eq('symbol', symbol)
    .eq('order_type_v2', 'limit')
    .eq('status_v2', 'open')
    .eq('market_type_v2', marketType)
    .gt('remaining_qty', 0);

  const [{ data: buys, error: buyErr }, { data: sells, error: sellErr }] = await Promise.all([
    baseQuery.eq('side', 'buy').order('price',  { ascending: false }).limit(50),
    baseQuery.eq('side', 'sell').order('price', { ascending: true  }).limit(50),
  ]);

  if (buyErr)  { result.errors.push(`buy fetch: ${buyErr.message}`);  return result; }
  if (sellErr) { result.errors.push(`sell fetch: ${sellErr.message}`); return result; }

  const buyQueue  = (buys  ?? []) as Order[];
  const sellQueue = (sells ?? []) as Order[];

  let bi = 0, si = 0;
  while (bi < buyQueue.length && si < sellQueue.length) {
    const buy  = buyQueue[bi];
    const sell = sellQueue[si];

    if (buy.user_id === sell.user_id) { si++; continue; }
    if (buy.price < sell.price) break; // no compatible price

    // For futures: use mark price if available, else maker (sell) price
    let matchPrice = sell.price;
    if (marketType === 'futures') {
      const mp = await getMarkPrice(symbol);
      if (mp !== null) matchPrice = mp;
    }

    const { error: settleErr } = await matchOrderPair(buy, sell, matchPrice, marketType);
    if (settleErr) {
      result.errors.push(`settle ${buy.id.slice(0,8)}×${sell.id.slice(0,8)}: ${settleErr}`);
      si++;
      continue;
    }

    result.matched++;
    const matchQty = Math.min(buy.remaining_qty, sell.remaining_qty);
    buy.remaining_qty  -= matchQty; buy.filled_qty  += matchQty;
    sell.remaining_qty -= matchQty; sell.filled_qty += matchQty;
    if (buy.remaining_qty  <= 0) bi++;
    if (sell.remaining_qty <= 0) si++;
  }

  return result;
}

Deno.serve(async (_req) => {
  try {
    // Fetch distinct symbols with open limit orders on both spot and futures
    const { data: rows, error: symErr } = await supabase
      .from('orders')
      .select('symbol,market_type_v2')
      .eq('order_type_v2', 'limit')
      .eq('status_v2', 'open')
      .gt('remaining_qty', 0)
      .in('market_type_v2', ['spot', 'futures']);

    if (symErr) throw symErr;

    // Deduplicate symbol+marketType pairs
    const symbolMap = new Map<string, 'spot' | 'futures'>();
    for (const r of (rows ?? []) as { symbol: string; market_type_v2: 'spot' | 'futures' }[]) {
      symbolMap.set(`${r.market_type_v2}::${r.symbol}`, r.market_type_v2);
    }
    const tasks = [...symbolMap.entries()].map(([key, mt]) => ({
      symbol: key.split('::')[1],
      marketType: mt,
    }));

    const results = await Promise.all(tasks.map(t => matchSymbol(t.symbol, t.marketType)));
    const totalMatched  = results.reduce((s, r) => s + r.matched, 0);
    const allErrors     = results.flatMap(r => r.errors);
    const spotCount     = results.filter(r => r.marketType === 'spot').reduce((s,r) => s + r.matched, 0);
    const futuresCount  = results.filter(r => r.marketType === 'futures').reduce((s,r) => s + r.matched, 0);

    console.log(`[order-matcher] symbols=${tasks.length} spot=${spotCount} futures=${futuresCount} errors=${allErrors.length}`);
    if (allErrors.length > 0) console.error(allErrors.slice(0, 10).join('\n'));

    return new Response(JSON.stringify({
      ok: true, matched: totalMatched, spot: spotCount, futures: futuresCount,
      symbols: tasks.length, errors: allErrors.slice(0, 10),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[order-matcher] fatal:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

  matched: number;
