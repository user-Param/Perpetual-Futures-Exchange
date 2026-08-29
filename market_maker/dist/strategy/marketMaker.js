"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketMakerStrategy = void 0;
exports.createMarketMakerStrategy = createMarketMakerStrategy;
const config_1 = require("../config");
const decimal_1 = require("../utils/decimal");
const logger_1 = require("../logger");
class MarketMakerStrategy {
    spreadBps;
    orderSize;
    levels = 20;
    levelSpreadBps = 2;
    constructor() {
        this.spreadBps = config_1.config.spreadBps;
        this.orderSize = config_1.config.orderSize;
    }
    calculateQuotes(input) {
        const { referencePrice, market } = input;
        const refPrice = new decimal_1.Decimal(referencePrice);
        const tickSize = parseFloat(market.tickSize);
        const stepSize = parseFloat(market.stepSize);
        const baseQuantity = parseFloat((0, decimal_1.roundToStepSize)(this.orderSize, market.stepSize));
        const halfSpread = refPrice.mul(this.spreadBps.toString()).div("20000");
        const levelSpread = refPrice.mul(this.levelSpreadBps.toString()).div("10000");
        const bids = [];
        const asks = [];
        for (let i = 0; i < this.levels; i++) {
            const levelOffset = levelSpread.mul((i + 1).toString());
            const bidPrice = (0, decimal_1.roundToTickSize)(refPrice.minus(halfSpread).minus(levelOffset).toString(), market.tickSize);
            const askPrice = (0, decimal_1.roundToTickSize)(refPrice.plus(halfSpread).plus(levelOffset).toString(), market.tickSize);
            const qty = (0, decimal_1.roundToStepSize)((baseQuantity * (1 + i * 0.1)).toFixed(8), market.stepSize);
            if ((0, decimal_1.validatePrice)(bidPrice, market.tickSize) && (0, decimal_1.validateQuantity)(qty, market.stepSize, market.minOrderSize, market.maxOrderSize)) {
                bids.push({ price: bidPrice, quantity: qty });
            }
            if ((0, decimal_1.validatePrice)(askPrice, market.tickSize) && (0, decimal_1.validateQuantity)(qty, market.stepSize, market.minOrderSize, market.maxOrderSize)) {
                asks.push({ price: askPrice, quantity: qty });
            }
        }
        logger_1.logger.debug("Calculated quotes", { referencePrice, bidLevels: bids.length, askLevels: asks.length, spreadBps: this.spreadBps });
        return { bids, asks };
    }
}
exports.MarketMakerStrategy = MarketMakerStrategy;
function createMarketMakerStrategy() {
    return new MarketMakerStrategy();
}
//# sourceMappingURL=marketMaker.js.map