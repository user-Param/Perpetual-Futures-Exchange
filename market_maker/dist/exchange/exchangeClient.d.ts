export interface Market {
    id: string;
    symbol: string;
    baseAssetId: string;
    quoteAssetId: string;
    status: string;
    tickSize: string;
    stepSize: string;
    minOrderSize: string;
    maxOrderSize: string;
    maxLeverage: number;
    initialMarginRate: string;
    maintenanceMarginRate: string;
    makerFeeBps: number;
    takerFeeBps: number;
    fundingIntervalHours: number;
}
export interface Balance {
    asset: string;
    available: string;
    locked: string;
}
export interface Order {
    id: string;
    userId: string;
    marketId: string;
    clientOrderId: string | null;
    orderType: "market" | "limit";
    side: "buy" | "sell";
    price: string | null;
    quantity: string;
    filledQuantity: string;
    status: "pending" | "open" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
    reduceOnly: boolean;
    postOnly: boolean;
    timeInForce: "GTC" | "IOC" | "FOK";
    leverage: string;
    marginMode: "isolated" | "cross";
    createdAt: string;
    updatedAt: string;
    executedAt: string | null;
}
export interface Position {
    id: string;
    userId: string;
    marketId: string;
    side: "long" | "short";
    quantity: string;
    entryPrice: string;
    markPrice: string;
    liquidationPrice: string;
    margin: string;
    leverage: number;
    marginMode: "isolated" | "cross";
    realizedPnl: string;
    status: "open" | "closed" | "liquidated";
    openedAt: string;
    closedAt: string | null;
}
export interface PlaceOrderParams {
    market: string;
    side: "buy" | "sell";
    orderType: "market" | "limit";
    price?: string;
    quantity: string;
    timeInForce?: "GTC" | "IOC" | "FOK";
    leverage?: string;
    marginMode?: "isolated" | "cross";
    reduceOnly?: boolean;
    postOnly?: boolean;
    clientOrderId?: string;
}
export interface AuthResponse {
    token: string;
    user: {
        id: string;
        email: string;
        name: string;
        role: string;
    };
}
export declare class ExchangeClient {
    private baseUrl;
    private email;
    private password;
    private token;
    private requestTimeout;
    constructor();
    private request;
    authenticate(): Promise<void>;
    getToken(): string | null;
    getMarket(symbol: string): Promise<Market>;
    getBalances(): Promise<Balance[]>;
    getOpenOrders(symbol: string): Promise<Order[]>;
    placeLimitOrder(params: PlaceOrderParams): Promise<Order>;
    cancelOrder(orderId: string): Promise<void>;
    cancelAllOrders(symbol: string): Promise<void>;
    getPosition(symbol: string): Promise<Position | null>;
    getUserId(): Promise<string>;
}
export declare function createExchangeClient(): ExchangeClient;
//# sourceMappingURL=exchangeClient.d.ts.map