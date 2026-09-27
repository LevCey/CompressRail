import { describe, it, expect } from "vitest";
import { fetchTransport, retryingTransport, LedgerClient } from "../ledger/index";
import { runCrossNodeCycle } from "./crossnode";

// Runs only when two participant nodes are configured:
//   E2E_LEDGER_URL     node A (hosts A and the operator; parties are allocated here)
//   E2E_H_LEDGER_URL   node H
//   E2E_H_TOKEN        access token for node H's ledger user
//   E2E_H_USER_ID      that ledger user's id
//   E2E_H_PARTY        an existing party on node H that the user can act as
// Node A is reached without a token, as in the single-node e2e.
const env = process.env;
const urlA = env["E2E_LEDGER_URL"];
const urlH = env["E2E_H_LEDGER_URL"];
const tokenH = env["E2E_H_TOKEN"];
const userH = env["E2E_H_USER_ID"];
const partyH = env["E2E_H_PARTY"];
const configured = Boolean(urlA && urlH && tokenH && userH && partyH);

describe.skipIf(!configured)("a compression cycle across two participant nodes", () => {
  it("tears up a partly offsetting pair and creates the net leg, signed across both nodes", async () => {
    const nodeA = new LedgerClient({ transport: retryingTransport(fetchTransport(urlA as string)), token: "" });
    const nodeH = new LedgerClient({ transport: retryingTransport(fetchTransport(urlH as string)), token: tokenH as string, userId: userH as string });

    const r = await runCrossNodeCycle({ nodeA, nodeH, partyH: partyH as string });

    // 100 against 60 of one factor: both trades go, one net leg of 40 remains.
    expect(r.tradesTornUp).toBe(2);
    expect(r.replacementLegCount).toBe(1);
    // Each side, reading from its own node, holds the net leg and neither original.
    expect(r.aOriginalsActive).toBe(0);
    expect(r.hOriginalsActive).toBe(0);
    expect(r.aReplacementLegs).toBe(1);
    expect(r.hReplacementLegs).toBe(1);
    // H opens it with its own key on node H; the sign follows the smaller party id.
    expect(Math.abs(r.hDecryptedReplacementRisk["2Y"] ?? 0)).toBe(40);
    // The net leg is signed by parties under two different namespaces.
    expect(r.replacementSignatoryNamespaces).toHaveLength(2);
    // The operator is a stakeholder of nothing, before or after.
    expect(r.operatorTradeCount).toBe(0);
    expect(r.maxActAsPerSubmission).toBe(1);
  }, 240_000);
});
