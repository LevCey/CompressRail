// Response parsing and error handling for the JSON Ledger API.
import type { CreatedEvent, ExerciseResult, LedgerEnd, PartyDetails } from "./types";
import type { LedgerResponse } from "./transport";

export class LedgerError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// Throw if the response is an error: a 4xx/5xx status, or the standard JSON Ledger
// API error object that carries both `code` and `cause`.
export function assertOk(res: LedgerResponse): void {
  const body = asRecord(res.body);
  const hasErrorShape = body !== undefined && typeof body["code"] === "string" && typeof body["cause"] === "string";
  if (res.status >= 400 || hasErrorShape) {
    const cause = body && typeof body["cause"] === "string" ? body["cause"] : `HTTP ${res.status}`;
    const code = body && typeof body["code"] === "string" ? body["code"] : undefined;
    throw new LedgerError(cause, code, res.status);
  }
}

export function parseExerciseResult(body: unknown): ExerciseResult {
  const r = asRecord(body);
  if (!r || typeof r["updateId"] !== "string") {
    throw new LedgerError("unexpected submit-and-wait response (missing updateId)");
  }
  return { updateId: r["updateId"], completionOffset: Number(r["completionOffset"] ?? 0) };
}

export function parseLedgerEnd(body: unknown): LedgerEnd {
  const r = asRecord(body);
  if (!r || r["offset"] === undefined) {
    throw new LedgerError("unexpected ledger-end response (missing offset)");
  }
  return { offset: Number(r["offset"]) };
}

function toPartyDetails(r: Record<string, unknown>): PartyDetails {
  return { party: asString(r["party"]), isLocal: r["isLocal"] === true };
}

export function parseAllocatedParty(body: unknown): PartyDetails {
  const details = asRecord(asRecord(body)?.["partyDetails"]);
  if (!details || typeof details["party"] !== "string") {
    throw new LedgerError("unexpected allocate-party response (missing partyDetails.party)");
  }
  return toPartyDetails(details);
}

export function parseParties(body: unknown): PartyDetails[] {
  const arr = asRecord(body)?.["partyDetails"];
  if (!Array.isArray(arr)) {
    throw new LedgerError("unexpected parties response (expected partyDetails array)");
  }
  const out: PartyDetails[] = [];
  for (const entry of arr) {
    const r = asRecord(entry);
    if (r) out.push(toPartyDetails(r));
  }
  return out;
}

function toCreatedEvent(r: Record<string, unknown>, synchronizerId: string): CreatedEvent {
  return {
    contractId: asString(r["contractId"]),
    templateId: asString(r["templateId"]),
    createArgument: asRecord(r["createArgument"]) ?? {},
    signatories: asStringArray(r["signatories"]),
    observers: asStringArray(r["observers"]),
    witnessParties: asStringArray(r["witnessParties"]),
    offset: Number(r["offset"] ?? 0),
    createdAt: asString(r["createdAt"]),
    createdEventBlob: asString(r["createdEventBlob"]),
    synchronizerId,
    ...(typeof r["packageName"] === "string" ? { packageName: r["packageName"] } : {}),
  };
}

// The active-contracts HTTP response is an array of entries; each active contract is
// under contractEntry.JsActiveContract.createdEvent, with synchronizerId as a sibling
// of createdEvent. Non-active entries are skipped.
export function parseActiveContracts(body: unknown): CreatedEvent[] {
  if (!Array.isArray(body)) {
    throw new LedgerError("unexpected active-contracts response (expected an array)");
  }
  const out: CreatedEvent[] = [];
  for (const entry of body) {
    const contractEntry = asRecord(asRecord(entry)?.["contractEntry"]);
    const active = asRecord(contractEntry?.["JsActiveContract"]);
    const created = asRecord(active?.["createdEvent"]);
    if (created) out.push(toCreatedEvent(created, asString(active?.["synchronizerId"])));
  }
  return out;
}
