// Encoders: typed model values -> Daml-LF JSON, as the JSON Ledger API expects.
//
// Records become JSON objects keyed by field name; Party/Text/ContractId are
// strings; lists are arrays; a Daml 2-tuple (Party, Party) encodes as {_1, _2}; an
// Optional is the value or null; Time is an ISO 8601 string.
import type {
  BilateralTradeArgs,
  CompressionCycleArgs,
  LegCommit,
  Participation,
  ParticipantProfileArgs,
  SelectiveAuditDisclosureArgs,
} from "./types";

function encodeLegCommit(leg: LegCommit): Record<string, unknown> {
  return { counterparty: leg.counterparty, commitment: leg.commitment, enc: leg.enc };
}

function encodeParticipation(p: Participation): Record<string, unknown> {
  return { participant: p.participant, legs: p.legs.map(encodeLegCommit), withinTolerance: p.withinTolerance };
}

function encodePair([a, b]: readonly [string, string]): Record<string, unknown> {
  return { _1: a, _2: b };
}

export function createBilateralTrade(a: BilateralTradeArgs): Record<string, unknown> {
  return {
    cptyA: a.cptyA,
    cptyB: a.cptyB,
    tradeRef: a.tradeRef,
    terms: a.terms,
    commitment: a.commitment,
    auditors: a.auditors,
  };
}

export function createParticipantProfile(a: ParticipantProfileArgs): Record<string, unknown> {
  return {
    participant: a.participant,
    auditor: a.auditor,
    sensitivityCommitment: a.sensitivityCommitment,
    encSensitivities: a.encSensitivities,
  };
}

export function createCompressionCycle(a: CompressionCycleArgs): Record<string, unknown> {
  return {
    cycleId: a.cycleId,
    operator: a.operator,
    committed: a.committed,
    toCommit: a.toCommit,
    teardown: a.teardown,
    topology: a.topology.map(encodePair),
    participations: a.participations.map(encodeParticipation),
    deadline: a.deadline,
  };
}

export function createSelectiveAuditDisclosure(a: SelectiveAuditDisclosureArgs): Record<string, unknown> {
  return { participant: a.participant, auditor: a.auditor, encDecryptionScope: a.encDecryptionScope };
}

// Choice arguments.
export function commitArg(participant: string, legs: LegCommit[], withinTolerance: boolean): Record<string, unknown> {
  return { participant, legs: legs.map(encodeLegCommit), withinTolerance };
}

export function executeArg(): Record<string, unknown> {
  return {};
}

export function nominateIntoCycleArg(cycleId: string, operator: string, nominator: string): Record<string, unknown> {
  return { cycleId, operator, nominator };
}

export function discloseToAuditorArg(newAuditor: string): Record<string, unknown> {
  return { newAuditor };
}

export function revokeArg(): Record<string, unknown> {
  return {};
}
