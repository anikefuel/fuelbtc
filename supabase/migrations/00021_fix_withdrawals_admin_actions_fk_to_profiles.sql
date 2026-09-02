
-- ── 1. Re-point withdrawals.user_id FK → profiles.id ──────────────────────────
-- profiles.id = auth.users.id (enforced by trigger), so this is safe.
ALTER TABLE withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_user_id_fkey,
  ADD  CONSTRAINT withdrawals_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- reviewed_by also references auth.users — point to profiles for consistent joins
ALTER TABLE withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_reviewed_by_fkey,
  ADD  CONSTRAINT withdrawals_reviewed_by_fkey
       FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- ── 2. Re-point admin_actions.admin_id FK → profiles.id ───────────────────────
ALTER TABLE admin_actions
  DROP CONSTRAINT IF EXISTS admin_actions_admin_id_fkey,
  ADD  CONSTRAINT admin_actions_admin_id_fkey
       FOREIGN KEY (admin_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ── 3. Add unique constraint on wallets for upsert ────────────────────────────
-- binance-sync needs onConflict: 'user_id,asset,wallet_type'
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_user_asset_type_uq;
ALTER TABLE wallets ADD CONSTRAINT wallets_user_asset_type_uq
  UNIQUE (user_id, asset, wallet_type);

-- ── 4. Add wallets.updated_at if not present ──────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='wallets' AND column_name='updated_at'
  ) THEN
    ALTER TABLE wallets ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- ── 5. Ensure profiles.uid index for fast lookup ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_uid ON profiles(uid);

-- ── 6. Ensure orders table has market_type_v2 if missing ────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='orders' AND column_name='market_type_v2'
  ) THEN
    ALTER TABLE orders ADD COLUMN market_type_v2 text GENERATED ALWAYS AS (market_type) STORED;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
