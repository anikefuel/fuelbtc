
-- ─── is_admin() helper ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- ─── wallets ─────────────────────────────────────────────────────────────────
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_wallets"   ON public.wallets;
DROP POLICY IF EXISTS "admins_all_wallets"  ON public.wallets;
CREATE POLICY "users_own_wallets"  ON public.wallets FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admins_all_wallets" ON public.wallets FOR ALL USING (public.is_admin());

-- ─── ledger_accounts ─────────────────────────────────────────────────────────
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_ledger_accounts"  ON public.ledger_accounts;
DROP POLICY IF EXISTS "admins_all_ledger_accounts" ON public.ledger_accounts;
CREATE POLICY "users_own_ledger_accounts"  ON public.ledger_accounts FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admins_all_ledger_accounts" ON public.ledger_accounts FOR ALL USING (public.is_admin());

-- ─── ledger_entries ──────────────────────────────────────────────────────────
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_ledger_entries"  ON public.ledger_entries;
DROP POLICY IF EXISTS "admins_all_ledger_entries" ON public.ledger_entries;
CREATE POLICY "users_own_ledger_entries"  ON public.ledger_entries FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "admins_all_ledger_entries" ON public.ledger_entries FOR ALL    USING (public.is_admin());

-- ─── withdrawals ─────────────────────────────────────────────────────────────
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_withdrawals"  ON public.withdrawals;
DROP POLICY IF EXISTS "admins_all_withdrawals" ON public.withdrawals;
CREATE POLICY "users_own_withdrawals"  ON public.withdrawals FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admins_all_withdrawals" ON public.withdrawals FOR ALL USING (public.is_admin());

-- ─── escrows ─────────────────────────────────────────────────────────────────
ALTER TABLE public.escrows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_party_escrow"  ON public.escrows;
DROP POLICY IF EXISTS "admins_all_escrows"  ON public.escrows;
CREATE POLICY "users_party_escrow"  ON public.escrows FOR ALL USING (buyer_id = auth.uid() OR seller_id = auth.uid());
CREATE POLICY "admins_all_escrows"  ON public.escrows FOR ALL USING (public.is_admin());

-- ─── p2p_trades ──────────────────────────────────────────────────────────────
ALTER TABLE public.p2p_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_party_trade"    ON public.p2p_trades;
DROP POLICY IF EXISTS "admins_all_p2p_trades" ON public.p2p_trades;
CREATE POLICY "users_party_trade"    ON public.p2p_trades FOR ALL USING (buyer_id = auth.uid() OR seller_id = auth.uid());
CREATE POLICY "admins_all_p2p_trades" ON public.p2p_trades FOR ALL USING (public.is_admin());

-- ─── exchange_provider_configs ────────────────────────────────────────────────
ALTER TABLE public.exchange_provider_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner_or_admin_provider_configs" ON public.exchange_provider_configs;
CREATE POLICY "owner_or_admin_provider_configs" ON public.exchange_provider_configs
  FOR ALL USING (user_id = auth.uid() OR public.is_admin());

-- ─── wallet_freezes ──────────────────────────────────────────────────────────
ALTER TABLE public.wallet_freezes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_freezes"  ON public.wallet_freezes;
DROP POLICY IF EXISTS "admins_all_freezes" ON public.wallet_freezes;
CREATE POLICY "users_own_freezes"  ON public.wallet_freezes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "admins_all_freezes" ON public.wallet_freezes FOR ALL    USING (public.is_admin());

-- ─── wallet_audit_logs ───────────────────────────────────────────────────────
ALTER TABLE public.wallet_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_audit_logs"  ON public.wallet_audit_logs;
DROP POLICY IF EXISTS "admins_all_audit_logs" ON public.wallet_audit_logs;
CREATE POLICY "users_own_audit_logs"  ON public.wallet_audit_logs
  FOR SELECT USING (actor_id = auth.uid() OR target_user_id = auth.uid());
CREATE POLICY "admins_all_audit_logs" ON public.wallet_audit_logs FOR ALL USING (public.is_admin());

-- ─── risk_flags ──────────────────────────────────────────────────────────────
ALTER TABLE public.risk_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_risk_flags"  ON public.risk_flags;
DROP POLICY IF EXISTS "admins_all_risk_flags" ON public.risk_flags;
CREATE POLICY "users_own_risk_flags"  ON public.risk_flags FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "admins_all_risk_flags" ON public.risk_flags FOR ALL    USING (public.is_admin());
