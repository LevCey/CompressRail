import { describe, it, expect } from "vitest";
import { fetchTransport, LedgerClient } from "../ledger/index";
import { runOperatorBlindnessScenario } from "./blindness";
import { runCompressionCycle } from "./cycle";

// Runs only when a live JSON Ledger API URL is provided, e.g.
//   E2E_LEDGER_URL=http://localhost:7575 npx vitest run scenario/e2e.test.ts
// against a Canton sandbox started with the CompressRail DAR (see deploy/README).
const url = process.env["E2E_LEDGER_URL"];

describe.skipIf(!url)("operator-blindness on a live Canton ledger", () => {
  it("counterparties see the trade and can decrypt it; the operator's projection is empty", async () => {
    const client = new LedgerClient({ transport: fetchTransport(url as string), token: "" });
    const r = await runOperatorBlindnessScenario(client);

    expect(r.aliceTradeCount).toBeGreaterThanOrEqual(1);
    expect(r.bobTradeCount).toBeGreaterThanOrEqual(1);
    expect(r.operatorTradeCount).toBe(0);
    expect(r.onLedgerTermsAreCiphertext).toBe(true);
    expect(r.aliceDecryptedTerms).toMatchObject({ instrument: "IRS" });
  }, 60_000);
});

describe.skipIf(!url)("the full compression cycle on a live Canton ledger", () => {
  it("tears up the offsetting ring atomically; the operator ends up a stakeholder of nothing", async () => {
    const client = new LedgerClient({ transport: fetchTransport(url as string), token: "" });
    const r = await runCompressionCycle(client);

    // The offsetting ring nets to zero, so the matching stand-in fully compresses it
    // — zero replacement legs — and every party's trade count goes to zero.
    expect(r.replacementLegCount).toBe(0);
    expect(r.aliceTradeCount).toBe(0);
    expect(r.bobTradeCount).toBe(0);
    expect(r.carolTradeCount).toBe(0);
    // Across the whole lifecycle — open, three commits, and the atomic execute —
    // the operator never becomes a stakeholder of any bilateral trade.
    expect(r.operatorTradeCount).toBe(0);
  }, 60_000);
});
