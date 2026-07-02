// JSON Ledger API v2 request/response shapes.
//
// These mirror the Canton 3.x JSON Ledger API (the HTTP/JSON binding integrated into
// the participant node). Shapes are taken from the published JSON Ledger API
// reference, not assumed. Economic fields travel as opaque ciphertext + commitment;
// this client never holds a key that can decrypt a participant payload.

// "#<packageName>:<Module>:<Entity>" or "<packageId>:<Module>:<Entity>".
export type TemplateId = string;

export interface CreateCommand {
  readonly CreateCommand: {
    readonly templateId: TemplateId;
    readonly createArguments: Record<string, unknown>;
  };
}

export interface ExerciseCommand {
  readonly ExerciseCommand: {
    readonly templateId: TemplateId;
    readonly contractId: string;
    readonly choice: string;
    readonly choiceArgument: Record<string, unknown>;
  };
}

export type Command = CreateCommand | ExerciseCommand;

export interface DisclosedContract {
  readonly contractId: string;
  readonly templateId: TemplateId;
  readonly createdEventBlob: string;
  readonly synchronizerId: string;
}

export interface SubmitAndWaitRequest {
  readonly actAs: string[];
  readonly commands: Command[];
  readonly commandId?: string;
  readonly userId?: string;
  readonly readAs?: string[];
  readonly disclosedContracts?: DisclosedContract[];
}

export interface ExerciseResult {
  readonly updateId: string;
  readonly completionOffset: number;
}

export interface CreatedEvent {
  readonly contractId: string;
  readonly templateId: string;
  readonly createArgument: Record<string, unknown>;
  readonly signatories: string[];
  readonly observers: string[];
  readonly witnessParties: string[];
  readonly offset: number;
  readonly createdAt: string;
  readonly createdEventBlob: string;
  readonly synchronizerId: string;
  readonly packageName?: string;
}

export interface LedgerEnd {
  readonly offset: number;
}

export interface PartyDetails {
  readonly party: string;
  readonly isLocal: boolean;
}

export interface IdentifierFilter {
  readonly identifierFilter:
    | { readonly TemplateFilter: { readonly value: { readonly templateId: TemplateId; readonly includeCreatedEventBlob: boolean } } }
    | { readonly WildcardFilter: { readonly value: { readonly includeCreatedEventBlob: boolean } } };
}

export interface CumulativeFilter {
  readonly cumulative: IdentifierFilter[];
}

export interface ActiveContractsFilter {
  readonly filtersByParty: Record<string, CumulativeFilter>;
  readonly filtersForAnyParty?: CumulativeFilter;
}

export interface ActiveContractsRequest {
  readonly filter: ActiveContractsFilter;
  readonly verbose: boolean;
  readonly activeAtOffset: number;
}
