// The Compression Console (R8.4): the join-cycle action runs the actual compression
// cycle against the live ledger and reports what really happened — never a hardcoded
// "0" (R5.4, R8.8). The ~50s DevNet run is shown as a live step timeline: each step
// lands as its real ledger operation completes, so the latency reads as proof that
// every phase is a real transaction, not dead air. The result leads with what was
// accomplished (trades torn up, % compressed) rather than a wall of zeros.
"use client";

import { useCallback, useEffect, useState } from "react";
import { KpiCard } from "./shell";
import { CompressionRing } from "./compression-ring";
import { useLiveRun } from "@/lib/use-live-run";
import { createDemoLedgerClient } from "@/lib/ledger";
import { useDemoSession } from "@/lib/demo-session";
import { runCompressionCycle, type CycleResult, type CycleProgress } from "@compressrail/app/scenario/cycle";
import { runOperatorBlindnessScenario, type BlindnessResult } from "@compressrail/app/scenario/blindness";

const short = (id: string): string => (id.length > 16 ? `${id.slice(0, 12)}…` : id);

function progressLabel(e: CycleProgress): string {
  switch (e.step) {
    case "parties":
      return `Allocated ${e.count} parties on Canton DevNet`;
    case "trades":
      return `Wrote ${e.count} encrypted bilateral trades (${e.refs.join(", ")} · $${(e.grossNotional / 1_000_000).toFixed(0)}M gross)`;
    case "matched":
      return `Matched: tear up ${e.tearUp} trades, create ${e.replacements} replacement legs`;
    case "opened":
      return "Operator opened the cycle — carries no economic terms";
    case "verified":
      return `${short(e.participant)} verified post-cycle risk on its own node — ${e.withinTolerance ? "within tolerance" : "declined"}`;
    case "executed":
      return `Atomic execute: ${e.tornUp} trades torn up in one transaction`;
    case "settled":
      return `After: A ${e.aliceTradeCount} · B ${e.bobTradeCount} · C ${e.carolTradeCount} — fully compressed`;
  }
}

export function CompressionConsole({ onActAsOperator }: { readonly onActAsOperator: () => void }) {
  const [progress, setProgress] = useState<CycleProgress[]>([]);
  const run = useCallback(() => {
    setProgress([]);
    return runCompressionCycle(createDemoLedgerClient(), (e) => setProgress((prev) => [...prev, e]));
  }, []);
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

  const compressionPct =
    result && result.tradesTornUp > 0
      ? Math.round((1 - result.replacementLegCount / result.tradesTornUp) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* KPI row — framed around accomplishment, not remainder. Every value is real. */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Trades torn up"
          value={result ? String(result.tradesTornUp) : "—"}
          tone={result ? "positive" : "neutral"}
          caption={result ? "archived in one atomic transaction" : "run a cycle to compute this"}
        />
        <KpiCard
          label="Compression"
          value={result ? `${result.tradesTornUp} → ${result.replacementLegCount}` : "—"}
          tone={result ? "positive" : "neutral"}
          caption={result ? `${compressionPct}% compressed by the real matching algorithm` : "replacement legs from the matcher"}
        />
        <KpiCard
          label="Positions seen by the operator"
          value={result ? String(result.operatorTradeCount) : "0"}
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
              algorithm, and the atomic execute. Runs live against Canton DevNet — a
              full cycle takes under a minute.
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

        {/* Live step timeline: each step appears when its real ledger op completes. */}
        {(running || progress.length > 0) && (
          <ol className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            {progress.map((e, i) => (
              <li key={`${e.step}-${i}`} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 text-accent-live">✓</span>
                <span className="text-foreground">{progressLabel(e)}</span>
              </li>
            ))}
            {running && (
              <li className="flex items-center gap-2 text-xs text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-propose" />
                <span>Working against Canton DevNet — each step above is a real transaction…</span>
              </li>
            )}
          </ol>
        )}

        {/* Finale CTA: surface the buried try-to-cheat by jumping to the operator view. */}
        {result && (
          <div className="mt-4 rounded border border-accent-propose/40 bg-accent-propose/10 px-3 py-3">
            <p className="text-xs text-foreground">
              The operator coordinated this entire cycle without ever seeing a position.
              See exactly what it saw — and try to read a participant&apos;s book yourself.
            </p>
            <button
              type="button"
              onClick={onActAsOperator}
              className="mt-2 rounded bg-accent-propose px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              View as operator →
            </button>
          </div>
        )}
      </div>

      <CompressionRing result={result} />

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
