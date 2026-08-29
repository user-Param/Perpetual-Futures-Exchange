import { config, validateConfig } from "./config";
import { logger } from "./logger";
import { BinanceFeed, createBinanceFeed } from "./binance/binanceFeed";
import { ExchangeClient, createExchangeClient } from "./exchange/exchangeClient";
import { MarketMakerStrategy, createMarketMakerStrategy } from "./strategy/marketMaker";
import { OrderManager, createOrderManager } from "./orders/orderManager";
import { RiskManager, createRiskManager } from "./risk/riskManager";
import { HealthServer, createHealthServer } from "./health/healthServer";
import Redis from "ioredis";

type State =
  | "STARTING"
  | "CONNECTING"
  | "READY"
  | "QUOTING"
  | "PAUSED"
  | "RECONNECTING"
  | "STOPPING"
  | "STOPPED";

export class MarketMaker {
  private state: State = "STARTING";
  private binanceFeed: BinanceFeed;
  private exchangeClient: ExchangeClient;
  private strategy: MarketMakerStrategy;
  private orderManager: OrderManager;
  private riskManager: RiskManager;
  private healthServer: HealthServer;
  private quoteInterval: NodeJS.Timeout | null = null;
  private currentPrice: string | null = null;
  private marketInfo: Awaited<ReturnType<ExchangeClient["getMarket"]>> | null = null;
  private isShuttingDown = false;
  private redis: Redis;

  constructor() {
    validateConfig();
    logger.info("Market Maker initializing", {
      market: config.market,
      spreadBps: config.spreadBps,
      orderSize: config.orderSize,
      quoteRefreshMs: config.quoteRefreshMs,
      priceStaleMs: config.priceStaleMs,
      maxPosition: config.maxPosition,
    });

    this.redis = new Redis(config.redisUrl || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.redis.on("error", (err) => logger.error("Redis error", { error: err.message }));

    this.binanceFeed = createBinanceFeed();
    this.exchangeClient = createExchangeClient();
    this.strategy = createMarketMakerStrategy();
    this.orderManager = createOrderManager(this.exchangeClient, config.market);
    this.riskManager = createRiskManager(this.exchangeClient, config.market);
    this.healthServer = createHealthServer({
      binanceFeed: this.binanceFeed,
      exchangeClient: this.exchangeClient,
      orderManager: this.orderManager,
      market: config.market,
    });

    this.setupBinanceHandlers();
    this.setupSignalHandlers();
  }

  private setupBinanceHandlers(): void {
    this.binanceFeed.onPrice((price: string, timestamp: number) => {
      this.currentPrice = price;
      logger.debug("Received Binance price", { price, timestamp });

      // Publish reference price to Redis for exchange mark price updater
      const payload = JSON.stringify({ price, timestamp, market: config.market });
      this.redis.set("mark_price:reference", payload, "EX", 60).catch((e) => {
        logger.warn("Failed to publish mark price to Redis", { error: (e as Error).message });
      });
    });
  }

  private setupSignalHandlers(): void {
    const handleSignal = async (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown`);
      await this.shutdown();
      process.exit(0);
    };

    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));
  }

  async start(): Promise<void> {
    try {
      this.setState("CONNECTING");
      await this.healthServer.start();

      this.setState("READY");
      await this.authenticateAndLoadMarket();
      await this.orderManager.reconcile();
      this.binanceFeed.start();

      this.waitForFreshPriceAndStartQuoting();
    } catch (e) {
      logger.error("Failed to start market maker", { error: (e as Error).message });
      throw e;
    }
  }

  private async authenticateAndLoadMarket(): Promise<void> {
    await this.exchangeClient.authenticate();
    this.marketInfo = await this.exchangeClient.getMarket(config.market);
    logger.info("Market loaded", {
      symbol: this.marketInfo.symbol,
      tickSize: this.marketInfo.tickSize,
      stepSize: this.marketInfo.stepSize,
      minOrderSize: this.marketInfo.minOrderSize,
      maxOrderSize: this.marketInfo.maxOrderSize,
    });
  }

  private waitForFreshPriceAndStartQuoting(): void {
    const checkPrice = () => {
      if (this.isShuttingDown) return;

      if (this.currentPrice && !this.binanceFeed.isPriceStale()) {
        this.setState("QUOTING");
        this.startQuoteLoop();
      } else {
        setTimeout(checkPrice, 1000);
      }
    };
    checkPrice();
  }

  private startQuoteLoop(): void {
    if (this.quoteInterval) return;

    this.quoteInterval = setInterval(async () => {
      if (this.isShuttingDown || this.state !== "QUOTING") return;

      if (this.binanceFeed.isPriceStale()) {
        logger.warn("Price is stale, pausing quoting");
        await this.pauseQuoting();
        return;
      }

      if (!this.currentPrice || !this.marketInfo) {
        logger.warn("Missing price or market info, skipping quote cycle");
        return;
      }

      try {
        await this.executeQuoteCycle();
      } catch (e) {
        logger.error("Quote cycle failed", { error: (e as Error).message });
      }
    }, config.quoteRefreshMs);

    logger.info("Quote loop started", { intervalMs: config.quoteRefreshMs });
  }

  private async executeQuoteCycle(): Promise<void> {
    if (!this.currentPrice || !this.marketInfo) return;

    const { canBuy, canSell } = await this.riskManager.getPositionRisk();

    const desiredQuote = this.strategy.calculateQuotes({
      referencePrice: this.currentPrice,
      market: this.marketInfo,
    });

    if (!canBuy) {
      logger.warn("Position limit reached for long, disabling bids");
      await this.orderManager.updateQuotes({ bids: [], asks: desiredQuote.asks });
      return;
    }

    if (!canSell) {
      logger.warn("Position limit reached for short, disabling asks");
      await this.orderManager.updateQuotes({ bids: desiredQuote.bids, asks: [] });
      return;
    }

    await this.orderManager.updateQuotes(desiredQuote);
  }

  private async pauseQuoting(): Promise<void> {
    this.setState("PAUSED");
    await this.orderManager.cancelAll();
    this.setState("RECONNECTING");
  }

  private setState(newState: State): void {
    this.state = newState;
    logger.info("State changed", { state: newState });
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.setState("STOPPING");

    if (this.quoteInterval) {
      clearInterval(this.quoteInterval);
      this.quoteInterval = null;
    }

    logger.info("Cancelling active orders");
    await this.orderManager.cancelAll();

    logger.info("Closing Binance WebSocket");
    this.binanceFeed.stop();

    logger.info("Stopping health server");
    await this.healthServer.stop();

    this.setState("STOPPED");
    logger.info("Market Maker stopped gracefully");
  }
}

async function main(): Promise<void> {
  const marketMaker = new MarketMaker();
  await marketMaker.start();
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});