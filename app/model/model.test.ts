import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  CHOICES,
  createBilateralTrade,
  createParticipantProfile,
  createCompressionCycle,
  commitArg,
  executeArg,
  revokeArg,
  decodeBilateralTrade,
  decodeParticipantProfile,
  decodeCompressionCycle,
  type BilateralTradeArgs,
  type CompressionCycleArgs,
} from "./index";
import { LedgerClient, type LedgerResponse, type Transport } from "../ledger/index";

const trade: BilateralTradeArgs = {
  cptyA: "A::1220",
  cptyB: "B::1220",
  tradeRef: "AB",
  terms: "base64ciphertext",
  commitment: "hexcommit",
  auditors: [],
};

describe("template ids and choices", () => {
  it("uses the package-name qualified form", () => {
    expect(TEMPLATES.BilateralTrade).toBe("#compressrail:CompressRail.Trade:BilateralTrade");
    expect(TEMPLATES.CompressionCycle).toBe("#compressrail:CompressRail.Cycle:CompressionCycle");
    expect(CHOICES.Commit).toBe("Commit");
  });
});

describe("encoders", () => {
  it("encodes a BilateralTrade record", () => {
    expect(createBilateralTrade(trade)).toEqual({
      cptyA: "A::1220",
      cptyB: "B::1220",
      tradeRef: "AB",
      terms: "base64ciphertext",
      commitment: "hexcommit",
      auditors: [],
    });
  });

  it("encodes an Optional Party as the value or null", () => {
    expect(createParticipantProfile({ participant: "A::1220", auditor: null, sensitivityCommitment: "c", encSensitivities: "e" }).auditor).toBeNull();
    expect(createParticipantProfile({ participant: "A::1220", auditor: "R::1220", sensitivityCommitment: "c", encSensitivities: "e" }).auditor).toBe("R::1220");
  });

  it("encodes a (Party, Party) topology tuple as {_1, _2}", () => {
    const encoded = createCompressionCycle({
      cycleId: "cycle-1",
      operator: "Op::1220",
      committed: ["Op::1220"],
      toCommit: ["A::1220", "B::1220"],
      teardown: ["00ab", "00bc"],
      topology: [["A::1220", "B::1220"]],
      participations: [],
      deadline: "2031-06-24T00:00:00Z",
    });
    expect(encoded["topology"]).toEqual([{ _1: "A::1220", _2: "B::1220" }]);
  });

  it("encodes Commit legs and empty choice arguments", () => {
    expect(commitArg("A::1220", [{ counterparty: "B::1220", commitment: "h", enc: "e" }], true)).toEqual({
      participant: "A::1220",
      legs: [{ counterparty: "B::1220", commitment: "h", enc: "e" }],
      withinTolerance: true,
    });
    expect(executeArg()).toEqual({});
    expect(revokeArg()).toEqual({});
  });
});

describe("decoders round-trip the encoders", () => {
  it("round-trips a BilateralTrade", () => {
    expect(decodeBilateralTrade(createBilateralTrade(trade))).toEqual(trade);
  });

  it("round-trips a ParticipantProfile with a scoped auditor", () => {
    const p = { participant: "A::1220", auditor: "R::1220", sensitivityCommitment: "c", encSensitivities: "e" };
    expect(decodeParticipantProfile(createParticipantProfile(p))).toEqual(p);
  });

  it("round-trips a CompressionCycle including topology tuples and participations", () => {
    const cycle: CompressionCycleArgs = {
      cycleId: "cycle-1",
      operator: "Op::1220",
      committed: ["Op::1220", "A::1220"],
      toCommit: ["B::1220"],
      teardown: ["00ab", "00bc", "00ca"],
      topology: [["A::1220", "B::1220"]],
      participations: [
        { participant: "A::1220", legs: [{ counterparty: "B::1220", commitment: "h", enc: "e" }], withinTolerance: true },
      ],
      deadline: "2031-06-24T00:00:00Z",
    };
    expect(decodeCompressionCycle(createCompressionCycle(cycle))).toEqual(cycle);
  });
});

describe("integration with the ledger client", () => {
  function mock(body: unknown): { transport: Transport; calls: Array<{ path: string; body?: unknown }> } {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const res: LedgerResponse = { status: 200, body };
    const transport: Transport = {
      async post(path, b) {
        calls.push({ path, body: b });
        return res;
      },
      async get(path) {
        calls.push({ path });
        return res;
      },
    };
    return { transport, calls };
  }

  it("submits a typed create through the client with the right template id and arguments", async () => {
    const { transport, calls } = mock({ updateId: "u1", completionOffset: 1 });
    const client = new LedgerClient({ transport, token: "jwt-A" });

    await client.create("A::1220", TEMPLATES.BilateralTrade, createBilateralTrade(trade));

    expect(calls[0]!.body).toMatchObject({
      actAs: ["A::1220"],
      commands: [{ CreateCommand: { templateId: TEMPLATES.BilateralTrade, createArguments: createBilateralTrade(trade) } }],
    });
    expect(typeof (calls[0]!.body as { commandId: unknown }).commandId).toBe("string");
  });

  it("submits a typed Commit exercise through the client", async () => {
    const { transport, calls } = mock({ updateId: "u2", completionOffset: 2 });
    const client = new LedgerClient({ transport, token: "jwt-A" });

    await client.exercise("A::1220", TEMPLATES.CompressionCycle, "00cyc", CHOICES.Commit, commitArg("A::1220", [], true));

    expect(calls[0]!.body).toMatchObject({
      actAs: ["A::1220"],
      commands: [
        {
          ExerciseCommand: {
            templateId: TEMPLATES.CompressionCycle,
            contractId: "00cyc",
            choice: "Commit",
            choiceArgument: { participant: "A::1220", legs: [], withinTolerance: true },
          },
        },
      ],
    });
    expect(typeof (calls[0]!.body as { commandId: unknown }).commandId).toBe("string");
  });
});
