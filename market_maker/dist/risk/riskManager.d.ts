import { ExchangeClient, Position } from "../exchange/exchangeClient";
export declare class RiskManager {
    private exchangeClient;
    private market;
    private maxPosition;
    constructor(exchangeClient: ExchangeClient, market: string);
    canIncreaseLong(additionalQuantity: string): Promise<boolean>;
    canIncreaseShort(additionalQuantity: string): Promise<boolean>;
    getPosition(): Promise<Position | null>;
    getPositionRisk(): Promise<{
        canBuy: boolean;
        canSell: boolean;
        position: Position | null;
    }>;
}
export declare function createRiskManager(exchangeClient: ExchangeClient, market: string): RiskManager;
//# sourceMappingURL=riskManager.d.ts.map