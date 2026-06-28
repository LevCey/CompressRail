// Participant-side cycle orchestration types.
//
// These mirror the on-ledger shapes the Daml `CompressionCycle.Commit` choice
// consumes: a participation is a participant id, a list of replacement-leg
// commitments, and a single within-tolerance boolean. Nothing here carries a
// cleartext economic term — the risk delta and the tolerance stay on the node.
import type { SealedLeg, KeyPair } from "../crypto/index";
import type { Position, RiskAssessment } from "../verify/index";

// A replacement leg the participant will hold after the cycle, as the shared
// sealed payload one counterparty authored and distributed. Both counterparties
// commit the same `sealed.commitment`, which is what the on-ledger execute checks.
export interface HeldLeg {
  readonly counterparty: string;
  readonly sealed: SealedLeg;
}

export interface PrepareParticipationInput {
  readonly participant: string;
  readonly keyPair: KeyPair; // to open (verify + decrypt) the legs it will hold
  readonly before: readonly Position[]; // its node-local pre-cycle positions
  readonly legs: readonly HeldLeg[]; // the replacement legs it will hold
  readonly tolerance: number;
}

// Mirrors Daml `LegCommit`: the only per-leg data that goes on-ledger.
export interface LegCommit {
  readonly counterparty: string;
  readonly commitment: string;
  readonly enc: string;
}

// Mirrors the Daml `Commit` choice arguments / `Participation`.
export interface ParticipationSubmission {
  readonly participant: string;
  readonly legs: LegCommit[];
  readonly withinTolerance: boolean;
}

// The local outcome: either an on-ledger submission to commit, or a decline. The
// `assessment` (magnitude, tolerance) is node-local detail, never submitted.
export type ParticipationResult =
  | { readonly decision: "commit"; readonly submission: ParticipationSubmission; readonly assessment: RiskAssessment }
  | { readonly decision: "decline"; readonly assessment: RiskAssessment };
