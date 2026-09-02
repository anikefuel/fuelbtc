// Edge Function: earn-accrue-yield
// Scheduled daily (cron) — calls accrue_earn_yield() to mint one yield entry per active subscription
// Also auto-matures fixed subscriptions that have passed their maturity date
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Allow cron scheduler (no auth header) OR service role callers
  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (authHeader && !authHeader.includes('service_role')) {
    // Validate it's a service role token or internal scheduler call
    const isScheduler = req.headers.get('x-scheduler-token') === serviceKey;
    if (!isScheduler) return json({ error: 'Forbidden' }, 403);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  );

  try {
    // 1. Accrue daily yield for all active subscriptions
    const { data: accrued, error: accrueErr } = await supabase.rpc('accrue_earn_yield');
    if (accrueErr) throw new Error(`accrue_earn_yield: ${accrueErr.message}`);

    // 2. Auto-mature fixed subscriptions past maturity_at
    const { data: matured, error: matureErr } = await supabase
      .from('earn_subscriptions')
      .update({ status: 'matured', updated_at: new Date().toISOString() })
      .eq('status', 'active')
      .not('maturity_at', 'is', null)
      .lt('maturity_at', new Date().toISOString())
      .select('id');
    if (matureErr) console.warn('[earn-accrue-yield] auto-mature error:', matureErr.message);

    console.log(`[earn-accrue-yield] accrued=${accrued} matured=${matured?.length ?? 0}`);
    return json({ accrued, matured: matured?.length ?? 0 });
  } catch (e) {
    console.error('[earn-accrue-yield]', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
