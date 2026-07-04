// A small in-memory session for the demo (R7.3 — demo-grade, cleared on reload):
// once a live scenario has run, its real allocated party ids are shared across
// views (the console, the X-ray, the privacy matrix) so each can read that exact
// party's own live projection rather than a placeholder.
"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { CycleResult } from "@compressrail/app/scenario/cycle";
import type { PrivacyMatrixParties } from "@compressrail/app/scenario/privacy-matrix";

export interface DemoSession {
  readonly lastCycle: CycleResult | null;
  readonly setLastCycle: (result: CycleResult) => void;
  // The compression cycle in the fixture ring fully compresses, so every trade is
  // archived by the end of it — nothing is left to read for the matrix. The
  // operator-blindness scenario leaves a persistent trade instead, so its parties
  // are what the matrix view actually drives against.
  readonly matrixParties: PrivacyMatrixParties | null;
  readonly setMatrixParties: (parties: PrivacyMatrixParties) => void;
}

const DemoSessionContext = createContext<DemoSession | null>(null);

export function DemoSessionProvider({ children }: { readonly children: ReactNode }) {
  const [lastCycle, setLastCycle] = useState<CycleResult | null>(null);
  const [matrixParties, setMatrixParties] = useState<PrivacyMatrixParties | null>(null);
  const value = useMemo(
    () => ({ lastCycle, setLastCycle, matrixParties, setMatrixParties }),
    [lastCycle, matrixParties],
  );
  return <DemoSessionContext.Provider value={value}>{children}</DemoSessionContext.Provider>;
}

export function useDemoSession(): DemoSession {
  const ctx = useContext(DemoSessionContext);
  if (!ctx) throw new Error("useDemoSession must be used within DemoSessionProvider");
  return ctx;
}
