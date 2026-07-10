// The header carries the acting party's identity (R8.1, R8.2): which party the
// viewer is currently acting as, its real allocated party id (copyable), and a
// control to switch. Every view downstream renders from this party's own ledger
// projection — visibility comes from Canton, never from a UI filter.
"use client";

import { useState } from "react";

export interface PartyHeaderProps {
  readonly partyLabel: string;
  readonly partyRole: string;
  readonly partyId?: string | null;
  readonly onSwitchParty?: () => void;
}

export function PartyHeader({ partyLabel, partyRole, partyId, onSwitchParty }: PartyHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    if (!partyId) return;
    try {
      await navigator.clipboard.writeText(partyId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — the truncated id is still shown
    }
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-sm font-semibold tracking-tight text-foreground">CompressRail</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Canton Compression Protocol</span>
      </div>
      <div className="flex items-center gap-3">
        {partyId && (
          <button
            type="button"
            onClick={copy}
            title="Copy the full party id"
            className="group flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-accent-action hover:text-foreground"
          >
            <span>{partyId.length > 14 ? `${partyId.slice(0, 12)}…` : partyId}</span>
            <span className="text-[10px] uppercase tracking-wide text-border group-hover:text-accent-action">
              {copied ? "copied" : "copy"}
            </span>
          </button>
        )}
        <div className="flex flex-col items-end leading-tight">
          <span className="text-sm font-medium text-foreground">{partyLabel}</span>
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{partyRole}</span>
        </div>
        {onSwitchParty && (
          <button
            type="button"
            onClick={onSwitchParty}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent-action hover:text-foreground"
          >
            Switch party
          </button>
        )}
      </div>
    </header>
  );
}
