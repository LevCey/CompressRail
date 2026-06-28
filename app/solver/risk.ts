// Risk-vector helpers for the matching stand-in.
import type { RiskVector } from "../verify/index";

export const EPS = 1e-9;

// Add v (scaled by sign) into a mutable accumulator, in place.
export function addInto(acc: Record<string, number>, v: RiskVector, sign: number): void {
  for (const [factor, value] of Object.entries(v)) {
    acc[factor] = (acc[factor] ?? 0) + sign * value;
  }
}

// Drop near-zero factors, returning a clean vector.
export function prune(v: Record<string, number>): RiskVector {
  const out: Record<string, number> = {};
  for (const [factor, value] of Object.entries(v)) {
    if (Math.abs(value) > EPS) out[factor] = value;
  }
  return out;
}
