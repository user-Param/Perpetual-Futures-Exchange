import Redis from "ioredis";
import type { Quote } from "../strategy/marketMaker";
export declare class DirectOrderInjector {
    private redis;
    private market;
    private activeBids;
    private activeAsks;
    constructor(redis: Redis, market: string);
    updateQuotes(quote: Quote): Promise<void>;
    private placeOrder;
    private cancelOrder;
    cancelAll(): Promise<void>;
    getActiveCounts(): {
        bids: number;
        asks: number;
    };
}
//# sourceMappingURL=directOrderInjector.d.ts.map