import WebSocket from "ws";
import { config } from "../config";
import { logger } from "../logger";

type PriceCallback = (price: string, timestamp: number) => void;

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
  private lastPriceUpdate = 0;
  private isRunning = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor() {}

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

  getLastPriceUpdate(): number {
    return this.lastPriceUpdate;
  }

  isPriceStale(): boolean {
    return Date.now() - this.lastPriceUpdate > config.priceStaleMs;
  }

  private connect(): void {
    if (!this.isRunning) return;

    // Use trade stream for real-time price updates
    const wsUrl = `wss://fstream.binance.com/ws/${config.binance.symbol.toLowerCase()}@trade`;
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
    const msg = message as Record<string, unknown>;
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