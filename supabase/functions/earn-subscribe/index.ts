// Edge Function: earn-subscribe
// Validates JWT, calls subscribe_earn RPC (idempotent), returns subscription id
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resolve caller user
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json() as { product_id: string; amount: number; idempotency_key: string };
    const { product_id, amount, idempotency_key } = body;

    if (!product_id || !amount || !idempotency_key) {
      return json({ error: 'product_id, amount, idempotency_key required' }, 400);
    }

    const { data, error } = await supabase.rpc('subscribe_earn', {
      p_user_id:     user.id,
      p_product_id:  product_id,
      p_amount:      amount,
      p_idempotency: idempotency_key,
    });

    if (error) return json({ error: error.message }, 400);
    return json({ subscription_id: data });
  } catch (e) {
    console.error('[earn-subscribe]', e);
    return json({ error: 'Internal server error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
