// Template identifiers and choice names for the CompressRail Daml package.
//
// The package-name form ("#<name>:<Module>:<Entity>") is used so contracts remain
// addressable across package-id changes under smart-contract upgrading.

const PACKAGE = "compressrail";

const tid = (module: string, entity: string): string => `#${PACKAGE}:${module}:${entity}`;

export const TEMPLATES = {
  BilateralTrade: tid("CompressRail.Trade", "BilateralTrade"),
  CycleNomination: tid("CompressRail.Trade", "CycleNomination"),
  ParticipantProfile: tid("CompressRail.Profile", "ParticipantProfile"),
  CompressionCycle: tid("CompressRail.Cycle", "CompressionCycle"),
  SelectiveAuditDisclosure: tid("CompressRail.Disclosure", "SelectiveAuditDisclosure"),
} as const;

export const CHOICES = {
  NominateIntoCycle: "NominateIntoCycle",
  Commit: "Commit",
  Execute: "Execute",
  DiscloseToAuditor: "DiscloseToAuditor",
  Revoke: "Revoke",
} as const;
