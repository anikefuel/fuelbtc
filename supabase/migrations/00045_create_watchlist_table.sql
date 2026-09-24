
-- Watchlist: per-user list of saved market symbols
CREATE TABLE user_watchlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol      text NOT NULL,               -- e.g. "BTC", "ETH"
  market_type text NOT NULL DEFAULT 'spot' CHECK (market_type IN ('spot','futures')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, market_type)
);

ALTER TABLE user_watchlist ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own watchlist
CREATE POLICY "user_watchlist_select" ON user_watchlist
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Authenticated users can insert into their own watchlist
CREATE POLICY "user_watchlist_insert" ON user_watchlist
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Authenticated users can delete their own watchlist entries
CREATE POLICY "user_watchlist_delete" ON user_watchlist
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Index for fast per-user lookups
CREATE INDEX user_watchlist_user_id_idx ON user_watchlist (user_id);
