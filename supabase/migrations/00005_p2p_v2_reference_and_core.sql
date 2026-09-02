
-- ═══════════════════════════════════════════════════════════════
-- P2P V2 — Reference tables, merchants, trades, new support tables
-- Avoids altering existing p2p_disputes/p2p_messages
-- ═══════════════════════════════════════════════════════════════

-- ── Reference tables ────────────────────────────────────────────
CREATE TABLE p2p_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      text UNIQUE NOT NULL,
  name        text NOT NULL,
  icon_url    text,
  decimals    int NOT NULL DEFAULT 8,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE p2p_fiats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text UNIQUE NOT NULL,
  name         text NOT NULL,
  symbol       text NOT NULL,
  country_code text,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE p2p_countries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,
  name          text NOT NULL,
  phone_prefix  text,
  default_fiat  text,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE p2p_payment_methods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  slug          text UNIQUE NOT NULL,
  logo_url      text,
  country_codes text[] NOT NULL DEFAULT '{}',
  fiat_codes    text[] NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Merchant profiles ────────────────────────────────────────────
CREATE TABLE p2p_merchants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name       text NOT NULL,
  country_code       text,
  total_trades       int NOT NULL DEFAULT 0,
  completed_trades   int NOT NULL DEFAULT 0,
  cancelled_trades   int NOT NULL DEFAULT 0,
  disputed_trades    int NOT NULL DEFAULT 0,
  positive_ratings   int NOT NULL DEFAULT 0,
  negative_ratings   int NOT NULL DEFAULT 0,
  avg_payment_time   numeric(6,2) NOT NULL DEFAULT 0,
  avg_release_time   numeric(6,2) NOT NULL DEFAULT 0,
  is_online          boolean NOT NULL DEFAULT false,
  last_seen_at       timestamptz,
  is_verified        boolean NOT NULL DEFAULT false,
  is_pro             boolean NOT NULL DEFAULT false,
  is_suspended       boolean NOT NULL DEFAULT false,
  kyc_level          int NOT NULL DEFAULT 0,
  bio                text,
  terms              text,
  auto_reply         text,
  supported_fiats    text[] NOT NULL DEFAULT '{}',
  supported_payments text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- ── Alter p2p_ads to add new columns ────────────────────────────
ALTER TABLE p2p_ads
  ADD COLUMN IF NOT EXISTS country_code      text,
  ADD COLUMN IF NOT EXISTS price_type        text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS float_margin      numeric(6,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_window    int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS terms             text,
  ADD COLUMN IF NOT EXISTS avg_release_time  numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

-- ── P2P Trades (full lifecycle) ──────────────────────────────────
CREATE TYPE p2p_trade_status AS ENUM (
  'pending','awaiting_payment','payment_marked','awaiting_release',
  'released','cancelled','expired','disputed','refunded'
);

CREATE TABLE p2p_trades (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_number      text UNIQUE NOT NULL DEFAULT '',
  ad_id             uuid NOT NULL REFERENCES p2p_ads(id),
  buyer_id          uuid NOT NULL REFERENCES auth.users(id),
  seller_id         uuid NOT NULL REFERENCES auth.users(id),
  merchant_id       uuid NOT NULL REFERENCES p2p_merchants(id),
  asset             text NOT NULL,
  fiat              text NOT NULL,
  crypto_amount     numeric(24,8) NOT NULL,
  fiat_amount       numeric(24,8) NOT NULL,
  price             numeric(24,8) NOT NULL,
  fee_crypto        numeric(24,8) NOT NULL DEFAULT 0,
  payment_method    text NOT NULL,
  payment_window    int NOT NULL DEFAULT 15,
  status            p2p_trade_status NOT NULL DEFAULT 'pending',
  escrow_locked_at  timestamptz,
  payment_due_at    timestamptz,
  paid_at           timestamptz,
  released_at       timestamptz,
  cancelled_at      timestamptz,
  expires_at        timestamptz,
  escrow_released   boolean NOT NULL DEFAULT false,
  buyer_rated       boolean NOT NULL DEFAULT false,
  seller_rated      boolean NOT NULL DEFAULT false,
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id)
);

CREATE INDEX idx_p2p_trades_buyer  ON p2p_trades(buyer_id, status);
CREATE INDEX idx_p2p_trades_seller ON p2p_trades(seller_id, status);
CREATE INDEX idx_p2p_trades_status ON p2p_trades(status);

