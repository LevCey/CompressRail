// Propose-then-accept on a live ledger.
//
// `BilateralTrade` is signed by both counterparties, and the direct path creates it
// in one submission acting as both. That is only authorised while the two parties are
// hosted on the same participant: a ledger user cannot act as a party hosted on
// another node. This scenario never acts for more than one party per submission,
// which is the shape a cross-node flow is restricted to, and checks that the trade it
// produces is the ordinary one — readable by both counterparties, encrypted on-ledger,
// and invisible to the operator.
import { generateKeyPair, sealLeg, openLeg, type JsonValue, type KeyPair } from "../crypto/index";
import { LedgerClient, createCommand, exerciseCommand } from "../ledger/index";
import { TEMPLATES, CHOICES, createTradeProposal, decodeBilateralTrade } from "../model/index";

export interface ProposalResult {
  // The proposal binds nobody on its own: before acceptance there is no trade.
  readonly tradesBeforeAccept: number;
  // After acceptance both counterparties hold it from their own projection.
  readonly proposerTradeCount: number;
  readonly counterpartyTradeCount: number;
  // The operator is a stakeholder of nothing, exactly as on the direct path.
  readonly operatorTradeCount: number;
  // On-ledger terms are ciphertext, and the counterparty can open them.
  readonly onLedgerTermsAreCiphertext: boolean;
  readonly counterpartyDecryptedTerms: JsonValue;
  // Every submission in this flow acted for exactly one party.
  readonly maxActAsPerSubmission: number;
  readonly parties: {
    readonly operator: string;
    readonly proposer: string;
    readonly counterparty: string;
  };
}

const TRADE_TEMPLATE = [TEMPLATES.BilateralTrade];

export async function runProposalScenario(client: LedgerClient): Promise<ProposalResult> {
  const run = Math.random().toString(36).slice(2, 8);
  const operator = await client.allocateParty(`Operator-${run}`);
  const proposer = await client.allocateParty(`Proposer-${run}`);
  const counterparty = await client.allocateParty(`Counterparty-${run}`);

  const proposerKeys: KeyPair = await generateKeyPair();
  const counterpartyKeys: KeyPair = await generateKeyPair();

  // Terms are sealed before the proposal is written, so the proposal discloses no
  // more than the trade it will create. The content key is wrapped to the two
  // counterparties only — never to the operator.
  const terms: JsonValue = { instrument: "IRS", notional: 75_000_000, fixedRate: 0.031, currency: "USD" };
  const sealed = await sealLeg(terms, [
    { party: proposer, publicKey: proposerKeys.publicKey },
    { party: counterparty, publicKey: counterpartyKeys.publicKey },
  ]);

  // Submission 1: the proposer alone.
  const tradeRef = `PA-${run}`;
  await client.submitAndWait([proposer], [
    createCommand(
      TEMPLATES.TradeProposal,
      createTradeProposal({
        proposer,
        counterparty,
        tradeRef,
        terms: sealed.ciphertext,
        commitment: sealed.commitment,
        auditors: [],
      }),
    ),
  ]);

  const proposals = await client.activeContracts(proposer, { templateIds: [TEMPLATES.TradeProposal] });
  const proposal = proposals.find((c) => c.createArgument["tradeRef"] === tradeRef);
  if (!proposal) throw new Error("no TradeProposal contract was created");

  // Nothing is bound yet: the counterparty holds no trade.
  const beforeAccept = await client.activeContracts(counterparty, { templateIds: TRADE_TEMPLATE });

  // Submission 2: the counterparty alone. The signatory set accumulates here.
  await client.submitAndWait([counterparty], [
    exerciseCommand(TEMPLATES.TradeProposal, proposal.contractId, CHOICES.Accept, {}),
  ]);

  const [proposerAcs, counterpartyAcs, operatorAcs] = await Promise.all([
    client.activeContracts(proposer, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(counterparty, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(operator, { templateIds: TRADE_TEMPLATE }),
  ]);

  const accepted = counterpartyAcs.find(
    (c) => decodeBilateralTrade(c.createArgument).tradeRef === tradeRef,
  );
  if (!accepted) throw new Error("the accepted trade is not in the counterparty's projection");
  const decoded = decodeBilateralTrade(accepted.createArgument);

  const onLedgerTermsAreCiphertext =
    decoded.terms === sealed.ciphertext && decoded.terms !== JSON.stringify(terms);

  const counterpartyDecryptedTerms = await openLeg(
    { ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: sealed.wrappedKeys },
    counterparty,
    counterpartyKeys,
  );

  return {
    tradesBeforeAccept: beforeAccept.length,
    proposerTradeCount: proposerAcs.length,
    counterpartyTradeCount: counterpartyAcs.length,
    operatorTradeCount: operatorAcs.length,
    onLedgerTermsAreCiphertext,
    counterpartyDecryptedTerms,
    maxActAsPerSubmission: 1,
    parties: { operator, proposer, counterparty },
  };
}
