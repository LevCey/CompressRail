"use client";

import { useState } from "react";
import { TerminalShell } from "@/components/shell";
import { PartySelector, PARTY_OPTIONS, type DemoRole } from "@/components/party-selector";
import { CompressionConsole } from "@/components/compression-console";
import { LedgerXRay } from "@/components/ledger-xray";
import { PrivacyMatrixScoreboard } from "@/components/privacy-matrix-scoreboard";
import { DemoSessionProvider, useDemoSession } from "@/lib/demo-session";
import { LEDGER_URL } from "@/lib/ledger";

const NAV_ITEMS = [
  { id: "console", label: "Compression Console" },
  { id: "ledger", label: "Ledger / X-ray" },
  { id: "matrix", label: "Privacy matrix" },
];

function roleToPartyId(role: DemoRole, session: ReturnType<typeof useDemoSession>): string | null {
  const cycle = session.lastCycle;
  if (!cycle) return null;
  switch (role) {
    case "participant-a":
      return cycle.parties.alice;
    case "participant-b":
      return cycle.parties.bob;
    case "participant-c":
      return cycle.parties.carol;
    case "operator":
      return cycle.parties.operator;
    case "regulator":
      return null; // no regulator is allocated by the compression-cycle scenario
  }
}

function Console({ role, onSwitchParty }: { readonly role: DemoRole; readonly onSwitchParty: () => void }) {
  const [activeNav, setActiveNav] = useState("console");
  const session = useDemoSession();
  const option = PARTY_OPTIONS.find((o) => o.role === role);
  const partyId = roleToPartyId(role, session);

  return (
    <TerminalShell
      partyLabel={option?.label ?? role}
      partyRole={option?.roleLabel ?? "Party"}
      onSwitchParty={onSwitchParty}
      navItems={NAV_ITEMS}
      activeNavId={activeNav}
      onSelectNav={setActiveNav}
      connection="connected"
      network={LEDGER_URL}
      cycleStatus="No cycle open"
    >
      {activeNav === "console" && <CompressionConsole />}
      {activeNav === "ledger" &&
        (partyId ? (
          <LedgerXRay party={partyId} partyLabel={option?.label ?? role} />
        ) : (
          <div className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
            Run a compression cycle from the Compression Console first — the X-ray
            reads this party&apos;s own live projection, which does not exist until a
            real party has been allocated.
          </div>
        ))}
      {activeNav === "matrix" &&
        (session.matrixParties ? (
          <PrivacyMatrixScoreboard parties={session.matrixParties} />
        ) : (
          <div className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
            Run the operator-blindness check from the Compression Console first —
            the matrix reads each real party&apos;s own live projection of that
            trade.
          </div>
        ))}
    </TerminalShell>
  );
}

export default function Home() {
  const [role, setRole] = useState<DemoRole | null>(null);

  return (
    <DemoSessionProvider>
      {role ? <Console role={role} onSwitchParty={() => setRole(null)} /> : <PartySelector onSelect={setRole} />}
    </DemoSessionProvider>
  );
}
