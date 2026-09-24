
-- ═══════════════════════════════════════════════════════════════════════════
-- WALLET SYSTEM V2 — Full ledger-based multi-wallet infrastructure
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Extend wallet_type enum if needed ─────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE wallet_type ADD VALUE IF NOT EXISTS 'funding';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE wallet_type ADD VALUE IF NOT EXISTS 'p2p';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE wallet_type ADD VALUE IF NOT EXISTS 'escrow';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE wallet_type ADD VALUE IF NOT EXISTS 'futures';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE wallet_type ADD VALUE IF NOT EXISTS 'margin';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE wallet_type ADD VALUE IF NOT EXISTS 'earn';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Extend wallets table with full balance columns ─────────────────────────
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS escrow_balance    NUMERIC(32,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_deposit   NUMERIC(32,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_withdraw  NUMERIC(32,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- Unique constraint: one row per user+wallet_type+asset
DO $$ BEGIN
  ALTER TABLE wallets ADD CONSTRAINT wallets_user_wallet_asset_uq UNIQUE (user_id, wallet_type, asset);
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- ─── asset_networks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_networks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset               TEXT NOT NULL,
  network             TEXT NOT NULL,
  network_label       TEXT NOT NULL,
  deposit_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  withdraw_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  min_deposit         NUMERIC(32,8) NOT NULL DEFAULT 0,
  min_withdrawal      NUMERIC(32,8) NOT NULL DEFAULT 0,
  max_withdrawal_day  NUMERIC(32,8) NOT NULL DEFAULT 1000000,
  withdrawal_fee      NUMERIC(32,8) NOT NULL DEFAULT 0,
  required_confs      INTEGER NOT NULL DEFAULT 1,
  estimated_arrival   TEXT NOT NULL DEFAULT '~5 min',
  has_memo            BOOLEAN NOT NULL DEFAULT FALSE,
  memo_label          TEXT,
  address_regex       TEXT,
  explorer_url        TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset, network)
);

-- ─── internal_transfers ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID NOT NULL REFERENCES auth.users(id),
  recipient_id    UUID NOT NULL REFERENCES auth.users(id),
  asset           TEXT NOT NULL,
  wallet_type     wallet_type NOT NULL DEFAULT 'spot',
  amount          NUMERIC(32,8) NOT NULL,
  fee             NUMERIC(32,8) NOT NULL DEFAULT 0,
  net_amount      NUMERIC(32,8) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'completed',
  note            TEXT,
  reference       TEXT UNIQUE,
  ledger_tx_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internal_transfers_positive CHECK (amount > 0),
  CONSTRAINT internal_transfers_no_self CHECK (sender_id <> recipient_id)
);

-- ─── wallet_transfers (own wallet-to-wallet) ────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  asset           TEXT NOT NULL,
  from_wallet     wallet_type NOT NULL,
  to_wallet       wallet_type NOT NULL,
  amount          NUMERIC(32,8) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'completed',
  ledger_tx_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_transfers_positive CHECK (amount > 0),
  CONSTRAINT wallet_transfers_diff CHECK (from_wallet <> to_wallet)
);

-- ─── escrows ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        UUID,
  seller_id       UUID NOT NULL REFERENCES auth.users(id),
  buyer_id        UUID REFERENCES auth.users(id),
  asset           TEXT NOT NULL,
  amount          NUMERIC(32,8) NOT NULL,
  fee             NUMERIC(32,8) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'locked',
  escrow_type     TEXT NOT NULL DEFAULT 'p2p',
  locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at     TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  admin_action_id UUID,
  notes           TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT escrows_positive CHECK (amount > 0),
  CONSTRAINT escrows_status CHECK (status IN ('locked','released','refunded','frozen','disputed','expired'))
);

-- ─── hot_wallets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hot_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset           TEXT NOT NULL,
  network         TEXT NOT NULL,
  address         TEXT NOT NULL,
  label           TEXT,
  balance         NUMERIC(32,8) NOT NULL DEFAULT 0,
  reserved        NUMERIC(32,8) NOT NULL DEFAULT 0,
  daily_limit     NUMERIC(32,8) NOT NULL DEFAULT 100000,
  daily_used      NUMERIC(32,8) NOT NULL DEFAULT 0,
  daily_reset_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  low_balance_threshold NUMERIC(32,8) NOT NULL DEFAULT 1000,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset, network, address)
);

-- ─── cold_wallets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cold_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset           TEXT NOT NULL,
  network         TEXT NOT NULL,
  address         TEXT NOT NULL,
  label           TEXT,
  balance         NUMERIC(32,8) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_audit_at   TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset, network, address)
);

