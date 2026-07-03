"use client";

import { useState } from "react";
import { TerminalShell, KpiCard, DataTableTabs, DataTable } from "@/components/shell";

// A static preview of the terminal shell (R8.1). Real per-party data — party
// selection, live projections, the Compression Console, the X-ray, the privacy
// matrix — lands in the following tasks; this proves the shared shell renders
// correctly before any of it is wired in.
const NAV_ITEMS = [
  { id: "console", label: "Compression Console" },
  { id: "ledger", label: "Ledger / X-ray" },
  { id: "matrix", label: "Privacy matrix" },
];

const TRADE_TABS = [
  { id: "open", label: "Open trades", count: 2 },
  { id: "nominated", label: "Nominated", count: 1 },
  { id: "history", label: "History", count: 0 },
];

export default function Home() {
  const [activeNav, setActiveNav] = useState("console");
  const [activeTab, setActiveTab] = useState("open");

  return (
    <TerminalShell
      partyLabel="Participant A"
      partyRole="Participant"
      navItems={NAV_ITEMS}
      activeNavId={activeNav}
      onSelectNav={setActiveNav}
      connection="connected"
      network="Canton DevNet"
      cycleStatus="No cycle open"
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-4">
          <KpiCard label="Trapped initial margin" value="$4.20M" caption="across 2 open trades" />
          <KpiCard label="Book size" value="2" caption="bilateral trades" />
          <KpiCard
            label="Books seen by operator"
            value="0"
            tone="positive"
            caption="verified from the operator's own projection"
          />
        </div>

        <div className="rounded-md border border-border bg-surface">
          <DataTableTabs tabs={TRADE_TABS} activeId={activeTab} onSelect={setActiveTab} />
          <DataTable>
            <tr>
              <td className="px-4 py-3 font-mono text-xs text-muted">AB</td>
              <td className="px-4 py-3 text-sm">Participant B</td>
              <td className="px-4 py-3 text-right font-mono text-sm text-accent-live">within tolerance</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-mono text-xs text-muted">CA</td>
              <td className="px-4 py-3 text-sm">Participant C</td>
              <td className="px-4 py-3 text-right font-mono text-sm text-accent-live">within tolerance</td>
            </tr>
          </DataTable>
        </div>
      </div>
    </TerminalShell>
  );
}
