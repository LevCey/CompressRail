// The per-node residual-risk check (R4.1).
//
// A participant runs this on its own node, over its node-local cleartext, before it
// commits to a cycle. It measures how far the proposed compression moves the
// participant's net risk and compares that to the participant's declared tolerance.
// The boolean it returns is the on-ledger attestation; the magnitude and tolerance
// never leave the node (R4.3). A participant whose movement exceeds tolerance
// declines, which makes the whole cycle fail to commit (R4.4 / I-5).
import { l1Norm, netRisk, subtractRisk } from "./risk";
import type { CompressionAssessmentInput, RiskAssessment } from "./types";

export function assessCompression(input: CompressionAssessmentInput): RiskAssessment {
  if (typeof input.tolerance !== "number" || !Number.isFinite(input.tolerance) || input.tolerance < 0) {
    throw new Error("tolerance must be a finite, non-negative number");
  }
  const residual = subtractRisk(netRisk(input.after), netRisk(input.before));
  const magnitude = l1Norm(residual);
  return {
    residual,
    magnitude,
    tolerance: input.tolerance,
    withinTolerance: magnitude <= input.tolerance,
  };
}