-- ─── cold_wallet_movements ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cold_wallet_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cold_wallet_id  UUID NOT NULL REFERENCES cold_wallets(id),
  direction       TEXT NOT NULL, -- 'hot_to_cold' | 'cold_to_hot'
  amount          NUMERIC(32,8) NOT NULL,
  tx_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  requested_by    UUID REFERENCES auth.users(id),
  approved_by     UUID REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── wallet_fees ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_type        TEXT NOT NULL, -- 'deposit'|'withdrawal'|'internal_transfer'|'wallet_transfer'
  asset           TEXT,          -- NULL = applies to all
  network         TEXT,          -- NULL = applies to all networks
  flat_fee        NUMERIC(32,8) NOT NULL DEFAULT 0,
  percent_fee     NUMERIC(8,4)  NOT NULL DEFAULT 0,
  min_fee         NUMERIC(32,8) NOT NULL DEFAULT 0,
  max_fee         NUMERIC(32,8),
  kyc_level       INTEGER,       -- NULL = applies to all kyc levels
  vip_level       INTEGER,       -- NULL = applies to all vip levels
  country_code    TEXT,          -- NULL = applies to all countries
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── wallet_limits ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_limits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limit_type            TEXT NOT NULL, -- 'daily_withdrawal'|'daily_deposit'|'single_withdrawal'
  asset                 TEXT,          -- NULL = all assets
  kyc_level             INTEGER,       -- NULL = all levels
  vip_level             INTEGER,
  max_amount            NUMERIC(32,8) NOT NULL DEFAULT 10000,
  min_amount            NUMERIC(32,8) NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── wallet_audit_logs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        UUID REFERENCES auth.users(id),
  target_user_id  UUID REFERENCES auth.users(id),
  action          TEXT NOT NULL,
  asset           TEXT,
  amount          NUMERIC(32,8),
  reference_id    UUID,
  reference_type  TEXT,
  ip_address      TEXT,
  device_info     TEXT,
  reason          TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── wallet_freezes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_freezes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  wallet_type     wallet_type,   -- NULL = all wallet types
  asset           TEXT,          -- NULL = all assets
  freeze_type     TEXT NOT NULL DEFAULT 'full', -- 'full'|'withdrawal'|'deposit'
  reason          TEXT NOT NULL,
  frozen_by       UUID REFERENCES auth.users(id),
  unfrozen_by     UUID REFERENCES auth.users(id),
  unfrozen_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wallets_user_type   ON wallets(user_id, wallet_type);
CREATE INDEX IF NOT EXISTS idx_wallets_user_asset  ON wallets(user_id, asset);
CREATE INDEX IF NOT EXISTS idx_asset_networks_asset ON asset_networks(asset, is_active);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_sender    ON internal_transfers(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_recipient ON internal_transfers(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_user ON wallet_transfers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrows_seller  ON escrows(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_escrows_buyer   ON escrows(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_escrows_trade   ON escrows(trade_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor  ON wallet_audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON wallet_audit_logs(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_freezes_user ON wallet_freezes(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_deposits_user_status ON deposits(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_status ON withdrawals(user_id, status, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE asset_networks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_transfers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transfers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE hot_wallets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_wallets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_wallet_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_fees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_limits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_freezes         ENABLE ROW LEVEL SECURITY;

-- asset_networks: public read
CREATE POLICY "asset_networks_read_all"  ON asset_networks FOR SELECT USING (TRUE);
CREATE POLICY "asset_networks_admin"     ON asset_networks FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- internal_transfers
CREATE POLICY "internal_transfers_own"  ON internal_transfers FOR SELECT
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY "internal_transfers_insert" ON internal_transfers FOR INSERT
  WITH CHECK (sender_id = auth.uid());
CREATE POLICY "internal_transfers_admin" ON internal_transfers FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- wallet_transfers
CREATE POLICY "wallet_transfers_own"    ON wallet_transfers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wallet_transfers_insert" ON wallet_transfers FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wallet_transfers_admin"  ON wallet_transfers FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- escrows
CREATE POLICY "escrows_own"   ON escrows FOR SELECT
  USING (seller_id = auth.uid() OR buyer_id = auth.uid());
CREATE POLICY "escrows_admin" ON escrows FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- hot_wallets / cold_wallets: admin only
CREATE POLICY "hot_wallets_admin"  ON hot_wallets  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "cold_wallets_admin" ON cold_wallets FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "cold_movements_admin" ON cold_wallet_movements FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- wallet_fees / wallet_limits: public read, admin write
CREATE POLICY "wallet_fees_read"   ON wallet_fees   FOR SELECT USING (TRUE);
CREATE POLICY "wallet_fees_admin"  ON wallet_fees   FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "wallet_limits_read" ON wallet_limits FOR SELECT USING (TRUE);
CREATE POLICY "wallet_limits_admin" ON wallet_limits FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- wallet_audit_logs
CREATE POLICY "audit_logs_own"   ON wallet_audit_logs FOR SELECT USING (target_user_id = auth.uid());
CREATE POLICY "audit_logs_actor" ON wallet_audit_logs FOR SELECT USING (actor_id = auth.uid());
CREATE POLICY "audit_logs_insert" ON wallet_audit_logs FOR INSERT WITH CHECK (actor_id = auth.uid());
CREATE POLICY "audit_logs_admin" ON wallet_audit_logs FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- wallet_freezes
CREATE POLICY "freezes_own"   ON wallet_freezes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "freezes_admin" ON wallet_freezes FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
