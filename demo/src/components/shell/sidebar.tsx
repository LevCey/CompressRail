// The left sidebar nav (R8.1): the sections of the acting party's console.
export interface SidebarItem {
  readonly id: string;
  readonly label: string;
}

export interface SidebarProps {
  readonly items: readonly SidebarItem[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
}

export function Sidebar({ items, activeId, onSelect }: SidebarProps) {
  return (
    <nav className="flex w-52 flex-col gap-0.5 border-r border-border bg-surface p-3">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`rounded px-3 py-2 text-left text-sm transition-colors ${
              active
                ? "bg-surface-raised text-foreground"
                : "text-muted hover:bg-surface-raised hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
