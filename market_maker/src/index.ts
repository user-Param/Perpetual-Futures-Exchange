import { config, validateConfig } from "./config";
import { logger } from "./logger";
import { BinanceFeed, createBinanceFeed } from "./binance/binanceFeed";
import { ExchangeClient, createExchangeClient } from "./exchange/exchangeClient";
import { MarketMakerStrategy, createMarketMakerStrategy } from "./strategy/marketMaker";
import { OrderManager, createOrderManager } from "./orders/orderManager";
import { RiskManager, createRiskManager } from "./risk/riskManager";
import { HealthServer, createHealthServer } from "./health/healthServer";
import { DirectOrderInjector } from "./liquidity/directOrderInjector";
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

interface MarketState {
  market: string;
  binanceSymbol: string;
  currentPrice: string | null;
  marketInfo: Awaited<ReturnType<ExchangeClient["getMarket"]>> | null;
  orderManager: OrderManager;
  riskManager: RiskManager;
  directInjector: DirectOrderInjector;
}

// Map Binance symbol -> FTX market symbol
function binanceToMarket(binanceSymbol: string): string | null {
  const upper = binanceSymbol.toUpperCase();
  // Try ordered mapping: config.binance.symbols[i] ↔ config.markets[i]
  const idx = config.binance.symbols.findIndex((s) => s.toUpperCase() === upper);
  if (idx !== -1 && config.markets[idx]) return config.markets[idx];
  // Fallback: derive (BTCUSDT -> BTC-USDT-PERP)
  const base = upper.replace(/USDT$/, "");
  if (!base) return null;
  const candidate = `${base}-USDT-PERP`;
  if (config.markets.includes(candidate)) return candidate;
  // Also try exact match if market list contains base
  return null;
}

export class MarketMaker {
  private state: State = "STARTING";
  private binanceFeed: BinanceFeed;
  private exchangeClient: ExchangeClient;
  private strategy: MarketMakerStrategy;
  private healthServer: HealthServer;
  private quoteInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private redis: Redis;
  private markets: Map<string, MarketState> = new Map();

