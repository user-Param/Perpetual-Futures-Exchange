export declare class MarketMaker {
    private state;
    private binanceFeed;
    private exchangeClient;
    private strategy;
    private orderManager;
    private riskManager;
    private healthServer;
    private quoteInterval;
    private currentPrice;
    private marketInfo;
    private isShuttingDown;
    private redis;
    constructor();
    private setupBinanceHandlers;
    private setupSignalHandlers;
    start(): Promise<void>;
    private authenticateAndLoadMarket;
    private waitForFreshPriceAndStartQuoting;
    private startQuoteLoop;
    private executeQuoteCycle;
    private pauseQuoting;
    private setState;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map