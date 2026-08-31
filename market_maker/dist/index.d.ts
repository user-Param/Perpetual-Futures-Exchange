export declare class MarketMaker {
    private state;
    private binanceFeed;
    private exchangeClient;
    private strategy;
    private healthServer;
    private quoteInterval;
    private isShuttingDown;
    private redis;
    private markets;
    constructor();
    private marketToBinanceSymbol;
    private setupBinanceHandlers;
    private setupSignalHandlers;
    start(): Promise<void>;
    private authenticateAndLoadMarkets;
    private waitForFreshPriceAndStartQuoting;
    private startQuoteLoop;
    private executeQuoteCycleFor;
    private pauseQuoting;
    private setState;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map