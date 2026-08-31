import Redis from "ioredis";
import { randomUUID } from "crypto";
import type { Quote } from "../strategy/marketMaker";
import { logger } from "../logger";

const REDIS_ORDER_COMMANDS_STREAM = "order_commands";

/**
 * DirectOrderInjector publishes Binance-backed liquidity directly to Engine's
 * Redis Stream (order_commands) without going through REST -> DB -> lockBalance.
 * This gives Engine external liquidity so FTX users can match against Binance.
 *
 * Each market gets its own injector with its own active order tracking.
 * Orders use a synthetic userId `BINANCE_LP_USER_ID` that Engine will match
 * but DB writer will handle gracefully (fills created, balances skipped for external side).
 */
const BINANCE_LP_USER_ID = process.env.BINANCE_LP_USER_ID || "00000000-0000-0000-0000-000000000001";

export class DirectOrderInjector {
  private redis: Redis;
  private market: string;
  private activeBids: Map<string, { id: string; price: string; quantity: string }> = new Map();
  private activeAsks: Map<string, { id: string; price: string; quantity: string }> = new Map();

  constructor(redis: Redis, market: string) {
    this.redis = redis;
    this.market = market;
  }

  async updateQuotes(quote: Quote): Promise<void> {
    const desiredBidPrices = new Set(quote.bids.map((b) => b.price));
    const desiredAskPrices = new Set(quote.asks.map((a) => a.price));

    // Cancel stale bids
    for (const [price, order] of this.activeBids) {
      if (!desiredBidPrices.has(price)) {
        await this.cancelOrder(order.id);
        this.activeBids.delete(price);
      }
    }
    for (const [price, order] of this.activeAsks) {
      if (!desiredAskPrices.has(price)) {
        await this.cancelOrder(order.id);
        this.activeAsks.delete(price);
      }
    }

    // Place new bids
    for (const bid of quote.bids) {
      if (!this.activeBids.has(bid.price)) {
        const id = await this.placeOrder("buy", bid.price, bid.quantity);
        if (id) this.activeBids.set(bid.price, { id, price: bid.price, quantity: bid.quantity });
      }
    }
    // Place new asks
    for (const ask of quote.asks) {
      if (!this.activeAsks.has(ask.price)) {
        const id = await this.placeOrder("sell", ask.price, ask.quantity);
        if (id) this.activeAsks.set(ask.price, { id, price: ask.price, quantity: ask.quantity });
      }
    }
  }

  private async placeOrder(side: "buy" | "sell", price: string, quantity: string): Promise<string | null> {
    const orderId = randomUUID();
    const payload = {
      id: orderId,
      orderId,
      userId: BINANCE_LP_USER_ID,
      market: this.market,
      side,
      orderType: "limit",
      price,
      quantity,
      timeInForce: "GTC",
      reduceOnly: false,
      postOnly: false,
      clientOrderId: `BINANCE-LP-${this.market}-${side}-${price}-${Date.now()}`,
      leverage: "1",
      marginMode: "isolated",
      timestamp: Date.now(),
    };

    try {
      await this.redis.xadd(
        REDIS_ORDER_COMMANDS_STREAM,
        "*",
        "type",
        "PLACE_ORDER",
        "payload",
        JSON.stringify(payload)
      );
      logger.debug(`Direct LP placed ${side} ${this.market}`, { orderId, price, quantity });
      return orderId;
    } catch (e) {
      logger.error(`Direct LP failed to place ${side}`, { error: (e as Error).message, price });
      return null;
    }
  }

  private async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.redis.xadd(
        REDIS_ORDER_COMMANDS_STREAM,
        "*",
        "type",
        "CANCEL_ORDER",
        "orderId",
        orderId,
        "market",
        this.market,
        "userId",
        BINANCE_LP_USER_ID
      );
      logger.debug(`Direct LP canceled`, { orderId, market: this.market });
    } catch (e) {
      logger.warn(`Direct LP cancel failed`, { error: (e as Error).message, orderId });
    }
  }

  async cancelAll(): Promise<void> {
    const all = [...this.activeBids.values(), ...this.activeAsks.values()];
    for (const o of all) {
      await this.cancelOrder(o.id);
    }
    this.activeBids.clear();
    this.activeAsks.clear();
  }

  getActiveCounts(): { bids: number; asks: number } {
    return { bids: this.activeBids.size, asks: this.activeAsks.size };
  }
}
