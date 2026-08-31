"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketMaker = void 0;
const config_1 = require("./config");
const logger_1 = require("./logger");
const binanceFeed_1 = require("./binance/binanceFeed");
const exchangeClient_1 = require("./exchange/exchangeClient");
const marketMaker_1 = require("./strategy/marketMaker");
const orderManager_1 = require("./orders/orderManager");
const riskManager_1 = require("./risk/riskManager");
const healthServer_1 = require("./health/healthServer");
const directOrderInjector_1 = require("./liquidity/directOrderInjector");
const ioredis_1 = __importDefault(require("ioredis"));
// Map Binance symbol -> FTX market symbol
function binanceToMarket(binanceSymbol) {
    const upper = binanceSymbol.toUpperCase();
    // Try ordered mapping: config.binance.symbols[i] ↔ config.markets[i]
    const idx = config_1.config.binance.symbols.findIndex((s) => s.toUpperCase() === upper);
    if (idx !== -1 && config_1.config.markets[idx])
        return config_1.config.markets[idx];
    // Fallback: derive (BTCUSDT -> BTC-USDT-PERP)
    const base = upper.replace(/USDT$/, "");
    if (!base)
        return null;
    const candidate = `${base}-USDT-PERP`;
    if (config_1.config.markets.includes(candidate))
        return candidate;
    // Also try exact match if market list contains base
    return null;
}
class MarketMaker {
    state = "STARTING";
    binanceFeed;
    exchangeClient;
    strategy;
    healthServer;
    quoteInterval = null;
    isShuttingDown = false;
    redis;
    markets = new Map();
    constructor() {
        (0, config_1.validateConfig)();
        logger_1.logger.info("Market Maker initializing (direct Engine liquidity)", {
            markets: config_1.config.markets,
            binanceSymbols: config_1.config.binance.symbols,
            spreadBps: config_1.config.spreadBps,
            orderSize: config_1.config.orderSize,
            quoteRefreshMs: config_1.config.quoteRefreshMs,
            priceStaleMs: config_1.config.priceStaleMs,
        });
        this.redis = new ioredis_1.default(config_1.config.redisUrl || "redis://127.0.0.1:6379", {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
        });
        this.redis.on("error", (err) => logger_1.logger.error("Redis error", { error: err.message }));
        // Single feed handling all symbols via combined stream
        this.binanceFeed = new binanceFeed_1.BinanceFeed(config_1.config.binance.symbols);
        this.exchangeClient = (0, exchangeClient_1.createExchangeClient)();
        this.strategy = (0, marketMaker_1.createMarketMakerStrategy)();
        // Init per-market state with direct injector (primary) + legacy orderManager (fallback)
        for (const market of config_1.config.markets) {
            const binanceSym = this.marketToBinanceSymbol(market);
            const ms = {
                market,
                binanceSymbol: binanceSym || market.split("-")[0] + "USDT",
                currentPrice: null,
                marketInfo: null,
                orderManager: (0, orderManager_1.createOrderManager)(this.exchangeClient, market),
                riskManager: (0, riskManager_1.createRiskManager)(this.exchangeClient, market),
                directInjector: new directOrderInjector_1.DirectOrderInjector(this.redis, market),
            };
            this.markets.set(market, ms);
        }
        // Health server uses first market for legacy compat, but also expose multi
        const firstMarket = config_1.config.markets[0] || config_1.config.market;
        const firstState = this.markets.get(firstMarket);
        this.healthServer = (0, healthServer_1.createHealthServer)({
            binanceFeed: this.binanceFeed,
            exchangeClient: this.exchangeClient,
            orderManager: firstState ? firstState.orderManager : (0, orderManager_1.createOrderManager)(this.exchangeClient, firstMarket),
            market: firstMarket,
        });
        this.setupBinanceHandlers();
        this.setupSignalHandlers();
    }
    marketToBinanceSymbol(market) {
        const base = market.split("-")[0].toUpperCase();
        const found = config_1.config.binance.symbols.find((s) => s.toUpperCase().startsWith(base));
        return found || `${base}USDT`;
    }
    setupBinanceHandlers() {
        // Per-symbol callback — direct Engine liquidity path
        this.binanceFeed.onSymbolPrice((binanceSymbol, price, timestamp) => {
            const market = binanceToMarket(binanceSymbol);
            if (!market) {
                logger_1.logger.debug("Received Binance price for unmapped symbol", { binanceSymbol, price });
                return;
            }
            const state = this.markets.get(market);
            if (!state)
                return;
            state.currentPrice = price;
            logger_1.logger.debug("Received Binance price", { binanceSymbol, market, price, timestamp });
            // Publish reference price to Redis for exchange mark price updater & ticker
            // This is the critical path: Server/src/services/marketService.ts:107 and markPriceUpdater.ts:91
            const payload = JSON.stringify({ price, timestamp, market });
            const key = `mark_price:reference:${market}`;
            this.redis.set(key, payload, "EX", 60).catch((e) => {
                logger_1.logger.warn("Failed to publish mark price to Redis", { error: e.message, market });
            });
        });
        // Legacy single-price callback for backward compat
        this.binanceFeed.onPrice((price, timestamp) => {
            // Fallback: if only one market, update it
            if (config_1.config.markets.length === 1) {
                const market = config_1.config.markets[0];
                const state = this.markets.get(market);
                if (state && !state.currentPrice) {
                    state.currentPrice = price;
                    const payload = JSON.stringify({ price, timestamp, market });
                    const key = `mark_price:reference:${market}`;
                    this.redis.set(key, payload, "EX", 60).catch(() => { });
                }
            }
        });
    }
    setupSignalHandlers() {
        const handleSignal = async (signal) => {
            logger_1.logger.info(`Received ${signal}, initiating graceful shutdown`);
            await this.shutdown();
            process.exit(0);
        };
        process.on("SIGINT", () => handleSignal("SIGINT"));
        process.on("SIGTERM", () => handleSignal("SIGTERM"));
    }
    async start() {
        try {
            this.setState("CONNECTING");
            await this.healthServer.start();
            this.setState("READY");
            await this.authenticateAndLoadMarkets();
            for (const state of this.markets.values()) {
                try {
                    await state.orderManager.reconcile();
                }
                catch (e) {
                    logger_1.logger.warn("Reconcile failed", { market: state.market, error: e.message });
                }
            }
            this.binanceFeed.start();
            this.waitForFreshPriceAndStartQuoting();
        }
        catch (e) {
            logger_1.logger.error("Failed to start market maker", { error: e.message });
            throw e;
        }
    }
    async authenticateAndLoadMarkets() {
        await this.exchangeClient.authenticate();
        for (const [market, state] of this.markets) {
            try {
                state.marketInfo = await this.exchangeClient.getMarket(market);
                logger_1.logger.info("Market loaded", {
                    symbol: state.marketInfo.symbol,
                    binanceSymbol: state.binanceSymbol,
                    tickSize: state.marketInfo.tickSize,
                    stepSize: state.marketInfo.stepSize,
                });
            }
            catch (e) {
                logger_1.logger.error("Failed to load market", { market, error: e.message });
                throw e;
            }
        }
    }
    waitForFreshPriceAndStartQuoting() {
        const checkPrice = () => {
            if (this.isShuttingDown)
                return;
            // Start quoting as soon as any market has fresh price
            let anyFresh = false;
            for (const state of this.markets.values()) {
                if (state.currentPrice && !this.binanceFeed.isPriceStaleFor(state.binanceSymbol)) {
                    anyFresh = true;
                    break;
                }
            }
            if (anyFresh) {
                this.setState("QUOTING");
                this.startQuoteLoop();
            }
            else {
                setTimeout(checkPrice, 1000);
            }
        };
        checkPrice();
    }
    startQuoteLoop() {
        if (this.quoteInterval)
            return;
        this.quoteInterval = setInterval(async () => {
            if (this.isShuttingDown || this.state !== "QUOTING")
                return;
            for (const state of this.markets.values()) {
                if (!state.currentPrice || !state.marketInfo)
                    continue;
                if (this.binanceFeed.isPriceStaleFor(state.binanceSymbol)) {
                    logger_1.logger.warn("Price stale, skipping market", { market: state.market, binanceSymbol: state.binanceSymbol });
                    continue;
                }
                try {
                    await this.executeQuoteCycleFor(state);
                }
                catch (e) {
                    logger_1.logger.error("Quote cycle failed", { market: state.market, error: e.message });
                }
            }
        }, config_1.config.quoteRefreshMs);
        logger_1.logger.info("Quote loop started (direct Engine injection)", { intervalMs: config_1.config.quoteRefreshMs, markets: config_1.config.markets });
    }
    async executeQuoteCycleFor(state) {
        if (!state.currentPrice || !state.marketInfo)
            return;
        const desiredQuote = this.strategy.calculateQuotes({
            referencePrice: state.currentPrice,
            market: state.marketInfo,
        });
        // Direct injection to Engine via Redis Stream — primary liquidity path
        // This connects Binance directly to Engine: Engine will match FTX user orders against these Binance-backed quotes
        try {
            await state.directInjector.updateQuotes(desiredQuote);
        }
        catch (e) {
            logger_1.logger.error("Direct injection failed, falling back to REST", { market: state.market, error: e.message });
            // Fallback to REST path (requires balance, slower)
            const { canBuy, canSell } = await state.riskManager.getPositionRisk().catch(() => ({ canBuy: true, canSell: true }));
            let quoteToSend = desiredQuote;
            if (!canBuy)
                quoteToSend = { bids: [], asks: desiredQuote.asks };
            if (!canSell)
                quoteToSend = { bids: desiredQuote.bids, asks: [] };
            await state.orderManager.updateQuotes(quoteToSend);
        }
    }
    async pauseQuoting() {
        this.setState("PAUSED");
        for (const state of this.markets.values()) {
            await state.directInjector.cancelAll().catch(() => { });
            await state.orderManager.cancelAll().catch(() => { });
        }
        this.setState("RECONNECTING");
    }
    setState(newState) {
        this.state = newState;
        logger_1.logger.info("State changed", { state: newState });
    }
    async shutdown() {
        if (this.isShuttingDown)
            return;
        this.isShuttingDown = true;
        this.setState("STOPPING");
        if (this.quoteInterval) {
            clearInterval(this.quoteInterval);
            this.quoteInterval = null;
        }
        logger_1.logger.info("Cancelling direct LP orders");
        for (const state of this.markets.values()) {
            await state.directInjector.cancelAll().catch(() => { });
            await state.orderManager.cancelAll().catch(() => { });
        }
        logger_1.logger.info("Closing Binance WebSocket");
        this.binanceFeed.stop();
        logger_1.logger.info("Stopping health server");
        await this.healthServer.stop();
        this.setState("STOPPED");
        logger_1.logger.info("Market Maker stopped gracefully (direct Engine mode)");
    }
}
exports.MarketMaker = MarketMaker;
async function main() {
    const marketMaker = new MarketMaker();
    await marketMaker.start();
}
main().catch((e) => {
    logger_1.logger.error("Fatal error", { error: e.message });
    process.exit(1);
});
//# sourceMappingURL=index.js.map