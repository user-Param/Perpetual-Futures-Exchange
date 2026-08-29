import { config } from "../config";
import { Decimal, roundToTickSize, roundToStepSize, validatePrice, validateQuantity } from "../utils/decimal";
import { Market } from "../exchange/exchangeClient";
import { logger } from "../logger";

export interface Quote {
  bids: { price: string; quantity: string }[];
  asks: { price: string; quantity: string }[];
}

export interface StrategyInput {
  referencePrice: string;
  market: Market;
}

export class MarketMakerStrategy {
  private spreadBps: number;
  private orderSize: string;
  private levels = 20;
  private levelSpreadBps = 2;

  constructor() {
    this.spreadBps = config.spreadBps;
    this.orderSize = config.orderSize;
  }

  calculateQuotes(input: StrategyInput): Quote {
    const { referencePrice, market } = input;
    const refPrice = new Decimal(referencePrice);
    const tickSize = parseFloat(market.tickSize);
    const stepSize = parseFloat(market.stepSize);
    const baseQuantity = parseFloat(roundToStepSize(this.orderSize, market.stepSize));

    const halfSpread = refPrice.mul(this.spreadBps.toString()).div("20000");
    const levelSpread = refPrice.mul(this.levelSpreadBps.toString()).div("10000");

    const bids: { price: string; quantity: string }[] = [];
    const asks: { price: string; quantity: string }[] = [];

    for (let i = 0; i < this.levels; i++) {
      const levelOffset = levelSpread.mul((i + 1).toString());
      const bidPrice = roundToTickSize(refPrice.minus(halfSpread).minus(levelOffset).toString(), market.tickSize);
      const askPrice = roundToTickSize(refPrice.plus(halfSpread).plus(levelOffset).toString(), market.tickSize);
      const qty = roundToStepSize((baseQuantity * (1 + i * 0.1)).toFixed(8), market.stepSize);

      if (validatePrice(bidPrice, market.tickSize) && validateQuantity(qty, market.stepSize, market.minOrderSize, market.maxOrderSize)) {
        bids.push({ price: bidPrice, quantity: qty });
      }
      if (validatePrice(askPrice, market.tickSize) && validateQuantity(qty, market.stepSize, market.minOrderSize, market.maxOrderSize)) {
        asks.push({ price: askPrice, quantity: qty });
      }
    }

    logger.debug("Calculated quotes", { referencePrice, bidLevels: bids.length, askLevels: asks.length, spreadBps: this.spreadBps });

    return { bids, asks };
  }
}

export function createMarketMakerStrategy(): MarketMakerStrategy {
  return new MarketMakerStrategy();
}