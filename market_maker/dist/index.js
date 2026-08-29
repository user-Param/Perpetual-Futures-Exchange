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
const ioredis_1 = __importDefault(require("ioredis"));
class MarketMaker {
    state = "STARTING";
    binanceFeed;
    exchangeClient;
    strategy;
    orderManager;
    riskManager;
    healthServer;
    quoteInterval = null;
    currentPrice = null;
    marketInfo = null;
    isShuttingDown = false;
    redis;
    constructor() {
        (0, config_1.validateConfig)();
        logger_1.logger.info("Market Maker initializing", {
            market: config_1.config.market,
            spreadBps: config_1.config.spreadBps,
            orderSize: config_1.config.orderSize,
            quoteRefreshMs: config_1.config.quoteRefreshMs,
            priceStaleMs: config_1.config.priceStaleMs,
            maxPosition: config_1.config.maxPosition,
        });
        this.redis = new ioredis_1.default(config_1.config.redisUrl || "redis://127.0.0.1:6379", {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
        });
        this.redis.on("error", (err) => logger_1.logger.error("Redis error", { error: err.message }));
        this.binanceFeed = (0, binanceFeed_1.createBinanceFeed)();
        this.exchangeClient = (0, exchangeClient_1.createExchangeClient)();
        this.strategy = (0, marketMaker_1.createMarketMakerStrategy)();
        this.orderManager = (0, orderManager_1.createOrderManager)(this.exchangeClient, config_1.config.market);
        this.riskManager = (0, riskManager_1.createRiskManager)(this.exchangeClient, config_1.config.market);
        this.healthServer = (0, healthServer_1.createHealthServer)({
            binanceFeed: this.binanceFeed,
            exchangeClient: this.exchangeClient,
            orderManager: this.orderManager,
            market: config_1.config.market,
        });
        this.setupBinanceHandlers();
        this.setupSignalHandlers();
    }
    setupBinanceHandlers() {
        this.binanceFeed.onPrice((price, timestamp) => {
            this.currentPrice = price;
            logger_1.logger.debug("Received Binance price", { price, timestamp });
            // Publish reference price to Redis for exchange mark price updater
            const payload = JSON.stringify({ price, timestamp, market: config_1.config.market });
            this.redis.set("mark_price:reference", payload, "EX", 60).catch((e) => {
                logger_1.logger.warn("Failed to publish mark price to Redis", { error: e.message });
            });
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
            await this.authenticateAndLoadMarket();
            await this.orderManager.reconcile();
            this.binanceFeed.start();
            this.waitForFreshPriceAndStartQuoting();
        }
        catch (e) {
            logger_1.logger.error("Failed to start market maker", { error: e.message });
            throw e;
        }
    }
    async authenticateAndLoadMarket() {
        await this.exchangeClient.authenticate();
        this.marketInfo = await this.exchangeClient.getMarket(config_1.config.market);
        logger_1.logger.info("Market loaded", {
            symbol: this.marketInfo.symbol,
            tickSize: this.marketInfo.tickSize,
            stepSize: this.marketInfo.stepSize,
            minOrderSize: this.marketInfo.minOrderSize,
            maxOrderSize: this.marketInfo.maxOrderSize,
        });
    }
    waitForFreshPriceAndStartQuoting() {
        const checkPrice = () => {
            if (this.isShuttingDown)
                return;
            if (this.currentPrice && !this.binanceFeed.isPriceStale()) {
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
            if (this.binanceFeed.isPriceStale()) {
                logger_1.logger.warn("Price is stale, pausing quoting");
                await this.pauseQuoting();
                return;
            }
            if (!this.currentPrice || !this.marketInfo) {
                logger_1.logger.warn("Missing price or market info, skipping quote cycle");
                return;
            }
            try {
                await this.executeQuoteCycle();
            }
            catch (e) {
                logger_1.logger.error("Quote cycle failed", { error: e.message });
            }
        }, config_1.config.quoteRefreshMs);
        logger_1.logger.info("Quote loop started", { intervalMs: config_1.config.quoteRefreshMs });
    }
    async executeQuoteCycle() {
        if (!this.currentPrice || !this.marketInfo)
            return;
        const { canBuy, canSell } = await this.riskManager.getPositionRisk();
        const desiredQuote = this.strategy.calculateQuotes({
            referencePrice: this.currentPrice,
            market: this.marketInfo,
        });
        if (!canBuy) {
            logger_1.logger.warn("Position limit reached for long, disabling bids");
            await this.orderManager.updateQuotes({ bids: [], asks: desiredQuote.asks });
            return;
        }
        if (!canSell) {
            logger_1.logger.warn("Position limit reached for short, disabling asks");
            await this.orderManager.updateQuotes({ bids: desiredQuote.bids, asks: [] });
            return;
        }
        await this.orderManager.updateQuotes(desiredQuote);
    }
    async pauseQuoting() {
        this.setState("PAUSED");
        await this.orderManager.cancelAll();
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
        logger_1.logger.info("Cancelling active orders");
        await this.orderManager.cancelAll();
        logger_1.logger.info("Closing Binance WebSocket");
        this.binanceFeed.stop();
        logger_1.logger.info("Stopping health server");
        await this.healthServer.stop();
        this.setState("STOPPED");
        logger_1.logger.info("Market Maker stopped gracefully");
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