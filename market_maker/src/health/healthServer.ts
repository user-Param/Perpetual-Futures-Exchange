import express, { Request, Response } from "express";
import { config } from "../config";
import { BinanceFeed } from "../binance/binanceFeed";
import { ExchangeClient } from "../exchange/exchangeClient";
import { OrderManager } from "../orders/orderManager";
import { logger } from "../logger";

export interface HealthServerDependencies {
  binanceFeed: BinanceFeed;
  exchangeClient: ExchangeClient;
  orderManager: OrderManager;
  market: string;
}

export class HealthServer {
  private app: express.Express;
  private server: ReturnType<express.Express["listen"]> | null = null;
  private deps: HealthServerDependencies;

  constructor(deps: HealthServerDependencies) {
    this.deps = deps;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get("/health", (_req: Request, res: Response) => {
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

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(config.healthPort, () => {
        logger.info("Health server started", { port: config.healthPort });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
      logger.info("Health server stopped");
    }
  }
}

export function createHealthServer(deps: HealthServerDependencies): HealthServer {
  return new HealthServer(deps);
}