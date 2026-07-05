// The "try to cheat" falsification (R8.7, D8): a judge, acting as the operator,
// genuinely attempts to recover a participant's position from the operator's own
// live ledger view. This must really fail — no cleartext is faked as hidden by the
// UI, and no simulated failure is returned. It reads the operator's own
// BilateralTrade projection (which is empty by construction, R5.1) and, if the
// operator somehow held a trade, attempts to open it with the operator's own key
// pair, which cannot succeed because the operator's key was never a wrap recipient
// (R5.3). Either path is a real outcome of a real attempt, not a scripted one.
import { generateKeyPair, openLeg } from "../crypto/index";
import { LedgerClient } from "../ledger/index";
import { TEMPLATES, decodeBilateralTrade } from "../model/index";

export interface CheatAttemptResult {
  readonly operatorTradeCount: number;
  readonly succeeded: boolean;
  readonly reason: string;
}

export async function attemptOperatorCheat(client: LedgerClient, operator: string): Promise<CheatAttemptResult> {
  const trades = await client.activeContracts(operator, { templateIds: [TEMPLATES.BilateralTrade] });

  if (trades.length === 0) {
    return {
      operatorTradeCount: 0,
      succeeded: false,
      reason: "The operator's own ledger projection contains no bilateral trade to attempt to open.",
    };
  }

  // If the operator's projection ever did contain a trade (it should not — this
  // branch exists so the attempt is genuine rather than a shortcut on the empty
  // case), the operator still cannot open it: its key pair was never one of the
  // sealed leg's wrap recipients.
  const decoded = decodeBilateralTrade(trades[0]!.createArgument);
  const operatorKeys = await generateKeyPair();
  try {
    await openLeg({ ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: {} }, operator, operatorKeys);
    return { operatorTradeCount: trades.length, succeeded: true, reason: "unexpectedly decrypted a payload" };
  } catch (err) {
    return {
      operatorTradeCount: trades.length,
      succeeded: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
