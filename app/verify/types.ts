// Types for the per-node residual-risk check.
//
// This runs on a participant's own node over its node-local cleartext (the legs it
// has decrypted). It computes how much the proposed compression would move the
// participant's net risk and compares that to the participant's declared tolerance.
// Only the resulting boolean attestation is ever written on-ledger; the delta and
// the tolerance stay on the node (R4.3).

// Signed risk sensitivities keyed by an opaque risk factor (e.g. a tenor bucket).
// The unit is the participant's own; the check is scale-consistent within a node.
export type RiskVector = Readonly<Record<string, number>>;

// One leg the participant holds, as seen in its node-local cleartext: an opaque leg
// id and the signed sensitivities the leg contributes to the participant's book.
export interface Position {
  readonly legId: string;
  readonly risk: RiskVector;
}

// Inputs to the check: the participant's positions before the cycle (the legs it
// would tear up plus any it keeps) and after the cycle (the replacement legs it
// would hold), and its declared tolerance for net-risk movement.
export interface CompressionAssessmentInput {
  readonly before: readonly Position[];
  readonly after: readonly Position[];
  readonly tolerance: number;
}

// The outcome. `withinTolerance` is the only field that leaves the node (it becomes
// the on-ledger attestation); `residual`, `magnitude`, and `tolerance` are local
// detail for the participant to inspect.
export interface RiskAssessment {
  readonly residual: RiskVector;
  readonly magnitude: number;
  readonly tolerance: number;
  readonly withinTolerance: boolean;
}
