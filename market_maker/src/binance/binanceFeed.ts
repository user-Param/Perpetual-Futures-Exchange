import WebSocket from "ws";
import { config } from "../config";
import { logger } from "../logger";

type PriceCallback = (price: string, timestamp: number) => void;
type SymbolPriceCallback = (symbol: string, price: string, timestamp: number) => void;

export interface BinanceFeedEvents {
  onPrice: (callback: PriceCallback) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (error: Error) => void;
}

export class BinanceFeed {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private priceCallback: PriceCallback | null = null;
  private symbolPriceCallback: SymbolPriceCallback | null = null;
  private lastPriceUpdate = 0;
  private perSymbolLastUpdate: Map<string, number> = new Map();
  private isRunning = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private symbols: string[];

  constructor(symbols?: string[]) {
    this.symbols = symbols && symbols.length > 0 ? symbols : config.binance.symbols;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  stop(): void {
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

  onPrice(callback: PriceCallback): void {
    this.priceCallback = callback;
  }

  onSymbolPrice(callback: SymbolPriceCallback): void {
    this.symbolPriceCallback = callback;
  }

  getLastPriceUpdate(): number {
    return this.lastPriceUpdate;
  }

  getLastPriceUpdateFor(symbol: string): number {
    return this.perSymbolLastUpdate.get(symbol.toUpperCase()) || 0;
  }

  isPriceStale(): boolean {
    return Date.now() - this.lastPriceUpdate > config.priceStaleMs;
  }

  isPriceStaleFor(symbol: string): boolean {
    const ts = this.perSymbolLastUpdate.get(symbol.toUpperCase()) || 0;
    if (ts === 0) return true;
    return Date.now() - ts > config.priceStaleMs;
  }

  private buildWsUrl(): string {
    if (this.symbols.length === 1) {
      return `wss://fstream.binance.com/ws/${this.symbols[0].toLowerCase()}@trade`;
    }
    // Combined stream for multiple symbols: /stream?streams=btcusdt@trade/ethusdt@trade
    const streams = this.symbols.map((s) => `${s.toLowerCase()}@trade`).join("/");
    return `wss://fstream.binance.com/stream?streams=${streams}`;
  }

  private connect(): void {
    if (!this.isRunning) return;

    const wsUrl = this.buildWsUrl();
    logger.info("Connecting to Binance WebSocket", { url: wsUrl });

    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      logger.info("Binance WebSocket connected");
      this.reconnectAttempts = 0;
      this.emitConnect();
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (e) {
        logger.warn("Failed to parse Binance message", { error: (e as Error).message });
      }
    });

    this.ws.on("close", () => {
      logger.warn("Binance WebSocket disconnected");
      this.emitDisconnect();
      this.scheduleReconnect();
    });

    this.ws.on("error", (error: Error) => {
      logger.error("Binance WebSocket error", { error: error.message });
      this.emitError(error);
    });
  }

  private handleMessage(message: unknown): void {
    const raw = message as Record<string, unknown>;
    // Combined stream envelope: { stream: "btcusdt@trade", data: { e:"trade", p:"...", E:... } }
    let msg: Record<string, unknown>;
    let streamSymbol: string | null = null;
    if (typeof raw.stream === "string" && raw.data) {
      streamSymbol = String(raw.stream).split("@")[0].toUpperCase();
      msg = raw.data as Record<string, unknown>;
    } else {
      msg = raw;
      // Single stream: infer symbol from config
      if (this.symbols.length === 1) streamSymbol = this.symbols[0].toUpperCase();
    }

    // Handle trade stream messages: e=trade, p=price, s=symbol
    if (msg.e === "trade" && typeof msg.p === "string") {
      const price = msg.p;
      const timestamp = typeof msg.E === "number" ? msg.E : Date.now();
      // Prefer symbol from message field `s` (e.g. "BTCUSDT") if present
      const sym = typeof msg.s === "string" ? String(msg.s).toUpperCase() : streamSymbol;
      if (parseFloat(price) > 0) {
        this.lastPriceUpdate = timestamp;
        if (sym) this.perSymbolLastUpdate.set(sym, timestamp);
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
        if (sym) this.perSymbolLastUpdate.set(sym, timestamp);
        if (this.priceCallback) {
          this.priceCallback(price, timestamp);
        }
        if (this.symbolPriceCallback && sym) {
          this.symbolPriceCallback(sym, price, timestamp);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;

    const delays = [1000, 2000, 4000, 8000, 16000, 30000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts++;

    logger.info("Scheduling Binance reconnect", { attempt: this.reconnectAttempts, delayMs: delay });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private emitConnect(): void {
    // Event emitted via logger
  }

  private emitDisconnect(): void {
    // Event emitted via logger
  }

  private emitError(error: Error): void {
    // Event emitted via logger
  }
}

export function createBinanceFeed(): BinanceFeed {
  return new BinanceFeed();
}