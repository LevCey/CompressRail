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
import { DemoSessionProvider, useDemoSession, type SeedStatus } from "@/lib/demo-session";
import { createDemoLedgerClient } from "@/lib/ledger";

const NAV_ITEMS = [
  { id: "console", label: "Compression Console" },
  { id: "ledger", label: "Ledger / X-ray" },
  { id: "matrix", label: "Privacy matrix" },
];

function roleToPartyId(role: DemoRole, session: ReturnType<typeof useDemoSession>): string | null {
  // After a compression cycle its (post-cycle) parties take precedence; otherwise the
  // cold-load seed populates every role. The regulator only exists in the seed (the
  // cycle allocates none).
  const cycle = session.lastCycle;
  const seed = session.matrixParties;
  switch (role) {
    case "participant-a":
      return cycle?.parties.alice ?? seed?.alice ?? null;
    case "participant-b":
      return cycle?.parties.bob ?? seed?.bob ?? null;
    case "participant-c":
      return cycle?.parties.carol ?? seed?.carol ?? null;
    case "operator":
      return cycle?.parties.operator ?? seed?.operator ?? null;
    case "regulator":
      return seed?.regulator ?? null;
  }
}

function SeedBanner({ status, onRetry }: { readonly status: SeedStatus; readonly onRetry: () => void }) {
  if (status === "error") {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-accent-alert/40 bg-accent-alert/10 px-4 py-3 text-xs text-accent-alert">
        <span>Couldn&apos;t seed a live book on Canton DevNet — the ledger may be briefly unavailable.</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-accent-alert/50 px-2 py-1 font-medium text-accent-alert transition-colors hover:bg-accent-alert/20"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-3 text-xs text-muted">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-propose" />
      <span>Seeding a live encrypted book on Canton DevNet — real transactions, about 15–30 seconds…</span>
    </div>
  );
}

function Console({
  role,
  activeNav,
  onSelectNav,
  onSwitchParty,
  onActAsOperator,
}: {
  readonly role: DemoRole;
  readonly activeNav: string;
  readonly onSelectNav: (id: string) => void;
  readonly onSwitchParty: () => void;
  readonly onActAsOperator: () => void;
}) {
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
      onSelectNav={onSelectNav}
      connection={connection}
      network={network}
      cycleStatus={cycleStatus}
    >
      {session.matrixParties ? (
        <div className="mb-4">
          <LiveCounter parties={session.matrixParties} />
        </div>
      ) : (
        <SeedBanner status={session.seedStatus} onRetry={session.reseed} />
      )}
      {activeNav === "console" && <CompressionConsole onActAsOperator={onActAsOperator} />}
      {activeNav === "ledger" &&
        (partyId ? (
          <div className="flex flex-col gap-4">
            <LedgerXRay party={partyId} partyLabel={option?.label ?? role} />
            {role === "operator" && <TryToCheat operator={partyId} />}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
            This party&apos;s live projection populates from the seed above — its own
            CREATE/ARCHIVE events, with every economic field as real on-ledger
            ciphertext.
          </div>
        ))}
      {activeNav === "matrix" &&
        (session.matrixParties ? (
          <PrivacyMatrixScoreboard parties={session.matrixParties} />
        ) : (
          <div className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
            The privacy matrix populates from the seed above — each cell read from
            that party&apos;s own live projection.
          </div>
        ))}
    </TerminalShell>
  );
}

export default function Home() {
  const [role, setRole] = useState<DemoRole | null>(null);
  const [activeNav, setActiveNav] = useState("console");

  return (
    <DemoSessionProvider>
      {role ? (
        <Console
          role={role}
          activeNav={activeNav}
          onSelectNav={setActiveNav}
          onSwitchParty={() => setRole(null)}
          onActAsOperator={() => {
            setRole("operator");
            setActiveNav("ledger");
          }}
        />
      ) : (
        <PartySelector
          onSelect={(r) => {
            setRole(r);
            setActiveNav("console");
          }}
        />
      )}
    </DemoSessionProvider>
  );
}
