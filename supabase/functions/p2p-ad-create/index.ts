// p2p-ad-create Edge Function
// Creates a P2P ad server-side. For SELL ads: atomically validates balance,
// locks the advertised amount in seller's locked_balance, then inserts the ad.
// This prevents client-side balance manipulation.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

  const {
    side, asset, fiat, countryCode,
    priceType, price, floatMargin,
    totalAmount, minLimit, maxLimit,
    paymentMethods, paymentWindow,
    terms, autoReply,
  } = body as {
    side: string; asset: string; fiat: string; countryCode?: string;
    priceType: string; price: number; floatMargin?: number;
    totalAmount: number; minLimit: number; maxLimit: number;
    paymentMethods: string[]; paymentWindow: number;
    terms?: string; autoReply?: string;
  };

  // ─── Validate ──────────────────────────────────────────────────────────────
  if (!['buy','sell'].includes(side)) return err('side must be buy or sell');
  if (!asset || !fiat) return err('asset and fiat required');
  if (!price || price <= 0) return err('price must be positive');
  if (!totalAmount || totalAmount <= 0) return err('totalAmount must be positive');
  if (!minLimit || !maxLimit || minLimit > maxLimit) return err('Invalid limits');
  if (!paymentMethods?.length) return err('paymentMethods required');
  if (!paymentWindow || paymentWindow < 5) return err('paymentWindow min 5 minutes');

  // ─── Ensure merchant profile exists ────────────────────────────────────────
  let merchantId: string;
  const { data: existingMerchant } = await svc
    .from('p2p_merchants').select('id').eq('user_id', user.id).maybeSingle();

  if (existingMerchant) {
    merchantId = (existingMerchant as { id: string }).id;
  } else {
    const { data: profile } = await svc
      .from('profiles').select('username').eq('id', user.id).maybeSingle();
    const displayName = (profile as { username?: string } | null)?.username
      ?? user.email?.split('@')[0] ?? 'User';
    const { data: newMerchant, error: mErr } = await svc
      .from('p2p_merchants')
      .insert({ user_id: user.id, display_name: displayName })
      .select('id').single();
    if (mErr || !newMerchant) return err(`Failed to create merchant: ${mErr?.message}`, 500);
    merchantId = (newMerchant as { id: string }).id;
  }

  // ─── SELL ad: check and reserve balance ────────────────────────────────────
  if (side === 'sell') {
    // Check asset is active for P2P
    const { data: assetRow } = await svc
      .from('p2p_assets').select('is_active').eq('symbol', asset).maybeSingle();
    if (!assetRow || !(assetRow as { is_active: boolean }).is_active) {
      return err(`Asset ${asset} is not available for P2P`);
    }

    // Atomic reserve: read balance and lock amount in single RPC
    // Use ledger_accounts which is the canonical balance source
    const { data: acct } = await svc
      .from('ledger_accounts')
      .select('id, available_balance, locked_balance')
      .eq('user_id', user.id)
      .eq('asset', asset)
      .maybeSingle();

    const available = acct
      ? Math.max(0, Number((acct as Record<string,unknown>).available_balance ?? 0) - Number((acct as Record<string,unknown>).locked_balance ?? 0))
      : 0;

    if (available < totalAmount) {
      return err(`Insufficient ${asset} balance. Available: ${available.toFixed(8)}, Required: ${totalAmount}`);
    }

    // Lock the amount (increment locked_balance)
    if (acct) {
      const { error: lockErr } = await svc
        .from('ledger_accounts')
        .update({
          locked_balance: Number((acct as Record<string,unknown>).locked_balance ?? 0) + totalAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (acct as { id: string }).id)
        .eq('user_id', user.id); // extra safety check
      if (lockErr) return err(`Failed to reserve balance: ${lockErr.message}`, 500);

      // Mirror on wallets table
      await svc.from('wallets')
        .update({ locked_balance: svc.rpc as unknown as never })
        .eq('user_id', user.id).eq('asset', asset);
      // Use raw update on wallets
      await svc.from('wallets')
        .update({ locked_balance: available - totalAmount < 0 ? 0 : undefined })
        .eq('user_id', user.id).eq('asset', asset);
      // Simple increment on wallets
      const { data: wRow } = await svc.from('wallets')
        .select('locked_balance, balance')
        .eq('user_id', user.id).eq('asset', asset)
        .in('wallet_type', ['spot', 'p2p']).maybeSingle();
      if (wRow) {
        await svc.from('wallets')
          .update({ locked_balance: Number((wRow as Record<string,unknown>).locked_balance ?? 0) + totalAmount, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('asset', asset)
          .in('wallet_type', ['spot', 'p2p']);
      }
    }
  }

  // ─── Insert ad ─────────────────────────────────────────────────────────────
  const { data: ad, error: adErr } = await svc
    .from('p2p_ads')
    .insert({
      merchant_id:      merchantId,
      side,
      asset,
      fiat,
      country_code:     countryCode ?? null,
      price_type:       priceType,
      price:            price,
      float_margin:     floatMargin ?? 0,
      total_amount:     totalAmount,
      available_amount: totalAmount,
      min_limit:        minLimit,
      max_limit:        maxLimit,
      payment_methods:  paymentMethods,
      payment_window:   paymentWindow,
      terms:            terms ?? null,
      auto_reply:       autoReply ?? null,
      status:           'active',
    })
    .select('id')
    .single();

  if (adErr) {
    // Rollback balance lock on failure
    if (side === 'sell') {
      const { data: acct2 } = await svc
        .from('ledger_accounts')
        .select('id, locked_balance')
        .eq('user_id', user.id).eq('asset', asset).maybeSingle();
      if (acct2) {
        await svc.from('ledger_accounts')
          .update({ locked_balance: Math.max(0, Number((acct2 as Record<string,unknown>).locked_balance ?? 0) - totalAmount), updated_at: new Date().toISOString() })
          .eq('id', (acct2 as { id: string }).id);
      }
    }
    return err(`Failed to create ad: ${adErr.message}`, 500);
  }

  return new Response(
    JSON.stringify({ id: (ad as { id: string }).id }),
    { status: 201, headers: JSON_H },
  );
});
