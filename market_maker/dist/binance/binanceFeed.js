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
    symbolPriceCallback = null;
    lastPriceUpdate = 0;
    perSymbolLastUpdate = new Map();
    isRunning = false;
    reconnectTimeout = null;
    symbols;
    constructor(symbols) {
        this.symbols = symbols && symbols.length > 0 ? symbols : config_1.config.binance.symbols;
    }
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
    onSymbolPrice(callback) {
        this.symbolPriceCallback = callback;
    }
    getLastPriceUpdate() {
        return this.lastPriceUpdate;
    }
    getLastPriceUpdateFor(symbol) {
        return this.perSymbolLastUpdate.get(symbol.toUpperCase()) || 0;
    }
    isPriceStale() {
        return Date.now() - this.lastPriceUpdate > config_1.config.priceStaleMs;
    }
    isPriceStaleFor(symbol) {
        const ts = this.perSymbolLastUpdate.get(symbol.toUpperCase()) || 0;
        if (ts === 0)
            return true;
        return Date.now() - ts > config_1.config.priceStaleMs;
    }
    buildWsUrl() {
        if (this.symbols.length === 1) {
            return `wss://fstream.binance.com/ws/${this.symbols[0].toLowerCase()}@trade`;
        }
        // Combined stream for multiple symbols: /stream?streams=btcusdt@trade/ethusdt@trade
        const streams = this.symbols.map((s) => `${s.toLowerCase()}@trade`).join("/");
        return `wss://fstream.binance.com/stream?streams=${streams}`;
    }
    connect() {
        if (!this.isRunning)
            return;
        const wsUrl = this.buildWsUrl();
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
        const raw = message;
        // Combined stream envelope: { stream: "btcusdt@trade", data: { e:"trade", p:"...", E:... } }
        let msg;
        let streamSymbol = null;
        if (typeof raw.stream === "string" && raw.data) {
            streamSymbol = String(raw.stream).split("@")[0].toUpperCase();
            msg = raw.data;
        }
        else {
            msg = raw;
            // Single stream: infer symbol from config
            if (this.symbols.length === 1)
                streamSymbol = this.symbols[0].toUpperCase();
        }
        // Handle trade stream messages: e=trade, p=price, s=symbol
        if (msg.e === "trade" && typeof msg.p === "string") {
            const price = msg.p;
            const timestamp = typeof msg.E === "number" ? msg.E : Date.now();
            // Prefer symbol from message field `s` (e.g. "BTCUSDT") if present
            const sym = typeof msg.s === "string" ? String(msg.s).toUpperCase() : streamSymbol;
            if (parseFloat(price) > 0) {
                this.lastPriceUpdate = timestamp;
                if (sym)
                    this.perSymbolLastUpdate.set(sym, timestamp);
                if (this.priceCallback) {
                    this.priceCallback(price, timestamp);
                }
                if (this.symbolPriceCallback && sym) {
                    this.symbolPriceCallback(sym, price, timestamp);
                }
            }
        }
        // Also handle markPriceUpdate as fallback
        else if (msg.e === "markPriceUpdate" && typeof msg.p === "string") {
            const price = msg.p;
            const timestamp = typeof msg.E === "number" ? msg.E : Date.now();
            const sym = typeof msg.s === "string" ? String(msg.s).toUpperCase() : streamSymbol;
            if (parseFloat(price) > 0) {
                this.lastPriceUpdate = timestamp;
                if (sym)
                    this.perSymbolLastUpdate.set(sym, timestamp);
                if (this.priceCallback) {
                    this.priceCallback(price, timestamp);
                }
                if (this.symbolPriceCallback && sym) {
                    this.symbolPriceCallback(sym, price, timestamp);
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