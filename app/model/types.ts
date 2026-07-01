// Typed shapes for the on-ledger model, mirroring the Daml records field-for-field.
// These are the cleartext-free structures the ledger client moves: economic terms
// appear only as opaque ciphertext (`terms`, `enc`) + hash `commitment`.

export interface LegCommit {
  readonly counterparty: string;
  readonly commitment: string;
  readonly enc: string;
}

export interface Participation {
  readonly participant: string;
  readonly legs: LegCommit[];
  readonly withinTolerance: boolean;
}

export interface BilateralTradeArgs {
  readonly cptyA: string;
  readonly cptyB: string;
  readonly tradeRef: string;
  readonly terms: string; // ciphertext
  readonly commitment: string;
  readonly auditors: string[];
}

export interface ParticipantProfileArgs {
  readonly participant: string;
  readonly auditor: string | null; // Optional Party
  readonly sensitivityCommitment: string;
  readonly encSensitivities: string; // ciphertext
}

export interface CompressionCycleArgs {
  readonly cycleId: string;
  readonly operator: string;
  readonly committed: string[];
  readonly toCommit: string[];
  readonly teardown: string[]; // ContractId BilateralTrade
  readonly topology: Array<readonly [string, string]>; // (Party, Party) pairs
  readonly participations: Participation[];
  readonly deadline: string; // ISO 8601 UTC
}

export interface SelectiveAuditDisclosureArgs {
  readonly participant: string;
  readonly auditor: string;
  readonly encDecryptionScope: string; // ciphertext
}
