
-- Drop and recreate both functions since return type changes
DROP FUNCTION IF EXISTS public.save_provider_config(uuid,text,text,text,text,text,boolean,text[],text);
DROP FUNCTION IF EXISTS public.list_provider_configs_safe();

-- ─── save_provider_config ─────────────────────────────────────────────────────
-- Root cause of "column reference id is ambiguous":
--   RETURNS TABLE declares OUT param "id" which shadows exchange_provider_configs.id
--   inside the function body. Fix: rename OUT param to "cfg_id" + fully-qualify all
--   table column references with an alias.
CREATE FUNCTION public.save_provider_config(
  p_id           UUID    DEFAULT NULL,
  p_provider     TEXT    DEFAULT NULL,
  p_label        TEXT    DEFAULT NULL,
  p_api_key      TEXT    DEFAULT NULL,
  p_api_secret   TEXT    DEFAULT NULL,
  p_passphrase   TEXT    DEFAULT '',
  p_is_testnet   BOOLEAN DEFAULT FALSE,
  p_permissions  TEXT[]  DEFAULT '{}',
  p_notes        TEXT    DEFAULT ''
)
RETURNS TABLE (
  cfg_id          UUID,
  provider_name   TEXT,
  label           TEXT,
  is_active       BOOLEAN,
  is_testnet      BOOLEAN,
  has_key         BOOLEAN,
  permissions     TEXT[],
  notes           TEXT,
  health_status   TEXT,
  last_sync_at    TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  avg_response_ms INT,
  error_count     INT,
  sync_error      TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_record_id UUID;
  v_is_admin  BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = v_user_id AND p.role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_provider IS NULL OR trim(p_provider) = '' THEN
    RAISE EXCEPTION 'Provider name is required';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE exchange_provider_configs AS epc
    SET
      provider_name = COALESCE(NULLIF(trim(p_provider), ''), epc.provider_name),
      label         = COALESCE(NULLIF(trim(p_label),    ''), epc.label),
      api_key       = CASE WHEN p_api_key    IS NOT NULL AND trim(p_api_key)    <> '' THEN trim(p_api_key)    ELSE epc.api_key    END,
      api_secret    = CASE WHEN p_api_secret IS NOT NULL AND trim(p_api_secret) <> '' THEN trim(p_api_secret) ELSE epc.api_secret END,
      passphrase    = CASE WHEN p_passphrase IS NOT NULL AND trim(p_passphrase) <> '' THEN trim(p_passphrase) ELSE epc.passphrase END,
      is_testnet    = p_is_testnet,
      permissions   = p_permissions,
      notes         = p_notes,
      user_id       = v_user_id,
      updated_at    = now()
    WHERE epc.id = p_id
    RETURNING epc.id INTO v_record_id;

    IF v_record_id IS NULL THEN
      RAISE EXCEPTION 'Provider config not found: %', p_id;
    END IF;
  ELSE
    INSERT INTO exchange_provider_configs (
      provider_name, label, api_key, api_secret, passphrase,
      is_testnet, permissions, notes, user_id, is_active,
      health_status, error_count, ws_state, rest_fallback
    ) VALUES (
      trim(p_provider),
      COALESCE(NULLIF(trim(p_label), ''), trim(p_provider)),
      COALESCE(p_api_key,    ''),
      COALESCE(p_api_secret, ''),
      COALESCE(p_passphrase, ''),
      p_is_testnet, p_permissions, p_notes,
      v_user_id, TRUE,
      'unknown', 0, 'disconnected', FALSE
    ) RETURNING exchange_provider_configs.id INTO v_record_id;
  END IF;

  RETURN QUERY
    SELECT
      c.id            AS cfg_id,
      c.provider_name,
      c.label,
      c.is_active,
      c.is_testnet,
      (length(c.api_key) > 0) AS has_key,
      c.permissions,
      c.notes,
      c.health_status,
      c.last_sync_at, c.last_success_at, c.last_failure_at,
      c.avg_response_ms, c.error_count, c.sync_error,
      c.created_at, c.updated_at
    FROM exchange_provider_configs c
    WHERE c.id = v_record_id;
END;
$$;

-- ─── list_provider_configs_safe ───────────────────────────────────────────────
CREATE FUNCTION public.list_provider_configs_safe()
RETURNS TABLE (
  cfg_id          UUID,
  provider_name   TEXT,
  label           TEXT,
  is_active       BOOLEAN,
  is_testnet      BOOLEAN,
  has_key         BOOLEAN,
  permissions     TEXT[],
  notes           TEXT,
  health_status   TEXT,
  last_sync_at    TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  avg_response_ms INT,
  error_count     INT,
  sync_error      TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id            AS cfg_id,
    c.provider_name,
    c.label,
    c.is_active,
    c.is_testnet,
    (length(c.api_key) > 0) AS has_key,
    c.permissions,
    c.notes,
    c.health_status,
    c.last_sync_at, c.last_success_at, c.last_failure_at,
    c.avg_response_ms, c.error_count, c.sync_error,
    c.created_at, c.updated_at
  FROM exchange_provider_configs c
  WHERE EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
  ORDER BY c.created_at DESC;
$$;
