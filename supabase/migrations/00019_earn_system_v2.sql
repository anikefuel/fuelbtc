
-- Extend earn_subscriptions with missing columns
ALTER TABLE earn_subscriptions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS maturity_at     timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_earn_subs_idem ON earn_subscriptions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_earn_subs_user_status ON earn_subscriptions(user_id, status);

-- Backfill maturity_at for fixed subscriptions
UPDATE earn_subscriptions es
SET maturity_at = es.start_date + (ep.duration_days || ' days')::interval
FROM earn_products ep
WHERE ep.id = es.product_id AND ep.duration_days IS NOT NULL AND es.maturity_at IS NULL;

-- Earn yield ledger (one row per subscription per day)
CREATE TABLE IF NOT EXISTS earn_yield_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES earn_subscriptions(id),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset           text NOT NULL,
  yield_amount    numeric(36,18) NOT NULL CHECK (yield_amount >= 0),
  accrual_date    date NOT NULL,
  settled         boolean NOT NULL DEFAULT false,
  settled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, accrual_date)
);
CREATE INDEX IF NOT EXISTS idx_earn_yield_user      ON earn_yield_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_earn_yield_unsettled ON earn_yield_entries(settled) WHERE settled = false;

-- RLS
ALTER TABLE earn_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE earn_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE earn_yield_entries  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='earn_products' AND policyname='earn_products_public_read') THEN
    CREATE POLICY earn_products_public_read ON earn_products FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='earn_subscriptions' AND policyname='earn_subs_own_select') THEN
    CREATE POLICY earn_subs_own_select ON earn_subscriptions FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='earn_subscriptions' AND policyname='earn_subs_own_insert') THEN
    CREATE POLICY earn_subs_own_insert ON earn_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='earn_subscriptions' AND policyname='earn_subs_own_update') THEN
    CREATE POLICY earn_subs_own_update ON earn_subscriptions FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='earn_yield_entries' AND policyname='earn_yield_own_select') THEN
    CREATE POLICY earn_yield_own_select ON earn_yield_entries FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

-- RPC: subscribe_earn
CREATE OR REPLACE FUNCTION subscribe_earn(
  p_user_id     uuid,
  p_product_id  uuid,
  p_amount      numeric,
  p_idempotency text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_product  earn_products%ROWTYPE;
  v_sub_id   uuid;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM earn_subscriptions
  WHERE idempotency_key = p_idempotency AND user_id = p_user_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO v_product FROM earn_products WHERE id = p_product_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found or inactive'; END IF;
  IF p_amount < v_product.min_amount THEN
    RAISE EXCEPTION 'Amount % below minimum %', p_amount, v_product.min_amount;
  END IF;

  -- Lock funds
  UPDATE wallets
  SET balance = balance - p_amount, locked_balance = locked_balance + p_amount, updated_at = now()
  WHERE user_id = p_user_id AND asset = v_product.asset AND wallet_type = 'spot' AND balance >= p_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient % balance', v_product.asset; END IF;

  INSERT INTO earn_subscriptions (user_id, product_id, asset, amount, status, start_date, end_date, maturity_at, idempotency_key)
  VALUES (
    p_user_id, p_product_id, v_product.asset, p_amount, 'active',
    CURRENT_DATE,
    CASE WHEN v_product.duration_days IS NOT NULL THEN CURRENT_DATE + v_product.duration_days ELSE NULL END,
    CASE WHEN v_product.duration_days IS NOT NULL THEN now() + (v_product.duration_days || ' days')::interval ELSE NULL END,
    p_idempotency
  ) RETURNING id INTO v_sub_id;

  INSERT INTO ledger_entries (user_id, wallet_id, entry_type, asset, debit, credit, reference_id, reference_type, note)
  SELECT p_user_id, w.id, 'earn_lock', v_product.asset, p_amount, 0, v_sub_id, 'earn_subscription', 'Earn subscription locked'
  FROM wallets w WHERE w.user_id = p_user_id AND w.asset = v_product.asset AND w.wallet_type = 'spot' LIMIT 1;

  RETURN v_sub_id;
END; $$;

-- RPC: redeem_earn
CREATE OR REPLACE FUNCTION redeem_earn(
  p_user_id uuid,
  p_sub_id  uuid
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sub         earn_subscriptions%ROWTYPE;
  v_product     earn_products%ROWTYPE;
  v_total_yield numeric;
  v_payout      numeric;
BEGIN
  SELECT * INTO v_sub FROM earn_subscriptions
  WHERE id = p_sub_id AND user_id = p_user_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription not found or already redeemed'; END IF;

  SELECT * INTO v_product FROM earn_products WHERE id = v_sub.product_id;
  IF v_product.duration_days IS NOT NULL AND v_sub.maturity_at IS NOT NULL AND v_sub.maturity_at > now() THEN
    RAISE EXCEPTION 'Fixed subscription locked until %', v_sub.maturity_at;
  END IF;

  SELECT COALESCE(SUM(yield_amount), 0) INTO v_total_yield
  FROM earn_yield_entries WHERE subscription_id = p_sub_id AND settled = false;

  v_payout := v_sub.amount + v_total_yield;

  UPDATE wallets
  SET balance = balance + v_payout, locked_balance = GREATEST(locked_balance - v_sub.amount, 0), updated_at = now()
  WHERE user_id = p_user_id AND asset = v_sub.asset AND wallet_type = 'spot';

  UPDATE earn_yield_entries SET settled = true, settled_at = now()
  WHERE subscription_id = p_sub_id AND settled = false;

  UPDATE earn_subscriptions
  SET status = 'redeemed', redeemed_at = now(), updated_at = now(),
      earned_total = COALESCE(earned_total, 0) + v_total_yield
  WHERE id = p_sub_id;

  INSERT INTO ledger_entries (user_id, wallet_id, entry_type, asset, debit, credit, reference_id, reference_type, note)
  SELECT p_user_id, w.id, 'earn_unlock', v_sub.asset, 0, v_payout, p_sub_id, 'earn_redemption', 'Earn redeemed: principal + yield'
  FROM wallets w WHERE w.user_id = p_user_id AND w.asset = v_sub.asset AND w.wallet_type = 'spot' LIMIT 1;

  RETURN v_payout;
END; $$;

-- RPC: accrue_earn_yield (called daily by scheduled Edge Function)
CREATE OR REPLACE FUNCTION accrue_earn_yield() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count integer := 0;
  v_rec   RECORD;
  v_daily numeric;
  v_date  date := CURRENT_DATE;
BEGIN
  FOR v_rec IN
    SELECT es.id AS sub_id, es.user_id, es.asset, es.amount, ep.apy
    FROM earn_subscriptions es JOIN earn_products ep ON ep.id = es.product_id
    WHERE es.status = 'active'
  LOOP
    v_daily := (v_rec.amount * v_rec.apy / 100.0) / 365.0;
    INSERT INTO earn_yield_entries (subscription_id, user_id, asset, yield_amount, accrual_date)
    VALUES (v_rec.sub_id, v_rec.user_id, v_rec.asset, v_daily, v_date)
    ON CONFLICT (subscription_id, accrual_date) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE earn_subscriptions;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE earn_yield_entries;
EXCEPTION WHEN others THEN NULL; END $$;
