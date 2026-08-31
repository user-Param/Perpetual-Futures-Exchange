type PriceCallback = (price: string, timestamp: number) => void;
type SymbolPriceCallback = (symbol: string, price: string, timestamp: number) => void;
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
    private symbolPriceCallback;
    private lastPriceUpdate;
    private perSymbolLastUpdate;
    private isRunning;
    private reconnectTimeout;
    private symbols;
    constructor(symbols?: string[]);
    start(): void;
    stop(): void;
    onPrice(callback: PriceCallback): void;
    onSymbolPrice(callback: SymbolPriceCallback): void;
    getLastPriceUpdate(): number;
    getLastPriceUpdateFor(symbol: string): number;
    isPriceStale(): boolean;
    isPriceStaleFor(symbol: string): boolean;
    private buildWsUrl;
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