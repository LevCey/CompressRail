import { describe, it, expect } from "vitest";
import { LedgerClient, LedgerError, retryingTransport, type LedgerResponse, type Transport } from "./index";

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

describe("LedgerClient.updates (X-ray activity feed)", () => {
  // Shapes below are taken verbatim from a live Canton 3.5.1 sandbox response.
  const txCreate = {
    update: {
      Transaction: {
        value: {
          updateId: "u-create",
          commandId: "c1",
          offset: 15,
          effectiveAt: "2026-07-04T14:04:34.737403Z",
          events: [
            {
              CreatedEvent: {
                offset: 15,
                contractId: "00trade",
                templateId: "pkg:CompressRail.Trade:BilateralTrade",
                createArgument: { cptyA: "A::1220", cptyB: "B::1220", tradeRef: "AB" },
                signatories: ["A::1220", "B::1220"],
                observers: [],
                witnessParties: ["A::1220"],
                createdAt: "2026-07-04T14:04:34.737403Z",
                createdEventBlob: "",
                packageName: "compressrail",
              },
            },
          ],
        },
      },
    },
  };
  const txArchiveThenCreate = {
    update: {
      Transaction: {
        value: {
          updateId: "u-exec",
          commandId: "",
          offset: 33,
          effectiveAt: "2026-07-04T14:05:20.647677Z",
          events: [
            {
              ArchivedEvent: {
                offset: 33,
                contractId: "00cyc-old",
                templateId: "pkg:CompressRail.Cycle:CompressionCycle",
                witnessParties: ["Op::1220"],
                packageName: "compressrail",
              },
            },
            {
              CreatedEvent: {
                offset: 33,
                contractId: "00cyc-new",
                templateId: "pkg:CompressRail.Cycle:CompressionCycle",
                createArgument: { cycleId: "cyc1" },
                signatories: ["Op::1220"],
                observers: [],
                witnessParties: ["Op::1220"],
                createdAt: "2026-07-04T14:05:20.647677Z",
                createdEventBlob: "",
                packageName: "compressrail",
              },
            },
          ],
        },
      },
    },
  };
  const offsetCheckpoint = { update: { OffsetCheckpoint: { value: { offset: 40, synchronizerTimes: [] } } } };

  it("parses CreatedEvent and ArchivedEvent from the transaction event feed, in order", async () => {
    const { transport } = mock({
      "/v2/updates": { status: 200, body: [txCreate, txArchiveThenCreate] },
    });
    const client = new LedgerClient({ transport, token: "jwt" });
    const updates = await client.updates("A::1220", { endInclusive: 40 });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ updateId: "u-create", commandId: "c1", offset: 15 });
    expect(updates[0]!.events).toEqual([{ kind: "created", event: expect.objectContaining({ contractId: "00trade" }) }]);

    expect(updates[1]!.events.map((e) => e.kind)).toEqual(["archived", "created"]);
    expect(updates[1]!.events[0]).toMatchObject({ kind: "archived", event: { contractId: "00cyc-old" } });
    expect(updates[1]!.events[1]).toMatchObject({ kind: "created", event: { contractId: "00cyc-new" } });
  });

  it("skips non-transaction update kinds such as OffsetCheckpoint", async () => {
    const { transport } = mock({ "/v2/updates": { status: 200, body: [txCreate, offsetCheckpoint] } });
    const client = new LedgerClient({ transport, token: "jwt" });
    const updates = await client.updates("A::1220", { endInclusive: 40 });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.updateId).toBe("u-create");
  });

  it("scopes the request to the requested party and offset range", async () => {
    const { transport, calls } = mock({ "/v2/updates": { status: 200, body: [] } });
    const client = new LedgerClient({ transport, token: "jwt" });
    await client.updates("Op::1220", { beginExclusive: 10, endInclusive: 20 });
    const call = calls.find((c) => c.path === "/v2/updates")!;
    expect(call.body).toMatchObject({ beginExclusive: 10, endInclusive: 20 });
    const filter = (call.body as { filter: { filtersByParty: Record<string, unknown> } }).filter;
    expect(Object.keys(filter.filtersByParty)).toEqual(["Op::1220"]);
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

describe("LedgerClient.version", () => {
  it("returns the participant's reported version via GET /v2/version", async () => {
    const { transport, calls } = mock({
      "/v2/version": { status: 200, body: { version: "3.5.4", features: {} } },
    });
    const client = new LedgerClient({ transport, token: "jwt-A" });

    const v = await client.version();

    expect(v).toBe("3.5.4");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/version", token: "jwt-A" });
  });
});

describe("retryingTransport", () => {
  function failThenOk(failStatus: number, failTimes: number): { transport: Transport; count: () => number } {
    let calls = 0;
    const reply = (): LedgerResponse => {
      calls += 1;
      return calls <= failTimes ? { status: failStatus, body: "backpressure" } : { status: 200, body: { ok: true } };
    };
    return {
      transport: {
        async post() {
          return reply();
        },
        async get() {
          return reply();
        },
      },
      count: () => calls,
    };
  }

  it("retries a transient 503 then succeeds, using an injected no-op sleep", async () => {
    const { transport, count } = failThenOk(503, 1);
    const sleeps: number[] = [];
    const t = retryingTransport(transport, { sleep: async (ms) => void sleeps.push(ms) });

    const res = await t.post("/v2/parties", { partyIdHint: "x" }, "");

    expect(count()).toBe(2);
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([1000]);
  });

  it("gives up after the max attempts and returns the last response", async () => {
    const { transport, count } = failThenOk(503, 99);
    const t = retryingTransport(transport, { sleep: async () => undefined });

    const res = await t.get("/v2/state/ledger-end", "");

    expect(count()).toBe(3);
    expect(res.status).toBe(503);
  });

  it("does not retry a non-transient status", async () => {
    const { transport, count } = failThenOk(404, 1);
    const t = retryingTransport(transport, { sleep: async () => undefined });

    const res = await t.post("/v2/parties", {}, "");

    expect(count()).toBe(1);
    expect(res.status).toBe(404);
  });
});
