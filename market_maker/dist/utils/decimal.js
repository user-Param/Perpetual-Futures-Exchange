"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Decimal = void 0;
exports.D = D;
exports.roundToTickSize = roundToTickSize;
exports.roundToStepSize = roundToStepSize;
exports.validatePrice = validatePrice;
exports.validateQuantity = validateQuantity;
class Decimal {
    value;
    constructor(value) {
        this.value = value.toString();
    }
    static fromString(value) {
        return new Decimal(value);
    }
    toString() {
        return this.value;
    }
    toNumber() {
        return parseFloat(this.value);
    }
    plus(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return new Decimal((a + b).toFixed(8));
    }
    minus(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return new Decimal((a - b).toFixed(8));
    }
    mul(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return new Decimal((a * b).toFixed(8));
    }
    div(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        if (b === 0)
            throw new Error("Division by zero");
        return new Decimal((a / b).toFixed(8));
    }
    gt(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return a > b;
    }
    gte(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return a >= b;
    }
    lt(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return a < b;
    }
    lte(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return a <= b;
    }
    eq(other) {
        const a = this.toNumber();
        const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
        return a === b;
    }
    abs() {
        return new Decimal(Math.abs(this.toNumber()).toFixed(8));
    }
}
exports.Decimal = Decimal;
function D(value) {
    return new Decimal(value);
}
function roundToTickSize(price, tickSize) {
    const p = parseFloat(price);
    const tick = parseFloat(tickSize);
    if (tick === 0)
        return price;
    const rounded = Math.round(p / tick) * tick;
    return rounded.toFixed(8);
}
function roundToStepSize(quantity, stepSize) {
    const q = parseFloat(quantity);
    const step = parseFloat(stepSize);
    if (step === 0)
        return quantity;
    const rounded = Math.floor(q / step) * step;
    return rounded.toFixed(8);
}
function validatePrice(price, tickSize, minPrice, maxPrice) {
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0)
        return false;
    if (minPrice && p < parseFloat(minPrice))
        return false;
    if (maxPrice && p > parseFloat(maxPrice))
        return false;
    const rounded = roundToTickSize(price, tickSize);
    return parseFloat(rounded) === p;
}
function validateQuantity(quantity, stepSize, minSize, maxSize) {
    const q = parseFloat(quantity);
    if (isNaN(q) || q <= 0)
        return false;
    if (minSize && q < parseFloat(minSize))
        return false;
    if (maxSize && q > parseFloat(maxSize))
        return false;
    const rounded = roundToStepSize(quantity, stepSize);
    return parseFloat(rounded) === q;
}
//# sourceMappingURL=decimal.js.map