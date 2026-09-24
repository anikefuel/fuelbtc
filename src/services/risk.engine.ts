// Risk Engine — margin calculations, liquidation price, position risk
// All calculations are deterministic and provider-agnostic.

export interface LiquidationParams {
  side: 'long' | 'short';
  entryPrice: number;
  leverage: number;
  maintMarginRate?: number; // default 0.005 (0.5%)
}

export interface MarginRatioParams {
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  initialMargin: number;
  maintMarginRate?: number;
  cumFundingFee?: number;
}

export interface PositionRisk {
  unrealizedPnl: number;
  marginRatio: number;      // 0–1, 1 = liquidation
  liqPrice: number;
  isAtRisk: boolean;        // marginRatio > 0.8
  isNearLiquidation: boolean; // marginRatio > 0.9
}

export const RiskEngine = {
  /** Liquidation price for isolated margin */
  calcLiqPrice({ side, entryPrice, leverage, maintMarginRate = 0.005 }: LiquidationParams): number {
    if (side === 'long') {
      // liq = entry * (1 - 1/leverage + maintMarginRate)
      return entryPrice * (1 - 1 / leverage + maintMarginRate);
    } else {
      return entryPrice * (1 + 1 / leverage - maintMarginRate);
    }
  },

  /** Unrealized PnL */
  calcUnrealizedPnl(side: 'long' | 'short', size: number, entryPrice: number, markPrice: number): number {
    return side === 'long'
      ? (markPrice - entryPrice) * size
      : (entryPrice - markPrice) * size;
  },

  /** Margin ratio = maintenanceMargin / (wallet balance after PnL) */
  calcMarginRatio({
    side, size, entryPrice, markPrice, initialMargin,
    maintMarginRate = 0.005, cumFundingFee = 0,
  }: MarginRatioParams): number {
    const notional = size * markPrice;
    const maintMargin = notional * maintMarginRate;
    const unrealizedPnl = this.calcUnrealizedPnl(side, size, entryPrice, markPrice);
    const walletBalance = initialMargin + unrealizedPnl - cumFundingFee;
    if (walletBalance <= 0) return 1;
    return maintMargin / walletBalance;
  },

  /** Full position risk assessment */
  assessRisk(params: MarginRatioParams & { leverage: number }): PositionRisk {
    const unrealizedPnl = this.calcUnrealizedPnl(params.side, params.size, params.entryPrice, params.markPrice);
    const marginRatio = this.calcMarginRatio(params);
    const liqPrice = this.calcLiqPrice({ side: params.side, entryPrice: params.entryPrice, leverage: params.leverage });
    return {
      unrealizedPnl,
      marginRatio: Math.min(1, marginRatio),
      liqPrice,
      isAtRisk: marginRatio > 0.8,
      isNearLiquidation: marginRatio > 0.9,
    };
  },

  /** Required margin for a new position */
  calcInitialMargin(notional: number, leverage: number): number {
    return notional / leverage;
  },

  /** Max position size given available balance */
  calcMaxPositionSize(availableBalance: number, price: number, leverage: number): number {
    return (availableBalance * leverage) / price;
  },

  /** Validate leverage against bracket */
  validateLeverage(leverage: number, notional: number, brackets: Array<{ notionalCap: number; initialLeverage: number }>): boolean {
    for (const b of brackets) {
      if (notional <= b.notionalCap) return leverage <= b.initialLeverage;
    }
    return false;
  },

  /** Funding fee for a position */
  calcFundingFee(side: 'long' | 'short', size: number, markPrice: number, fundingRate: number): number {
    const notional = size * markPrice;
    // Longs pay funding when rate > 0, shorts receive; vice versa
    return side === 'long' ? notional * fundingRate : -notional * fundingRate;
  },
};
