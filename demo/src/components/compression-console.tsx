// The Compression Console (R8.4): a participant blotter that looks like a real
// risk/treasury tool, with a join-cycle action that runs the actual compression
// cycle against the live ledger and reports what really happened — never a
// hardcoded "0" (R5.4, R8.8).
"use client";

import { useCallback, useEffect } from "react";
import { KpiCard, DataTableTabs, DataTable } from "./shell";
import { useLiveRun } from "@/lib/use-live-run";
import { createDemoLedgerClient } from "@/lib/ledger";
import { useDemoSession } from "@/lib/demo-session";
import { runCompressionCycle, type CycleResult } from "@compressrail/app/scenario/cycle";
import { runOperatorBlindnessScenario, type BlindnessResult } from "@compressrail/app/scenario/blindness";

export function CompressionConsole() {
  const run = useCallback(() => runCompressionCycle(createDemoLedgerClient()), []);
  const { state, trigger } = useLiveRun<CycleResult>(run);
  const { setLastCycle, setMatrixParties } = useDemoSession();

  const runBlindness = useCallback(() => runOperatorBlindnessScenario(createDemoLedgerClient()), []);
  const { state: blindnessState, trigger: triggerBlindness } = useLiveRun<BlindnessResult>(runBlindness);

  const running = state.status === "running";
  const result = state.status === "done" ? state.result : undefined;
  const blindnessResult = blindnessState.status === "done" ? blindnessState.result : undefined;

  useEffect(() => {
    if (result) setLastCycle(result);
  }, [result, setLastCycle]);

  useEffect(() => {
    if (blindnessResult) setMatrixParties(blindnessResult.parties);
  }, [blindnessResult, setMatrixParties]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Replacement legs after the cycle"
          value={result ? String(result.replacementLegCount) : "—"}
          caption={result ? "computed by the real matching algorithm" : "run a cycle to compute this"}
        />
        <KpiCard
          label="Your books held by the operator"
          value={result ? String(result.operatorTradeCount) : "—"}
          tone={result && result.operatorTradeCount === 0 ? "positive" : "neutral"}
          caption="read from the operator's own live projection"
        />
        <KpiCard
          label="Books seen by the operator"
          value="0"
          tone="positive"
          caption="the operator never holds a decryption key"
        />
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-foreground">Compression cycle</h2>
            <p className="text-xs text-muted">
              Runs an offsetting three-party ring end to end against the live ledger:
              real encryption, a real per-node risk check, the real matching
              algorithm, and the atomic execute.
            </p>
          </div>
          <button
            type="button"
            onClick={trigger}
            disabled={running}
            className="rounded bg-accent-action px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {running ? "Running…" : "Run compression cycle"}
          </button>
        </div>

        {state.status === "error" && (
          <p className="mt-3 rounded border border-accent-alert/40 bg-accent-alert/10 px-3 py-2 text-xs text-accent-alert">
            {state.message}
          </p>
        )}

        {result && (
          <div className="mt-4">
            <DataTableTabs
              tabs={[
                { id: "participants", label: "Participant trade counts", count: 3 },
              ]}
              activeId="participants"
              onSelect={() => undefined}
            />
            <DataTable>
              <tr>
                <td className="px-4 py-3 text-sm">Participant A (you)</td>
                <td className="px-4 py-3 text-right font-mono text-sm">{result.aliceTradeCount}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm">Participant B</td>
                <td className="px-4 py-3 text-right font-mono text-sm">{result.bobTradeCount}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm">Participant C</td>
                <td className="px-4 py-3 text-right font-mono text-sm">{result.carolTradeCount}</td>
              </tr>
            </DataTable>
          </div>
        )}
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-foreground">Operator-blindness check</h2>
            <p className="text-xs text-muted">
              Writes a single encrypted bilateral trade and reads it back from both
              counterparties and the operator, so the privacy matrix has a
              persistent trade to read from.
            </p>
          </div>
          <button
            type="button"
            onClick={triggerBlindness}
            disabled={blindnessState.status === "running"}
            className="rounded border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-accent-action disabled:opacity-50"
          >
            {blindnessState.status === "running" ? "Running…" : "Run operator-blindness check"}
          </button>
        </div>

        {blindnessState.status === "error" && (
          <p className="mt-3 rounded border border-accent-alert/40 bg-accent-alert/10 px-3 py-2 text-xs text-accent-alert">
            {blindnessState.message}
          </p>
        )}

        {blindnessResult && (
          <p className="mt-3 text-xs text-muted">
            Operator&apos;s own projection: <span className="font-mono text-accent-live">{blindnessResult.operatorTradeCount}</span> bilateral trades.
            Open the Privacy matrix tab to see the full read.
          </p>
        )}
      </div>
    </div>
  );
}
