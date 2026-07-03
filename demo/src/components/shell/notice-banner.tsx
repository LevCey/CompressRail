// The top notice banner (R8.1, R8.2 / R7.3): states plainly that this is a demo —
// no real funds, demo-grade auth, and the ledger environment resets periodically.
// This is a disclosure, not decoration; it must stay accurate to R7.3 and D8.
export function NoticeBanner() {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-border bg-surface px-4 py-1.5 text-xs text-muted">
      <span className="font-mono uppercase tracking-wide text-accent-propose">Demo</span>
      <span>
        Canton DevNet — demo-grade authentication, no real funds, resets periodically.
      </span>
    </div>
  );
}
