
-- User roles
CREATE TYPE public.user_role AS ENUM ('user', 'admin');
CREATE TYPE public.kyc_tier AS ENUM ('tier0', 'tier1', 'tier2', 'tier3');
CREATE TYPE public.kyc_status AS ENUM ('none', 'pending', 'approved', 'rejected');

-- Profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  username text,
  role public.user_role NOT NULL DEFAULT 'user',
  avatar_url text,
  uid text UNIQUE NOT NULL DEFAULT 'EXX' || substr(md5(random()::text), 1, 8),
  vip_level int NOT NULL DEFAULT 0,
  referral_code text UNIQUE NOT NULL DEFAULT upper(substr(md5(random()::text), 1, 8)),
  referred_by text,
  kyc_tier public.kyc_tier NOT NULL DEFAULT 'tier0',
  kyc_status public.kyc_status NOT NULL DEFAULT 'none',
  is_frozen boolean NOT NULL DEFAULT false,
  anti_phishing_code text,
  two_fa_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Wallets
CREATE TYPE public.wallet_type AS ENUM ('spot', 'futures', 'earn', 'fiat');

CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_type public.wallet_type NOT NULL DEFAULT 'spot',
  asset text NOT NULL,
  balance numeric(28, 8) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  locked_balance numeric(28, 8) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, wallet_type, asset)
);

-- Transactions
CREATE TYPE public.tx_type AS ENUM ('deposit', 'withdrawal', 'trade', 'transfer', 'reward', 'fee');
CREATE TYPE public.tx_status AS ENUM ('pending', 'completed', 'failed', 'cancelled');

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tx_type public.tx_type NOT NULL,
  asset text NOT NULL,
  amount numeric(28, 8) NOT NULL,
  fee numeric(28, 8) NOT NULL DEFAULT 0,
  status public.tx_status NOT NULL DEFAULT 'pending',
  tx_hash text,
  address text,
  network text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Earn products
CREATE TYPE public.earn_type AS ENUM ('flexible', 'fixed', 'staking');

CREATE TABLE public.earn_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  asset text NOT NULL,
  earn_type public.earn_type NOT NULL,
  apy numeric(6, 2) NOT NULL,
  min_amount numeric(28, 8) NOT NULL DEFAULT 0,
  max_amount numeric(28, 8),
  duration_days int,
  is_active boolean NOT NULL DEFAULT true,
  total_capacity numeric(28, 8),
  subscribed_amount numeric(28, 8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- P2P Ads
CREATE TYPE public.p2p_side AS ENUM ('buy', 'sell');
CREATE TYPE public.p2p_status AS ENUM ('active', 'inactive', 'completed');

CREATE TABLE public.p2p_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  side public.p2p_side NOT NULL,
  asset text NOT NULL DEFAULT 'USDT',
  fiat text NOT NULL DEFAULT 'NGN',
  price numeric(20, 4) NOT NULL,
  total_amount numeric(28, 8) NOT NULL,
  available_amount numeric(28, 8) NOT NULL,
  min_limit numeric(20, 2) NOT NULL,
  max_limit numeric(20, 2) NOT NULL,
  payment_methods text[] NOT NULL DEFAULT '{}',
  status public.p2p_status NOT NULL DEFAULT 'active',
  auto_reply text,
  completion_rate numeric(5, 2) NOT NULL DEFAULT 100,
  trade_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- P2P Orders
CREATE TYPE public.p2p_order_status AS ENUM ('pending', 'paid', 'released', 'cancelled', 'disputed');

CREATE TABLE public.p2p_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NOT NULL REFERENCES public.p2p_ads(id),
  buyer_id uuid NOT NULL REFERENCES public.profiles(id),
  seller_id uuid NOT NULL REFERENCES public.profiles(id),
  asset text NOT NULL,
  fiat text NOT NULL,
  amount numeric(28, 8) NOT NULL,
  fiat_amount numeric(20, 2) NOT NULL,
  price numeric(20, 4) NOT NULL,
  payment_method text NOT NULL,
  status public.p2p_order_status NOT NULL DEFAULT 'pending',
  order_number text UNIQUE NOT NULL DEFAULT 'P2P' || to_char(now(), 'YYYYMMDD') || substr(md5(random()::text), 1, 6),
  dispute_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  released_at timestamptz
);

-- P2P Chat messages
CREATE TABLE public.p2p_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.p2p_orders(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id),
  message text,
  image_url text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- KYC submissions
