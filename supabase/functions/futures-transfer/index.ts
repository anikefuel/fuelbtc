// futures-transfer Edge Function
// Transfers USDT between spot and futures wallets via spot_to_futures_transfer RPC
// Validates balance, creates ledger entries atomically

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface TransferRequest {
  direction: 'spot_to_futures' | 'futures_to_spot';
  amount:    number;
  asset?:    string;
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const err = (s: number, code: string, msg: string) =>
  new Response(JSON.stringify({ error: { code, message: msg } }), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ok = (d: unknown) =>
  new Response(JSON.stringify(d), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return err(401, 'UNAUTHENTICATED', 'Missing token');
    const userSupa = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return err(401, 'UNAUTHENTICATED', 'Invalid token');
    const userId = user.id;

    let body: TransferRequest;
    try { body = await req.json(); } catch { return err(400, 'INVALID_JSON', 'Invalid JSON'); }
    const { direction, amount, asset = 'USDT' } = body;

    if (!direction || !amount) return err(400, 'MISSING_FIELDS', 'direction and amount required');
    if (!['spot_to_futures','futures_to_spot'].includes(direction)) {
      return err(400, 'INVALID_DIRECTION', 'direction must be spot_to_futures or futures_to_spot');
    }
    if (amount <= 0) return err(400, 'INVALID_AMOUNT', 'amount must be > 0');
    if (amount < 1) return err(400, 'AMOUNT_TOO_SMALL', 'Minimum transfer is 1 USDT');

    // Ensure futures wallet exists
    await svc.rpc('get_or_create_futures_wallet', { p_user_id: userId, p_asset: asset });

    // Execute transfer via SECURITY DEFINER RPC
    const { error: rpcErr } = await svc.rpc('spot_to_futures_transfer', {
      p_user_id:   userId,
      p_amount:    amount,
      p_asset:     asset,
      p_direction: direction,
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      if (msg.includes('Insufficient')) return err(400, 'INSUFFICIENT_BALANCE', msg);
      return err(500, 'TRANSFER_FAILED', msg);
    }

    // Return updated balances
    const { data: wallets } = await svc.from('wallets')
      .select('wallet_type,available_balance,locked_balance')
      .eq('user_id', userId).eq('asset', asset)
      .in('wallet_type', ['spot','futures']);

    const balanceMap: Record<string, { available: number; locked: number }> = {};
    for (const w of wallets ?? []) {
      balanceMap[w.wallet_type] = {
        available: Number(w.available_balance),
        locked:    Number(w.locked_balance),
      };
    }

    return ok({
      direction,
      amount,
      asset,
      spotBalance:    balanceMap.spot    ?? { available: 0, locked: 0 },
      futuresBalance: balanceMap.futures ?? { available: 0, locked: 0 },
    });

  } catch (e) {
    console.error('[futures-transfer] unhandled:', e);
    return err(500, 'INTERNAL_ERROR', (e as Error).message);
  }
});
