// Decimal math using string-based arithmetic to avoid float precision issues.
// All monetary values flow through this module as strings.
import Big from "./big";

export type DecStr = string;

export const D = (v: string | number | bigint | DecStr): Big => new Big(String(v));

export const ZERO = D("0");

export function add(a: DecStr, b: DecStr): DecStr {
  return D(a).plus(D(b)).toString();
}

export function sub(a: DecStr, b: DecStr): DecStr {
  return D(a).minus(D(b)).toString();
}

export function mul(a: DecStr, b: DecStr): DecStr {
  return D(a).times(D(b)).toString();
}

export function div(a: DecStr, b: DecStr): DecStr {
  return D(a).div(D(b)).toString();
}

export function gte(a: DecStr, b: DecStr): boolean {
  return D(a).gte(D(b));
}

export function lte(a: DecStr, b: DecStr): boolean {
  return D(a).lte(D(b));
}

export function gt(a: DecStr, b: DecStr): boolean {
  return D(a).gt(D(b));
}

export function lt(a: DecStr, b: DecStr): boolean {
  return D(a).lt(D(b));
}

export function eq(a: DecStr, b: DecStr): boolean {
  return D(a).eq(D(b));
}

export function isPositive(a: DecStr): boolean {
  return gt(a, "0");
}

export function toFixed(a: DecStr, decimals: number): DecStr {
  return D(a).toFixed(decimals);
}
