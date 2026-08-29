"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderManager = void 0;
exports.createOrderManager = createOrderManager;
const logger_1 = require("../logger");
class OrderManager {
    exchangeClient;
    market;
    activeBids = new Map();
    activeAsks = new Map();
    isReconciling = false;
    constructor(exchangeClient, market) {
        this.exchangeClient = exchangeClient;
        this.market = market;
    }
    async reconcile() {
        if (this.isReconciling)
            return;
        this.isReconciling = true;
        try {
            const openOrders = await this.exchangeClient.getOpenOrders(this.market);
            this.activeBids.clear();
            this.activeAsks.clear();
            for (const order of openOrders) {
                const active = {
                    id: order.id,
                    price: order.price || "",
                    quantity: order.quantity,
                    side: order.side,
                    clientOrderId: order.clientOrderId || order.id,
                };
                if (order.side === "buy") {
                    this.activeBids.set(order.price || "", active);
                }
                else {
                    this.activeAsks.set(order.price || "", active);
                }
            }
            logger_1.logger.info("Order reconciliation complete", {
                activeBids: this.activeBids.size,
                activeAsks: this.activeAsks.size,
            });
        }
        catch (e) {
            logger_1.logger.error("Order reconciliation failed", { error: e.message });
            throw e;
        }
        finally {
            this.isReconciling = false;
        }
    }
    async updateQuotes(desiredQuote) {
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
    async placeOrder(side, price, quantity) {
        const clientOrderId = `MM-${this.market}-${side.toUpperCase()}-${price}-${Date.now()}`;
        const params = {
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
            const active = {
                id: order.id,
                price: order.price || "",
                quantity: order.quantity,
                side,
                clientOrderId: order.clientOrderId || order.id,
            };
            if (side === "buy") {
                this.activeBids.set(price, active);
            }
            else {
                this.activeAsks.set(price, active);
            }
            logger_1.logger.info(`Placed new ${side}`, { orderId: order.id, price, quantity });
        }
        catch (e) {
            logger_1.logger.error(`Failed to place ${side}`, { error: e.message, price, quantity });
        }
    }
    async cancelOrder(order) {
        try {
            await this.exchangeClient.cancelOrder(order.id);
            logger_1.logger.info(`Canceled ${order.side}`, { orderId: order.id, price: order.price });
        }
        catch (e) {
            logger_1.logger.warn(`Failed to cancel ${order.side}`, { error: e.message });
        }
    }
    async cancelAll() {
        const promises = [];
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
    getActiveBids() {
        return Array.from(this.activeBids.values());
    }
    getActiveAsks() {
        return Array.from(this.activeAsks.values());
    }
    hasActiveOrders() {
        return this.activeBids.size > 0 || this.activeAsks.size > 0;
    }
}
exports.OrderManager = OrderManager;
function createOrderManager(exchangeClient, market) {
    return new OrderManager(exchangeClient, market);
}
//# sourceMappingURL=orderManager.js.map