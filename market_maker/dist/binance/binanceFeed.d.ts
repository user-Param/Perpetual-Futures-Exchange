type PriceCallback = (price: string, timestamp: number) => void;
export interface BinanceFeedEvents {
    onPrice: (callback: PriceCallback) => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onError: (error: Error) => void;
}
export declare class BinanceFeed {
    private ws;
    private reconnectAttempts;
    private maxReconnectDelay;
    private priceCallback;
    private lastPriceUpdate;
    private isRunning;
    private reconnectTimeout;
    constructor();
    start(): void;
    stop(): void;
    onPrice(callback: PriceCallback): void;
    getLastPriceUpdate(): number;
    isPriceStale(): boolean;
    private connect;
    private handleMessage;
    private scheduleReconnect;
    private emitConnect;
    private emitDisconnect;
    private emitError;
}
export declare function createBinanceFeed(): BinanceFeed;
export {};
//# sourceMappingURL=binanceFeed.d.ts.map