  constructor() {
    validateConfig();
    logger.info("Market Maker initializing (direct Engine liquidity)", {
      markets: config.markets,
      binanceSymbols: config.binance.symbols,
      spreadBps: config.spreadBps,
      orderSize: config.orderSize,
      quoteRefreshMs: config.quoteRefreshMs,
      priceStaleMs: config.priceStaleMs,
    });

    this.redis = new Redis(config.redisUrl || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.redis.on("error", (err) => logger.error("Redis error", { error: err.message }));

    // Single feed handling all symbols via combined stream
    this.binanceFeed = new BinanceFeed(config.binance.symbols);
    this.exchangeClient = createExchangeClient();
    this.strategy = createMarketMakerStrategy();

    // Init per-market state with direct injector (primary) + legacy orderManager (fallback)
    for (const market of config.markets) {
      const binanceSym = this.marketToBinanceSymbol(market);
      const ms: MarketState = {
        market,
        binanceSymbol: binanceSym || market.split("-")[0] + "USDT",
        currentPrice: null,
        marketInfo: null,
        orderManager: createOrderManager(this.exchangeClient, market),
        riskManager: createRiskManager(this.exchangeClient, market),
        directInjector: new DirectOrderInjector(this.redis, market),
      };
      this.markets.set(market, ms);
    }

    // Health server uses first market for legacy compat, but also expose multi
    const firstMarket = config.markets[0] || config.market;
    const firstState = this.markets.get(firstMarket);
    this.healthServer = createHealthServer({
      binanceFeed: this.binanceFeed,
      exchangeClient: this.exchangeClient,
      orderManager: firstState ? firstState.orderManager : createOrderManager(this.exchangeClient, firstMarket),
      market: firstMarket,
    });

    this.setupBinanceHandlers();
    this.setupSignalHandlers();
  }

  private marketToBinanceSymbol(market: string): string {
    const base = market.split("-")[0].toUpperCase();
    const found = config.binance.symbols.find((s) => s.toUpperCase().startsWith(base));
    return found || `${base}USDT`;
  }

  private setupBinanceHandlers(): void {
    // Per-symbol callback — direct Engine liquidity path
    this.binanceFeed.onSymbolPrice((binanceSymbol: string, price: string, timestamp: number) => {
      const market = binanceToMarket(binanceSymbol);
      if (!market) {
        logger.debug("Received Binance price for unmapped symbol", { binanceSymbol, price });
        return;
      }
      const state = this.markets.get(market);
      if (!state) return;
      state.currentPrice = price;
      logger.debug("Received Binance price", { binanceSymbol, market, price, timestamp });

      // Publish reference price to Redis for exchange mark price updater & ticker
      // This is the critical path: Server/src/services/marketService.ts:107 and markPriceUpdater.ts:91
      const payload = JSON.stringify({ price, timestamp, market });
      const key = `mark_price:reference:${market}`;
      this.redis.set(key, payload, "EX", 60).catch((e) => {
        logger.warn("Failed to publish mark price to Redis", { error: (e as Error).message, market });
      });
    });

    // Legacy single-price callback for backward compat
    this.binanceFeed.onPrice((price: string, timestamp: number) => {
      // Fallback: if only one market, update it
      if (config.markets.length === 1) {
        const market = config.markets[0];
        const state = this.markets.get(market);
        if (state && !state.currentPrice) {
          state.currentPrice = price;
          const payload = JSON.stringify({ price, timestamp, market });
          const key = `mark_price:reference:${market}`;
          this.redis.set(key, payload, "EX", 60).catch(() => {});
        }
      }
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
      await this.authenticateAndLoadMarkets();
      for (const state of this.markets.values()) {
        try {
          await state.orderManager.reconcile();
        } catch (e) {
          logger.warn("Reconcile failed", { market: state.market, error: (e as Error).message });
        }
      }
      this.binanceFeed.start();

      this.waitForFreshPriceAndStartQuoting();
    } catch (e) {
      logger.error("Failed to start market maker", { error: (e as Error).message });
      throw e;
    }
  }

  private async authenticateAndLoadMarkets(): Promise<void> {
    await this.exchangeClient.authenticate();
    for (const [market, state] of this.markets) {
      try {
        state.marketInfo = await this.exchangeClient.getMarket(market);
        logger.info("Market loaded", {
          symbol: state.marketInfo.symbol,
          binanceSymbol: state.binanceSymbol,
          tickSize: state.marketInfo.tickSize,
          stepSize: state.marketInfo.stepSize,
        });
      } catch (e) {
        logger.error("Failed to load market", { market, error: (e as Error).message });
        throw e;
      }
    }
  }

  private waitForFreshPriceAndStartQuoting(): void {
    const checkPrice = () => {
      if (this.isShuttingDown) return;
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

      for (const state of this.markets.values()) {
        if (!state.currentPrice || !state.marketInfo) continue;
        if (this.binanceFeed.isPriceStaleFor(state.binanceSymbol)) {
          logger.warn("Price stale, skipping market", { market: state.market, binanceSymbol: state.binanceSymbol });
          continue;
        }
        try {
          await this.executeQuoteCycleFor(state);
        } catch (e) {
          logger.error("Quote cycle failed", { market: state.market, error: (e as Error).message });
        }
      }
    }, config.quoteRefreshMs);

    logger.info("Quote loop started (direct Engine injection)", { intervalMs: config.quoteRefreshMs, markets: config.markets });
  }

  private async executeQuoteCycleFor(state: MarketState): Promise<void> {
    if (!state.currentPrice || !state.marketInfo) return;

    const desiredQuote = this.strategy.calculateQuotes({
      referencePrice: state.currentPrice,
      market: state.marketInfo,
    });

    // Direct injection to Engine via Redis Stream — primary liquidity path
    // This connects Binance directly to Engine: Engine will match FTX user orders against these Binance-backed quotes
    try {
      await state.directInjector.updateQuotes(desiredQuote);
    } catch (e) {
      logger.error("Direct injection failed, falling back to REST", { market: state.market, error: (e as Error).message });
      // Fallback to REST path (requires balance, slower)
      const { canBuy, canSell } = await state.riskManager.getPositionRisk().catch(() => ({ canBuy: true, canSell: true }));
      let quoteToSend = desiredQuote;
      if (!canBuy) quoteToSend = { bids: [], asks: desiredQuote.asks };
      if (!canSell) quoteToSend = { bids: desiredQuote.bids, asks: [] };
      await state.orderManager.updateQuotes(quoteToSend);
    }
  }

  private async pauseQuoting(): Promise<void> {
    this.setState("PAUSED");
    for (const state of this.markets.values()) {
      await state.directInjector.cancelAll().catch(() => {});
      await state.orderManager.cancelAll().catch(() => {});
    }
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

    logger.info("Cancelling direct LP orders");
    for (const state of this.markets.values()) {
      await state.directInjector.cancelAll().catch(() => {});
      await state.orderManager.cancelAll().catch(() => {});
    }

    logger.info("Closing Binance WebSocket");
    this.binanceFeed.stop();

    logger.info("Stopping health server");
    await this.healthServer.stop();

    this.setState("STOPPED");
    logger.info("Market Maker stopped gracefully (direct Engine mode)");
  }
}

async function main(): Promise<void> {
  const marketMaker = new MarketMaker();
  await marketMaker.start();
}

main().catch((e) => {
  logger.error("Fatal error", { error: e.message });
  process.exit(1);
});
