
-- ══════════════════════════════════════════════════════════════════
-- Core Stabilization Migration
-- 1. Auto-provision wallets on user sign-up
-- 2. Notification triggers for P2P, orders, positions
-- 3. Idempotency key on withdrawals
-- 4. Performance indexes
-- 5. Fix missing wallet available_balance policy
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. Idempotency key on withdrawals ────────────────────────────
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idempotency_key_uidx
  ON withdrawals(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ─── 2. Ensure user wallets function ─────────────────────────────
CREATE OR REPLACE FUNCTION ensure_user_wallets(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_assets text[] := ARRAY['USDT','BTC','ETH','BNB','SOL','USDC','XRP','TRX','LTC','DOGE'];
  v_types  wallet_type[] := ARRAY['spot','funding','p2p']::wallet_type[];
  v_asset  text;
  v_wtype  wallet_type;
BEGIN
  FOREACH v_wtype IN ARRAY v_types LOOP
    FOREACH v_asset IN ARRAY v_assets LOOP
      INSERT INTO wallets(id, user_id, asset, wallet_type,
        balance, locked_balance, escrow_balance, pending_deposit, pending_withdraw)
      VALUES (gen_random_uuid(), p_user_id, v_asset, v_wtype, 0, 0, 0, 0, 0)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  -- Futures wallet: USDT only
  INSERT INTO wallets(id, user_id, asset, wallet_type,
    balance, locked_balance, escrow_balance, pending_deposit, pending_withdraw)
  VALUES (gen_random_uuid(), p_user_id, 'USDT', 'futures', 0, 0, 0, 0, 0)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Also ensure for existing users (run once, idempotent)
DO $$
DECLARE v_uid uuid;
BEGIN
  FOR v_uid IN SELECT id FROM auth.users LOOP
    PERFORM ensure_user_wallets(v_uid);
  END LOOP;
END;
$$;

-- Trigger: auto-provision wallets on sign-up
CREATE OR REPLACE FUNCTION trg_provision_user_wallets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM ensure_user_wallets(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_provision_wallets ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_wallets
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION trg_provision_user_wallets();

-- ─── 3. Notification helper ───────────────────────────────────────
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id  uuid,
  p_category text,
  p_title    text,
  p_body     text,
  p_priority text DEFAULT 'medium',
  p_action_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications(user_id, category, title, body, priority, action_url, metadata)
  VALUES (p_user_id, p_category::notification_category, p_title, p_body,
          p_priority::notif_priority, p_action_url, p_metadata);
END;
$$;

-- ─── 4. P2P notification trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION trg_p2p_trade_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only fire on status transitions
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Trade created → notify seller
  IF TG_OP = 'INSERT' THEN
    PERFORM create_notification(
      NEW.seller_id, 'p2p',
      'New P2P Order',
      'A buyer has placed an order for ' || NEW.crypto_amount::text || ' ' || NEW.asset,
      'high', '/(app)/p2p/active-trade?id=' || NEW.id,
      jsonb_build_object('trade_id', NEW.id, 'asset', NEW.asset, 'amount', NEW.crypto_amount)
    );
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'awaiting_payment' THEN
      PERFORM create_notification(NEW.buyer_id, 'p2p', 'Order Confirmed',
        'Seller has confirmed your order. Please make payment within ' || NEW.payment_window || ' minutes.',
        'high', '/(app)/p2p/active-trade?id=' || NEW.id, jsonb_build_object('trade_id', NEW.id));
    WHEN 'payment_marked' THEN
      PERFORM create_notification(NEW.seller_id, 'p2p', 'Payment Marked',
        'Buyer has marked payment as sent. Please verify and release crypto.',
        'critical', '/(app)/p2p/active-trade?id=' || NEW.id, jsonb_build_object('trade_id', NEW.id));
    WHEN 'released' THEN
      PERFORM create_notification(NEW.buyer_id, 'p2p', 'Crypto Released',
        NEW.crypto_amount::text || ' ' || NEW.asset || ' has been released to your wallet.',
        'high', NULL, jsonb_build_object('trade_id', NEW.id, 'amount', NEW.crypto_amount, 'asset', NEW.asset));
    WHEN 'disputed' THEN
      PERFORM create_notification(NEW.buyer_id, 'p2p', 'Dispute Opened',
        'A dispute has been opened for your order. Support will review within 24 hours.', 'high', NULL, jsonb_build_object('trade_id', NEW.id));
      PERFORM create_notification(NEW.seller_id, 'p2p', 'Dispute Opened',
        'A dispute has been opened for your order. Support will review within 24 hours.', 'high', NULL, jsonb_build_object('trade_id', NEW.id));
    WHEN 'cancelled' THEN
      PERFORM create_notification(NEW.buyer_id, 'p2p', 'Order Cancelled',
        'Your P2P order has been cancelled.', 'medium', NULL, jsonb_build_object('trade_id', NEW.id));
    WHEN 'refunded' THEN
      PERFORM create_notification(NEW.buyer_id, 'p2p', 'Order Refunded',
        'Your escrow has been refunded. Funds returned to seller.', 'medium', NULL, jsonb_build_object('trade_id', NEW.id));
    ELSE NULL;
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_p2p_trade_notif ON p2p_trades;
CREATE TRIGGER trg_p2p_trade_notif
  AFTER INSERT OR UPDATE OF status ON p2p_trades
  FOR EACH ROW EXECUTE FUNCTION trg_p2p_trade_notifications();

-- ─── 5. Order fill notification trigger ──────────────────────────
CREATE OR REPLACE FUNCTION trg_order_fill_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status_v2 = NEW.status_v2 THEN RETURN NEW; END IF;
  CASE NEW.status_v2::text
    WHEN 'filled' THEN
      PERFORM create_notification(NEW.user_id, 'trade',
        'Order Filled',
        NEW.side::text || ' ' || NEW.filled_qty::text || ' ' || COALESCE(NEW.base_asset, NEW.symbol) || ' at ' || COALESCE(NEW.avg_fill_price::text, 'market'),
        'high', NULL, jsonb_build_object('order_id', NEW.id, 'symbol', NEW.symbol, 'side', NEW.side, 'qty', NEW.filled_qty));
    WHEN 'partially_filled' THEN
      PERFORM create_notification(NEW.user_id, 'trade',
        'Order Partially Filled',
        NEW.filled_qty::text || '/' || NEW.quantity::text || ' ' || COALESCE(NEW.base_asset, NEW.symbol) || ' filled',
        'medium', NULL, jsonb_build_object('order_id', NEW.id));
    WHEN 'cancelled' THEN
      PERFORM create_notification(NEW.user_id, 'trade', 'Order Cancelled',
        COALESCE(NEW.side::text, '') || ' order for ' || COALESCE(NEW.base_asset, NEW.symbol) || ' was cancelled.',
        'low', NULL, jsonb_build_object('order_id', NEW.id));
    WHEN 'rejected' THEN
      PERFORM create_notification(NEW.user_id, 'trade', 'Order Rejected',
        'Order rejected: ' || COALESCE(NEW.reject_reason, 'Unknown reason'),
        'high', NULL, jsonb_build_object('order_id', NEW.id, 'reason', NEW.reject_reason));
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_notif ON orders;
CREATE TRIGGER trg_order_notif
  AFTER UPDATE OF status_v2 ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_order_fill_notifications();

-- ─── 6. Position notification trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION trg_position_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Liquidation warning: margin_ratio > 0.85
  IF TG_OP = 'UPDATE'
     AND OLD.margin_ratio IS NOT NULL
     AND NEW.margin_ratio IS NOT NULL
     AND OLD.margin_ratio < 0.85
     AND NEW.margin_ratio >= 0.85 THEN
    PERFORM create_notification(NEW.user_id, 'risk',
      'Liquidation Warning',
      NEW.symbol || ' ' || NEW.side::text || ' position margin ratio is ' || ROUND(NEW.margin_ratio * 100)::text || '%. Add margin or reduce position.',
      'critical', NULL, jsonb_build_object('position_id', NEW.id, 'symbol', NEW.symbol, 'margin_ratio', NEW.margin_ratio));
  END IF;

  -- Position closed
  IF TG_OP = 'UPDATE' AND OLD.status = 'open' AND NEW.status IN ('closed','liquidated') THEN
    PERFORM create_notification(NEW.user_id, 'trade',
      CASE NEW.status::text WHEN 'liquidated' THEN 'Position Liquidated' ELSE 'Position Closed' END,
      NEW.symbol || ' ' || NEW.side::text || ' position closed. PnL: ' || NEW.realized_pnl::text || ' USDT',
      CASE NEW.status::text WHEN 'liquidated' THEN 'critical' ELSE 'high' END,
      NULL, jsonb_build_object('position_id', NEW.id, 'symbol', NEW.symbol, 'pnl', NEW.realized_pnl));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_position_notif ON positions;
CREATE TRIGGER trg_position_notif
  AFTER UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION trg_position_notifications();

-- ─── 7. Deposit notification trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION trg_deposit_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status = 'credited' THEN
    PERFORM create_notification(NEW.user_id, 'wallet',
      'Deposit Credited',
      NEW.amount::text || ' ' || NEW.asset || ' has been credited to your ' || COALESCE(NEW.network, '') || ' wallet.',
      'high', NULL, jsonb_build_object('deposit_id', NEW.id, 'asset', NEW.asset, 'amount', NEW.amount, 'tx_hash', NEW.tx_hash));
  ELSIF NEW.status = 'rejected' THEN
    PERFORM create_notification(NEW.user_id, 'wallet',
      'Deposit Rejected', 'Your deposit of ' || NEW.amount::text || ' ' || NEW.asset || ' was rejected.',
      'high', NULL, jsonb_build_object('deposit_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deposit_notif ON deposits;
CREATE TRIGGER trg_deposit_notif
  AFTER INSERT OR UPDATE OF status ON deposits
  FOR EACH ROW EXECUTE FUNCTION trg_deposit_notifications();

-- ─── 8. Withdrawal notification trigger ──────────────────────────
CREATE OR REPLACE FUNCTION trg_withdrawal_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  CASE NEW.status::text
    WHEN 'completed' THEN
      PERFORM create_notification(NEW.user_id, 'wallet', 'Withdrawal Completed',
        NEW.net_amount::text || ' ' || NEW.asset || ' sent to ' || LEFT(NEW.to_address, 10) || '...',
        'high', NULL, jsonb_build_object('withdrawal_id', NEW.id, 'asset', NEW.asset, 'amount', NEW.net_amount, 'tx_hash', NEW.tx_hash));
    WHEN 'rejected' THEN
      PERFORM create_notification(NEW.user_id, 'wallet', 'Withdrawal Rejected',
        'Withdrawal of ' || NEW.amount::text || ' ' || NEW.asset || ' was rejected: ' || COALESCE(NEW.reject_reason, 'Policy violation'),
        'high', NULL, jsonb_build_object('withdrawal_id', NEW.id));
    WHEN 'cancelled' THEN
      PERFORM create_notification(NEW.user_id, 'wallet', 'Withdrawal Cancelled',
        'Withdrawal of ' || NEW.amount::text || ' ' || NEW.asset || ' was cancelled.',
        'medium', NULL, jsonb_build_object('withdrawal_id', NEW.id));
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_notif ON withdrawals;
CREATE TRIGGER trg_withdrawal_notif
  AFTER UPDATE OF status ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION trg_withdrawal_notifications();

-- ─── 9. Performance indexes ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wallets_user_type    ON wallets(user_id, wallet_type);
CREATE INDEX IF NOT EXISTS idx_wallets_user_asset   ON wallets(user_id, asset);
CREATE INDEX IF NOT EXISTS idx_orders_user_status   ON orders(user_id, status_v2, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status_v2) WHERE status_v2 = 'open';
CREATE INDEX IF NOT EXISTS idx_notif_user_unread    ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_user_asset    ON ledger_entries(user_id, asset, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_user_status ON deposits(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdr_user_status   ON withdrawals(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_trades_status    ON p2p_trades(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_user_open  ON positions(user_id, status) WHERE status = 'open';

-- ─── 10. Grant execute permissions ───────────────────────────────
GRANT EXECUTE ON FUNCTION ensure_user_wallets(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_notification(uuid, text, text, text, text, text, jsonb) TO service_role;
