import { ExchangeClient, Order, PlaceOrderParams } from "../exchange/exchangeClient";
import { Quote } from "../strategy/marketMaker";
import { logger } from "../logger";

export interface ActiveOrder {
  id: string;
  price: string;
  quantity: string;
  side: "buy" | "sell";
  clientOrderId: string;
}

export class OrderManager {
  private exchangeClient: ExchangeClient;
  private market: string;
  private activeBids: Map<string, ActiveOrder> = new Map();
  private activeAsks: Map<string, ActiveOrder> = new Map();
  private isReconciling = false;

  constructor(exchangeClient: ExchangeClient, market: string) {
    this.exchangeClient = exchangeClient;
    this.market = market;
  }

  async reconcile(): Promise<void> {
    if (this.isReconciling) return;
    this.isReconciling = true;

    try {
      const openOrders = await this.exchangeClient.getOpenOrders(this.market);
      this.activeBids.clear();
      this.activeAsks.clear();

      for (const order of openOrders) {
        const active: ActiveOrder = {
          id: order.id,
          price: order.price || "",
          quantity: order.quantity,
          side: order.side,
          clientOrderId: order.clientOrderId || order.id,
        };
        if (order.side === "buy") {
          this.activeBids.set(order.price || "", active);
        } else {
          this.activeAsks.set(order.price || "", active);
        }
      }

      logger.info("Order reconciliation complete", {
        activeBids: this.activeBids.size,
        activeAsks: this.activeAsks.size,
      });
    } catch (e) {
      logger.error("Order reconciliation failed", { error: (e as Error).message });
      throw e;
    } finally {
      this.isReconciling = false;
    }
  }

  async updateQuotes(desiredQuote: Quote): Promise<void> {
    const desiredBidPrices = new Set(desiredQuote.bids.map(b => b.price));
    const desiredAskPrices = new Set(desiredQuote.asks.map(a => a.price));

    for (const [price, order] of this.activeBids) {
      if (!desiredBidPrices.has(price)) {
        await this.cancelOrder(order);
        this.activeBids.delete(price);
      }
    }
    for (const [price, order] of this.activeAsks) {
      if (!desiredAskPrices.has(price)) {
        await this.cancelOrder(order);
        this.activeAsks.delete(price);
      }
    }

    for (const bid of desiredQuote.bids) {
      if (!this.activeBids.has(bid.price)) {
        await this.placeOrder("buy", bid.price, bid.quantity);
      }
    }
    for (const ask of desiredQuote.asks) {
      if (!this.activeAsks.has(ask.price)) {
        await this.placeOrder("sell", ask.price, ask.quantity);
      }
    }
  }

  private async placeOrder(side: "buy" | "sell", price: string, quantity: string): Promise<void> {
    const clientOrderId = `MM-${this.market}-${side.toUpperCase()}-${price}-${Date.now()}`;
    const params: PlaceOrderParams = {
      market: this.market,
      side,
      orderType: "limit",
      price,
      quantity,
      timeInForce: "GTC",
      clientOrderId,
    };

    try {
      const order = await this.exchangeClient.placeLimitOrder(params);
      const active: ActiveOrder = {
        id: order.id,
        price: order.price || "",
        quantity: order.quantity,
        side,
        clientOrderId: order.clientOrderId || order.id,
      };
      if (side === "buy") {
        this.activeBids.set(price, active);
      } else {
        this.activeAsks.set(price, active);
      }
      logger.info(`Placed new ${side}`, { orderId: order.id, price, quantity });
    } catch (e) {
      logger.error(`Failed to place ${side}`, { error: (e as Error).message, price, quantity });
    }
  }

  private async cancelOrder(order: ActiveOrder): Promise<void> {
    try {
      await this.exchangeClient.cancelOrder(order.id);
      logger.info(`Canceled ${order.side}`, { orderId: order.id, price: order.price });
    } catch (e) {
      logger.warn(`Failed to cancel ${order.side}`, { error: (e as Error).message });
    }
  }

  async cancelAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const order of this.activeBids.values()) {
      promises.push(this.cancelOrder(order));
    }
    for (const order of this.activeAsks.values()) {
      promises.push(this.cancelOrder(order));
    }
    await Promise.all(promises);
    this.activeBids.clear();
    this.activeAsks.clear();
  }

  getActiveBids(): ActiveOrder[] {
    return Array.from(this.activeBids.values());
  }

  getActiveAsks(): ActiveOrder[] {
    return Array.from(this.activeAsks.values());
  }

  hasActiveOrders(): boolean {
    return this.activeBids.size > 0 || this.activeAsks.size > 0;
  }
}

export function createOrderManager(exchangeClient: ExchangeClient, market: string): OrderManager {
  return new OrderManager(exchangeClient, market);
}