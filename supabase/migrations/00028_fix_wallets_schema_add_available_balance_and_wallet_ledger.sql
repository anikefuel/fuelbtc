
-- 1. Add available_balance and total_balance to wallets
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS available_balance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_balance     NUMERIC NOT NULL DEFAULT 0;

-- 2. Backfill: available_balance = balance - locked_balance - escrow_balance - pending_withdraw
--            total_balance = balance (ledger total; locked is included in balance)
UPDATE wallets SET
  available_balance = GREATEST(0, balance - locked_balance - escrow_balance - pending_withdraw),
  total_balance     = balance;

-- 3. Trigger function to keep available_balance / total_balance in sync automatically
CREATE OR REPLACE FUNCTION sync_wallet_derived_balances()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.available_balance := GREATEST(0,
    NEW.balance - NEW.locked_balance - NEW.escrow_balance - NEW.pending_withdraw);
  NEW.total_balance := NEW.balance;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_wallet_balances ON wallets;
CREATE TRIGGER trg_sync_wallet_balances
  BEFORE INSERT OR UPDATE OF balance, locked_balance, escrow_balance, pending_withdraw
  ON wallets
  FOR EACH ROW EXECUTE FUNCTION sync_wallet_derived_balances();

-- 4. Create wallet_ledger table (referenced by match_futures_orders, p2p_fund_wallet etc.)
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id        UUID        REFERENCES wallets(id) ON DELETE SET NULL,
  user_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  transaction_type TEXT        NOT NULL,
  asset            TEXT        NOT NULL,
  amount           NUMERIC     NOT NULL,
  balance_before   NUMERIC     NOT NULL DEFAULT 0,
  balance_after    NUMERIC     NOT NULL DEFAULT 0,
  reference_type   TEXT,
  reference_id     UUID,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_id    ON wallet_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_wallet_id  ON wallet_ledger(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created_at ON wallet_ledger(created_at DESC);

-- 5. RLS on wallet_ledger
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own ledger"
  ON wallet_ledger FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins full access wallet_ledger"
  ON wallet_ledger FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Service role wallet_ledger"
  ON wallet_ledger FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
