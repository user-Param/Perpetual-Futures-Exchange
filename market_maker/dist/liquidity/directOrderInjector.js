"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectOrderInjector = void 0;
const crypto_1 = require("crypto");
const logger_1 = require("../logger");
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
class DirectOrderInjector {
    redis;
    market;
    activeBids = new Map();
    activeAsks = new Map();
    constructor(redis, market) {
        this.redis = redis;
        this.market = market;
    }
    async updateQuotes(quote) {
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
                if (id)
                    this.activeBids.set(bid.price, { id, price: bid.price, quantity: bid.quantity });
            }
        }
        // Place new asks
        for (const ask of quote.asks) {
            if (!this.activeAsks.has(ask.price)) {
                const id = await this.placeOrder("sell", ask.price, ask.quantity);
                if (id)
                    this.activeAsks.set(ask.price, { id, price: ask.price, quantity: ask.quantity });
            }
        }
    }
    async placeOrder(side, price, quantity) {
        const orderId = (0, crypto_1.randomUUID)();
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
            await this.redis.xadd(REDIS_ORDER_COMMANDS_STREAM, "*", "type", "PLACE_ORDER", "payload", JSON.stringify(payload));
            logger_1.logger.debug(`Direct LP placed ${side} ${this.market}`, { orderId, price, quantity });
            return orderId;
        }
        catch (e) {
            logger_1.logger.error(`Direct LP failed to place ${side}`, { error: e.message, price });
            return null;
        }
    }
    async cancelOrder(orderId) {
        try {
            await this.redis.xadd(REDIS_ORDER_COMMANDS_STREAM, "*", "type", "CANCEL_ORDER", "orderId", orderId, "market", this.market, "userId", BINANCE_LP_USER_ID);
            logger_1.logger.debug(`Direct LP canceled`, { orderId, market: this.market });
        }
        catch (e) {
            logger_1.logger.warn(`Direct LP cancel failed`, { error: e.message, orderId });
        }
    }
    async cancelAll() {
        const all = [...this.activeBids.values(), ...this.activeAsks.values()];
        for (const o of all) {
            await this.cancelOrder(o.id);
        }
        this.activeBids.clear();
        this.activeAsks.clear();
    }
    getActiveCounts() {
        return { bids: this.activeBids.size, asks: this.activeAsks.size };
    }
}
exports.DirectOrderInjector = DirectOrderInjector;
//# sourceMappingURL=directOrderInjector.js.map