CREATE TABLE public.kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier public.kyc_tier NOT NULL,
  status public.kyc_status NOT NULL DEFAULT 'pending',
  id_front_url text,
  id_back_url text,
  selfie_url text,
  rejection_reason text,
  reviewed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

-- Earn subscriptions
CREATE TYPE public.earn_sub_status AS ENUM ('active', 'redeemed', 'matured');

CREATE TABLE public.earn_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.earn_products(id),
  amount numeric(28, 8) NOT NULL,
  earned_total numeric(28, 8) NOT NULL DEFAULT 0,
  status public.earn_sub_status NOT NULL DEFAULT 'active',
  start_date date NOT NULL DEFAULT current_date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-sync new users to profiles
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'user'::public.user_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Helper function to get user role (using uuid cast)
CREATE OR REPLACE FUNCTION get_user_role(uid uuid)
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = uid::uuid;
$$;

-- Public profiles view
CREATE VIEW public_profiles AS
  SELECT id, username, uid, avatar_url, vip_level, kyc_tier, role FROM profiles;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earn_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earn_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Admins full access profiles" ON profiles FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Users view own profile" ON profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (role IS NOT DISTINCT FROM get_user_role(auth.uid()));

-- Wallets policies
CREATE POLICY "Admins full access wallets" ON wallets FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Users view own wallets" ON wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own wallets" ON wallets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own wallets" ON wallets FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Transactions policies
CREATE POLICY "Admins full access transactions" ON transactions FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Users view own transactions" ON transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own transactions" ON transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Earn products policies
CREATE POLICY "Anyone can view earn products" ON earn_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage earn products" ON earn_products FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');

-- Earn subscriptions policies
CREATE POLICY "Admins full access earn subs" ON earn_subscriptions FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Users view own earn subs" ON earn_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own earn subs" ON earn_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own earn subs" ON earn_subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- P2P ads policies
CREATE POLICY "Anyone can view active p2p ads" ON p2p_ads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Merchants insert own ads" ON p2p_ads FOR INSERT TO authenticated WITH CHECK (auth.uid() = merchant_id);
CREATE POLICY "Merchants update own ads" ON p2p_ads FOR UPDATE TO authenticated USING (auth.uid() = merchant_id);
CREATE POLICY "Admins full access p2p ads" ON p2p_ads FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');

-- P2P orders policies
CREATE POLICY "Admins full access p2p orders" ON p2p_orders FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Parties view own p2p orders" ON p2p_orders FOR SELECT TO authenticated USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
CREATE POLICY "Buyers insert p2p orders" ON p2p_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = buyer_id);
CREATE POLICY "Parties update p2p orders" ON p2p_orders FOR UPDATE TO authenticated USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- P2P messages policies
CREATE POLICY "Admins full access p2p messages" ON p2p_messages FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Order parties view messages" ON p2p_messages FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM p2p_orders WHERE id = order_id AND (buyer_id = auth.uid() OR seller_id = auth.uid()))
);
CREATE POLICY "Order parties send messages" ON p2p_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);

-- KYC submissions policies
CREATE POLICY "Admins full access kyc" ON kyc_submissions FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Users view own kyc" ON kyc_submissions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own kyc" ON kyc_submissions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Seed earn products
INSERT INTO public.earn_products (name, asset, earn_type, apy, min_amount, duration_days) VALUES
  ('USDT Flexible Savings', 'USDT', 'flexible', 4.50, 10, NULL),
  ('BTC Flexible Savings', 'BTC', 'flexible', 1.20, 0.001, NULL),
  ('ETH Flexible Savings', 'ETH', 'flexible', 2.80, 0.01, NULL),
  ('EXX Flexible Savings', 'EXX', 'flexible', 12.00, 100, NULL),
  ('USDT 7-Day Fixed', 'USDT', 'fixed', 6.00, 100, 7),
  ('USDT 30-Day Fixed', 'USDT', 'fixed', 8.50, 100, 30),
  ('USDT 60-Day Fixed', 'USDT', 'fixed', 10.00, 100, 60),
  ('USDT 90-Day Fixed', 'USDT', 'fixed', 12.50, 100, 90),
  ('ETH Staking', 'ETH', 'staking', 4.00, 0.1, NULL),
  ('SOL Staking', 'SOL', 'staking', 6.50, 1, NULL);
