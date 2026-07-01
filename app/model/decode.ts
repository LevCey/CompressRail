// Decoders: a contract's createArgument JSON -> typed model values. Used to read
// contracts back from the ledger's active-contract set.
import type {
  BilateralTradeArgs,
  CompressionCycleArgs,
  LegCommit,
  Participation,
  ParticipantProfileArgs,
  SelectiveAuditDisclosureArgs,
} from "./types";

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error("expected a JSON object");
  }
  return v as Record<string, unknown>;
}

function str(v: unknown): string {
  if (typeof v !== "string") throw new Error("expected a string");
  return v;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) throw new Error("expected an array");
  return v.map(str);
}

function optStr(v: unknown): string | null {
  return v === null || v === undefined ? null : str(v);
}

function decodeLegCommit(v: unknown): LegCommit {
  const r = asRecord(v);
  return { counterparty: str(r["counterparty"]), commitment: str(r["commitment"]), enc: str(r["enc"]) };
}

function decodeParticipation(v: unknown): Participation {
  const r = asRecord(v);
  if (!Array.isArray(r["legs"])) throw new Error("participation.legs must be an array");
  return {
    participant: str(r["participant"]),
    legs: r["legs"].map(decodeLegCommit),
    withinTolerance: r["withinTolerance"] === true,
  };
}

function decodePair(v: unknown): [string, string] {
  const r = asRecord(v);
  return [str(r["_1"]), str(r["_2"])];
}

export function decodeBilateralTrade(arg: Record<string, unknown>): BilateralTradeArgs {
  return {
    cptyA: str(arg["cptyA"]),
    cptyB: str(arg["cptyB"]),
    tradeRef: str(arg["tradeRef"]),
    terms: str(arg["terms"]),
    commitment: str(arg["commitment"]),
    auditors: strArray(arg["auditors"]),
  };
}

export function decodeParticipantProfile(arg: Record<string, unknown>): ParticipantProfileArgs {
  return {
    participant: str(arg["participant"]),
    auditor: optStr(arg["auditor"]),
    sensitivityCommitment: str(arg["sensitivityCommitment"]),
    encSensitivities: str(arg["encSensitivities"]),
  };
}

export function decodeCompressionCycle(arg: Record<string, unknown>): CompressionCycleArgs {
  if (!Array.isArray(arg["topology"])) throw new Error("topology must be an array");
  if (!Array.isArray(arg["participations"])) throw new Error("participations must be an array");
  return {
    cycleId: str(arg["cycleId"]),
    operator: str(arg["operator"]),
    committed: strArray(arg["committed"]),
    toCommit: strArray(arg["toCommit"]),
    teardown: strArray(arg["teardown"]),
    topology: arg["topology"].map(decodePair),
    participations: arg["participations"].map(decodeParticipation),
    deadline: str(arg["deadline"]),
  };
}

export function decodeSelectiveAuditDisclosure(arg: Record<string, unknown>): SelectiveAuditDisclosureArgs {
  return {
    participant: str(arg["participant"]),
    auditor: str(arg["auditor"]),
    encDecryptionScope: str(arg["encDecryptionScope"]),
  };
}
