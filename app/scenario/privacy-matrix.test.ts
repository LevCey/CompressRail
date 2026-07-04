import { describe, it, expect } from "vitest";
import { computePrivacyMatrix, type PrivacyMatrixParties } from "./privacy-matrix";
import { LedgerClient, type LedgerResponse, type Transport } from "../ledger/index";
import { createBilateralTrade, createCompressionCycle } from "../model/index";

function acsResponse(entries: Array<{ templateId: string; createArgument: Record<string, unknown> }>): LedgerResponse {
  return {
    status: 200,
    body: entries.map((e) => ({
      workflowId: "",
      contractEntry: {
        JsActiveContract: {
          createdEvent: {
            contractId: "00x",
            templateId: e.templateId,
            createArgument: e.createArgument,
            signatories: [],
            observers: [],
            witnessParties: [],
            offset: 1,
            createdAt: "2026-01-01T00:00:00Z",
            createdEventBlob: "",
          },
          synchronizerId: "sync-1",
        },
      },
    })),
  };
}

function mockClient(byParty: Record<string, { trades?: Array<Record<string, unknown>>; cycles?: Array<Record<string, unknown>> }>) {
  const transport: Transport = {
    async get() {
      return { status: 200, body: { offset: 1 } };
    },
    async post(path, body) {
      if (path === "/v2/state/active-contracts") {
        const req = body as { filter: { filtersByParty: Record<string, unknown> } };
        const party = Object.keys(req.filter.filtersByParty)[0]!;
        const requested = JSON.stringify(body);
        const wantsCycle = requested.includes("CompressionCycle");
        const entries = byParty[party] ?? {};
        const trades = (entries.trades ?? []).map((createArgument) => ({
          templateId: "pkg:CompressRail.Trade:BilateralTrade",
          createArgument,
        }));
        const cycles = (entries.cycles ?? []).map((createArgument) => ({
          templateId: "pkg:CompressRail.Cycle:CompressionCycle",
          createArgument,
        }));
        return acsResponse(wantsCycle ? cycles : trades);
      }
      return { status: 200, body: {} };
    },
  };
  return new LedgerClient({ transport, token: "" });
}

const parties: PrivacyMatrixParties = { operator: "Op", alice: "A", bob: "B" };

describe("computePrivacyMatrix", () => {
  it("marks A's terms visible to A and hidden from B when only A holds the trade", async () => {
    const trade = createBilateralTrade({ cptyA: "A", cptyB: "X", tradeRef: "t1", terms: "c", commitment: "h", auditors: [] });
    const client = mockClient({ A: { trades: [trade] }, B: {}, Op: {} });

    const matrix = await computePrivacyMatrix(client, parties);
    const row = matrix.rows.find((r) => r.label === "A's economic terms")!;
    expect(row.participantA).toBe("yes");
    expect(row.participantB).toBe("no");
    expect(row.operator).toBe("no");
  });

  it("marks B's terms visible to B when B genuinely holds a trade with A", async () => {
    const trade = createBilateralTrade({ cptyA: "A", cptyB: "B", tradeRef: "t1", terms: "c", commitment: "h", auditors: [] });
    const client = mockClient({ A: { trades: [trade] }, B: { trades: [trade] }, Op: {} });

    const matrix = await computePrivacyMatrix(client, parties);
    const bTerms = matrix.rows.find((r) => r.label === "B's economic terms")!;
    expect(bTerms.participantA).toBe("yes"); // A genuinely holds a trade with B
    expect(bTerms.participantB).toBe("yes");
  });

  it("does not mark A as seeing B's terms just because A holds a different trade", async () => {
    const aliceOwn = createBilateralTrade({ cptyA: "A", cptyB: "X", tradeRef: "t1", terms: "c", commitment: "h", auditors: [] });
    const client = mockClient({ A: { trades: [aliceOwn] }, B: {}, Op: {} });

    const matrix = await computePrivacyMatrix(client, parties);
    const bTerms = matrix.rows.find((r) => r.label === "B's economic terms")!;
    expect(bTerms.participantA).toBe("no");
  });

  it("gives the operator topology-scoped visibility (not full yes) when it holds only the cycle contract", async () => {
    const cyc = createCompressionCycle({
      cycleId: "c1",
      operator: "Op",
      committed: ["Op"],
      toCommit: [],
      teardown: [],
      topology: [["A", "B"]],
      participations: [],
      deadline: "2031-01-01T00:00:00Z",
    });
    const client = mockClient({ A: {}, B: {}, Op: { cycles: [cyc] } });

    const matrix = await computePrivacyMatrix(client, parties);
    const topologyRow = matrix.rows.find((r) => r.label === "Cycle topology and validity")!;
    expect(topologyRow.operator).toBe("scoped");
    // The operator has no BilateralTrade, so the plan-in-cleartext row stays "no".
    const planRow = matrix.rows.find((r) => r.label === "Full cycle plan in cleartext")!;
    expect(planRow.operator).toBe("no");
  });

  it("marks the regulator rows as unknown rather than guessing, since none is allocated here", async () => {
    const client = mockClient({ A: {}, B: {}, Op: {} });
    const matrix = await computePrivacyMatrix(client, parties);
    expect(matrix.rows.every((r) => r.regulator === "unknown")).toBe(true);
  });
});
