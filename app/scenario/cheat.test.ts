import { describe, it, expect } from "vitest";
import { attemptOperatorCheat } from "./cheat";
import { LedgerClient, type LedgerResponse, type Transport } from "../ledger/index";
import { sealLeg, generateKeyPair } from "../crypto/index";
import { createBilateralTrade } from "../model/index";

function acsResponse(entries: Array<{ createArgument: Record<string, unknown> }>): LedgerResponse {
  return {
    status: 200,
    body: entries.map((e) => ({
      workflowId: "",
      contractEntry: {
        JsActiveContract: {
          createdEvent: {
            contractId: "00x",
            templateId: "pkg:CompressRail.Trade:BilateralTrade",
            createArgument: e.createArgument,
            signatories: [],
            observers: [],
            witnessParties: [],
            offset: 1,
            createdAt: "2026-01-01T00:00:00Z",
            createdEventBlob: "",
          },
        },
      },
    })),
  };
}

function mockClient(entries: Array<{ createArgument: Record<string, unknown> }>): LedgerClient {
  const transport: Transport = {
    async get() {
      return { status: 200, body: { offset: 1 } };
    },
    async post(path) {
      if (path === "/v2/state/active-contracts") return acsResponse(entries);
      return { status: 200, body: {} };
    },
  };
  return new LedgerClient({ transport, token: "" });
}

describe("attemptOperatorCheat", () => {
  it("fails honestly when the operator's projection is empty (the real case, R5.1)", async () => {
    const client = mockClient([]);
    const result = await attemptOperatorCheat(client, "Operator");

    expect(result.succeeded).toBe(false);
    expect(result.operatorTradeCount).toBe(0);
    expect(result.reason).toMatch(/no bilateral trade/i);
  });

  it("still fails to decrypt even in the hypothetical case where a trade were visible", async () => {
    const aliceKeys = await generateKeyPair();
    const bobKeys = await generateKeyPair();
    const sealed = await sealLeg({ instrument: "IRS", notional: 1 }, [
      { party: "Alice", publicKey: aliceKeys.publicKey },
      { party: "Bob", publicKey: bobKeys.publicKey },
    ]);
    const trade = createBilateralTrade({ cptyA: "Alice", cptyB: "Bob", tradeRef: "AB", terms: sealed.ciphertext, commitment: sealed.commitment, auditors: [] });
    const client = mockClient([{ createArgument: trade }]);

    const result = await attemptOperatorCheat(client, "Operator");

    expect(result.succeeded).toBe(false);
    expect(result.operatorTradeCount).toBe(1);
    expect(result.reason).toMatch(/no wrapped content key/i);
  });
});
