// p2p-escrow-refund Edge Function
// Refunds escrowed crypto back to the seller.
// Called by: buyer cancellation (before payment), system expiry, admin refund.
// - Validates identity (buyer can cancel before payment, admin can always refund)
// - Calls p2p_refund_escrow_secure (SECURITY DEFINER) which handles all ledger
//   double-entries, wallet updates, notifications, and status changes
// - Idempotent: if already refunded/cancelled, returns success silently

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

function errResp(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: JSON_H });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return errResp('Method not allowed', 405);

  // ─── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errResp('Missing Authorization', 401);
  const { data: { user }, error: authErr } = await svc.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) return errResp('Not authenticated', 401);

  // ─── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON'); }

  const { tradeId, reason = 'Cancelled by user' } = body as { tradeId: string; reason?: string };
  if (!tradeId) return errResp('tradeId required');

  // ─── Load trade ────────────────────────────────────────────────────────────
  const { data: trade, error: te } = await svc
    .from('p2p_trades')
    .select('seller_id, buyer_id, status, escrow_released')
    .eq('id', tradeId)
    .single();
  if (te || !trade) return errResp('Trade not found', 404);

  type TradeRow = {
    seller_id: string; buyer_id: string;
    status: string; escrow_released: boolean;
  };
  const t = trade as unknown as TradeRow;

  // ─── Check admin role ─────────────────────────────────────────────────────
  const { data: roleRow } = await svc
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isAdmin = (roleRow as { role?: string } | null)?.role === 'admin';

  // ─── Permission checks ────────────────────────────────────────────────────
  if (!isAdmin) {
    if (t.buyer_id !== user.id && t.seller_id !== user.id) {
      return errResp('Access denied', 403);
    }
    // Buyer can cancel only before payment is marked
    if (t.buyer_id === user.id && !['pending', 'awaiting_payment'].includes(t.status)) {
      return errResp('Cannot cancel after payment has been marked. Please open a dispute.');
    }
    // Seller cannot unilaterally cancel after buyer marked payment
    if (t.seller_id === user.id && ['payment_marked', 'awaiting_release', 'released'].includes(t.status)) {
      return errResp('Cannot cancel at this trade stage. Open a dispute if needed.');
    }
  }

  // ─── Idempotency ─────────────────────────────────────────────────────────
  if (t.escrow_released || ['released', 'refunded', 'cancelled', 'expired'].includes(t.status)) {
    return new Response(JSON.stringify({ success: true, note: 'already_settled' }), { headers: JSON_H });
  }

  // ─── Call atomic cancel RPC (which internally calls refund_escrow_secure) ──
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { error: cancelErr } = await userClient.rpc('p2p_cancel_trade', {
    p_trade_id: tradeId,
    p_reason:   reason,
  });

  if (cancelErr) {
    console.error(`[p2p-escrow-refund] rpc error trade=${tradeId}: ${cancelErr.message}`);
    return errResp(cancelErr.message, 500);
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: JSON_H },
  );
});
