
-- ═══════════════════════════════════════════════════════════════════
-- SEED: trading_pairs (spot + futures)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO trading_pairs (symbol,base_asset,quote_asset,market_type_v2,status_v2,min_qty,max_qty,step_size,min_notional,tick_size,maker_fee,taker_fee,max_leverage,price_precision,qty_precision,is_futures_ok,provider_symbol,sort_order) VALUES
('BTCUSDT','BTC','USDT','spot','active',0.00001,9000,0.00001,5,0.01,0.001,0.001,1,2,5,false,'BTCUSDT',1),
('ETHUSDT','ETH','USDT','spot','active',0.0001,90000,0.0001,5,0.01,0.001,0.001,1,2,4,false,'ETHUSDT',2),
('BNBUSDT','BNB','USDT','spot','active',0.001,900000,0.001,5,0.01,0.001,0.001,1,2,3,false,'BNBUSDT',3),
('SOLUSDT','SOL','USDT','spot','active',0.01,9000000,0.01,5,0.001,0.001,0.001,1,3,2,false,'SOLUSDT',4),
('XRPUSDT','XRP','USDT','spot','active',0.1,90000000,0.1,5,0.0001,0.001,0.001,1,4,1,false,'XRPUSDT',5),
('DOGEUSDT','DOGE','USDT','spot','active',1,900000000,1,5,0.00001,0.001,0.001,1,5,0,false,'DOGEUSDT',6),
('LTCUSDT','LTC','USDT','spot','active',0.001,900000,0.001,5,0.01,0.001,0.001,1,2,3,false,'LTCUSDT',7),
('TRXUSDT','TRX','USDT','spot','active',1,900000000,1,5,0.00001,0.001,0.001,1,5,0,false,'TRXUSDT',8),
('USDCUSDT','USDC','USDT','spot','active',0.01,9000000,0.01,5,0.0001,0.0001,0.0001,1,4,2,false,'USDCUSDT',9),
-- Futures perpetual
('BTCUSDT_PERP','BTC','USDT','futures','active',0.001,1000,0.001,5,0.1,0.0002,0.0005,125,1,3,true,'BTCUSDT',101),
('ETHUSDT_PERP','ETH','USDT','futures','active',0.001,10000,0.001,5,0.01,0.0002,0.0005,100,2,3,true,'ETHUSDT',102),
('BNBUSDT_PERP','BNB','USDT','futures','active',0.01,100000,0.01,5,0.01,0.0002,0.0005,75,2,2,true,'BNBUSDT',103),
('SOLUSDT_PERP','SOL','USDT','futures','active',0.1,1000000,0.1,5,0.001,0.0002,0.0005,50,3,1,true,'SOLUSDT',104),
('XRPUSDT_PERP','XRP','USDT','futures','active',1,10000000,1,5,0.0001,0.0002,0.0005,50,4,0,true,'XRPUSDT',105),
('DOGEUSDT_PERP','DOGE','USDT','futures','active',1,100000000,1,5,0.00001,0.0002,0.0005,50,5,0,true,'DOGEUSDT',106)
ON CONFLICT (symbol) DO UPDATE SET
  status_v2=EXCLUDED.status_v2, maker_fee=EXCLUDED.maker_fee, taker_fee=EXCLUDED.taker_fee,
  max_leverage=EXCLUDED.max_leverage, is_futures_ok=EXCLUDED.is_futures_ok, sort_order=EXCLUDED.sort_order;

