// The participant-side cycle flow (R4.1 / R4.3): verify locally, then commit.
//
// A participant runs this on its own node. It opens (verifies + decrypts) every
// replacement leg it would hold, computes its post-cycle residual risk against its
// tolerance, and only if the check passes does it build a participation to submit.
// The submission carries the leg commitments + ciphertext and a single boolean —
// never the cleartext terms, the risk delta, or the tolerance. A participant whose
// risk moves beyond tolerance declines, which leaves the cycle unable to commit
// (R4.4 / I-5).
import { openLeg } from "../crypto/index";
import { assessCompression, riskOf } from "../verify/index";
import type { Position } from "../verify/index";
import type { LegCommit, ParticipationResult, PrepareParticipationInput } from "./types";

export async function prepareParticipation(input: PrepareParticipationInput): Promise<ParticipationResult> {
  // Open every leg the participant will hold. openLeg verifies the commitment and
  // authenticates the ciphertext, so a tampered or unverifiable leg is rejected
  // before the participant would ever commit to it.
  const after: Position[] = [];
  for (const leg of input.legs) {
    if (leg.cptyA !== input.participant && leg.cptyA !== leg.counterparty) {
      throw new Error(`leg with ${leg.counterparty} names a cptyA that is neither side: ${leg.cptyA}`);
    }
    const terms = await openLeg(leg.sealed, input.participant, input.keyPair);
    const sign = leg.cptyA === input.participant ? 1 : -1;
    const risk = riskOf(terms);
    after.push({ legId: leg.counterparty, risk: Object.fromEntries(Object.entries(risk).map(([k, v]) => [k, sign * v])) });
  }

  const assessment = assessCompression({ before: input.before, after, tolerance: input.tolerance });
  if (!assessment.withinTolerance) {
    return { decision: "decline", assessment };
  }

  const legs: LegCommit[] = input.legs.map((leg) => ({
    counterparty: leg.counterparty,
    commitment: leg.sealed.commitment,
    enc: leg.sealed.ciphertext,
  }));

  return {
    decision: "commit",
    submission: { participant: input.participant, legs, withinTolerance: true },
    assessment,
  };
}
