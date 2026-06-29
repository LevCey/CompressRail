// A thin, per-party JSON Ledger API v2 client.
//
// It composes the request builders, the injectable transport, and the response
// parsers. The base URL and the access token are configuration (R2.3 / X.5); the
// token is a per-party JWT and the client holds no key that can decrypt a payload
// (R2.4). Reads are scoped to a single party's projection, so visibility differences
// come from Canton, never from filtering in the client.
import {
  buildActiveContractsRequest,
  buildSubmitAndWait,
  createCommand,
  exerciseCommand,
  type SubmitOptions,
} from "./requests";
import { assertOk, parseActiveContracts, parseExerciseResult, parseLedgerEnd } from "./parse";
import type { Command, CreatedEvent, ExerciseResult, TemplateId } from "./types";
import type { Transport } from "./transport";

export interface LedgerClientConfig {
  readonly transport: Transport;
  readonly token: string; // per-party JWT, from configuration
  readonly userId?: string;
}

export interface ReadOptions {
  readonly templateIds?: readonly TemplateId[];
  readonly activeAtOffset?: number;
}

export class LedgerClient {
  private readonly transport: Transport;
  private readonly token: string;
  private readonly userId: string | undefined;

  constructor(config: LedgerClientConfig) {
    this.transport = config.transport;
    this.token = config.token;
    this.userId = config.userId;
  }

  async submitAndWait(actAs: string[], commands: Command[], opts: SubmitOptions = {}): Promise<ExerciseResult> {
    const request = buildSubmitAndWait(actAs, commands, {
      ...opts,
      ...(opts.userId === undefined && this.userId !== undefined ? { userId: this.userId } : {}),
    });
    const res = await this.transport.post("/v2/commands/submit-and-wait", request, this.token);
    assertOk(res);
    return parseExerciseResult(res.body);
  }

  async create(
    actAs: string,
    templateId: TemplateId,
    createArguments: Record<string, unknown>,
    opts: SubmitOptions = {},
  ): Promise<ExerciseResult> {
    return this.submitAndWait([actAs], [createCommand(templateId, createArguments)], opts);
  }

  async exercise(
    actAs: string,
    templateId: TemplateId,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    opts: SubmitOptions = {},
  ): Promise<ExerciseResult> {
    return this.submitAndWait([actAs], [exerciseCommand(templateId, contractId, choice, choiceArgument)], opts);
  }

  async ledgerEnd(): Promise<number> {
    const res = await this.transport.get("/v2/state/ledger-end", this.token);
    assertOk(res);
    return parseLedgerEnd(res.body).offset;
  }

  // Active contracts in a single party's projection. Defaults to the current ledger
  // end if no offset is given.
  async activeContracts(party: string, opts: ReadOptions = {}): Promise<CreatedEvent[]> {
    const activeAtOffset = opts.activeAtOffset ?? (await this.ledgerEnd());
    const request = buildActiveContractsRequest(party, activeAtOffset, opts.templateIds);
    const res = await this.transport.post("/v2/state/active-contracts", request, this.token);
    assertOk(res);
    return parseActiveContracts(res.body);
  }
}
