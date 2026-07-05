// The live counter (R8.8): "positions seen by the operator / other participants:
// 0" — read from the same real per-party projection counts the privacy matrix
// already computes, never a hardcoded "0" asserted in the UI. If the operator's
// count is ever non-zero, this renders that honestly instead of forcing a zero.
"use client";

import { useEffect, useState } from "react";
import { createDemoLedgerClient } from "@/lib/ledger";
import { computePrivacyMatrix } from "@compressrail/app/scenario/privacy-matrix";
import type { PrivacyMatrix, PrivacyMatrixParties } from "@compressrail/app/scenario/privacy-matrix";

export interface LiveCounterProps {
  readonly parties: PrivacyMatrixParties;
}

export function LiveCounter({ parties }: LiveCounterProps) {
  const key = `${parties.operator}-${parties.alice}-${parties.bob}`;
  return <LiveCounterForParties key={key} parties={parties} />;
}

function LiveCounterForParties({ parties }: LiveCounterProps) {
  const [matrix, setMatrix] = useState<PrivacyMatrix | null>(null);

  useEffect(() => {
    computePrivacyMatrix(createDemoLedgerClient(), parties).then(setMatrix).catch(() => setMatrix(null));
    // Runs once per mount; a new run remounts this component via the key above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!matrix) {
    return <p className="text-xs text-muted">Reading live projections…</p>;
  }

  const operatorSaw = matrix.operatorTradeCount;

  return (
    <div className="flex items-center gap-6 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex flex-col">
        <span className="text-xs text-muted">Positions seen by the operator</span>
        <span className={`font-mono text-xl font-semibold ${operatorSaw === 0 ? "text-accent-live" : "text-accent-alert"}`}>
          {operatorSaw}
        </span>
      </div>
      <div className="h-8 w-px bg-border" />
      <div className="flex flex-col">
        <span className="text-xs text-muted">Alice&apos;s / Bob&apos;s own trade count</span>
        <span className="font-mono text-xl font-semibold text-foreground">
          {matrix.aliceTradeCount} / {matrix.bobTradeCount}
        </span>
      </div>
    </div>
  );
}
