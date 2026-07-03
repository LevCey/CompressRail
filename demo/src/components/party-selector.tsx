// The party-selection entry (R8.2): the acting party is chosen, not assumed.
// Selecting a party opens a view scoped by that party's own Ledger API projection —
// nothing here decides what that party can see; Canton does.
"use client";

import { NoticeBanner } from "./shell/notice-banner";

export type DemoRole = "participant-a" | "participant-b" | "participant-c" | "operator" | "regulator";

export interface PartyOption {
  readonly role: DemoRole;
  readonly label: string;
  readonly roleLabel: string;
  readonly description: string;
}

export const PARTY_OPTIONS: readonly PartyOption[] = [
  {
    role: "participant-a",
    label: "Participant A",
    roleLabel: "Participant",
    description: "A derivatives counterparty holding bilateral trades.",
  },
  {
    role: "participant-b",
    label: "Participant B",
    roleLabel: "Participant",
    description: "A derivatives counterparty holding bilateral trades.",
  },
  {
    role: "participant-c",
    label: "Participant C",
    roleLabel: "Participant",
    description: "A derivatives counterparty holding bilateral trades.",
  },
  {
    role: "operator",
    label: "Operator",
    roleLabel: "Operator",
    description: "Coordinates the compression cycle. Sees ciphertext, commitments, and topology only.",
  },
  {
    role: "regulator",
    label: "Regulator (A)",
    roleLabel: "Regulator",
    description: "Scoped, read-only view of Participant A's own contracts only.",
  },
];

export interface PartySelectorProps {
  readonly onSelect: (role: DemoRole) => void;
}

export function PartySelector({ onSelect }: PartySelectorProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <NoticeBanner />
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="font-mono text-sm font-semibold tracking-tight text-muted">CompressRail</span>
          <h1 className="text-2xl font-semibold text-foreground">Act as…</h1>
          <p className="max-w-md text-sm text-muted">
            Each party sees only its own projection of the Canton ledger. Choose who
            you are acting as; nothing else changes what you can see.
          </p>
        </div>
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {PARTY_OPTIONS.map((option) => (
            <button
              key={option.role}
              type="button"
              onClick={() => onSelect(option.role)}
              className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4 text-left transition-colors hover:border-accent-action hover:bg-surface-raised"
            >
              <span className="font-mono text-[11px] uppercase tracking-wide text-accent-propose">
                {option.roleLabel}
              </span>
              <span className="text-sm font-medium text-foreground">{option.label}</span>
              <span className="text-xs text-muted">{option.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
