// Bridge from a decrypted leg's cleartext terms to its risk sensitivities.
//
// A participant decrypts its own legs off-ledger (see ../crypto) and reads the risk
// sensitivities out of the cleartext to run the per-node check. The terms reach this
// function only on the owning participant's node; nothing here ever runs operator-side.
import type { RiskVector } from "./types";

// Read `terms.risk` (a map of factor -> finite number) from a decrypted leg's terms,
// validating the shape so a malformed payload fails the check rather than passing
// silently.
export function riskOf(terms: unknown): RiskVector {
  if (typeof terms !== "object" || terms === null || Array.isArray(terms)) {
    throw new Error("terms must be an object carrying a risk field");
  }
  const risk = (terms as Record<string, unknown>).risk;
  if (typeof risk !== "object" || risk === null || Array.isArray(risk)) {
    throw new Error("terms.risk must be an object of factor -> sensitivity");
  }
  const out: Record<string, number> = {};
  for (const [factor, value] of Object.entries(risk)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`risk sensitivity for factor "${factor}" must be a finite number`);
    }
    out[factor] = value;
  }
  return out;
}
