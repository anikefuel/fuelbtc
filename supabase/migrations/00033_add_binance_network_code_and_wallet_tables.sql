-- Add binance_network column to asset_networks for correct Binance API mapping
ALTER TABLE asset_networks ADD COLUMN IF NOT EXISTS binance_network TEXT;

-- Map internal network names to Binance capital API network codes
UPDATE asset_networks SET binance_network = CASE
  WHEN network = 'ethereum'  THEN 'ETH'
  WHEN network = 'tron'      THEN 'TRX'
  WHEN network = 'bsc'       THEN 'BSC'
  WHEN network = 'solana'    THEN 'SOL'
  WHEN network = 'bitcoin'   THEN 'BTC'
  WHEN network = 'xrp'       THEN 'XRP'
  WHEN network = 'litecoin'  THEN 'LTC'
  WHEN network = 'dogecoin'  THEN 'DOGE'
  WHEN network = 'polygon'   THEN 'MATIC'
  WHEN network = 'arbitrum'  THEN 'ARBITRUM'
  WHEN network = 'optimism'  THEN 'OPTIMISM'
  ELSE UPPER(network)
END
WHERE binance_network IS NULL;

-- Fix XRP memo requirement
UPDATE asset_networks SET has_memo = true, memo_label = 'Destination Tag' WHERE network = 'xrp';

-- Ensure deposit_addresses table has extra columns
ALTER TABLE deposit_addresses ADD COLUMN IF NOT EXISTS binance_network TEXT;
ALTER TABLE deposit_addresses ADD COLUMN IF NOT EXISTS provider_config_id UUID REFERENCES exchange_provider_configs(id) ON DELETE SET NULL;

-- Create wallet_provider_status table
CREATE TABLE IF NOT EXISTS wallet_provider_status (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id         UUID NOT NULL REFERENCES exchange_provider_configs(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'unknown',
  deposit_enabled   BOOLEAN NOT NULL DEFAULT false,
  withdraw_enabled  BOOLEAN NOT NULL DEFAULT false,
  spot_enabled      BOOLEAN NOT NULL DEFAULT false,
  futures_enabled   BOOLEAN NOT NULL DEFAULT false,
  permissions       TEXT[] DEFAULT '{}',
  latency_ms        INTEGER,
  error_message     TEXT,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(config_id)
);

-- Drop and recreate upsert_wallet_provider_status to allow default changes
DROP FUNCTION IF EXISTS upsert_wallet_provider_status(UUID,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT[],INTEGER,TEXT);

CREATE OR REPLACE FUNCTION upsert_wallet_provider_status(
  p_config_id        UUID,
  p_status           TEXT,
  p_deposit_enabled  BOOLEAN,
  p_withdraw_enabled BOOLEAN,
  p_spot_enabled     BOOLEAN,
  p_futures_enabled  BOOLEAN,
  p_permissions      TEXT[],
  p_latency_ms       INTEGER,
  p_error_message    TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO wallet_provider_status (config_id, status, deposit_enabled, withdraw_enabled, spot_enabled, futures_enabled, permissions, latency_ms, error_message, checked_at)
  VALUES (p_config_id, p_status, p_deposit_enabled, p_withdraw_enabled, p_spot_enabled, p_futures_enabled, COALESCE(p_permissions,'{}'), p_latency_ms, p_error_message, NOW())
  ON CONFLICT (config_id) DO UPDATE SET
    status           = EXCLUDED.status,
    deposit_enabled  = EXCLUDED.deposit_enabled,
    withdraw_enabled = EXCLUDED.withdraw_enabled,
    spot_enabled     = EXCLUDED.spot_enabled,
    futures_enabled  = EXCLUDED.futures_enabled,
    permissions      = EXCLUDED.permissions,
    latency_ms       = EXCLUDED.latency_ms,
    error_message    = EXCLUDED.error_message,
    checked_at       = NOW();
END;
$$;

-- RLS
ALTER TABLE wallet_provider_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_provider_status" ON wallet_provider_status;
CREATE POLICY "auth_read_provider_status" ON wallet_provider_status FOR SELECT TO authenticated USING (true);

ALTER TABLE asset_networks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_asset_networks" ON asset_networks;
CREATE POLICY "auth_read_asset_networks" ON asset_networks FOR SELECT TO authenticated USING (is_active = true);