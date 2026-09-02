// Order types — spot, futures, OCO

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop_limit' | 'stop_market' | 'oco' | 'trailing_stop';
export type OrderStatus =
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX';

export interface SpotOrder {
  id: string;
  userId: string;
  symbol: string;
  base: string;
  quote: string;
  side: OrderSide;
  orderType: OrderType;
  status: OrderStatus;
  price?: number;       // null for market orders
  stopPrice?: number;
  quantity: number;
  executedQty: number;
  cumulativeQuoteQty: number;
  fee: number;
  feeAsset: string;
  timeInForce: TimeInForce;
  createdAt: string;
  updatedAt: string;
}

// Futures-specific extensions
export type MarginMode = 'cross' | 'isolated';
export type PositionSide = 'long' | 'short' | 'both';

export interface FuturesOrder extends SpotOrder {
  leverage: number;
  marginMode: MarginMode;
  positionSide: PositionSide;
  reduceOnly: boolean;
  tpPrice?: number;
  slPrice?: number;
}

export interface FuturesPosition {
  id: string;
  userId: string;
  symbol: string;
  side: 'Long' | 'Short';
  size: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liqPrice: number;
  marginMode: MarginMode;
  margin: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl: number;
  tpPrice?: number;
  slPrice?: number;
  createdAt: string;
}

export interface OCOOrder {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  limitPrice: number;
  stopPrice: number;
  stopLimitPrice: number;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderFormState {
  orderType: OrderType;
  side: OrderSide;
  price: string;
  stopPrice: string;
  quantity: string;
  total: string;
  leverage?: number;
  marginMode?: MarginMode;
  tpPrice?: string;
  slPrice?: string;
}
