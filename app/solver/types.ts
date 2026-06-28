// Types for the cycle-matching stand-in (CTD-4 / D4).
//
// This computes which trades a compression cycle tears up and which replacement
// legs restore each participant's net risk. It is a small, real, deterministic
// algorithm over fixture cleartext — a labeled stand-in for the per-node multi-party
// computation a production system would run. It is NOT the operator and never runs
// operator-side: the operator only ever receives the resulting topology and opaque
// commitments, never the books this works over. Production risk models
// (SIMM / SA-CCR / CRIF) are out of scope.
import type { RiskVector } from "../verify/index";

export type { RiskVector };

// A bilateral trade in the nominated set. `risk` is from `a`'s perspective; `b`
// holds the opposite (a is long the sensitivities, b is short them).
export interface Trade {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly risk: RiskVector;
}

// A replacement leg the cycle would create, signed by its two counterparties only.
// `risk` is from `a`'s perspective.
export interface Replacement {
  readonly a: string;
  readonly b: string;
  readonly risk: RiskVector;
}

export interface MatchResult {
  readonly teardown: string[]; // ids of the trades to tear up
  readonly replacements: Replacement[]; // minimal net-preserving legs
  readonly netByParty: Record<string, RiskVector>; // each party's net risk (preserved by the match)
}
