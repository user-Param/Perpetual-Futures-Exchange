"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceFeed = void 0;
exports.createBinanceFeed = createBinanceFeed;
const ws_1 = __importDefault(require("ws"));
const config_1 = require("../config");
const logger_1 = require("../logger");
class BinanceFeed {
    ws = null;
    reconnectAttempts = 0;
    maxReconnectDelay = 30000;
    priceCallback = null;
    lastPriceUpdate = 0;
    isRunning = false;
    reconnectTimeout = null;
    constructor() { }
    start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        this.connect();
    }
    stop() {
        this.isRunning = false;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    onPrice(callback) {
        this.priceCallback = callback;
    }
    getLastPriceUpdate() {
        return this.lastPriceUpdate;
    }
    isPriceStale() {
        return Date.now() - this.lastPriceUpdate > config_1.config.priceStaleMs;
    }
    connect() {
        if (!this.isRunning)
            return;
        // Use trade stream for real-time price updates
        const wsUrl = `wss://fstream.binance.com/ws/${config_1.config.binance.symbol.toLowerCase()}@trade`;
        logger_1.logger.info("Connecting to Binance WebSocket", { url: wsUrl });
        this.ws = new ws_1.default(wsUrl);
        this.ws.on("open", () => {
            logger_1.logger.info("Binance WebSocket connected");
            this.reconnectAttempts = 0;
            this.emitConnect();
        });
        this.ws.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleMessage(message);
            }
            catch (e) {
                logger_1.logger.warn("Failed to parse Binance message", { error: e.message });
            }
        });
        this.ws.on("close", () => {
            logger_1.logger.warn("Binance WebSocket disconnected");
            this.emitDisconnect();
            this.scheduleReconnect();
        });
        this.ws.on("error", (error) => {
            logger_1.logger.error("Binance WebSocket error", { error: error.message });
            this.emitError(error);
        });
    }
    handleMessage(message) {
        const msg = message;
        // Handle trade stream messages: e=trade, p=price
        if (msg.e === "trade" && typeof msg.p === "string") {
            const price = msg.p;
            const timestamp = typeof msg.E === "number" ? msg.E : Date.now();
            if (parseFloat(price) > 0) {
                this.lastPriceUpdate = timestamp;
                if (this.priceCallback) {
                    this.priceCallback(price, timestamp);
                }
            }
        }
        // Also handle markPriceUpdate as fallback
        else if (msg.e === "markPriceUpdate" && typeof msg.p === "string") {
            const price = msg.p;
            const timestamp = typeof msg.E === "number" ? msg.E : Date.now();
            if (parseFloat(price) > 0) {
                this.lastPriceUpdate = timestamp;
                if (this.priceCallback) {
                    this.priceCallback(price, timestamp);
                }
            }
        }
    }
    scheduleReconnect() {
        if (!this.isRunning)
            return;
        const delays = [1000, 2000, 4000, 8000, 16000, 30000];
        const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
        this.reconnectAttempts++;
        logger_1.logger.info("Scheduling Binance reconnect", { attempt: this.reconnectAttempts, delayMs: delay });
        this.reconnectTimeout = setTimeout(() => {
            this.connect();
        }, delay);
    }
    emitConnect() {
        // Event emitted via logger
    }
    emitDisconnect() {
        // Event emitted via logger
    }
    emitError(error) {
        // Event emitted via logger
    }
}
exports.BinanceFeed = BinanceFeed;
function createBinanceFeed() {
    return new BinanceFeed();
}
//# sourceMappingURL=binanceFeed.js.map