
-- ============================================================
-- Admin verification report — shows all diagnostic data
-- for the admin console. SECURITY DEFINER bypasses RLS.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_verification_report()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_user_role      user_role;
  v_report         JSONB;
BEGIN
  -- Check admin access
  SELECT role INTO v_user_role FROM public.profiles WHERE id = v_user_id;
  IF v_user_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'admin_uuid',           v_user_id,
    'admin_role',           v_user_role,
    'auth_users',           (SELECT COUNT(*)::INT FROM auth.users),
    'profiles',             (SELECT COUNT(*)::INT FROM public.profiles),
    'profiles_admin',       (SELECT COUNT(*)::INT FROM public.profiles WHERE role = 'admin'),
    'profiles_missing_auth',(SELECT COUNT(*)::INT FROM public.profiles p
                             WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)),
    'kyc_attempts',         (SELECT COUNT(*)::INT FROM public.kyc_attempts),
    'kyc_attempts_pending', (SELECT COUNT(*)::INT FROM public.kyc_attempts WHERE status = 'pending'),
    'kyc_attempts_in_progress', (SELECT COUNT(*)::INT FROM public.kyc_attempts WHERE status = 'in_progress'),
    'kyc_attempts_verified',(SELECT COUNT(*)::INT FROM public.kyc_attempts WHERE status = 'verified'),
    'kyc_attempts_failed',  (SELECT COUNT(*)::INT FROM public.kyc_attempts WHERE status = 'failed'),
    'kyc_submissions',      (SELECT COUNT(*)::INT FROM public.kyc_submissions),
    'webhooks_total',       (SELECT COUNT(*)::INT FROM public.webhook_audit_log),
    'webhooks_failed',      (SELECT COUNT(*)::INT FROM public.webhook_audit_log WHERE status = 'failed'),
    'withdrawals',          (SELECT COUNT(*)::INT FROM public.withdrawals),
    'p2p_disputes',         (SELECT COUNT(*)::INT FROM public.p2p_disputes),
    'dojah_provider',       (SELECT jsonb_build_object(
                               'health_status',  health_status,
                               'failure_count',  failure_count,
                               'last_error',     last_error,
                               'widget_id',      config->>'widget_id',
                               'enabled',        enabled
                             ) FROM public.kyc_providers WHERE provider_name = 'dojah' LIMIT 1),
    'rls_policies_check',   (SELECT jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname))
                             FROM pg_policies
                             WHERE tablename IN ('kyc_attempts','kyc_submissions','profiles','kyc_providers','webhook_audit_log')),
    'generated_at',         NOW()
  ) INTO v_report;

  RETURN v_report;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_admin_verification_report() TO authenticated;
