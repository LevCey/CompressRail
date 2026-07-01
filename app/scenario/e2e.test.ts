import { describe, it, expect } from "vitest";
import { fetchTransport, LedgerClient } from "../ledger/index";
import { runOperatorBlindnessScenario } from "./blindness";

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
