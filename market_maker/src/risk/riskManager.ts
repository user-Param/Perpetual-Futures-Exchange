import { config } from "../config";
import { Decimal } from "../utils/decimal";
import { ExchangeClient, Position } from "../exchange/exchangeClient";
import { logger } from "../logger";

export class RiskManager {
  private exchangeClient: ExchangeClient;
  private market: string;
  private maxPosition: Decimal;

  constructor(exchangeClient: ExchangeClient, market: string) {
    this.exchangeClient = exchangeClient;
    this.market = market;
    this.maxPosition = new Decimal(config.maxPosition);
  }

  async canIncreaseLong(additionalQuantity: string): Promise<boolean> {
    const position = await this.getPosition();
    if (!position) return true;

    if (position.side === "long") {
      const currentQty = new Decimal(position.quantity);
      const newQty = currentQty.plus(additionalQuantity);
      return newQty.lte(this.maxPosition);
    }
    return true;
  }

  async canIncreaseShort(additionalQuantity: string): Promise<boolean> {
    const position = await this.getPosition();
    if (!position) return true;

    if (position.side === "short") {
      const currentQty = new Decimal(position.quantity);
      const newQty = currentQty.plus(additionalQuantity);
      return newQty.lte(this.maxPosition);
    }
    return true;
  }

  async getPosition(): Promise<Position | null> {
    try {
      return await this.exchangeClient.getPosition(this.market);
    } catch (e) {
      logger.warn("Failed to get position for risk check", { error: (e as Error).message });
      return null;
    }
  }

  async getPositionRisk(): Promise<{ canBuy: boolean; canSell: boolean; position: Position | null }> {
    const position = await this.getPosition();
    let canBuy = true;
    let canSell = true;

    if (position) {
      const posQty = new Decimal(position.quantity);
      if (position.side === "long") {
        canBuy = posQty.lt(this.maxPosition);
        canSell = true;
      } else if (position.side === "short") {
        canBuy = true;
        canSell = posQty.lt(this.maxPosition);
      }
    }

    return { canBuy, canSell, position };
  }
}

export function createRiskManager(exchangeClient: ExchangeClient, market: string): RiskManager {
  return new RiskManager(exchangeClient, market);
}