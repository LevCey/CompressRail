// A tabbed data table shell (R8.1, R8.5): tabs carry counts; the active tab's rows
// render below via children, so callers keep control of column shape.
export interface DataTableTab {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export interface DataTableTabsProps {
  readonly tabs: readonly DataTableTab[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
}

export function DataTableTabs({ tabs, activeId, onSelect }: DataTableTabsProps) {
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-accent-action text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            <span className="rounded-full bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function DataTable({ children }: { readonly children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-sm">
      <tbody className="divide-y divide-border">{children}</tbody>
    </table>
  );
}
