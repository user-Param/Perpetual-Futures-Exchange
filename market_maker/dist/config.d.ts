import "dotenv/config";
export declare const config: {
    exchange: {
        apiUrl: string;
        email: string;
        password: string;
    };
    binance: {
        symbol: string;
        wsUrl: string;
    };
    market: string;
    spreadBps: number;
    orderSize: string;
    quoteRefreshMs: number;
    priceStaleMs: number;
    maxPosition: string;
    healthPort: number;
    logLevel: string;
    redisUrl: string;
};
export declare function validateConfig(): void;
//# sourceMappingURL=config.d.ts.map