import { ExchangeClient } from "../exchange/exchangeClient";
import { Quote } from "../strategy/marketMaker";
export interface ActiveOrder {
    id: string;
    price: string;
    quantity: string;
    side: "buy" | "sell";
    clientOrderId: string;
}
export declare class OrderManager {
    private exchangeClient;
    private market;
    private activeBids;
    private activeAsks;
    private isReconciling;
    constructor(exchangeClient: ExchangeClient, market: string);
    reconcile(): Promise<void>;
    updateQuotes(desiredQuote: Quote): Promise<void>;
    private placeOrder;
    private cancelOrder;
    cancelAll(): Promise<void>;
    getActiveBids(): ActiveOrder[];
    getActiveAsks(): ActiveOrder[];
    hasActiveOrders(): boolean;
}
export declare function createOrderManager(exchangeClient: ExchangeClient, market: string): OrderManager;
//# sourceMappingURL=orderManager.d.ts.map