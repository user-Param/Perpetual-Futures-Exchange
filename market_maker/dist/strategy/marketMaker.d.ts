import { Market } from "../exchange/exchangeClient";
export interface Quote {
    bids: {
        price: string;
        quantity: string;
    }[];
    asks: {
        price: string;
        quantity: string;
    }[];
}
export interface StrategyInput {
    referencePrice: string;
    market: Market;
}
export declare class MarketMakerStrategy {
    private spreadBps;
    private orderSize;
    private levels;
    private levelSpreadBps;
    constructor();
    calculateQuotes(input: StrategyInput): Quote;
}
export declare function createMarketMakerStrategy(): MarketMakerStrategy;
//# sourceMappingURL=marketMaker.d.ts.map