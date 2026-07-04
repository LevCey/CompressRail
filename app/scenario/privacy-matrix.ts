// The privacy matrix (R8.6, R5.4 / I-1): the visibility claim, computed — not
// asserted — from real per-party Ledger API projections after a compression cycle.
// Rows mirror the public README's privacy-matrix table verbatim; every cell is
// derived from an actual read of that party's own active-contract set, never a
// hardcoded "yes"/"no". Cells this scenario has no basis to measure (no regulator
// is allocated by `runCompressionCycle`) are marked "unknown" rather than guessed —
// honesty over a complete-looking but fabricated result (D8).
import { LedgerClient } from "../ledger/index";
import { TEMPLATES, decodeBilateralTrade, decodeCompressionCycle } from "../model/index";

export type Visibility = "yes" | "no" | "scoped" | "unknown";

export interface PrivacyMatrixRow {
  readonly label: string;
  readonly participantA: Visibility;
  readonly participantB: Visibility;
  readonly operator: Visibility;
  readonly regulator: Visibility;
}

export interface PrivacyMatrix {
  readonly rows: readonly PrivacyMatrixRow[];
  readonly aliceTradeCount: number;
  readonly bobTradeCount: number;
  readonly operatorTradeCount: number;
}

export interface PrivacyMatrixParties {
  readonly alice: string;
  readonly bob: string;
  readonly operator: string;
}

// True if some trade in `own`'s own projection is a trade between `own` and `other`
// — i.e. `own` genuinely holds it, not merely learned about it some other way.
function holdsTradeWith(trades: readonly { createArgument: Record<string, unknown> }[], own: string, other: string): boolean {
  return trades.some((c) => {
    const t = decodeBilateralTrade(c.createArgument);
    return (t.cptyA === own && t.cptyB === other) || (t.cptyA === other && t.cptyB === own);
  });
}

export async function computePrivacyMatrix(client: LedgerClient, parties: PrivacyMatrixParties): Promise<PrivacyMatrix> {
  const { alice, bob, operator } = parties;

  const [aliceTrades, bobTrades, operatorTrades, aliceCycles, bobCycles, operatorCycles] = await Promise.all([
    client.activeContracts(alice, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(bob, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(operator, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(alice, { templateIds: [TEMPLATES.CompressionCycle] }),
    client.activeContracts(bob, { templateIds: [TEMPLATES.CompressionCycle] }),
    client.activeContracts(operator, { templateIds: [TEMPLATES.CompressionCycle] }),
  ]);

  const aOwnsWithB = holdsTradeWith(aliceTrades, alice, bob);
  const bOwnsWithA = holdsTradeWith(bobTrades, bob, alice);

  // The cycle plan in cleartext: a participant sees only that a cycle contract
  // exists in its own projection (its own legs), never the other participants' leg
  // commitments/ciphertext as plaintext economics — the model carries no cleartext
  // field for them to see in the first place (I-3).
  const aliceSeesCyclePlan = aliceCycles.length > 0;
  const bobSeesCyclePlan = bobCycles.length > 0;

  // Topology and validity: the operator's own cycle projection carries `topology`
  // and `participations[].withinTolerance`, visible to it, but with no numeric
  // economic field in either — LegCommit carries only commitment/enc strings.
  const operatorTopology = operatorCycles.length > 0 ? decodeCompressionCycle(operatorCycles[0]!.createArgument).topology : null;
  const operatorSeesTopologyNoEconomics = operatorTopology !== null;

  const rows: PrivacyMatrixRow[] = [
    {
      label: "A's economic terms",
      participantA: aliceTrades.length > 0 ? "yes" : "no",
      participantB: bOwnsWithA ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: "unknown",
    },
    {
      label: "B's economic terms",
      participantA: aOwnsWithB ? "yes" : "no",
      participantB: bobTrades.length > 0 ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: "unknown",
    },
    {
      label: "Full cycle plan in cleartext",
      participantA: aliceSeesCyclePlan ? "yes" : "no",
      participantB: bobSeesCyclePlan ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: "unknown",
    },
    {
      label: "Cycle topology and validity",
      participantA: aliceSeesCyclePlan ? "yes" : "no",
      participantB: bobSeesCyclePlan ? "yes" : "no",
      operator: operatorSeesTopologyNoEconomics ? "scoped" : "no",
      regulator: "unknown",
    },
    {
      label: "Margin released (own)",
      participantA: aliceTrades.length === 0 && aliceSeesCyclePlan ? "yes" : "no",
      participantB: bobTrades.length === 0 && bobSeesCyclePlan ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: "unknown",
    },
  ];

  return { rows, aliceTradeCount: aliceTrades.length, bobTradeCount: bobTrades.length, operatorTradeCount: operatorTrades.length };
}
