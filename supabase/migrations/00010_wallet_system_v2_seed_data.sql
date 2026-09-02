
-- Asset Networks seed
INSERT INTO asset_networks (asset, network, network_label, min_deposit, min_withdrawal, withdrawal_fee, required_confs, estimated_arrival, has_memo, sort_order) VALUES
('BTC','bitcoin','Bitcoin Network',0.0001,0.001,0.00005,3,'~30 min',FALSE,1),
('ETH','ethereum','Ethereum (ERC20)',0.001,0.01,0.003,12,'~5 min',FALSE,1),
('USDT','ethereum','Ethereum (ERC20)',1,10,2.00,12,'~5 min',FALSE,1),
('USDT','tron','TRON (TRC20)',1,10,1.00,20,'~3 min',FALSE,2),
('USDT','bsc','BSC (BEP20)',1,10,0.50,15,'~3 min',FALSE,3),
('USDT','solana','Solana (SPL)',1,10,0.50,1,'~30 sec',FALSE,4),
('USDC','ethereum','Ethereum (ERC20)',1,10,2.00,12,'~5 min',FALSE,1),
('USDC','bsc','BSC (BEP20)',1,10,0.50,15,'~3 min',FALSE,2),
('USDC','solana','Solana (SPL)',1,10,0.50,1,'~30 sec',FALSE,3),
('BNB','bsc','BSC (BEP20)',0.01,0.05,0.0005,15,'~3 min',FALSE,1),
('SOL','solana','Solana',0.1,1,0.01,1,'~30 sec',FALSE,1),
('XRP','xrp','XRP Ledger',1,5,0.25,1,'~5 sec',TRUE,1),
('TRX','tron','TRON',10,50,1.00,20,'~3 min',FALSE,1),
('LTC','litecoin','Litecoin',0.01,0.1,0.001,6,'~10 min',FALSE,1),
('DOGE','dogecoin','Dogecoin',10,50,5.00,6,'~5 min',FALSE,1)
ON CONFLICT (asset, network) DO NOTHING;

INSERT INTO wallet_fees (fee_type, flat_fee, percent_fee, min_fee) VALUES
('internal_transfer', 0, 0, 0),
('wallet_transfer', 0, 0, 0),
('p2p_escrow', 0, 0, 0)
ON CONFLICT DO NOTHING;

INSERT INTO wallet_limits (limit_type, kyc_level, max_amount, min_amount) VALUES
('daily_withdrawal', 0, 100, 0),
('daily_withdrawal', 1, 10000, 0),
('daily_withdrawal', 2, 100000, 0),
('daily_withdrawal', 3, 1000000, 0),
('single_withdrawal', 0, 100, 0),
('single_withdrawal', 1, 5000, 0),
('single_withdrawal', 2, 50000, 0),
('single_withdrawal', 3, 500000, 0)
ON CONFLICT DO NOTHING;

INSERT INTO hot_wallets (asset, network, address, label, daily_limit) VALUES
('USDT','tron','THotWalletTRC20AdminOnly001','USDT-TRC20 Hot Wallet',500000),
('USDT','ethereum','0xHotWalletERC20AdminOnly001','USDT-ERC20 Hot Wallet',500000),
('BTC','bitcoin','bc1qHotWalletBTCAdminOnly001','BTC Hot Wallet',5),
('ETH','ethereum','0xHotWalletETHAdminOnly001','ETH Hot Wallet',100)
ON CONFLICT DO NOTHING;

INSERT INTO cold_wallets (asset, network, address, label) VALUES
('USDT','tron','TColdWalletTRC20ColdStorage001','USDT Cold Storage'),
('BTC','bitcoin','bc1qColdWalletBTCColdStorage001','BTC Cold Storage'),
('ETH','ethereum','0xColdWalletETHColdStorage001','ETH Cold Storage')
ON CONFLICT DO NOTHING;
