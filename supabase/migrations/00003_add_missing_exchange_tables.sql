
-- ── ledger_accounts (per-user, per-asset balance tracking) ─────────────────
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset             TEXT NOT NULL,
  available_balance NUMERIC(36,18) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  locked_balance    NUMERIC(36,18) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  pending_balance   NUMERIC(36,18) NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset)
);
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger_accounts_owner" ON ledger_accounts USING (user_id = auth.uid());

-- ── ledger_entries (double-entry audit log) ────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  account_id      UUID REFERENCES ledger_accounts(id),
  entry_type      TEXT NOT NULL,
  asset           TEXT NOT NULL,
  amount          NUMERIC(36,18) NOT NULL,
  balance_before  NUMERIC(36,18) NOT NULL DEFAULT 0,
  balance_after   NUMERIC(36,18) NOT NULL DEFAULT 0,
  reference_id    UUID,
  reference_type  TEXT,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger_entries_owner" ON ledger_entries USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_ref  ON ledger_entries(reference_id, reference_type);

-- ── deposit_addresses ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposit_addresses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset      TEXT NOT NULL,
  network    TEXT NOT NULL,
  address    TEXT NOT NULL,
  memo       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset, network)
);
ALTER TABLE deposit_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deposit_addresses_owner" ON deposit_addresses USING (user_id = auth.uid());

-- ── deposits ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  asset           TEXT NOT NULL,
  network         TEXT NOT NULL,
  amount          NUMERIC(36,18) NOT NULL,
  fee             NUMERIC(36,18) NOT NULL DEFAULT 0,
  tx_hash         TEXT,
  from_address    TEXT,
  to_address      TEXT,
  confirmations   INT NOT NULL DEFAULT 0,
  required_confs  INT NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirming','confirmed','credited','failed')),
  credited_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deposits_owner" ON deposits USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at DESC);

-- ── withdrawals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  asset           TEXT NOT NULL,
  network         TEXT NOT NULL,
  amount          NUMERIC(36,18) NOT NULL,
  fee             NUMERIC(36,18) NOT NULL DEFAULT 0,
  to_address      TEXT NOT NULL,
  memo            TEXT,
  tx_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','under_review','approved','processing','completed','failed','rejected','cancelled')),
  rejection_reason TEXT,
  reviewed_by     UUID REFERENCES auth.users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "withdrawals_owner" ON withdrawals USING (user_id = auth.uid());
CREATE POLICY "withdrawals_admin" ON withdrawals USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user   ON withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- ── payment_methods ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method_type  TEXT NOT NULL,
  bank_name    TEXT,
  account_name TEXT,
  account_no   TEXT,
  details      JSONB NOT NULL DEFAULT '{}',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_methods_owner" ON payment_methods USING (user_id = auth.uid());

-- ── p2p_disputes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_disputes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES p2p_orders(id),
  raised_by    UUID NOT NULL REFERENCES auth.users(id),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','under_review','resolved_buyer','resolved_seller','cancelled')),
  resolution   TEXT,
  resolved_by  UUID REFERENCES auth.users(id),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE p2p_disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p2p_disputes_parties" ON p2p_disputes
  USING (
    raised_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM p2p_orders o
      WHERE o.id = order_id AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
CREATE INDEX IF NOT EXISTS idx_p2p_disputes_order  ON p2p_disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_p2p_disputes_status ON p2p_disputes(status);

-- ── risk_flags ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  flag_type   TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  details     TEXT,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk_flags_admin" ON risk_flags
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_risk_flags_user     ON risk_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_flags_resolved ON risk_flags(resolved, severity);

-- ── admin_actions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL REFERENCES auth.users(id),
  action_type  TEXT NOT NULL,
  target_id    UUID,
  target_type  TEXT,
  details      JSONB NOT NULL DEFAULT '{}',
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_actions_admin" ON admin_actions
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin  ON admin_actions(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_id, target_type);

-- ── updated_at trigger for ledger_accounts ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_ledger_accounts_updated ON ledger_accounts;
CREATE TRIGGER trg_ledger_accounts_updated
  BEFORE UPDATE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_withdrawals_updated ON withdrawals;
CREATE TRIGGER trg_withdrawals_updated
  BEFORE UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
