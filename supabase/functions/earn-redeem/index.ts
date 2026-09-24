// Edge Function: earn-redeem
// Validates JWT, calls redeem_earn RPC, returns payout amount
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

    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { subscription_id } = await req.json() as { subscription_id: string };
    if (!subscription_id) return json({ error: 'subscription_id required' }, 400);

    const { data, error } = await supabase.rpc('redeem_earn', {
      p_user_id: user.id,
      p_sub_id:  subscription_id,
    });

    if (error) return json({ error: error.message }, 400);
    return json({ payout: data });
  } catch (e) {
    console.error('[earn-redeem]', e);
    return json({ error: 'Internal server error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
