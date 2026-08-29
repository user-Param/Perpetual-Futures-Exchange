"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthServer = void 0;
exports.createHealthServer = createHealthServer;
const express_1 = __importDefault(require("express"));
const config_1 = require("../config");
const logger_1 = require("../logger");
class HealthServer {
    app;
    server = null;
    deps;
    constructor(deps) {
        this.deps = deps;
        this.app = (0, express_1.default)();
        this.setupRoutes();
    }
    setupRoutes() {
        this.app.get("/health", (_req, res) => {
            const binanceConnected = this.deps.binanceFeed.getLastPriceUpdate() > 0;
            const priceFresh = !this.deps.binanceFeed.isPriceStale();
            const exchangeConnected = !!this.deps.exchangeClient.getToken();
            const quoting = priceFresh && exchangeConnected && this.deps.orderManager.hasActiveOrders();
            const activeBids = this.deps.orderManager.getActiveBids();
            const activeAsks = this.deps.orderManager.getActiveAsks();
            res.json({
                status: "ok",
                service: "market-maker",
                binanceConnected,
                exchangeConnected,
                priceFresh,
                quoting,
                market: this.deps.market,
                activeBids: activeBids.length,
                activeAsks: activeAsks.length,
                lastPriceUpdate: this.deps.binanceFeed.getLastPriceUpdate(),
                timestamp: Date.now(),
            });
        });
    }
    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(config_1.config.healthPort, () => {
                logger_1.logger.info("Health server started", { port: config_1.config.healthPort });
                resolve();
            });
        });
    }
    async stop() {
        if (this.server) {
            await new Promise((resolve) => {
                this.server.close(() => resolve());
            });
            this.server = null;
            logger_1.logger.info("Health server stopped");
        }
    }
}
exports.HealthServer = HealthServer;
function createHealthServer(deps) {
    return new HealthServer(deps);
}
//# sourceMappingURL=healthServer.js.map