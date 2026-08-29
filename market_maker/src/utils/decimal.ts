export class Decimal {
  private value: string;

  constructor(value: string | number) {
    this.value = value.toString();
  }

  static fromString(value: string): Decimal {
    return new Decimal(value);
  }

  toString(): string {
    return this.value;
  }

  toNumber(): number {
    return parseFloat(this.value);
  }

  plus(other: Decimal | string): Decimal {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return new Decimal((a + b).toFixed(8));
  }

  minus(other: Decimal | string): Decimal {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return new Decimal((a - b).toFixed(8));
  }

  mul(other: Decimal | string): Decimal {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return new Decimal((a * b).toFixed(8));
  }

  div(other: Decimal | string): Decimal {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    if (b === 0) throw new Error("Division by zero");
    return new Decimal((a / b).toFixed(8));
  }

  gt(other: Decimal | string): boolean {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return a > b;
  }

  gte(other: Decimal | string): boolean {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return a >= b;
  }

  lt(other: Decimal | string): boolean {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return a < b;
  }

  lte(other: Decimal | string): boolean {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return a <= b;
  }

  eq(other: Decimal | string): boolean {
    const a = this.toNumber();
    const b = typeof other === "string" ? parseFloat(other) : other.toNumber();
    return a === b;
  }

  abs(): Decimal {
    return new Decimal(Math.abs(this.toNumber()).toFixed(8));
  }
}

export function D(value: string | number): Decimal {
  return new Decimal(value);
}

export function roundToTickSize(price: string, tickSize: string): string {
  const p = parseFloat(price);
  const tick = parseFloat(tickSize);
  if (tick === 0) return price;
  const rounded = Math.round(p / tick) * tick;
  return rounded.toFixed(8);
}

export function roundToStepSize(quantity: string, stepSize: string): string {
  const q = parseFloat(quantity);
  const step = parseFloat(stepSize);
  if (step === 0) return quantity;
  const rounded = Math.floor(q / step) * step;
  return rounded.toFixed(8);
}

export function validatePrice(price: string, tickSize: string, minPrice?: string, maxPrice?: string): boolean {
  const p = parseFloat(price);
  if (isNaN(p) || p <= 0) return false;
  if (minPrice && p < parseFloat(minPrice)) return false;
  if (maxPrice && p > parseFloat(maxPrice)) return false;
  const rounded = roundToTickSize(price, tickSize);
  return parseFloat(rounded) === p;
}

export function validateQuantity(quantity: string, stepSize: string, minSize?: string, maxSize?: string): boolean {
  const q = parseFloat(quantity);
  if (isNaN(q) || q <= 0) return false;
  if (minSize && q < parseFloat(minSize)) return false;
  if (maxSize && q > parseFloat(maxSize)) return false;
  const rounded = roundToStepSize(quantity, stepSize);
  return parseFloat(rounded) === q;
}