"use client";

import { useEffect, useState } from "react";
import { TerminalShell } from "@/components/shell";
import type { ConnectionState } from "@/components/shell/status-bar";
import { PartySelector, PARTY_OPTIONS, type DemoRole } from "@/components/party-selector";
import { CompressionConsole } from "@/components/compression-console";
import { LedgerXRay } from "@/components/ledger-xray";
import { PrivacyMatrixScoreboard } from "@/components/privacy-matrix-scoreboard";
import { TryToCheat } from "@/components/try-to-cheat";
import { LiveCounter } from "@/components/live-counter";
import { DemoSessionProvider, useDemoSession } from "@/lib/demo-session";
import { createDemoLedgerClient } from "@/lib/ledger";

const NAV_ITEMS = [
  { id: "console", label: "Compression Console" },
  { id: "ledger", label: "Ledger / X-ray" },
  { id: "matrix", label: "Privacy matrix" },
];

function roleToPartyId(role: DemoRole, session: ReturnType<typeof useDemoSession>): string | null {
  // The regulator's scoped view comes from the operator-blindness / disclosure
  // scenario, which allocates a regulator and discloses Participant A's trade to it —
  // not from the compression cycle (which fully compresses and leaves nothing).
  if (role === "regulator") return session.matrixParties?.regulator ?? null;
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
  }
}

function Console({ role, onSwitchParty }: { readonly role: DemoRole; readonly onSwitchParty: () => void }) {
  const [activeNav, setActiveNav] = useState("console");
  const session = useDemoSession();
  const option = PARTY_OPTIONS.find((o) => o.role === role);
  const partyId = roleToPartyId(role, session);

  // The status bar is measured, not asserted: probe the live ledger for a version on
  // mount and periodically, so a real outage shows as disconnected rather than a
  // hardcoded "connected".
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [ledgerVersion, setLedgerVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const v = await createDemoLedgerClient().version();
        if (!cancelled) {
          setLedgerVersion(v);
          setConnection("connected");
        }
      } catch {
        if (!cancelled) setConnection("disconnected");
      }
    };
    void probe();
    const id = setInterval(() => void probe(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const network = ledgerVersion ? `Canton DevNet · Ledger API ${ledgerVersion}` : "Canton DevNet";
  const cycleStatus = session.lastCycle
    ? `Cycle executed — ${session.lastCycle.replacementLegCount} replacement legs`
    : "No cycle open";

  return (
    <TerminalShell
      partyLabel={option?.label ?? role}
      partyRole={option?.roleLabel ?? "Party"}
      onSwitchParty={onSwitchParty}
      navItems={NAV_ITEMS}
      activeNavId={activeNav}
      onSelectNav={setActiveNav}
      connection={connection}
      network={network}
      cycleStatus={cycleStatus}
    >
      {session.matrixParties && (
        <div className="mb-4">
          <LiveCounter parties={session.matrixParties} />
        </div>
      )}
      {activeNav === "console" && <CompressionConsole />}
      {activeNav === "ledger" &&
        (partyId ? (
          <div className="flex flex-col gap-4">
            <LedgerXRay party={partyId} partyLabel={option?.label ?? role} />
            {role === "operator" && <TryToCheat operator={partyId} />}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
            {role === "regulator" ? (
              <>
                Run the operator-blindness check from the Compression Console
                first — the regulator&apos;s scoped view exists once Participant A
                discloses a trade to it, and reads the regulator&apos;s own live
                projection.
              </>
            ) : (
              <>
                Run a compression cycle from the Compression Console first — the
                X-ray reads this party&apos;s own live projection, which does not
                exist until a real party has been allocated.
              </>
            )}
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
