
-- ── Withdrawal Address Whitelist ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.withdrawal_whitelist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label         text NOT NULL,
  network       text NOT NULL,
  address       text NOT NULL,
  is_verified   boolean NOT NULL DEFAULT false,
  whitelisted_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.withdrawal_whitelist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whitelist_select_own" ON public.withdrawal_whitelist
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "whitelist_insert_own" ON public.withdrawal_whitelist
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "whitelist_delete_own" ON public.withdrawal_whitelist
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "whitelist_update_own" ON public.withdrawal_whitelist
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS withdrawal_whitelist_user_idx ON public.withdrawal_whitelist(user_id);

-- ── Ensure user_sessions INSERT policy is in place ────────────────────
DROP POLICY IF EXISTS "Users insert own sessions" ON public.user_sessions;
CREATE POLICY "Users insert own sessions" ON public.user_sessions
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users update own sessions" ON public.user_sessions;
CREATE POLICY "Users update own sessions" ON public.user_sessions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
