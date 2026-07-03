// The header carries the acting party's identity (R8.1, R8.2): which party the
// viewer is currently acting as, and a control to switch or log out. Every view
// downstream renders from this party's own ledger projection — visibility comes
// from Canton, never from a UI filter.
export interface PartyHeaderProps {
  readonly partyLabel: string;
  readonly partyRole: string;
  readonly onSwitchParty?: () => void;
}

export function PartyHeader({ partyLabel, partyRole, onSwitchParty }: PartyHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-semibold tracking-tight text-foreground">
          CompressRail
        </span>
        <span className="text-border">/</span>
        <span className="text-sm text-muted">Compression Console</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end leading-tight">
          <span className="text-sm font-medium text-foreground">{partyLabel}</span>
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
            {partyRole}
          </span>
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
