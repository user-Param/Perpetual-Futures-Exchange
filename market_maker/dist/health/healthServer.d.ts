import { BinanceFeed } from "../binance/binanceFeed";
import { ExchangeClient } from "../exchange/exchangeClient";
import { OrderManager } from "../orders/orderManager";
export interface HealthServerDependencies {
    binanceFeed: BinanceFeed;
    exchangeClient: ExchangeClient;
    orderManager: OrderManager;
    market: string;
}
export declare class HealthServer {
    private app;
    private server;
    private deps;
    constructor(deps: HealthServerDependencies);
    private setupRoutes;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export declare function createHealthServer(deps: HealthServerDependencies): HealthServer;
//# sourceMappingURL=healthServer.d.ts.map