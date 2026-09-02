
-- ledger_entries uses amount column; add debit/credit aliases for service compatibility
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS debit  NUMERIC(36,18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit NUMERIC(36,18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- payment_methods: add currency/method_name/account_number/bank_code/instructions columns
ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS method_name    TEXT,
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_code      TEXT,
  ADD COLUMN IF NOT EXISTS currency       TEXT,
  ADD COLUMN IF NOT EXISTS instructions   TEXT;

-- withdrawals: add net_amount column
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(36,18) GENERATED ALWAYS AS (amount - fee) STORED;
