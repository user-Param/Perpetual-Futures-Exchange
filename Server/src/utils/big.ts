// Lightweight big-decimal implementation supporting +, -, *, /, and comparison.
// Sufficient for v1 monetary calculations. Avoids floating point errors.
export default class Big {
  private value: bigint;
  private decimals: number;
  private negative: boolean;

  constructor(input: string | number | bigint) {
    let s = typeof input === "string" ? input.trim() : String(input);
    if (s === "") s = "0";
    this.negative = false;
    if (s.startsWith("-")) {
      this.negative = true;
      s = s.slice(1);
    } else if (s.startsWith("+")) {
      s = s.slice(1);
    }
    if (s.includes("e") || s.includes("E")) {
      // Use a fallback for scientific notation.
      const n = Number(s);
      s = n.toString();
    }
    let [intPart, decPart = ""] = s.split(".");
    intPart = intPart.replace(/[^0-9]/g, "") || "0";
    decPart = decPart.replace(/[^0-9]/g, "");
    this.decimals = decPart.length;
    const combined = (intPart === "" ? "0" : intPart) + decPart;
    this.value = BigInt(combined);
    this.normalize();
  }

  private normalize(): void {
    if (this.value === 0n) {
      this.negative = false;
      this.decimals = Math.max(this.decimals, 0);
    }
  }

  private sameScale(other: Big): { a: bigint; b: bigint; scale: number } {
    const scale = Math.max(this.decimals, other.decimals);
    const a = this.value * 10n ** BigInt(scale - this.decimals);
    const b = other.value * 10n ** BigInt(scale - other.decimals);
    return { a, b, scale };
  }

  private fromScaled(value: bigint, scale: number): Big {
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const str = abs.toString().padStart(scale + 1, "0");
    const intPart = str.slice(0, str.length - scale) || "0";
    const decPart = str.slice(str.length - scale).replace(/0+$/, "");
    const out = new Big(decPart ? `${intPart}.${decPart}` : intPart);
    out.negative = negative;
    return out;
  }

  plus(other: Big | string | number): Big {
    const o = other instanceof Big ? other : new Big(other);
    const { a, b, scale } = this.sameScale(o);
    const result = (this.negative ? -a : a) + (o.negative ? -b : b);
    return this.fromScaled(result, scale);
  }

  minus(other: Big | string | number): Big {
    const o = other instanceof Big ? other : new Big(other);
    const { a, b, scale } = this.sameScale(o);
    const result = (this.negative ? -a : a) - (o.negative ? -b : b);
    return this.fromScaled(result, scale);
  }

  times(other: Big | string | number): Big {
    const o = other instanceof Big ? other : new Big(other);
    const result = this.value * o.value;
    const out = this.fromScaled(result, this.decimals + o.decimals);
    if (this.negative !== o.negative) out.negative = true;
    return out;
  }

  div(other: Big | string | number, scale = 18): Big {
    const o = other instanceof Big ? other : new Big(other);
    if (o.value === 0n) throw new Error("Division by zero");
    const numerator = this.value * 10n ** BigInt(scale + o.decimals);
    const result = numerator / o.value;
    const out = this.fromScaled(result, this.decimals + scale);
    if (this.negative !== o.negative) out.negative = true;
    return out;
  }

  eq(other: Big | string | number): boolean {
    const o = other instanceof Big ? other : new Big(other);
    const { a, b } = this.sameScale(o);
    return a === b && this.negative === o.negative;
  }

  gt(other: Big | string | number): boolean {
    const o = other instanceof Big ? other : new Big(other);
    const { a, b } = this.sameScale(o);
    const left = this.negative ? -a : a;
    const right = o.negative ? -b : b;
    return left > right;
  }

  gte(other: Big | string | number): boolean {
    const o = other instanceof Big ? other : new Big(other);
    return this.eq(o) || this.gt(o);
  }

  lt(other: Big | string | number): boolean {
    return !this.gte(other);
  }

  lte(other: Big | string | number): boolean {
    return !this.gt(other);
  }

  toString(): string {
    if (this.decimals === 0) {
      return (this.negative ? "-" : "") + this.value.toString();
    }
    const abs = this.negative ? -this.value : this.value;
    const str = abs.toString().padStart(this.decimals + 1, "0");
    const intPart = str.slice(0, str.length - this.decimals);
    const decPart = str.slice(str.length - this.decimals);
    return `${this.negative ? "-" : ""}${intPart}.${decPart}`;
  }

  toFixed(decimals: number): string {
    let s = this.toString();
    const [intPart, decPart = ""] = s.replace("-", "").split(".");
    const padded = (decPart + "0".repeat(decimals)).slice(0, decimals);
    s = `${intPart}.${padded}`;
    if (this.negative && !(intPart === "0" && padded === "0")) s = "-" + s;
    return s;
  }
}