CREATE OR REPLACE FUNCTION p2p_generate_trade_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.trade_number := 'P2P' || TO_CHAR(NOW(), 'YYYYMMDD') ||
    LPAD(FLOOR(RANDOM()*9999999)::text, 7, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_p2p_trade_number
  BEFORE INSERT ON p2p_trades
  FOR EACH ROW EXECUTE FUNCTION p2p_generate_trade_number();

-- ── User payment accounts ────────────────────────────────────────
CREATE TABLE p2p_user_payment_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_method text NOT NULL,
  account_name   text NOT NULL,
  account_number text NOT NULL,
  bank_name      text,
  country_code   text,
  fiat_code      text,
  extra_info     text,
  is_verified    boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Trade messages (new, for p2p_trades) ────────────────────────
CREATE TABLE p2p_trade_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id    uuid NOT NULL REFERENCES p2p_trades(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES auth.users(id),
  message     text,
  image_url   text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_p2p_trade_messages_trade ON p2p_trade_messages(trade_id, created_at);

-- ── Alter existing p2p_disputes to add missing columns ──────────
ALTER TABLE p2p_disputes
  ADD COLUMN IF NOT EXISTS trade_id              uuid REFERENCES p2p_trades(id),
  ADD COLUMN IF NOT EXISTS description           text,
  ADD COLUMN IF NOT EXISTS evidence_urls         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS admin_note            text,
  ADD COLUMN IF NOT EXISTS resolved_in_favor_of  uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz NOT NULL DEFAULT now();

-- ── Dispute messages ─────────────────────────────────────────────
CREATE TABLE p2p_dispute_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES p2p_disputes(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES auth.users(id),
  message     text NOT NULL,
  is_admin    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Risk events ──────────────────────────────────────────────────
CREATE TABLE p2p_risk_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  trade_id     uuid REFERENCES p2p_trades(id),
  event_type   text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  details      jsonb NOT NULL DEFAULT '{}',
  reviewed     boolean NOT NULL DEFAULT false,
  reviewed_by  uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Trade reviews ────────────────────────────────────────────────
CREATE TABLE p2p_trade_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id     uuid NOT NULL REFERENCES p2p_trades(id),
  reviewer_id  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  reviewee_id  uuid NOT NULL REFERENCES auth.users(id),
  rating       int NOT NULL CHECK (rating IN (1, -1)),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trade_id, reviewer_id)
);

-- ── Fees ─────────────────────────────────────────────────────────
CREATE TABLE p2p_fees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_type     text NOT NULL CHECK (fee_type IN ('maker','taker','merchant','zero')),
  asset        text,
  fiat         text,
  country_code text,
  rate         numeric(8,6) NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Escrow RPCs ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION p2p_lock_escrow(
  p_trade_id  uuid, p_seller_id uuid, p_asset text, p_amount numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ledger_accounts
    SET available_balance = available_balance - p_amount,
        locked_balance    = locked_balance + p_amount,
        updated_at        = now()
    WHERE user_id = p_seller_id AND asset = p_asset AND available_balance >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance for asset %', p_asset;
  END IF;
  INSERT INTO ledger_entries (user_id, asset, account_id, entry_type, debit, credit, balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_seller_id, p_asset, la.id, 'p2p_escrow_lock', p_amount, 0,
    la.available_balance + p_amount, la.available_balance, p_trade_id, 'p2p_trade', 'P2P escrow locked'
  FROM ledger_accounts la WHERE la.user_id = p_seller_id AND la.asset = p_asset;
  UPDATE p2p_trades
    SET status = 'awaiting_payment', escrow_locked_at = now(),
        payment_due_at = now() + (payment_window || ' minutes')::interval, updated_at = now()
    WHERE id = p_trade_id;
END;
$$;

CREATE OR REPLACE FUNCTION p2p_release_escrow(
  p_trade_id uuid, p_seller_id uuid, p_buyer_id uuid, p_asset text, p_amount numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_buyer_acct_id uuid;
BEGIN
  UPDATE ledger_accounts SET locked_balance = locked_balance - p_amount, updated_at = now()
    WHERE user_id = p_seller_id AND asset = p_asset;
  INSERT INTO ledger_accounts (user_id, asset, available_balance, locked_balance, pending_balance)
    VALUES (p_buyer_id, p_asset, p_amount, 0, 0)
    ON CONFLICT (user_id, asset)
    DO UPDATE SET available_balance = ledger_accounts.available_balance + p_amount, updated_at = now();
  SELECT id INTO v_buyer_acct_id FROM ledger_accounts WHERE user_id = p_buyer_id AND asset = p_asset;
  INSERT INTO ledger_entries (user_id, asset, account_id, entry_type, debit, credit, balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_seller_id, p_asset, la.id, 'p2p_escrow_release', p_amount, 0,
    la.locked_balance + p_amount, la.locked_balance, p_trade_id, 'p2p_trade', 'P2P escrow released'
  FROM ledger_accounts la WHERE la.user_id = p_seller_id AND la.asset = p_asset;
  INSERT INTO ledger_entries (user_id, asset, account_id, entry_type, debit, credit, balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_buyer_id, p_asset, v_buyer_acct_id, 'p2p_escrow_release', 0, p_amount,
    la.available_balance - p_amount, la.available_balance, p_trade_id, 'p2p_trade', 'P2P crypto received'
  FROM ledger_accounts la WHERE la.user_id = p_buyer_id AND la.asset = p_asset;
  UPDATE p2p_trades SET status = 'released', released_at = now(), escrow_released = true, updated_at = now()
    WHERE id = p_trade_id;
  UPDATE p2p_merchants SET completed_trades = completed_trades + 1, total_trades = total_trades + 1, updated_at = now()
    WHERE id = (SELECT merchant_id FROM p2p_trades WHERE id = p_trade_id);
END;
$$;

CREATE OR REPLACE FUNCTION p2p_refund_escrow(
  p_trade_id uuid, p_seller_id uuid, p_asset text, p_amount numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ledger_accounts
    SET available_balance = available_balance + p_amount,
        locked_balance    = locked_balance - p_amount, updated_at = now()
    WHERE user_id = p_seller_id AND asset = p_asset;
  INSERT INTO ledger_entries (user_id, asset, account_id, entry_type, debit, credit, balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_seller_id, p_asset, la.id, 'p2p_escrow_release', 0, p_amount,
    la.available_balance - p_amount, la.available_balance, p_trade_id, 'p2p_trade', 'P2P escrow refunded'
  FROM ledger_accounts la WHERE la.user_id = p_seller_id AND la.asset = p_asset;
  UPDATE p2p_trades SET status = 'refunded', escrow_released = true, updated_at = now()
    WHERE id = p_trade_id;
END;
$$;

CREATE OR REPLACE FUNCTION p2p_create_trade(
  p_ad_id uuid, p_buyer_id uuid, p_crypto_amount numeric, p_fiat_amount numeric, p_payment_method text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ad        p2p_ads%ROWTYPE;
  v_merchant  p2p_merchants%ROWTYPE;
  v_trade_id  uuid;
  v_seller_id uuid;
BEGIN
  SELECT * INTO v_ad FROM p2p_ads WHERE id = p_ad_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ad not found'; END IF;
  IF v_ad.status::text <> 'active' THEN RAISE EXCEPTION 'Ad is not active'; END IF;
  IF v_ad.available_amount < p_crypto_amount THEN RAISE EXCEPTION 'Insufficient ad liquidity'; END IF;
  IF p_fiat_amount < v_ad.min_limit THEN RAISE EXCEPTION 'Amount below minimum limit'; END IF;
  IF p_fiat_amount > v_ad.max_limit THEN RAISE EXCEPTION 'Amount above maximum limit'; END IF;
  SELECT * INTO v_merchant FROM p2p_merchants WHERE id = v_ad.merchant_id;
  v_seller_id := v_merchant.user_id;
  IF v_seller_id = p_buyer_id THEN RAISE EXCEPTION 'Cannot trade with yourself'; END IF;
  IF v_merchant.is_suspended THEN RAISE EXCEPTION 'Merchant is suspended'; END IF;
  UPDATE p2p_ads SET available_amount = available_amount - p_crypto_amount,
    trade_count = trade_count + 1, updated_at = now() WHERE id = p_ad_id;
  INSERT INTO p2p_trades (ad_id, buyer_id, seller_id, merchant_id, asset, fiat,
    crypto_amount, fiat_amount, price, payment_method, payment_window, status, expires_at)
  VALUES (p_ad_id, p_buyer_id, v_seller_id, v_ad.merchant_id, v_ad.asset, v_ad.fiat,
    p_crypto_amount, p_fiat_amount, v_ad.price, p_payment_method, v_ad.payment_window,
    'pending', now() + (v_ad.payment_window || ' minutes')::interval)
  RETURNING id INTO v_trade_id;
  IF v_ad.side = 'sell' THEN
    PERFORM p2p_lock_escrow(v_trade_id, v_seller_id, v_ad.asset, p_crypto_amount);
  ELSE
    UPDATE p2p_trades SET status = 'awaiting_payment',
      payment_due_at = now() + (v_ad.payment_window || ' minutes')::interval, updated_at = now()
    WHERE id = v_trade_id;
  END IF;
  INSERT INTO p2p_trade_messages (trade_id, sender_id, message, is_system)
    VALUES (v_trade_id, NULL,
      'Trade created. Escrow activated. Order #' || (SELECT trade_number FROM p2p_trades WHERE id = v_trade_id),
      true);
  RETURN v_trade_id;
END;
$$;

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE p2p_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_fiats ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_user_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_trade_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_dispute_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_trade_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p2p_pub_assets"    ON p2p_assets           FOR SELECT USING (true);
CREATE POLICY "p2p_pub_fiats"     ON p2p_fiats             FOR SELECT USING (true);
CREATE POLICY "p2p_pub_countries" ON p2p_countries         FOR SELECT USING (true);
CREATE POLICY "p2p_pub_pmethods"  ON p2p_payment_methods   FOR SELECT USING (true);

CREATE POLICY "p2p_read_merchants"  ON p2p_merchants FOR SELECT USING (true);
CREATE POLICY "p2p_insert_merchant" ON p2p_merchants FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "p2p_update_merchant" ON p2p_merchants FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "p2p_read_trades"   ON p2p_trades FOR SELECT USING (buyer_id = auth.uid() OR seller_id = auth.uid());
CREATE POLICY "p2p_insert_trade"  ON p2p_trades FOR INSERT WITH CHECK (buyer_id = auth.uid());
CREATE POLICY "p2p_update_trade"  ON p2p_trades FOR UPDATE USING (buyer_id = auth.uid() OR seller_id = auth.uid());

CREATE POLICY "p2p_sel_pay_accts"  ON p2p_user_payment_accounts FOR SELECT  USING (user_id = auth.uid());
CREATE POLICY "p2p_ins_pay_accts"  ON p2p_user_payment_accounts FOR INSERT  WITH CHECK (user_id = auth.uid());
CREATE POLICY "p2p_upd_pay_accts"  ON p2p_user_payment_accounts FOR UPDATE  USING (user_id = auth.uid());
CREATE POLICY "p2p_del_pay_accts"  ON p2p_user_payment_accounts FOR DELETE  USING (user_id = auth.uid());

CREATE POLICY "p2p_read_tmsgs"   ON p2p_trade_messages FOR SELECT
  USING (trade_id IN (SELECT id FROM p2p_trades WHERE buyer_id = auth.uid() OR seller_id = auth.uid()));
CREATE POLICY "p2p_insert_tmsg"  ON p2p_trade_messages FOR INSERT
  WITH CHECK ((sender_id = auth.uid() OR sender_id IS NULL)
    AND trade_id IN (SELECT id FROM p2p_trades WHERE buyer_id = auth.uid() OR seller_id = auth.uid()));

CREATE POLICY "p2p_read_dmsgs"   ON p2p_dispute_messages FOR SELECT
  USING (dispute_id IN (
    SELECT d.id FROM p2p_disputes d JOIN p2p_trades t ON d.trade_id = t.id
    WHERE t.buyer_id = auth.uid() OR t.seller_id = auth.uid()
  ));
CREATE POLICY "p2p_insert_dmsg"  ON p2p_dispute_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "p2p_read_risk"   ON p2p_risk_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "p2p_insert_risk" ON p2p_risk_events FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "p2p_read_reviews"  ON p2p_trade_reviews FOR SELECT USING (true);
CREATE POLICY "p2p_insert_review" ON p2p_trade_reviews FOR INSERT WITH CHECK (reviewer_id = auth.uid());

CREATE POLICY "p2p_read_fees"     ON p2p_fees FOR SELECT USING (is_active = true);
