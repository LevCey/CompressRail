import { describe, it, expect } from "vitest";
import { fetchTransport, retryingTransport, LedgerClient } from "../ledger/index";
import { runThreeNodeCycle } from "./threenode";

// Runs only when three participant nodes are configured:
//   E2E_LEDGER_URL      node A (hosts Firms A and C; parties are allocated here)
//   E2E_OP_LEDGER_URL   the operator's node (hosts only the operator)
//   E2E_H_LEDGER_URL    node H (hosts Firm B)
//   E2E_H_TOKEN         access token for node H's ledger user
//   E2E_H_USER_ID       that ledger user's id
//   E2E_H_PARTY         Firm B: an existing party on node H the user can act as
const env = process.env;
const urlA = env["E2E_LEDGER_URL"];
const urlOp = env["E2E_OP_LEDGER_URL"];
const urlH = env["E2E_H_LEDGER_URL"];
const tokenH = env["E2E_H_TOKEN"];
const userH = env["E2E_H_USER_ID"];
const partyB = env["E2E_H_PARTY"];
const configured = Boolean(urlA && urlOp && urlH && tokenH && userH && partyB);

describe.skipIf(!configured)("a multilateral compression cycle across three participant nodes", () => {
  it("compresses a ring no pair can net alone, from an operator node that holds no trade", async () => {
    const nodeA = new LedgerClient({ transport: retryingTransport(fetchTransport(urlA as string)), token: "" });
    const nodeOp = new LedgerClient({ transport: retryingTransport(fetchTransport(urlOp as string)), token: "" });
    const nodeH = new LedgerClient({ transport: retryingTransport(fetchTransport(urlH as string)), token: tokenH as string, userId: userH as string });

    const r = await runThreeNodeCycle({ nodeA, nodeH, nodeOp, partyB: partyB as string });

    // Three distinct participants.
    expect(new Set(Object.values(r.namespaces)).size).toBe(3);
    // A–B 100, B–C 60, C–A 60: all three go, one net leg of 40 between A and B.
    expect(r.tradesTornUp).toBe(3);
    expect(r.replacementLegCount).toBe(1);
    expect(r.originalsActive).toEqual({ a: 0, b: 0, c: 0 });
    expect(r.replacementLegs).toEqual({ a: 1, b: 1, c: 0 });
    expect(r.cTradeCount).toBe(0); // C nets out of the cycle entirely
    expect(Math.abs(r.bDecryptedReplacementRisk["2Y"] ?? 0)).toBe(40);
    expect(r.replacementSignatoryNamespaces).toEqual([r.namespaces.a, r.namespaces.h].sort());
    // The operator's node never held a trade for the operator — not now, not in its history.
    expect(r.operatorTradeCount).toBe(0);
    expect(r.operatorTradeEventsInHistory).toBe(0);
    expect(r.maxActAsPerSubmission).toBe(1);
  }, 300_000);
});
