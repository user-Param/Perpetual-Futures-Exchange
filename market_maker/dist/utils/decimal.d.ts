export declare class Decimal {
    private value;
    constructor(value: string | number);
    static fromString(value: string): Decimal;
    toString(): string;
    toNumber(): number;
    plus(other: Decimal | string): Decimal;
    minus(other: Decimal | string): Decimal;
    mul(other: Decimal | string): Decimal;
    div(other: Decimal | string): Decimal;
    gt(other: Decimal | string): boolean;
    gte(other: Decimal | string): boolean;
    lt(other: Decimal | string): boolean;
    lte(other: Decimal | string): boolean;
    eq(other: Decimal | string): boolean;
    abs(): Decimal;
}
export declare function D(value: string | number): Decimal;
export declare function roundToTickSize(price: string, tickSize: string): string;
export declare function roundToStepSize(quantity: string, stepSize: string): string;
export declare function validatePrice(price: string, tickSize: string, minPrice?: string, maxPrice?: string): boolean;
export declare function validateQuantity(quantity: string, stepSize: string, minSize?: string, maxSize?: string): boolean;
//# sourceMappingURL=decimal.d.ts.map