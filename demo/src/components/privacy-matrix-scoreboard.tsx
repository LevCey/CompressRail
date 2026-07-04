// The privacy-matrix scoreboard (R8.6): the same claim restated natively in the
// public README's privacy-matrix table (D14), made runnable. Cells fill in one at a
// time as each underlying live projection read resolves — the fill order and the
// values are projection-driven, never hardcoded. A regulator cell some scenarios
// cannot yet measure renders honestly as "n/a" rather than a fabricated "no".
"use client";

import { useEffect, useState } from "react";
import { createDemoLedgerClient } from "@/lib/ledger";
import { computePrivacyMatrix } from "@compressrail/app/scenario/privacy-matrix";
import type { PrivacyMatrix, PrivacyMatrixParties, Visibility } from "@compressrail/app/scenario/privacy-matrix";

export interface PrivacyMatrixScoreboardProps {
  readonly parties: PrivacyMatrixParties;
}

const VISIBILITY_LABEL: Record<Visibility, string> = {
  yes: "yes",
  no: "no",
  scoped: "scoped",
  unknown: "n/a",
};

const VISIBILITY_CLASS: Record<Visibility, string> = {
  yes: "text-accent-live",
  no: "text-muted",
  scoped: "text-accent-propose",
  unknown: "text-border",
};

const COLUMNS = ["participantA", "participantB", "operator", "regulator"] as const;
const COLUMN_LABEL: Record<(typeof COLUMNS)[number], string> = {
  participantA: "Participant A",
  participantB: "Participant B",
  operator: "Operator",
  regulator: "Regulator (A)",
};

export function PrivacyMatrixScoreboard({ parties }: PrivacyMatrixScoreboardProps) {
  // Keying by the party ids makes a genuinely new run remount this component
  // fresh — React resets all state naturally, with no manual reset call inside an
  // effect.
  const key = `${parties.operator}-${parties.alice}-${parties.bob}`;
  return <ScoreboardForParties key={key} parties={parties} />;
}

function ScoreboardForParties({ parties }: PrivacyMatrixScoreboardProps) {
  const [matrix, setMatrix] = useState<PrivacyMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cells reveal one at a time, in row-major order, once the underlying data has
  // actually arrived — this animates the fill without inventing intermediate values.
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    computePrivacyMatrix(createDemoLedgerClient(), parties)
      .then(setMatrix)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // Runs once per mount; a new run remounts this component via the key above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!matrix) return;
    const total = matrix.rows.length * COLUMNS.length;
    if (revealed >= total) return;
    const timer = setTimeout(() => setRevealed((n) => n + 1), 120);
    return () => clearTimeout(timer);
  }, [matrix, revealed]);

  if (error) {
    return (
      <p className="rounded border border-accent-alert/40 bg-accent-alert/10 px-3 py-2 text-xs text-accent-alert">
        {error}
      </p>
    );
  }

  if (!matrix) {
    return <p className="text-xs text-muted">Reading each party&apos;s own projection…</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
              Can see…
            </th>
            {COLUMNS.map((col) => (
              <th key={col} className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted">
                {COLUMN_LABEL[col]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {matrix.rows.map((row, rowIndex) => (
            <tr key={row.label}>
              <td className="px-4 py-2 text-sm text-foreground">{row.label}</td>
              {COLUMNS.map((col, colIndex) => {
                const cellIndex = rowIndex * COLUMNS.length + colIndex;
                const value = row[col];
                const shown = cellIndex < revealed;
                return (
                  <td key={col} className="px-4 py-2 text-center">
                    {shown ? (
                      <span className={`font-mono text-xs font-semibold ${VISIBILITY_CLASS[value]}`}>
                        {VISIBILITY_LABEL[value]}
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-border">···</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-4 py-2 text-xs text-muted">
        Every cell is read from that party&apos;s own live ledger projection —{" "}
        <span className="font-mono text-foreground">{matrix.operatorTradeCount}</span> bilateral trades in
        the operator&apos;s own view.
      </p>
    </div>
  );
}
