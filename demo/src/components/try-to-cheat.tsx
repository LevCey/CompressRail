// "Be the operator, try to cheat" (R8.7, D8): a judge-operated control that
// genuinely attempts, as the operator, to reveal a participant's position — and
// fails, because there is nothing on the ledger to reveal. This calls the real
// attempt against the live ledger; it does not simulate a failure or hide a
// cleartext value behind a UI mask.
"use client";

import { useCallback } from "react";
import { useLiveRun } from "@/lib/use-live-run";
import { createDemoLedgerClient } from "@/lib/ledger";
import { attemptOperatorCheat, type CheatAttemptResult } from "@compressrail/app/scenario/cheat";

export interface TryToCheatProps {
  readonly operator: string;
}

export function TryToCheat({ operator }: TryToCheatProps) {
  const run = useCallback(() => attemptOperatorCheat(createDemoLedgerClient(), operator), [operator]);
  const { state, trigger } = useLiveRun<CheatAttemptResult>(run);

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Be the operator — try to reveal a position
          </h2>
          <p className="text-xs text-muted">
            Acts as the operator and genuinely attempts to read and decrypt a
            participant&apos;s trade from the operator&apos;s own ledger view. This
            is a real attempt against the live ledger, not a simulated result.
          </p>
        </div>
        <button
          type="button"
          onClick={trigger}
          disabled={state.status === "running"}
          className="rounded border border-accent-alert/60 px-4 py-2 text-sm text-accent-alert transition-colors hover:bg-accent-alert/10 disabled:opacity-50"
        >
          {state.status === "running" ? "Attempting…" : "Try to cheat"}
        </button>
      </div>

      {state.status === "error" && (
        <p className="mt-3 rounded border border-accent-alert/40 bg-accent-alert/10 px-3 py-2 text-xs text-accent-alert">
          {state.message}
        </p>
      )}

      {state.status === "done" && (
        <div className="mt-3 rounded border border-accent-live/40 bg-accent-live/10 px-3 py-2 text-xs">
          <p className="font-mono font-semibold text-accent-live">
            {state.result.succeeded ? "UNEXPECTED: the attempt succeeded" : "Failed, as expected"}
          </p>
          <p className="mt-1 text-muted">
            Operator&apos;s own projection: {state.result.operatorTradeCount} bilateral trade(s).{" "}
            {state.result.reason}
          </p>
        </div>
      )}
    </div>
  );
}
