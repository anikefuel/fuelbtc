
-- Crypto assets for P2P
INSERT INTO p2p_assets (symbol, name, decimals, sort_order) VALUES
  ('USDT', 'Tether',          6, 1),
  ('BTC',  'Bitcoin',         8, 2),
  ('ETH',  'Ethereum',        18,3),
  ('BNB',  'BNB',             18,4),
  ('USDC', 'USD Coin',        6, 5),
  ('SOL',  'Solana',          9, 6),
  ('XRP',  'Ripple',          6, 7),
  ('TRX',  'TRON',            6, 8),
  ('LTC',  'Litecoin',        8, 9),
  ('DOGE', 'Dogecoin',        8,10);

-- Fiat currencies
INSERT INTO p2p_fiats (code, name, symbol, country_code, sort_order) VALUES
  ('NGN','Nigerian Naira',       '₦', 'NG', 1),
  ('USD','US Dollar',            '$', 'US', 2),
  ('EUR','Euro',                 '€', 'EU', 3),
  ('GBP','British Pound',        '£', 'GB', 4),
  ('KES','Kenyan Shilling',      'KSh','KE',5),
  ('GHS','Ghanaian Cedi',        '₵', 'GH', 6),
  ('ZAR','South African Rand',   'R',  'ZA', 7),
  ('UGX','Ugandan Shilling',     'USh','UG',8),
  ('TZS','Tanzanian Shilling',   'TSh','TZ',9),
  ('AED','UAE Dirham',           'د.إ','AE',10),
  ('INR','Indian Rupee',         '₹', 'IN', 11),
  ('PKR','Pakistani Rupee',      '₨', 'PK', 12),
  ('IDR','Indonesian Rupiah',    'Rp', 'ID', 13),
  ('MYR','Malaysian Ringgit',    'RM', 'MY', 14),
  ('BRL','Brazilian Real',       'R$', 'BR', 15),
  ('MXN','Mexican Peso',         '$',  'MX', 16),
  ('TRY','Turkish Lira',         '₺', 'TR', 17),
  ('EGP','Egyptian Pound',       'E£', 'EG', 18);

-- Countries
INSERT INTO p2p_countries (code, name, phone_prefix, default_fiat, sort_order) VALUES
  ('NG','Nigeria',         '+234','NGN',1),
  ('GH','Ghana',           '+233','GHS',2),
  ('KE','Kenya',           '+254','KES',3),
  ('ZA','South Africa',    '+27', 'ZAR',4),
  ('UG','Uganda',          '+256','UGX',5),
  ('TZ','Tanzania',        '+255','TZS',6),
  ('US','United States',   '+1',  'USD',7),
  ('GB','United Kingdom',  '+44', 'GBP',8),
  ('AE','UAE',             '+971','AED',9),
  ('IN','India',           '+91', 'INR',10),
  ('PK','Pakistan',        '+92', 'PKR',11),
  ('ID','Indonesia',       '+62', 'IDR',12),
  ('MY','Malaysia',        '+60', 'MYR',13),
  ('BR','Brazil',          '+55', 'BRL',14),
  ('TR','Turkey',          '+90', 'TRY',15),
  ('EG','Egypt',           '+20', 'EGP',16);

-- Payment methods
INSERT INTO p2p_payment_methods (name, slug, country_codes, fiat_codes, sort_order) VALUES
  ('Bank Transfer',      'bank_transfer',  '{"NG","GH","KE","ZA","UG","TZ","US","GB","AE","IN","PK","ID","MY","BR","TR","EG"}', '{"NGN","GHS","KES","ZAR","UGX","TZS","USD","GBP","AED","INR","PKR","IDR","MYR","BRL","TRY","EGP"}', 1),
  ('OPay',               'opay',           '{"NG"}', '{"NGN"}', 2),
  ('PalmPay',            'palmpay',        '{"NG"}', '{"NGN"}', 3),
  ('Moniepoint',         'moniepoint',     '{"NG"}', '{"NGN"}', 4),
  ('Kuda',               'kuda',           '{"NG"}', '{"NGN"}', 5),
  ('Access Bank',        'access_bank',    '{"NG"}', '{"NGN"}', 6),
  ('GTBank',             'gtbank',         '{"NG"}', '{"NGN"}', 7),
  ('Zenith Bank',        'zenith_bank',    '{"NG"}', '{"NGN"}', 8),
  ('UBA',                'uba',            '{"NG","GH"}', '{"NGN","GHS"}', 9),
  ('M-Pesa',             'mpesa',          '{"KE","TZ","UG"}', '{"KES","TZS","UGX"}', 10),
  ('Airtel Money',       'airtel_money',   '{"KE","UG","TZ","GH"}', '{"KES","UGX","TZS","GHS"}', 11),
  ('MTN Mobile Money',   'mtn_momo',       '{"GH","UG","TZ"}', '{"GHS","UGX","TZS"}', 12),
  ('Vodafone Cash',      'vodafone_cash',  '{"GH"}', '{"GHS"}', 13),
  ('Wise',               'wise',           '{"US","GB","AE","IN","ID","MY","BR","TR"}', '{"USD","GBP","AED","INR","IDR","MYR","BRL","TRY"}', 14),
  ('Revolut',            'revolut',        '{"US","GB"}', '{"USD","GBP","EUR"}', 15),
  ('PayPal',             'paypal',         '{"US","GB"}', '{"USD","GBP","EUR"}', 16),
  ('SEPA',               'sepa',           '{"GB"}', '{"EUR"}', 17),
  ('UPI',                'upi',            '{"IN"}', '{"INR"}', 18),
  ('IMPS',               'imps',           '{"IN"}', '{"INR"}', 19),
  ('Paytm',              'paytm',          '{"IN"}', '{"INR"}', 20),
  ('Cash Deposit',       'cash_deposit',   '{"NG","GH","KE","ZA","UG","TZ","EG"}', '{"NGN","GHS","KES","ZAR","UGX","TZS","EGP"}', 21),
  ('Perfect Money',      'perfect_money',  '{"NG","GH","US"}', '{"NGN","GHS","USD"}', 22),
  ('Skrill',             'skrill',         '{"GB","US"}', '{"GBP","USD","EUR"}', 23);

-- Default zero fee
INSERT INTO p2p_fees (fee_type, rate) VALUES ('zero', 0);
