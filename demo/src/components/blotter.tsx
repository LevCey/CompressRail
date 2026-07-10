// The trade blotter (demo-density Item 2): the acting party's own bilateral trades,
// read from its own live Canton projection. The TERMS cell shows real decrypted
// economics where this session holds the party's key and the trade's wrapped content
// key (from the seed, in memory); otherwise it shows the real on-ledger ciphertext,
// truncated and labeled — never a simulated redaction. The operator's projection is
// empty by construction, which is the honest message: it holds no book.
"use client";

import { useCallback, useEffect } from "react";
import { useLiveRun } from "@/lib/use-live-run";
import { createDemoLedgerClient } from "@/lib/ledger";
import { useDemoSession } from "@/lib/demo-session";
import { TEMPLATES, decodeBilateralTrade } from "@compressrail/app/model";
import { openLeg } from "@compressrail/app/crypto";

const short = (s: string, n = 12): string => (s.length > n ? `${s.slice(0, n)}…` : s);

interface BlotterRow {
  readonly tradeRef: string;
  readonly counterparty: string;
  readonly terms: string;
  readonly decrypted: boolean;
  readonly commitment: string;
}

interface BlotterData {
  readonly rows: readonly BlotterRow[];
  readonly grossNotional: number | null; // summed over decryptable rows; null if none
}

export function Blotter({ party, partyLabel }: { readonly party: string; readonly partyLabel: string }) {
  const { seedSecrets } = useDemoSession();

  const load = useCallback(async (): Promise<BlotterData> => {
    const acs = await createDemoLedgerClient().activeContracts(party, { templateIds: [TEMPLATES.BilateralTrade] });
    const rows: BlotterRow[] = [];
    let gross = 0;
    let anyDecrypted = false;
    for (const c of acs) {
      const t = decodeBilateralTrade(c.createArgument);
      const counterparty = t.cptyA === party ? t.cptyB : t.cptyA;
      const keyPair = seedSecrets?.keys[party];
      const wrapped = seedSecrets?.wrappedByRef[t.tradeRef];
      let terms = short(t.terms, 18);
      let decrypted = false;
      if (keyPair && wrapped) {
        try {
          const opened = (await openLeg(
            { ciphertext: t.terms, commitment: t.commitment, wrappedKeys: wrapped },
            party,
            keyPair,
          )) as Record<string, unknown>;
          const notional = Number(opened["notional"]) || 0;
          terms = `${String(opened["instrument"] ?? "?")} · $${(notional / 1_000_000).toFixed(0)}M`;
          decrypted = true;
          gross += notional;
          anyDecrypted = true;
        } catch {
          // keep the ciphertext view
        }
      }
      rows.push({ tradeRef: t.tradeRef, counterparty, terms, decrypted, commitment: t.commitment });
    }
    return { rows, grossNotional: anyDecrypted ? gross : null };
  }, [party, seedSecrets]);

  const { state, trigger } = useLiveRun<BlotterData>(load);
  useEffect(() => {
    trigger();
  }, [trigger]);

  const data = state.status === "done" ? state.result : undefined;

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Trade blotter — {partyLabel}</h2>
          <p className="text-xs text-muted">
            This party&apos;s own bilateral trades, read from its live projection. Terms
            are decrypted where this session holds the party&apos;s key, otherwise shown
            as the real on-ledger ciphertext.
          </p>
        </div>
        {data?.grossNotional != null && (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-xs text-muted">Gross notional (decryptable)</span>
            <span className="font-mono text-lg font-semibold text-foreground">
              ${(data.grossNotional / 1_000_000).toFixed(0)}M
            </span>
          </div>
        )}
      </div>

      {state.status === "running" && <p className="p-4 text-xs text-muted">Reading this party&apos;s projection…</p>}
      {state.status === "error" && (
        <p className="m-4 rounded border border-accent-alert/40 bg-accent-alert/10 px-3 py-2 text-xs text-accent-alert">
          {state.message}
        </p>
      )}
      {data && data.rows.length === 0 && (
        <p className="p-4 text-xs text-muted">
          No trades in this party&apos;s projection — a stakeholder of nothing. This is the
          operator&apos;s view: it coordinates cycles but holds no book.
        </p>
      )}
      {data && data.rows.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Trade ref</th>
              <th className="px-4 py-2 font-medium">Counterparty</th>
              <th className="px-4 py-2 font-medium">Terms</th>
              <th className="px-4 py-2 font-medium">Commitment</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((r) => (
              <tr key={r.tradeRef}>
                <td className="px-4 py-2 font-mono text-xs text-foreground">{r.tradeRef}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-muted">{short(r.counterparty, 14)}</td>
                <td className="px-4 py-2 font-mono text-xs">
                  <span className={r.decrypted ? "text-foreground" : "text-muted"}>{r.terms}</span>
                  {!r.decrypted && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-border">ciphertext</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-[11px] text-muted">{short(r.commitment, 10)}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-accent-live">ACTIVE</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
