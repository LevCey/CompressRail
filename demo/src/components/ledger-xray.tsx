// The Ledger / X-ray view (R8.5): a ledger-activity feed of CREATE/ARCHIVE events
// from the acting party's own projection, plus a contract-detail drawer. Every
// economic field renders exactly as it is on-ledger — real ciphertext, not fake
// redaction (R5.2 / D16). This is read from `LedgerClient.updates`, never rendered
// from a hardcoded or simulated feed.
"use client";

import { useCallback, useEffect, useState } from "react";
import { DataTable } from "./shell";
import { useLiveRun } from "@/lib/use-live-run";
import { createDemoLedgerClient } from "@/lib/ledger";
import type { LedgerEvent, LedgerUpdate } from "@compressrail/app/ledger";

export interface LedgerXRayProps {
  readonly party: string;
  readonly partyLabel: string;
}

function eventKindLabel(e: LedgerEvent): string {
  return e.kind === "created" ? "CREATE" : "ARCHIVE";
}

function eventTemplateName(e: LedgerEvent): string {
  // Template ids are package-id-qualified on the wire (e.g.
  // "abc123...:CompressRail.Trade:BilateralTrade"); show only the module:entity.
  const parts = e.event.templateId.split(":");
  return parts.slice(-2).join(":");
}

function eventContractId(e: LedgerEvent): string {
  return e.event.contractId;
}

const KIND_CLASS: Record<string, string> = {
  CREATE: "text-accent-live",
  ARCHIVE: "text-accent-alert",
};

export function LedgerXRay({ party, partyLabel }: LedgerXRayProps) {
  const run = useCallback(() => createDemoLedgerClient().updates(party), [party]);
  const { state, trigger } = useLiveRun<LedgerUpdate[]>(run);
  const [selected, setSelected] = useState<LedgerEvent | null>(null);

  // Load the feed automatically on mount and whenever the acting party changes; the
  // Refresh button re-runs it on demand. This keeps the X-ray zero-click.
  useEffect(() => {
    trigger();
  }, [trigger]);

  const updates = state.status === "done" ? state.result : [];
  const flat = updates.flatMap((u) => u.events.map((e) => ({ update: u, event: e })));

  return (
    <div className="flex gap-4">
      <div className="flex-1 rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span>Ledger activity — {partyLabel}</span>
              {state.status === "done" && (
                <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-accent-live" />
                  {flat.length} events · Live
                </span>
              )}
            </h2>
            <p className="text-xs text-muted">
              Read directly from this party&apos;s own projection. Economic fields
              render exactly as they exist on-ledger.
            </p>
          </div>
          <button
            type="button"
            onClick={trigger}
            disabled={state.status === "running"}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent-action hover:text-foreground disabled:opacity-50"
          >
            {state.status === "running" ? "Loading…" : "Refresh"}
          </button>
        </div>

        {state.status === "error" && (
          <p className="m-4 rounded border border-accent-alert/40 bg-accent-alert/10 px-3 py-2 text-xs text-accent-alert">
            {state.message}
          </p>
        )}

        {state.status === "done" && flat.length === 0 && (
          <p className="p-4 text-xs text-muted">No activity yet in this projection.</p>
        )}

        {flat.length > 0 && (
          <DataTable>
            {flat.map(({ update, event }, i) => (
              <tr
                key={`${update.updateId}-${i}`}
                className="cursor-pointer hover:bg-surface-raised"
                onClick={() => setSelected(event)}
              >
                <td className={`px-4 py-2 font-mono text-xs font-semibold ${KIND_CLASS[eventKindLabel(event)]}`}>
                  {eventKindLabel(event)}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-foreground">{eventTemplateName(event)}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-muted">{eventContractId(event).slice(0, 12)}…</td>
                <td className="px-4 py-2 text-right font-mono text-[11px] text-muted">{update.effectiveAt}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      {selected && (
        <div className="w-96 rounded-md border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Contract detail</h3>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted hover:text-foreground">
              Close
            </button>
          </div>
          <dl className="flex flex-col gap-2 text-xs">
            <div>
              <dt className="text-muted">Template</dt>
              <dd className="font-mono text-foreground">{eventTemplateName(selected)}</dd>
            </div>
            <div>
              <dt className="text-muted">Contract id</dt>
              <dd className="break-all font-mono text-[11px] text-foreground">{selected.event.contractId}</dd>
            </div>
            {selected.kind === "created" && (
              <div>
                <dt className="text-muted">Create arguments — as stored on-ledger</dt>
                <dd className="mt-1 whitespace-pre-wrap break-all rounded bg-background p-2 font-mono text-[11px] text-foreground">
                  {JSON.stringify(selected.event.createArgument, null, 2)}
                </dd>
              </div>
            )}
            {selected.kind === "created" && (
              <div>
                <dt className="text-muted">Signatories</dt>
                <dd className="font-mono text-foreground">{selected.event.signatories.join(", ")}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
