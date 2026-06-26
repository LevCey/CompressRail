// Risk-vector arithmetic for the per-node check. Small, deterministic, and
// inspectable — the residual-risk computation is a real calculation over cleartext,
// not a placeholder (R4.2). Production risk models (SIMM, SA-CCR, CRIF) are out of
// scope; this is the stand-in the architecture is proven against (D4 / CTD-4).
import type { Position, RiskVector } from "./types";

// Net risk of a set of positions: the per-factor sum of their sensitivities.
export function netRisk(positions: readonly Position[]): RiskVector {
  const acc: Record<string, number> = {};
  for (const position of positions) {
    for (const [factor, sensitivity] of Object.entries(position.risk)) {
      acc[factor] = (acc[factor] ?? 0) + sensitivity;
    }
  }
  return acc;
}

// Per-factor difference a - b over the union of factors.
export function subtractRisk(a: RiskVector, b: RiskVector): RiskVector {
  const out: Record<string, number> = {};
  for (const factor of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[factor] = (a[factor] ?? 0) - (b[factor] ?? 0);
  }
  return out;
}

// Aggregate magnitude of a risk vector: the sum of absolute per-factor sensitivities
// (L1 norm). Used as the single scalar compared against the declared tolerance.
export function l1Norm(vector: RiskVector): number {
  return Object.values(vector).reduce((sum, value) => sum + Math.abs(value), 0);
}