-- ═══════════════════════════════════════════════════════════════════
-- SEED: leverage_brackets (BTC example; others abbreviated)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO leverage_brackets (symbol,bracket,initial_leverage,notional_cap,notional_floor,maint_margin_rate,cum_fast_out_amount) VALUES
-- BTC
('BTCUSDT_PERP',1,125,50000,0,0.004,0),
('BTCUSDT_PERP',2,100,250000,50000,0.005,50),
('BTCUSDT_PERP',3,50,1000000,250000,0.01,1300),
('BTCUSDT_PERP',4,20,5000000,1000000,0.025,14800),
('BTCUSDT_PERP',5,10,20000000,5000000,0.05,89800),
('BTCUSDT_PERP',6,5,50000000,20000000,0.1,589800),
('BTCUSDT_PERP',7,4,100000000,50000000,0.125,1839800),
('BTCUSDT_PERP',8,3,200000000,100000000,0.15,4339800),
('BTCUSDT_PERP',9,2,300000000,200000000,0.25,24339800),
-- ETH
('ETHUSDT_PERP',1,100,10000,0,0.005,0),
('ETHUSDT_PERP',2,75,100000,10000,0.0065,150),
('ETHUSDT_PERP',3,50,500000,100000,0.01,3650),
('ETHUSDT_PERP',4,25,5000000,500000,0.02,53650),
('ETHUSDT_PERP',5,10,20000000,5000000,0.05,553650),
('ETHUSDT_PERP',6,5,50000000,20000000,0.1,1553650),
('ETHUSDT_PERP',7,3,100000000,50000000,0.125,2803650),
-- SOL
('SOLUSDT_PERP',1,50,10000,0,0.01,0),
('SOLUSDT_PERP',2,25,100000,10000,0.02,100),
('SOLUSDT_PERP',3,10,500000,100000,0.05,3100),
('SOLUSDT_PERP',4,5,1000000,500000,0.1,28100),
('SOLUSDT_PERP',5,2,5000000,1000000,0.125,53100),
-- XRP
('XRPUSDT_PERP',1,50,10000,0,0.01,0),
('XRPUSDT_PERP',2,25,100000,10000,0.02,100),
('XRPUSDT_PERP',3,10,500000,100000,0.05,3100),
-- DOGE
('DOGEUSDT_PERP',1,50,10000,0,0.01,0),
('DOGEUSDT_PERP',2,25,100000,10000,0.02,100),
('DOGEUSDT_PERP',3,10,500000,100000,0.05,3100)
ON CONFLICT (symbol,bracket) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- SEED: trading_fees (VIP tiers 0-5)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO trading_fees (market_type,vip_level,maker_fee,taker_fee,funding_fee_rate,liquidation_fee) VALUES
('spot',0,0.001,0.001,0,0),
('spot',1,0.0009,0.001,0,0),
('spot',2,0.0008,0.0009,0,0),
('spot',3,0.0007,0.0008,0,0),
('spot',4,0.0005,0.0007,0,0),
('spot',5,0.0002,0.0005,0,0),
('futures',0,0.0002,0.0005,0.0001,0.005),
('futures',1,0.00016,0.00045,0.0001,0.004),
('futures',2,0.00012,0.0004,0.0001,0.003),
('futures',3,0.0001,0.00035,0.0001,0.003),
('futures',4,0.00008,0.0003,0.0001,0.002),
('futures',5,0.00005,0.00025,0.0001,0.002)
ON CONFLICT (market_type,vip_level) DO UPDATE SET
  maker_fee=EXCLUDED.maker_fee,taker_fee=EXCLUDED.taker_fee;

-- ═══════════════════════════════════════════════════════════════════
-- SEED: trading_settings
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO trading_settings (key,value,description) VALUES
('spot_trading_enabled',      'true',                   'Global spot trading on/off'),
('futures_trading_enabled',   'true',                   'Global futures trading on/off'),
('max_open_orders_per_user',  '200',                    'Max simultaneous open orders per user'),
('max_position_count',        '20',                     'Max open futures positions per user'),
('default_provider',          '"binance"',              'Default liquidity provider'),
('order_rate_limit_per_min',  '1200',                   'Max order ops per minute per user'),
('futures_max_leverage',      '125',                    'Hard cap on leverage across all pairs'),
('liquidation_fee_rate',      '0.005',                  'Liquidation fee: 0.5%'),
('insurance_fund_balance',    '0',                      'Insurance fund USDT balance'),
('maintenance_mode',          'false',                  'If true, all trading halted'),
('spot_maintenance',          'false',                  'Spot trading maintenance mode'),
('futures_maintenance',       'false',                  'Futures trading maintenance mode'),
('funding_interval_hours',    '8',                      'Funding rate payment interval'),
('min_kyc_level_futures',     '1',                      'Min KYC level required for futures'),
('api_trading_enabled',       'true',                   'API order placement enabled')
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

-- ═══════════════════════════════════════════════════════════════════
-- SEED: market_data_cache (initial placeholder prices)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO market_data_cache (symbol,market_type,price,price_change,price_change_pct,high_24h,low_24h,volume_24h,quote_volume_24h) VALUES
('BTCUSDT','spot',67500,850,1.27,68200,66800,25000,1687500000),
('ETHUSDT','spot',3480,45,1.31,3520,3410,180000,626400000),
('BNBUSDT','spot',590,8,1.37,598,578,850000,501500000),
('SOLUSDT','spot',182,3.5,1.96,186,178,4500000,819000000),
('XRPUSDT','spot',0.625,0.012,1.96,0.635,0.615,120000000,75000000),
('DOGEUSDT','spot',0.168,0.004,2.44,0.172,0.164,750000000,126000000),
('LTCUSDT','spot',89.5,1.2,1.36,91.2,88.1,450000,40275000),
('TRXUSDT','spot',0.124,0.002,1.64,0.126,0.122,500000000,62000000),
('USDCUSDT','spot',1.0001,0.0001,0.01,1.0002,0.9999,1000000000,1000100000),
('BTCUSDT_PERP','futures',67520,855,1.28,68210,66810,85000,5739200000),
('ETHUSDT_PERP','futures',3482,46,1.34,3522,3412,550000,1915100000),
('BNBUSDT_PERP','futures',591,8.5,1.46,599,579,2500000,1477500000),
('SOLUSDT_PERP','futures',182.5,3.6,2.01,186.5,178.5,12000000,2190000000),
('XRPUSDT_PERP','futures',0.626,0.013,2.12,0.636,0.616,350000000,219100000),
('DOGEUSDT_PERP','futures',0.169,0.005,3.05,0.173,0.165,2000000000,338000000)
ON CONFLICT (symbol) DO UPDATE SET
  price=EXCLUDED.price, updated_at=now();
