"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskManager = void 0;
exports.createRiskManager = createRiskManager;
const config_1 = require("../config");
const decimal_1 = require("../utils/decimal");
const logger_1 = require("../logger");
class RiskManager {
    exchangeClient;
    market;
    maxPosition;
    constructor(exchangeClient, market) {
        this.exchangeClient = exchangeClient;
        this.market = market;
        this.maxPosition = new decimal_1.Decimal(config_1.config.maxPosition);
    }
    async canIncreaseLong(additionalQuantity) {
        const position = await this.getPosition();
        if (!position)
            return true;
        if (position.side === "long") {
            const currentQty = new decimal_1.Decimal(position.quantity);
            const newQty = currentQty.plus(additionalQuantity);
            return newQty.lte(this.maxPosition);
        }
        return true;
    }
    async canIncreaseShort(additionalQuantity) {
        const position = await this.getPosition();
        if (!position)
            return true;
        if (position.side === "short") {
            const currentQty = new decimal_1.Decimal(position.quantity);
            const newQty = currentQty.plus(additionalQuantity);
            return newQty.lte(this.maxPosition);
        }
        return true;
    }
    async getPosition() {
        try {
            return await this.exchangeClient.getPosition(this.market);
        }
        catch (e) {
            logger_1.logger.warn("Failed to get position for risk check", { error: e.message });
            return null;
        }
    }
    async getPositionRisk() {
        const position = await this.getPosition();
        let canBuy = true;
        let canSell = true;
        if (position) {
            const posQty = new decimal_1.Decimal(position.quantity);
            if (position.side === "long") {
                canBuy = posQty.lt(this.maxPosition);
                canSell = true;
            }
            else if (position.side === "short") {
                canBuy = true;
                canSell = posQty.lt(this.maxPosition);
            }
        }
        return { canBuy, canSell, position };
    }
}
exports.RiskManager = RiskManager;
function createRiskManager(exchangeClient, market) {
    return new RiskManager(exchangeClient, market);
}
//# sourceMappingURL=riskManager.js.map