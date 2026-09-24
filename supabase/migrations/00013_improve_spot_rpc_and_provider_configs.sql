
-- ═══════════════════════════════════════════════════════════════════
-- Replace place_spot_order with improved wallet-ledger implementation
-- Signature kept identical (p_side order_side enum)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION place_spot_order(
  p_symbol      text,
  p_base_asset  text,
  p_quote_asset text,
  p_side        order_side,
  p_order_type  text,
  p_quantity    numeric,
  p_price       numeric DEFAULT NULL,
  p_stop_price  numeric DEFAULT NULL,
  p_tif         text    DEFAULT 'GTC',
  p_client_oid  text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id     uuid    := auth.uid();
  v_order_id    uuid    := gen_random_uuid();
  v_fill_price  numeric;
  v_cost_asset  text;
  v_recv_asset  text;
  v_cost_amount numeric := 0;
  v_recv_amount numeric := 0;
  v_fee_rate    numeric := 0.001;
  v_fee         numeric := 0;
  v_status      text;
  v_locked      numeric := 0;
  v_avail       numeric;
  v_wid         uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF p_side::text = 'buy' THEN
    v_cost_asset := p_quote_asset; v_recv_asset := p_base_asset;
  ELSE
    v_cost_asset := p_base_asset;  v_recv_asset := p_quote_asset;
  END IF;

  -- Resolve fill price & status
  IF p_order_type = 'market' THEN
    v_fill_price := COALESCE(p_price, 0);
    v_status     := CASE WHEN v_fill_price > 0 THEN 'filled' ELSE 'open' END;
  ELSE
    v_fill_price := p_price;
    v_status     := 'open';
  END IF;

  -- Cost + fee
  IF p_side::text = 'buy' THEN
    v_cost_amount := COALESCE(v_fill_price, 0) * p_quantity;
  ELSE
    v_cost_amount := p_quantity;
  END IF;
  v_fee    := v_cost_amount * v_fee_rate;
  v_locked := CASE WHEN v_status = 'open' THEN v_cost_amount + v_fee ELSE 0 END;

  -- Get spot wallet for cost asset
  SELECT id, available_balance INTO v_wid, v_avail
    FROM wallets
   WHERE user_id = v_user_id AND asset = v_cost_asset AND wallet_type = 'spot'
   LIMIT 1;

  IF v_wid IS NULL THEN
    RAISE EXCEPTION 'No spot wallet for %', v_cost_asset;
  END IF;

  -- For limit orders: check + lock
  IF v_status = 'open' AND v_locked > 0 THEN
    IF v_avail < v_locked THEN
      RAISE EXCEPTION 'Insufficient balance: have %, need %', v_avail, v_locked;
    END IF;
    UPDATE wallets
       SET available_balance = available_balance - v_locked,
           locked_balance    = locked_balance    + v_locked,
           updated_at        = now()
     WHERE id = v_wid;
  END IF;

  -- Insert order record
  INSERT INTO orders (
    id, user_id, symbol, base_asset, quote_asset, side,
    order_type_v2, market_type_v2, status_v2,
    price, stop_price, quantity,
    filled_qty, remaining_qty, avg_fill_price,
    fee, fee_asset, leverage_v2, margin_mode,
    locked_amount, provider_name, tif, client_order_id,
    created_at, updated_at
  ) VALUES (
    v_order_id, v_user_id, p_symbol, p_base_asset, p_quote_asset, p_side,
    p_order_type, 'spot', v_status,
    p_price, p_stop_price, p_quantity,
    CASE WHEN v_status='filled' THEN p_quantity ELSE 0 END,
    CASE WHEN v_status='filled' THEN 0 ELSE p_quantity END,
    CASE WHEN v_status='filled' THEN v_fill_price ELSE NULL END,
    CASE WHEN v_status='filled' THEN v_fee ELSE 0 END,
    v_cost_asset, 1, 'cross',
    v_locked, 'internal', p_tif, p_client_oid,
    now(), now()
  );

  -- Immediately settle market fills
  IF v_status = 'filled' AND v_fill_price > 0 THEN
    -- Debit cost wallet
    UPDATE wallets
       SET available_balance = available_balance - (v_cost_amount + v_fee),
           total_balance     = GREATEST(0, total_balance - (v_cost_amount + v_fee)),
           updated_at        = now()
     WHERE user_id = v_user_id AND asset = v_cost_asset AND wallet_type = 'spot';

    INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount,
      balance_before, balance_after, reference_type, reference_id, description, created_at)
    SELECT gen_random_uuid(), w.id, v_user_id, 'trade_debit', v_cost_asset,
           -(v_cost_amount + v_fee),
           w.available_balance + (v_cost_amount + v_fee), w.available_balance,
           'order', v_order_id, p_side::text || ' ' || p_symbol, now()
      FROM wallets w WHERE w.user_id=v_user_id AND w.asset=v_cost_asset AND w.wallet_type='spot';

    -- Ensure receive wallet exists
    INSERT INTO wallets (id, user_id, asset, wallet_type, available_balance, locked_balance, total_balance, updated_at)
    VALUES (gen_random_uuid(), v_user_id, v_recv_asset, 'spot', 0, 0, 0, now())
    ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

    v_recv_amount := CASE WHEN p_side::text='buy' THEN p_quantity ELSE v_cost_amount - v_fee END;

    UPDATE wallets
       SET available_balance = available_balance + v_recv_amount,
           total_balance     = total_balance     + v_recv_amount,
           updated_at        = now()
     WHERE user_id=v_user_id AND asset=v_recv_asset AND wallet_type='spot';

    INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount,
      balance_before, balance_after, reference_type, reference_id, description, created_at)
    SELECT gen_random_uuid(), w.id, v_user_id, 'trade_credit', v_recv_asset,
           v_recv_amount, w.available_balance - v_recv_amount, w.available_balance,
           'order', v_order_id, p_side::text || ' ' || p_symbol || ' recv', now()
      FROM wallets w WHERE w.user_id=v_user_id AND w.asset=v_recv_asset AND w.wallet_type='spot';

    -- Fee ledger
    INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount,
      balance_before, balance_after, reference_type, reference_id, description, created_at)
    SELECT gen_random_uuid(), w.id, v_user_id, 'fee', v_cost_asset,
           -v_fee, w.available_balance + v_fee, w.available_balance,
           'order', v_order_id, 'Fee ' || p_symbol, now()
      FROM wallets w WHERE w.user_id=v_user_id AND w.asset=v_cost_asset AND w.wallet_type='spot';
  END IF;

  RETURN v_order_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- Replace cancel_order_release with ledger-aware version
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cancel_order_release(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order   record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_order FROM orders
   WHERE id = p_order_id AND user_id = v_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.status_v2 NOT IN ('open','pending') THEN
    RAISE EXCEPTION 'Cannot cancel order in status: %', v_order.status_v2;
  END IF;

  UPDATE orders SET status_v2='cancelled', updated_at=now() WHERE id=p_order_id;

  IF v_order.locked_amount > 0 THEN
    UPDATE wallets
       SET available_balance = available_balance + v_order.locked_amount,
           locked_balance    = GREATEST(0, locked_balance - v_order.locked_amount),
           updated_at        = now()
     WHERE user_id = v_user_id AND wallet_type = 'spot'
       AND asset = CASE WHEN v_order.side::text='buy' THEN v_order.quote_asset ELSE v_order.base_asset END;

    INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount,
      balance_before, balance_after, reference_type, reference_id, description, created_at)
    SELECT gen_random_uuid(), w.id, v_user_id, 'order_release',
           CASE WHEN v_order.side::text='buy' THEN v_order.quote_asset ELSE v_order.base_asset END,
           v_order.locked_amount,
           w.available_balance - v_order.locked_amount, w.available_balance,
           'order', p_order_id, 'Cancel release', now()
      FROM wallets w
     WHERE w.user_id=v_user_id AND w.wallet_type='spot'
       AND w.asset = CASE WHEN v_order.side::text='buy' THEN v_order.quote_asset ELSE v_order.base_asset END;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION place_spot_order(text,text,text,order_side,text,numeric,numeric,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_order_release(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- Table: exchange_provider_configs
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS exchange_provider_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  label         text NOT NULL DEFAULT '',
  api_key       text NOT NULL DEFAULT '',
  api_secret    text NOT NULL DEFAULT '',
  passphrase    text NOT NULL DEFAULT '',
  is_active     boolean NOT NULL DEFAULT false,
  is_testnet    boolean NOT NULL DEFAULT false,
  permissions   text[] NOT NULL DEFAULT '{}',
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exchange_provider_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_provider_configs"
  ON exchange_provider_configs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "no_client_provider_configs"
  ON exchange_provider_configs FOR ALL TO authenticated, anon
  USING (false);

INSERT INTO exchange_provider_configs (provider_name, label, is_active, is_testnet, permissions, notes)
VALUES
  ('binance', 'Binance Main',  false, false, ARRAY['read','trade'], 'Add your Binance API key here'),
  ('bybit',   'Bybit Main',    false, false, ARRAY['read','trade'], 'Add your Bybit API key here'),
  ('okx',     'OKX Main',      false, false, ARRAY['read','trade'], 'Add OKX API key + passphrase')
ON CONFLICT DO NOTHING;

-- Safe column additions for orders table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='tif') THEN
    ALTER TABLE orders ADD COLUMN tif text NOT NULL DEFAULT 'GTC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='client_order_id') THEN
    ALTER TABLE orders ADD COLUMN client_order_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='quote_asset') THEN
    ALTER TABLE orders ADD COLUMN quote_asset text NOT NULL DEFAULT 'USDT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='base_asset') THEN
    ALTER TABLE orders ADD COLUMN base_asset text NOT NULL DEFAULT 'BTC';
  END IF;
END;
$$;
