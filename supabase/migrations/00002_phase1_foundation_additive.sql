
-- ─────────────────────────────────────────────────────────────────
--  Phase 1 Additive Migration — adds tables that don't exist yet
--  Safe: uses IF NOT EXISTS / DO blocks for all types & tables
-- ─────────────────────────────────────────────────────────────────

-- ── New enums (only create if not already present) ────────────
do $$ begin
  create type asset_status as enum ('active','suspended','delisted','maintenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_side as enum ('buy','sell');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_type as enum ('market','limit','stop_limit','stop_market','oco','trailing_stop');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('open','partially_filled','filled','cancelled','expired','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_tif as enum ('gtc','ioc','fok','day');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notif_category as enum ('trade','deposit','withdrawal','p2p','earn','security','system','announcement','kyc','price_alert','referral');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notif_priority as enum ('low','medium','high','critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type provider_type as enum ('spot','futures','price_feed','custody','kyc','banking');
exception when duplicate_object then null; end $$;

-- ── Blockchain Networks ────────────────────────────────────────
create table if not exists blockchain_networks (
  id              text primary key,
  name            text not null,
  chain_id        int,
  native_asset    text not null,
  is_active       boolean not null default true,
  confirmations   int not null default 12,
  avg_block_time  int,
  explorer_url    text,
  rpc_url_public  text,
  created_at      timestamptz not null default now()
);

-- ── Assets ────────────────────────────────────────────────────
create table if not exists assets (
  symbol              text primary key,
  name                text not null,
  status              asset_status not null default 'active',
  decimals            int not null default 8,
  min_withdrawal      numeric(30,10),
  withdrawal_fee      numeric(30,10),
  deposit_enabled     boolean not null default true,
  withdrawal_enabled  boolean not null default true,
  is_fiat             boolean not null default false,
  logo_url            text,
  coingecko_id        text,
  binance_id          text,
  explorer_url        text,
  contract_address    text,
  network_id          text references blockchain_networks(id),
  tags                text[] default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Fiat Currencies ───────────────────────────────────────────
create table if not exists fiat_currencies (
  code            text primary key,
  name            text not null,
  symbol          text not null,
  is_active       boolean not null default true,
  decimal_places  int not null default 2,
  min_p2p_amount  numeric(20,4),
  max_p2p_amount  numeric(20,4),
  created_at      timestamptz not null default now()
);

-- ── Countries ─────────────────────────────────────────────────
create table if not exists countries (
  code            text primary key,
  name            text not null,
  currency_code   text references fiat_currencies(code),
  is_supported    boolean not null default true,
  is_sanctioned   boolean not null default false,
  kyc_provider    text,
  banking_partner text,
  created_at      timestamptz not null default now()
);

-- ── Trading Pairs ─────────────────────────────────────────────
create table if not exists trading_pairs (
  symbol          text primary key,
  base_asset      text not null,
  quote_asset     text not null,
  is_active       boolean not null default true,
  min_qty         numeric(30,10) not null default 0.00001,
  max_qty         numeric(30,10),
  tick_size       numeric(30,10) not null default 0.01,
  step_size       numeric(30,10) not null default 0.00001,
  maker_fee       numeric(8,6)   not null default 0.001,
  taker_fee       numeric(8,6)   not null default 0.001,
  market_type     text           not null default 'spot',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Orders ────────────────────────────────────────────────────
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  client_order_id text,
  symbol          text not null,
  side            order_side not null,
  order_type      order_type not null,
  status          order_status not null default 'open',
  price           numeric(30,10),
  stop_price      numeric(30,10),
  quantity        numeric(30,10) not null,
  filled_qty      numeric(30,10) not null default 0,
  avg_fill_price  numeric(30,10),
  tif             order_tif not null default 'gtc',
  fee             numeric(30,10) not null default 0,
  fee_asset       text,
  is_maker        boolean,
  market_type     text not null default 'spot',
  leverage        int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create index if not exists idx_orders_user_id    on orders(user_id);
create index if not exists idx_orders_symbol     on orders(symbol);
create index if not exists idx_orders_status     on orders(status);
create index if not exists idx_orders_created_at on orders(created_at desc);

-- ── Notifications ─────────────────────────────────────────────
create table if not exists notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles(id) on delete cascade,
  category        notif_category not null,
  title           text not null,
  body            text not null,
  priority        notif_priority not null default 'medium',
  is_read         boolean not null default false,
  action_url      text,
  action_label    text,
  metadata        jsonb default '{}',
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  expires_at      timestamptz
);

create index if not exists idx_notifications_user_id    on notifications(user_id);
create index if not exists idx_notifications_is_read    on notifications(is_read);
create index if not exists idx_notifications_created_at on notifications(created_at desc);

-- ── API Keys ──────────────────────────────────────────────────
create table if not exists api_keys (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  label           text not null,
  key_hash        text not null unique,
  key_prefix      text not null,
  permissions     text[] not null default '{"read"}',
  ip_whitelist    text[],
  is_active       boolean not null default true,
  last_used_at    timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_api_keys_user_id on api_keys(user_id);

-- ── User Sessions ─────────────────────────────────────────────
create table if not exists user_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  device_name     text,
  os              text,
  browser         text,
  ip_address      inet,
  country_code    text,
  city            text,
  is_current      boolean not null default false,
  last_active_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

create index if not exists idx_user_sessions_user_id on user_sessions(user_id);

-- ── Exchange Providers ────────────────────────────────────────
create table if not exists exchange_providers (
  id              text primary key,
  name            text not null,
  provider_type   provider_type not null,
  is_active       boolean not null default false,
  priority        int not null default 99,
  base_url        text,
  config          jsonb default '{}',
  created_at      timestamptz not null default now()
);

-- ── RLS for new tables ────────────────────────────────────────
alter table blockchain_networks  enable row level security;
alter table assets               enable row level security;
alter table fiat_currencies      enable row level security;
alter table countries            enable row level security;
alter table trading_pairs        enable row level security;
alter table orders               enable row level security;
alter table notifications        enable row level security;
alter table api_keys             enable row level security;
alter table user_sessions        enable row level security;
alter table exchange_providers   enable row level security;

-- Public read-only
do $$ begin
  create policy "assets_public"      on assets             for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "networks_public"    on blockchain_networks for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "currencies_public"  on fiat_currencies    for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "countries_public"   on countries          for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "pairs_public"       on trading_pairs      for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "providers_public"   on exchange_providers for select using (true);
exception when duplicate_object then null; end $$;

-- User-scoped tables
do $$ begin
  create policy "orders_self"        on orders             for all  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "notifications_read" on notifications      for select using (auth.uid() = user_id or user_id is null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "notifications_write" on notifications     for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "api_keys_self"      on api_keys           for all  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "user_sessions_self" on user_sessions      for all  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ── Seed: Fiat currencies ─────────────────────────────────────
insert into fiat_currencies (code, name, symbol, decimal_places, min_p2p_amount, max_p2p_amount) values
  ('USD', 'US Dollar',          '$',   2,    10,        50000),
  ('EUR', 'Euro',               '€',   2,    10,        50000),
  ('GBP', 'British Pound',      '£',   2,    10,        50000),
  ('NGN', 'Nigerian Naira',     '₦',   2,  1000,      5000000),
  ('KES', 'Kenyan Shilling',    'KSh', 2,   100,       500000),
  ('GHS', 'Ghanaian Cedi',      '₵',   2,    50,       200000),
  ('ZAR', 'South African Rand', 'R',   2,   100,       500000),
  ('AED', 'UAE Dirham',         'AED', 2,    40,       200000),
  ('INR', 'Indian Rupee',       '₹',   2,   800,      5000000),
  ('PKR', 'Pakistani Rupee',    'Rs',  2,  2000,      5000000),
  ('IDR', 'Indonesian Rupiah',  'Rp',  0, 100000,  500000000),
  ('MYR', 'Malaysian Ringgit',  'RM',  2,    40,       200000)
on conflict (code) do nothing;

-- ── Seed: Countries ───────────────────────────────────────────
insert into countries (code, name, currency_code, is_supported, is_sanctioned) values
  ('NG', 'Nigeria',        'NGN', true,  false),
  ('KE', 'Kenya',          'KES', true,  false),
  ('GH', 'Ghana',          'GHS', true,  false),
  ('ZA', 'South Africa',   'ZAR', true,  false),
  ('AE', 'UAE',            'AED', true,  false),
  ('IN', 'India',          'INR', true,  false),
  ('PK', 'Pakistan',       'PKR', true,  false),
  ('ID', 'Indonesia',      'IDR', true,  false),
  ('MY', 'Malaysia',       'MYR', true,  false),
  ('US', 'United States',  'USD', false, false),
  ('GB', 'United Kingdom', 'GBP', true,  false),
  ('IR', 'Iran',           'USD', false, true),
  ('RU', 'Russia',         'USD', false, true),
  ('KP', 'North Korea',    'USD', false, true)
on conflict (code) do nothing;

-- ── Seed: Blockchain networks ─────────────────────────────────
insert into blockchain_networks (id, name, chain_id, native_asset, confirmations, avg_block_time, explorer_url) values
  ('bitcoin',   'Bitcoin',           null,  'BTC',  6,   600, 'https://blockchair.com/bitcoin'),
  ('ethereum',  'Ethereum',          1,     'ETH',  12,  12,  'https://etherscan.io'),
  ('bsc',       'BNB Smart Chain',   56,    'BNB',  15,  3,   'https://bscscan.com'),
  ('solana',    'Solana',            null,  'SOL',  32,  1,   'https://explorer.solana.com'),
  ('polygon',   'Polygon',           137,   'MATIC',100, 2,   'https://polygonscan.com'),
  ('tron',      'Tron',              null,  'TRX',  20,  3,   'https://tronscan.org'),
  ('avalanche', 'Avalanche C-Chain', 43114, 'AVAX', 12,  2,   'https://snowtrace.io'),
  ('arbitrum',  'Arbitrum One',      42161, 'ETH',  1,   1,   'https://arbiscan.io')
on conflict (id) do nothing;

-- ── Seed: Assets ──────────────────────────────────────────────
insert into assets (symbol, name, decimals, min_withdrawal, withdrawal_fee, network_id, tags, coingecko_id) values
  ('BTC',  'Bitcoin',         8, 0.001,   0.0005, 'bitcoin',   '{layer1,pow}',             'bitcoin'),
  ('ETH',  'Ethereum',        8, 0.01,    0.003,  'ethereum',  '{layer1,smart-contract}',  'ethereum'),
  ('BNB',  'BNB',             8, 0.01,    0.005,  'bsc',       '{layer1,exchange-token}',  'binancecoin'),
  ('USDT', 'Tether USD',      6, 10,      1,      'ethereum',  '{stablecoin,erc20}',       'tether'),
  ('USDC', 'USD Coin',        6, 10,      1,      'ethereum',  '{stablecoin,erc20}',       'usd-coin'),
  ('SOL',  'Solana',          9, 0.1,     0.01,   'solana',    '{layer1,smart-contract}',  'solana'),
  ('XRP',  'XRP',             6, 20,      0.25,   null,        '{layer1,payment}',         'ripple'),
  ('DOGE', 'Dogecoin',        8, 50,      5,      null,        '{meme,pow}',               'dogecoin'),
  ('ADA',  'Cardano',         6, 10,      0.5,    null,        '{layer1,pos}',             'cardano'),
  ('AVAX', 'Avalanche',       9, 0.1,     0.01,   'avalanche', '{layer1,smart-contract}',  'avalanche-2'),
  ('MATIC','Polygon',         18, 10,     0.1,    'polygon',   '{layer2,scaling}',         'matic-network'),
  ('LTC',  'Litecoin',        8, 0.1,     0.001,  null,        '{layer1,pow,payment}',     'litecoin'),
  ('TRX',  'TRON',            6, 100,     1,      'tron',      '{layer1,smart-contract}',  'tron'),
  ('EXX',  'ExchangeX Token', 8, 100,     10,     'ethereum',  '{exchange-token,utility}', null),
  ('NGN',  'Nigerian Naira',  2, 1000,    0,      null,        '{fiat}',                   null)
on conflict (symbol) do nothing;

update assets set is_fiat = true where symbol = 'NGN';

-- ── Seed: Exchange providers ──────────────────────────────────
insert into exchange_providers (id, name, provider_type, priority) values
  ('binance',       'Binance',         'spot',      1),
  ('bybit',         'Bybit',           'futures',   1),
  ('kraken',        'Kraken',          'spot',      2),
  ('coingecko',     'CoinGecko',       'price_feed',1),
  ('coinmarketcap', 'CoinMarketCap',   'price_feed',2),
  ('tradingview',   'TradingView',     'price_feed',3),
  ('alchemy',       'Alchemy',         'custody',   1),
  ('quicknode',     'QuickNode',       'custody',   2),
  ('goplus',        'GoPlus Security', 'kyc',       1),
  ('blockchair',    'Blockchair',      'custody',   3)
on conflict (id) do nothing;

-- ── Seed: Core trading pairs ──────────────────────────────────
insert into trading_pairs (symbol, base_asset, quote_asset, market_type) values
  ('BTCUSDT',  'BTC',  'USDT', 'spot'),
  ('ETHUSDT',  'ETH',  'USDT', 'spot'),
  ('BNBUSDT',  'BNB',  'USDT', 'spot'),
  ('SOLUSDT',  'SOL',  'USDT', 'spot'),
  ('XRPUSDT',  'XRP',  'USDT', 'spot'),
  ('DOGEUSDT', 'DOGE', 'USDT', 'spot'),
  ('ADAUSDT',  'ADA',  'USDT', 'spot'),
  ('AVAXUSDT', 'AVAX', 'USDT', 'spot'),
  ('EXXUSDT',  'EXX',  'USDT', 'spot'),
  ('LTCUSDT',  'LTC',  'USDT', 'spot')
on conflict (symbol) do nothing;

-- ── Auto-create profile trigger (idempotent) ──────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, referral_code)
  values (
    new.id,
    new.email,
    'EXX-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Updated_at trigger ────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_assets_updated_at      on assets;
drop trigger if exists set_trading_pairs_updated   on trading_pairs;
drop trigger if exists set_orders_updated_at       on orders;

create trigger set_assets_updated_at       before update on assets       for each row execute procedure set_updated_at();
create trigger set_trading_pairs_updated   before update on trading_pairs for each row execute procedure set_updated_at();
create trigger set_orders_updated_at       before update on orders        for each row execute procedure set_updated_at();
