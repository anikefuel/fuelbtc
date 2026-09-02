// p2p-trade-create Edge Function
// Server-side trade creation:
// - Validates all pre-conditions (self-trade, duplicate, ad active, limits, balance)
// - Calls p2p_create_trade RPC atomically
// - Sends in-app notifications to both parties
// - Returns { tradeId }

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_H = { ...CORS, 'Content-Type': 'application/json' };

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: JSON_H });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return err('Method not allowed', 405);

  // ─── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return err('Missing Authorization', 401);
  const { data: { user }, error: authErr } = await svc.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) return err('Not authenticated', 401);

  // ─── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('Invalid JSON'); }

  const { adId, cryptoAmount, fiatAmount, paymentMethod } = body as {
    adId: string; cryptoAmount: number; fiatAmount: number; paymentMethod: string;
  };

  if (!adId || !cryptoAmount || !fiatAmount || !paymentMethod) {
    return err('adId, cryptoAmount, fiatAmount, paymentMethod required');
  }
  if (cryptoAmount <= 0 || fiatAmount <= 0) return err('Amounts must be positive');

  // ─── Load ad with merchant ─────────────────────────────────────────────────
  const { data: ad, error: adErr } = await svc
    .from('p2p_ads')
    .select('*, p2p_merchants!merchant_id(user_id, display_name, is_suspended)')
    .eq('id', adId)
    .single();
  if (adErr || !ad) return err('Ad not found', 404);

  type AdRow = {
    status: string; side: string; asset: string; fiat: string;
    min_limit: number; max_limit: number; available_amount: number;
    payment_methods: string[]; merchant_id: string;
    p2p_merchants: { user_id: string; display_name: string; is_suspended: boolean } | null;
  };
  const adRow = ad as unknown as AdRow;

  if (adRow.status !== 'active') return err('Ad is not currently active');
  if (adRow.available_amount < cryptoAmount) return err('Insufficient ad liquidity');
  if (fiatAmount < adRow.min_limit) return err(`Minimum order is ${adRow.min_limit} ${adRow.fiat}`);
  if (fiatAmount > adRow.max_limit) return err(`Maximum order is ${adRow.max_limit} ${adRow.fiat}`);
  if (!adRow.payment_methods.includes(paymentMethod)) return err('Payment method not supported by this ad');

  const merchant = adRow.p2p_merchants;
  if (!merchant) return err('Merchant not found');
  if (merchant.is_suspended) return err('Merchant is suspended');

  // ─── Self-trade prevention ─────────────────────────────────────────────────
  if (merchant.user_id === user.id) return err('You cannot trade with your own ad');

  // ─── Duplicate trade prevention ────────────────────────────────────────────
  const { data: dupTrade } = await svc
    .from('p2p_trades')
    .select('id')
    .eq('ad_id', adId)
    .eq('buyer_id', user.id)
    .in('status', ['pending', 'awaiting_payment', 'payment_marked', 'awaiting_release'])
    .limit(1)
    .maybeSingle();
  if (dupTrade) return err('You already have an active trade for this ad');

  // ─── Call atomic RPC ──────────────────────────────────────────────────────
  const { data: tradeId, error: rpcErr } = await svc.rpc('p2p_create_trade', {
    p_ad_id:          adId,
    p_buyer_id:       user.id,
    p_crypto_amount:  cryptoAmount,
    p_fiat_amount:    fiatAmount,
    p_payment_method: paymentMethod,
  });
  if (rpcErr) return err(rpcErr.message, 500);

  // ─── Fetch trade number for notifications ─────────────────────────────────
  const { data: tradeRow } = await svc
    .from('p2p_trades')
    .select('trade_number')
    .eq('id', tradeId as string)
    .single();
  const tradeNumber = (tradeRow as { trade_number?: string } | null)?.trade_number ?? (tradeId as string).slice(0, 8);

  // ─── Notifications ─────────────────────────────────────────────────────────
  await svc.from('p2p_notifications').insert([
    {
      user_id:  merchant.user_id,
      trade_id: tradeId,
      type:     'new_order',
      title:    'New P2P Order 📩',
      body:     `${user.email?.split('@')[0] ?? 'A buyer'} wants to ${adRow.side === 'sell' ? 'buy' : 'sell'} ${cryptoAmount} ${adRow.asset}. Trade #${tradeNumber}.`,
    },
    {
      user_id:  user.id,
      trade_id: tradeId,
      type:     'new_order',
      title:    'Trade Started',
      body:     `Your trade #${tradeNumber} for ${cryptoAmount} ${adRow.asset} has been created. Complete payment within the window.`,
    },
  ]);

  return new Response(
    JSON.stringify({ tradeId }),
    { status: 201, headers: JSON_H },
  );
});
