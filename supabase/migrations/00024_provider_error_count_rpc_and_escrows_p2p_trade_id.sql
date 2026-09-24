
-- Helper: atomically increment provider error_count
CREATE OR REPLACE FUNCTION increment_provider_error_count(p_config_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE exchange_provider_configs
    SET error_count = error_count + 1,
        updated_at  = now()
  WHERE id = p_config_id;
$$;

-- Ensure escrows.p2p_trade_id column exists (needed by p2p_lock_escrow)
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS p2p_trade_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS escrows_p2p_trade_id_uq ON escrows(p2p_trade_id)
  WHERE p2p_trade_id IS NOT NULL;

-- Update exchange_provider_configs.user_id FK to reference profiles
ALTER TABLE exchange_provider_configs
  DROP CONSTRAINT IF EXISTS exchange_provider_configs_user_id_fkey;
ALTER TABLE exchange_provider_configs
  ADD CONSTRAINT exchange_provider_configs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Ensure ledger_accounts has unique(user_id, asset) for ON CONFLICT
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_user_id_asset_key;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ledger_accounts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%user_id, asset%'
  ) THEN
    ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_user_asset_uq UNIQUE (user_id, asset);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add tx_hash column to withdrawals if missing
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS tx_hash text;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- wallet_lock / wallet_unlock helper stubs (if not already defined)
CREATE OR REPLACE FUNCTION wallet_lock(
  p_user_id       uuid,
  p_asset         text,
  p_amount        numeric,
  p_wallet_type   text DEFAULT 'spot',
  p_reference_id  uuid DEFAULT NULL,
  p_reason        text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Lock in wallets table
  UPDATE wallets
    SET balance        = GREATEST(0, balance - p_amount),
        locked_balance = locked_balance + p_amount,
        updated_at     = now()
  WHERE user_id = p_user_id
    AND wallet_type = p_wallet_type::wallet_type
    AND asset = p_asset
    AND balance >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient available balance for % %', p_amount, p_asset;
  END IF;

  -- Lock in ledger_accounts
  UPDATE ledger_accounts
    SET available_balance = GREATEST(0, available_balance - p_amount),
        locked_balance    = locked_balance + p_amount,
        updated_at        = now()
  WHERE user_id = p_user_id AND asset = p_asset;
END;
$$;

CREATE OR REPLACE FUNCTION wallet_unlock(
  p_user_id       uuid,
  p_asset         text,
  p_amount        numeric,
  p_wallet_type   text DEFAULT 'spot',
  p_reference_id  uuid DEFAULT NULL,
  p_reason        text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE wallets
    SET balance        = balance + p_amount,
        locked_balance = GREATEST(0, locked_balance - p_amount),
        updated_at     = now()
  WHERE user_id = p_user_id
    AND wallet_type = p_wallet_type::wallet_type
    AND asset = p_asset;

  UPDATE ledger_accounts
    SET available_balance = available_balance + p_amount,
        locked_balance    = GREATEST(0, locked_balance - p_amount),
        updated_at        = now()
  WHERE user_id = p_user_id AND asset = p_asset;
END;
$$;
