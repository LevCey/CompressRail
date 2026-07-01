import { describe, it, expect } from "vitest";
import { LedgerClient, LedgerError, type LedgerResponse, type Transport } from "./index";

interface Call {
  method: "POST" | "GET";
  path: string;
  body?: unknown;
  token: string;
}

function mock(responses: Record<string, LedgerResponse>): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const reply = (path: string): LedgerResponse => responses[path] ?? { status: 200, body: {} };
  const transport: Transport = {
    async post(path, body, token) {
      calls.push({ method: "POST", path, body, token });
      return reply(path);
    },
    async get(path, token) {
      calls.push({ method: "GET", path, token });
      return reply(path);
    },
  };
  return { transport, calls };
}

const TRADE = "#compressrail:CompressRail.Trade:BilateralTrade";

describe("LedgerClient.create / exercise", () => {
  it("builds a CreateCommand submit-and-wait with the party, args, and bearer token", async () => {
    const { transport, calls } = mock({
      "/v2/commands/submit-and-wait": { status: 200, body: { updateId: "u1", completionOffset: 7 } },
    });
    const client = new LedgerClient({ transport, token: "jwt-A", userId: "app" });

    const res = await client.create("A::1220", TRADE, { cptyA: "A::1220", cptyB: "B::1220" }, { commandId: "c1" });

    expect(res).toEqual({ updateId: "u1", completionOffset: 7 });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/commands/submit-and-wait", token: "jwt-A" });
    expect(calls[0]!.body).toEqual({
      actAs: ["A::1220"],
      commands: [{ CreateCommand: { templateId: TRADE, createArguments: { cptyA: "A::1220", cptyB: "B::1220" } } }],
      userId: "app",
      commandId: "c1",
    });
  });

  it("builds an ExerciseCommand submit-and-wait", async () => {
    const { transport, calls } = mock({
      "/v2/commands/submit-and-wait": { status: 200, body: { updateId: "u2", completionOffset: 9 } },
    });
    const client = new LedgerClient({ transport, token: "jwt-Op" });

    await client.exercise("Op::1220", "#compressrail:CompressRail.Cycle:CompressionCycle", "00cyc", "Execute", {});

    expect(calls[0]!.body).toMatchObject({
      actAs: ["Op::1220"],
      commands: [
        {
          ExerciseCommand: {
            templateId: "#compressrail:CompressRail.Cycle:CompressionCycle",
            contractId: "00cyc",
            choice: "Execute",
            choiceArgument: {},
          },
        },
      ],
    });
    expect(typeof (calls[0]!.body as { commandId: unknown }).commandId).toBe("string");
  });
});

describe("LedgerClient.activeContracts", () => {
  const acsBody = [
    {
      workflowId: "",
      contractEntry: {
        JsActiveContract: {
          createdEvent: {
            contractId: "00ab",
            templateId: "pkg:CompressRail.Trade:BilateralTrade",
            createArgument: { terms: "base64ciphertext", commitment: "hexcommit" },
            signatories: ["A::1220", "B::1220"],
            observers: [],
            witnessParties: ["A::1220"],
            offset: 23,
            createdAt: "2026-01-01T00:00:00Z",
            packageName: "compressrail",
          },
          synchronizerId: "da::1220",
          reassignmentCounter: 0,
        },
      },
    },
  ];

  it("reads a single party's projection at ledger end and parses created events", async () => {
    const { transport, calls } = mock({
      "/v2/state/ledger-end": { status: 200, body: { offset: 23 } },
      "/v2/state/active-contracts": { status: 200, body: acsBody },
    });
    const client = new LedgerClient({ transport, token: "jwt-A" });

    const acs = await client.activeContracts("A::1220");

    expect(acs).toHaveLength(1);
    expect(acs[0]).toMatchObject({
      contractId: "00ab",
      templateId: "pkg:CompressRail.Trade:BilateralTrade",
      signatories: ["A::1220", "B::1220"],
      createArgument: { terms: "base64ciphertext", commitment: "hexcommit" },
    });
    const post = calls.find((c) => c.path === "/v2/state/active-contracts")!;
    expect(post.body).toEqual({
      filter: {
        filtersByParty: {
          "A::1220": { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: true } } } }] },
        },
      },
      verbose: false,
      activeAtOffset: 23,
    });
  });

  it("scopes strictly to the requested party and to template filters when given", async () => {
    const { transport, calls } = mock({ "/v2/state/active-contracts": { status: 200, body: [] } });
    const client = new LedgerClient({ transport, token: "jwt-Op" });

    await client.activeContracts("Op::1220", { activeAtOffset: 10, templateIds: [TRADE] });

    // an explicit offset means no ledger-end lookup
    expect(calls.some((c) => c.path === "/v2/state/ledger-end")).toBe(false);
    const post = calls.find((c) => c.path === "/v2/state/active-contracts")!;
    const filter = (post.body as { filter: { filtersByParty: Record<string, unknown> } }).filter;
    expect(Object.keys(filter.filtersByParty)).toEqual(["Op::1220"]);
    expect(post.body).toMatchObject({
      filter: {
        filtersByParty: {
          "Op::1220": { cumulative: [{ identifierFilter: { TemplateFilter: { value: { templateId: TRADE, includeCreatedEventBlob: true } } } }] },
        },
      },
      verbose: false,
      activeAtOffset: 10,
    });
  });

  it("skips non-active contract entries when parsing", async () => {
    const { transport } = mock({
      "/v2/state/active-contracts": {
        status: 200,
        body: [...acsBody, { workflowId: "", contractEntry: { JsIncompleteAssigned: {} } }],
      },
    });
    const client = new LedgerClient({ transport, token: "jwt-A" });
    expect(await client.activeContracts("A::1220", { activeAtOffset: 23 })).toHaveLength(1);
  });
});

describe("LedgerClient errors", () => {
  it("throws a LedgerError carrying the cause and code on an error response", async () => {
    const { transport } = mock({
      "/v2/commands/submit-and-wait": {
        status: 400,
        body: { code: "INVALID_ARGUMENT", cause: "the submitted request has invalid arguments" },
      },
    });
    const client = new LedgerClient({ transport, token: "jwt-A" });

    await expect(client.create("A::1220", TRADE, {})).rejects.toThrow(/invalid arguments/);
    try {
      await client.create("A::1220", TRADE, {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LedgerError);
      expect((e as LedgerError).code).toBe("INVALID_ARGUMENT");
      expect((e as LedgerError).status).toBe(400);
    }
  });
});

describe("LedgerClient party management", () => {
  it("allocates a party and returns its id", async () => {
    const { transport, calls } = mock({
      "/v2/parties": { status: 200, body: { partyDetails: { party: "Alice::1220", isLocal: true } } },
    });
    const client = new LedgerClient({ transport, token: "jwt" });
    expect(await client.allocateParty("Alice")).toBe("Alice::1220");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/parties" });
    expect(calls[0]!.body).toEqual({ partyIdHint: "Alice", identityProviderId: "" });
  });

  it("lists known parties", async () => {
    const { transport } = mock({
      "/v2/parties": {
        status: 200,
        body: { partyDetails: [{ party: "Alice::1220", isLocal: true }, { party: "Op::1220", isLocal: true }], nextPageToken: "" },
      },
    });
    const client = new LedgerClient({ transport, token: "jwt" });
    const parties = await client.listParties();
    expect(parties.map((p) => p.party)).toEqual(["Alice::1220", "Op::1220"]);
  });
});
