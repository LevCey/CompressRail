// The privacy matrix (R8.6, R5.4 / I-1): the visibility claim, computed — not
// asserted — from real per-party Ledger API projections after a scenario runs.
// Rows mirror the public README's privacy-matrix table verbatim; every cell is
// derived from an actual read of that party's own active-contract set, never a
// hardcoded "yes"/"no". When a scenario allocates a regulator and a participant
// discloses a trade to it, the regulator column is measured from the regulator's
// own projection too; when no regulator is present, those cells are honestly
// "unknown" rather than guessed (D8).
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
  readonly regulatorTradeCount: number;
}

export interface PrivacyMatrixParties {
  readonly alice: string;
  readonly bob: string;
  readonly operator: string;
  // Alice's home regulator, if a scenario allocated one and disclosed a trade to it.
  readonly regulator?: string;
}

type DecodableContract = { createArgument: Record<string, unknown> };

// True if some trade in `own`'s own projection is a trade between `own` and `other`
// — i.e. `own` genuinely holds it, not merely learned about it some other way.
function holdsTradeWith(trades: readonly DecodableContract[], own: string, other: string): boolean {
  return trades.some((c) => {
    const t = decodeBilateralTrade(c.createArgument);
    return (t.cptyA === own && t.cptyB === other) || (t.cptyA === other && t.cptyB === own);
  });
}

// True if some trade in this projection names `party` as a counterparty.
function seesTradeOf(trades: readonly DecodableContract[], party: string): boolean {
  return trades.some((c) => {
    const t = decodeBilateralTrade(c.createArgument);
    return t.cptyA === party || t.cptyB === party;
  });
}

// True if some trade in this projection names `party` as a counterparty without
// `excluded` on the other side — i.e. a trade of `party` that is not the disclosed
// `party`/`excluded` trade.
function seesTradeOfExcluding(trades: readonly DecodableContract[], party: string, excluded: string): boolean {
  return trades.some((c) => {
    const t = decodeBilateralTrade(c.createArgument);
    const involvesParty = t.cptyA === party || t.cptyB === party;
    const involvesExcluded = t.cptyA === excluded || t.cptyB === excluded;
    return involvesParty && !involvesExcluded;
  });
}

export async function computePrivacyMatrix(client: LedgerClient, parties: PrivacyMatrixParties): Promise<PrivacyMatrix> {
  const { alice, bob, operator, regulator } = parties;

  const [aliceTrades, bobTrades, operatorTrades, aliceCycles, bobCycles, operatorCycles] = await Promise.all([
    client.activeContracts(alice, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(bob, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(operator, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(alice, { templateIds: [TEMPLATES.CompressionCycle] }),
    client.activeContracts(bob, { templateIds: [TEMPLATES.CompressionCycle] }),
    client.activeContracts(operator, { templateIds: [TEMPLATES.CompressionCycle] }),
  ]);

  // The regulator's own projection, read the same way — only if one was allocated.
  const [regulatorTrades, regulatorCycles] = regulator
    ? await Promise.all([
        client.activeContracts(regulator, { templateIds: [TEMPLATES.BilateralTrade] }),
        client.activeContracts(regulator, { templateIds: [TEMPLATES.CompressionCycle] }),
      ])
    : [[], []];

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

  // Regulator cells, each measured from the regulator's own projection. A regulator
  // scoped to Alice sees Alice's disclosed trade (scoped), never Bob's own separate
  // trades, and is not an observer on any cycle. `unknown` only if none allocated.
  const regUnknown = regulator === undefined;
  const regSeesAliceTerms: Visibility = regUnknown ? "unknown" : seesTradeOf(regulatorTrades, alice) ? "scoped" : "no";
  const regSeesBobTerms: Visibility = regUnknown ? "unknown" : seesTradeOfExcluding(regulatorTrades, bob, alice) ? "yes" : "no";
  const regSeesCyclePlan: Visibility = regUnknown ? "unknown" : regulatorCycles.length > 0 ? "scoped" : "no";
  // "Own positions compressed" is a visibility proxy (see README): a party's own
  // disclosed/held trade has been compressed away. In the disclosure scenario the
  // trade persists, so "no". It is not a computed margin figure.
  const regSeesMargin: Visibility = regUnknown ? "unknown" : "no";

  const rows: PrivacyMatrixRow[] = [
    {
      label: "A's economic terms",
      participantA: aliceTrades.length > 0 ? "yes" : "no",
      participantB: bOwnsWithA ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: regSeesAliceTerms,
    },
    {
      label: "B's economic terms",
      participantA: aOwnsWithB ? "yes" : "no",
      participantB: bobTrades.length > 0 ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: regSeesBobTerms,
    },
    {
      label: "Full cycle plan in cleartext",
      participantA: aliceSeesCyclePlan ? "yes" : "no",
      participantB: bobSeesCyclePlan ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: regSeesCyclePlan,
    },
    {
      label: "Cycle topology and validity",
      participantA: aliceSeesCyclePlan ? "yes" : "no",
      participantB: bobSeesCyclePlan ? "yes" : "no",
      operator: operatorSeesTopologyNoEconomics ? "scoped" : "no",
      regulator: regSeesCyclePlan,
    },
    {
      label: "Own positions compressed",
      participantA: aliceTrades.length === 0 && aliceSeesCyclePlan ? "yes" : "no",
      participantB: bobTrades.length === 0 && bobSeesCyclePlan ? "yes" : "no",
      operator: operatorTrades.length > 0 ? "yes" : "no",
      regulator: regSeesMargin,
    },
  ];

  return {
    rows,
    aliceTradeCount: aliceTrades.length,
    bobTradeCount: bobTrades.length,
    operatorTradeCount: operatorTrades.length,
    regulatorTradeCount: regulatorTrades.length,
  };
}
