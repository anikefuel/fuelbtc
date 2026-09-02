// p2p-escrow-release Edge Function
// Seller releases escrowed crypto to buyer.
// - Validates seller identity and trade state
// - Optionally validates step-up token
// - Calls p2p_release_escrow_secure (SECURITY DEFINER) which handles
//   all ledger double-entries, wallet updates, notifications, and status
// - Idempotent: if already released, returns success silently

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

  const { tradeId, stepUpTokenId } = body as { tradeId: string; stepUpTokenId?: string };
  if (!tradeId) return errResp('tradeId required');

  // ─── Load trade ────────────────────────────────────────────────────────────
  const { data: trade, error: te } = await svc
    .from('p2p_trades')
    .select('seller_id, buyer_id, status, escrow_released, asset, crypto_amount, trade_number')
    .eq('id', tradeId)
    .single();
  if (te || !trade) return errResp('Trade not found', 404);

  type TradeRow = {
    seller_id: string; buyer_id: string; status: string;
    escrow_released: boolean; asset: string; crypto_amount: number; trade_number: string;
  };
  const t = trade as unknown as TradeRow;

  // ─── Pre-flight checks ────────────────────────────────────────────────────
  if (t.seller_id !== user.id) return errResp('Only the seller can release escrow', 403);
  if (t.escrow_released) {
    // Already released — idempotent success
    return new Response(JSON.stringify({ success: true, note: 'already_released' }), { headers: JSON_H });
  }
  if (!['payment_marked', 'awaiting_release', 'disputed'].includes(t.status)) {
    return errResp(`Cannot release in state: ${t.status}`);
  }

  // ─── Step-up token validation ─────────────────────────────────────────────
  if (stepUpTokenId) {
    const { data: token } = await svc
      .from('step_up_tokens')
      .select('id, used_at, expires_at, action_type, user_id')
      .eq('id', stepUpTokenId)
      .maybeSingle();

    type TokenRow = { id: string; used_at: string | null; expires_at: string; action_type: string; user_id: string };
    const tok = token as unknown as TokenRow | null;

    if (!tok) return errResp('Step-up token not found', 403);
    if (tok.user_id !== user.id) return errResp('Step-up token does not belong to this user', 403);
    if (tok.used_at) return errResp('Step-up token already used', 403);
    if (new Date(tok.expires_at) < new Date()) return errResp('Step-up token expired', 403);
    if (tok.action_type !== 'p2p_escrow_release') return errResp('Step-up token invalid action type', 403);

    // Mark used
    await svc.from('step_up_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', stepUpTokenId);
  }

  // ─── Call atomic release RPC ───────────────────────────────────────────────
  // The RPC runs as SECURITY DEFINER so auth.uid() will be seller in the SQL context.
  // We call it with the service role client but pass the user JWT to the RPC via
  // a user-scoped client for proper auth.uid() resolution.
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { error: releaseErr } = await userClient.rpc('p2p_release_escrow_secure', {
    p_trade_id:   tradeId,
    p_step_token: stepUpTokenId ?? null,
  });

  if (releaseErr) {
    console.error(`[p2p-escrow-release] rpc error trade=${tradeId}: ${releaseErr.message}`);
    return errResp(releaseErr.message, 500);
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: JSON_H },
  );
});
