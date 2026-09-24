// Provider Execution Engine — Public API
// Import from '@/engine' to access the full engine.

export * from './types';
export * from './config';
export * from './cache';
export * from './logger';
export * from './ProviderManager';

// Adapters
export { MockProviderAdapter }       from './adapters/mock';
export { BinanceAdapter }            from './adapters/binance';
export { CoinGeckoAdapter }          from './adapters/coingecko';
export { CoinMarketCapAdapter }      from './adapters/coinmarketcap';
export { GoPlusAdapter }             from './adapters/goplus';
export type { TokenSecurityResult }  from './adapters/goplus';
export { BlockchairAdapter }         from './adapters/blockchair';
export type { WalletBalanceResult, TransactionHistoryResult } from './adapters/blockchair';
export { AlchemyAdapter }            from './adapters/alchemy';
export type { AlchemyWalletResult }  from './adapters/alchemy';

// ─── Bootstrap — register all adapters on import ─────────────────────────────
import { providerManager } from './ProviderManager';
import { MockProviderAdapter }   from './adapters/mock';
import { BinanceAdapter }        from './adapters/binance';
import { CoinGeckoAdapter }      from './adapters/coingecko';
import { CoinMarketCapAdapter }  from './adapters/coinmarketcap';
import { GoPlusAdapter }         from './adapters/goplus';
import { BlockchairAdapter }     from './adapters/blockchair';
import { AlchemyAdapter }        from './adapters/alchemy';

// Register in priority order — manager also uses config.priority internally
providerManager.register(new MockProviderAdapter());
providerManager.register(new BinanceAdapter());
providerManager.register(new CoinGeckoAdapter());
providerManager.register(new CoinMarketCapAdapter());
providerManager.register(new GoPlusAdapter());
providerManager.register(new BlockchairAdapter());
providerManager.register(new AlchemyAdapter());
