"use client";

import { useState } from "react";
import { TerminalShell } from "@/components/shell";
import { PartySelector, PARTY_OPTIONS, type DemoRole } from "@/components/party-selector";
import { CompressionConsole } from "@/components/compression-console";
import { LEDGER_URL } from "@/lib/ledger";

const NAV_ITEMS = [
  { id: "console", label: "Compression Console" },
  { id: "ledger", label: "Ledger / X-ray" },
  { id: "matrix", label: "Privacy matrix" },
];

export default function Home() {
  const [role, setRole] = useState<DemoRole | null>(null);
  const [activeNav, setActiveNav] = useState("console");

  if (!role) {
    return <PartySelector onSelect={setRole} />;
  }

  const option = PARTY_OPTIONS.find((o) => o.role === role);

  return (
    <TerminalShell
      partyLabel={option?.label ?? role}
      partyRole={option?.roleLabel ?? "Party"}
      onSwitchParty={() => setRole(null)}
      navItems={NAV_ITEMS}
      activeNavId={activeNav}
      onSelectNav={setActiveNav}
      connection="connected"
      network={LEDGER_URL}
      cycleStatus="No cycle open"
    >
      {activeNav === "console" ? (
        <CompressionConsole />
      ) : (
        <div className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
          This view is not built yet.
        </div>
      )}
    </TerminalShell>
  );
}
