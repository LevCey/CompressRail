// TerminalShell (R8.1): the layout reused by every party console — notice banner,
// party-identity header, left sidebar nav, main content, sticky status bar.
"use client";

import type { ReactNode } from "react";
import { NoticeBanner } from "./notice-banner";
import { PartyHeader } from "./party-header";
import { Sidebar, type SidebarItem } from "./sidebar";
import { StatusBar, type ConnectionState } from "./status-bar";

export interface TerminalShellProps {
  readonly partyLabel: string;
  readonly partyRole: string;
  readonly partyId?: string | null;
  readonly onSwitchParty?: () => void;
  readonly navItems: readonly SidebarItem[];
  readonly activeNavId: string;
  readonly onSelectNav: (id: string) => void;
  readonly connection: ConnectionState;
  readonly network: string;
  readonly cycleStatus: string;
  readonly children: ReactNode;
}

export function TerminalShell({
  partyLabel,
  partyRole,
  partyId,
  onSwitchParty,
  navItems,
  activeNavId,
  onSelectNav,
  connection,
  network,
  cycleStatus,
  children,
}: TerminalShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <NoticeBanner />
      <PartyHeader partyLabel={partyLabel} partyRole={partyRole} partyId={partyId} onSwitchParty={onSwitchParty} />
      <div className="flex flex-1">
        <Sidebar items={navItems} activeId={activeNavId} onSelect={onSelectNav} />
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
      <StatusBar connection={connection} network={network} cycleStatus={cycleStatus} />
    </div>
  );
}
