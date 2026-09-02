// spot-pairs Edge Function
// Fetches Binance exchange info for supported spot pairs and syncs precision/filter data
// into trading_pairs table. Called by pg_cron every 6 hours and on-demand from admin.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BINANCE_SPOT  = 'https://api.binance.com';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const SUPPORTED_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'DOGEUSDT','TRXUSDT','LTCUSDT','USDCUSDT',
];

interface BinanceFilter {
  filterType: string;
  minPrice?: string; maxPrice?: string; tickSize?: string;
  minQty?: string;   maxQty?: string;   stepSize?: string;
  minNotional?: string; notional?: string;
}

interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quotePrecision: number;
  isSpotTradingAllowed: boolean;
  filters: BinanceFilter[];
}

interface ExchangeInfoResponse {
  symbols: BinanceSymbolInfo[];
}

function getFilter(filters: BinanceFilter[], type: string): BinanceFilter | undefined {
  return filters.find(f => f.filterType === type);
}

function parseVal(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function countDecimals(v: string | undefined): number {
  if (!v) return 2;
  const s = v.replace(/0+$/, '');
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' } });
  }

  try {
    const symbolsParam = SUPPORTED_SYMBOLS.join(',');
    const url = `${BINANCE_SPOT}/api/v3/exchangeInfo?symbols=["${SUPPORTED_SYMBOLS.join('","')}"]`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Binance exchangeInfo HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as ExchangeInfoResponse;

    const results: { symbol: string; status: string }[] = [];
    const errors:  string[] = [];

    for (const s of data.symbols ?? []) {
      if (!SUPPORTED_SYMBOLS.includes(s.symbol)) continue;

      const priceFilter   = getFilter(s.filters, 'PRICE_FILTER');
      const lotFilter     = getFilter(s.filters, 'LOT_SIZE');
      const notionalFilter = getFilter(s.filters, 'NOTIONAL') ?? getFilter(s.filters, 'MIN_NOTIONAL');

      const tickSize   = parseVal(priceFilter?.tickSize);
      const stepSize   = parseVal(lotFilter?.stepSize);
      const minQty     = parseVal(lotFilter?.minQty);
      const maxQty     = parseVal(lotFilter?.maxQty);
      const minNotional = parseVal(notionalFilter?.minNotional ?? notionalFilter?.notional) ?? 10;

      const pricePrecision = countDecimals(priceFilter?.tickSize);
      const qtyPrecision   = countDecimals(lotFilter?.stepSize);
      const isSpotOk       = s.isSpotTradingAllowed && s.status === 'TRADING';

      const { error } = await supabase
        .from('trading_pairs')
        .upsert({
          symbol:           s.symbol,
          base_asset:       s.baseAsset,
          quote_asset:      s.quoteAsset,
          binance_symbol:   s.symbol,
          provider_symbol:  s.symbol,
          is_spot_ok:       isSpotOk,
          tick_size:        tickSize,
          step_size:        stepSize,
          min_qty:          minQty ?? 0.00001,
          max_qty:          maxQty,
          min_notional:     minNotional,
          price_precision:  pricePrecision,
          qty_precision:    qtyPrecision,
          binance_filters:  { filters: s.filters },
          last_filter_sync: new Date().toISOString(),
          status_v2:        isSpotOk ? 'active' : 'suspended',
        }, { onConflict: 'symbol' });

      if (error) {
        errors.push(`${s.symbol}: ${error.message}`);
      } else {
        results.push({ symbol: s.symbol, status: isSpotOk ? 'synced' : 'suspended' });
      }
    }

    console.log(`[spot-pairs] synced=${results.length} errors=${errors.length}`);
    return new Response(
      JSON.stringify({ ok: true, synced: results.length, results, errors }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[spot-pairs] fatal:', msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );
  }
});

// silence unused import warning
void symbolsParam;
