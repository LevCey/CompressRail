// Pure builders for JSON Ledger API v2 requests. No I/O — these just shape payloads.
import type {
  ActiveContractsRequest,
  Command,
  CreateCommand,
  DisclosedContract,
  ExerciseCommand,
  SubmitAndWaitRequest,
  TemplateId,
} from "./types";

export function createCommand(templateId: TemplateId, createArguments: Record<string, unknown>): CreateCommand {
  return { CreateCommand: { templateId, createArguments } };
}

export function exerciseCommand(
  templateId: TemplateId,
  contractId: string,
  choice: string,
  choiceArgument: Record<string, unknown>,
): ExerciseCommand {
  return { ExerciseCommand: { templateId, contractId, choice, choiceArgument } };
}

export interface SubmitOptions {
  readonly commandId?: string;
  readonly userId?: string;
  readonly readAs?: string[];
  readonly disclosedContracts?: DisclosedContract[];
}

export function buildSubmitAndWait(actAs: string[], commands: Command[], opts: SubmitOptions = {}): SubmitAndWaitRequest {
  return {
    actAs,
    commands,
    ...(opts.userId !== undefined ? { userId: opts.userId } : {}),
    ...(opts.commandId !== undefined ? { commandId: opts.commandId } : {}),
    ...(opts.readAs !== undefined && opts.readAs.length > 0 ? { readAs: opts.readAs } : {}),
    ...(opts.disclosedContracts !== undefined && opts.disclosedContracts.length > 0
      ? { disclosedContracts: opts.disclosedContracts }
      : {}),
  };
}

// A per-party active-contracts request. The party is the sole key in
// `filtersByParty`, so the read is scoped to exactly that party's projection — the
// visibility comes from Canton, not from filtering the result afterwards.
export function buildActiveContractsRequest(
  party: string,
  activeAtOffset: number,
  templateIds?: readonly TemplateId[],
): ActiveContractsRequest {
  const cumulative =
    templateIds && templateIds.length > 0
      ? templateIds.map((templateId) => ({
          identifierFilter: { TemplateFilter: { value: { templateId, includeCreatedEventBlob: true } } } as const,
        }))
      : [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: true } } } as const }];
  return {
    filter: { filtersByParty: { [party]: { cumulative } } },
    verbose: false,
    activeAtOffset,
  };
}
