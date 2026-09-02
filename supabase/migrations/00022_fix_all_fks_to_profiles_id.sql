
-- ─── 1. risk_flags.user_id → profiles.id ─────────────────────────────────────
ALTER TABLE risk_flags
  DROP CONSTRAINT IF EXISTS risk_flags_user_id_fkey,
  ADD  CONSTRAINT risk_flags_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ─── 2. ledger_accounts.user_id → profiles.id ────────────────────────────────
ALTER TABLE ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_user_id_fkey,
  ADD  CONSTRAINT ledger_accounts_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ─── 3. ledger_entries.user_id → profiles.id ─────────────────────────────────
ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_user_id_fkey,
  ADD  CONSTRAINT ledger_entries_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ─── 4. p2p_trades buyer/seller → profiles.id ────────────────────────────────
ALTER TABLE p2p_trades
  DROP CONSTRAINT IF EXISTS p2p_trades_buyer_id_fkey,
  ADD  CONSTRAINT p2p_trades_buyer_id_fkey
       FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE p2p_trades
  DROP CONSTRAINT IF EXISTS p2p_trades_seller_id_fkey,
  ADD  CONSTRAINT p2p_trades_seller_id_fkey
       FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ─── 5. p2p_disputes → profiles.id ───────────────────────────────────────────
ALTER TABLE p2p_disputes
  DROP CONSTRAINT IF EXISTS p2p_disputes_raised_by_fkey,
  ADD  CONSTRAINT p2p_disputes_raised_by_fkey
       FOREIGN KEY (raised_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE p2p_disputes
  DROP CONSTRAINT IF EXISTS p2p_disputes_resolved_by_fkey,
  ADD  CONSTRAINT p2p_disputes_resolved_by_fkey
       FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE p2p_disputes
  DROP CONSTRAINT IF EXISTS p2p_disputes_resolved_in_favor_of_fkey,
  ADD  CONSTRAINT p2p_disputes_resolved_in_favor_of_fkey
       FOREIGN KEY (resolved_in_favor_of) REFERENCES profiles(id) ON DELETE SET NULL;

-- ─── 6. escrows buyer/seller → profiles.id ───────────────────────────────────
ALTER TABLE escrows
  DROP CONSTRAINT IF EXISTS escrows_buyer_id_fkey,
  ADD  CONSTRAINT escrows_buyer_id_fkey
       FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE escrows
  DROP CONSTRAINT IF EXISTS escrows_seller_id_fkey,
  ADD  CONSTRAINT escrows_seller_id_fkey
       FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ─── 7. wallet_freezes.user_id → profiles.id ─────────────────────────────────
DO $$ BEGIN
  ALTER TABLE wallet_freezes
    DROP CONSTRAINT IF EXISTS wallet_freezes_user_id_fkey;
  ALTER TABLE wallet_freezes
    ADD CONSTRAINT wallet_freezes_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ─── 8. escrows: ensure p2p_trade_id FK if column exists ─────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='escrows' AND column_name='p2p_trade_id'
  ) THEN
    ALTER TABLE escrows
      DROP CONSTRAINT IF EXISTS escrows_p2p_trade_id_fkey;
    ALTER TABLE escrows
      ADD CONSTRAINT escrows_p2p_trade_id_fkey
        FOREIGN KEY (p2p_trade_id) REFERENCES p2p_trades(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
