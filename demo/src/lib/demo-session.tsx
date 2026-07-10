// A small in-memory session for the demo (R7.3 — demo-grade, cleared on tab close):
// once a live scenario has run, its real allocated party ids are shared across views
// (the console, the X-ray, the privacy matrix) so each can read that exact party's
// own live projection rather than a placeholder.
//
// On cold load it auto-seeds once: it writes a small persistent book (A–B disclosed
// to Alice's regulator, plus B–C) so every party role has real content at first
// paint, with zero clicks. The seed's party ids are persisted (version-stamped) in
// sessionStorage so a reload repopulates instantly instead of re-seeding; the stored
// ids are validated with one cheap read on load, and on any failure (DevNet reset,
// party gone, parse/schema mismatch) the storage is silently cleared and the seed
// re-runs — a judge only ever sees the normal seeding state, never a broken restore.
// Only party ids are persisted; the demo-grade session keys are held in memory.
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CycleResult } from "@compressrail/app/scenario/cycle";
import { runOperatorBlindnessScenario, type BlindnessResult } from "@compressrail/app/scenario/blindness";
import type { PrivacyMatrixParties } from "@compressrail/app/scenario/privacy-matrix";
import { TEMPLATES } from "@compressrail/app/model";
import { createDemoLedgerClient } from "./ledger";

export type SeedStatus = "restoring" | "seeding" | "ready" | "error";

export interface DemoSession {
  readonly lastCycle: CycleResult | null;
  readonly setLastCycle: (result: CycleResult) => void;
  // The seed scenario leaves a persistent book, so its parties are what the matrix,
  // the X-ray, and the counter drive against.
  readonly matrixParties: PrivacyMatrixParties | null;
  readonly setMatrixParties: (parties: PrivacyMatrixParties) => void;
  readonly seedStatus: SeedStatus;
  // In-session decryption material from the seed, for the blotter. Memory only; null
  // after a restore (party ids are persisted, keys are not) — the blotter then falls
  // back to showing ciphertext.
  readonly seedSecrets: BlindnessResult["secrets"] | null;
  readonly reseed: () => void;
}

const DemoSessionContext = createContext<DemoSession | null>(null);

const SEED_KEY = "compressrail.seed.v1";

interface StoredSeed {
  readonly v: 1;
  readonly parties: PrivacyMatrixParties;
}

function loadStoredSeed(): PrivacyMatrixParties | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSeed>;
    if (parsed?.v !== 1 || typeof parsed.parties?.alice !== "string") return null;
    return parsed.parties;
  } catch {
    return null;
  }
}

function saveStoredSeed(parties: PrivacyMatrixParties): void {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify({ v: 1, parties } satisfies StoredSeed));
  } catch {
    // sessionStorage unavailable (private mode/quota) — the demo still works, it just
    // re-seeds on the next load.
  }
}

function clearStoredSeed(): void {
  try {
    sessionStorage.removeItem(SEED_KEY);
  } catch {
    // ignore
  }
}

export function DemoSessionProvider({ children }: { readonly children: ReactNode }) {
  const [lastCycle, setLastCycle] = useState<CycleResult | null>(null);
  const [matrixParties, setMatrixParties] = useState<PrivacyMatrixParties | null>(null);
  const [seedStatus, setSeedStatus] = useState<SeedStatus>("restoring");
  const [seedSecrets, setSeedSecrets] = useState<BlindnessResult["secrets"] | null>(null);
  const [reseedNonce, setReseedNonce] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    void (async () => {
      // 1. Try to restore a persisted seed, validated by one cheap live read.
      const stored = loadStoredSeed();
      if (stored) {
        try {
          const acs = await createDemoLedgerClient().activeContracts(stored.alice, { templateIds: [TEMPLATES.BilateralTrade] });
          if (acs.length > 0) {
            if (!cancelled) {
              setMatrixParties(stored);
              setSeedStatus("ready");
            }
            return;
          }
          clearStoredSeed(); // party gone or empty — fall through to re-seed
        } catch {
          clearStoredSeed(); // DevNet reset / invalid party — re-seed
        }
      }

      // 2. Seed a fresh book.
      if (cancelled) return;
      setSeedStatus("seeding");
      try {
        const result = await runOperatorBlindnessScenario(createDemoLedgerClient());
        if (cancelled) return;
        saveStoredSeed(result.parties);
        setMatrixParties(result.parties);
        setSeedSecrets(result.secrets);
        setSeedStatus("ready");
      } catch {
        if (!cancelled) setSeedStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reseedNonce]);

  const reseed = useCallback(() => {
    started.current = false;
    clearStoredSeed();
    setMatrixParties(null);
    setSeedSecrets(null);
    setSeedStatus("restoring");
    setReseedNonce((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ lastCycle, setLastCycle, matrixParties, setMatrixParties, seedStatus, seedSecrets, reseed }),
    [lastCycle, matrixParties, seedStatus, seedSecrets, reseed],
  );
  return <DemoSessionContext.Provider value={value}>{children}</DemoSessionContext.Provider>;
}

export function useDemoSession(): DemoSession {
  const ctx = useContext(DemoSessionContext);
  if (!ctx) throw new Error("useDemoSession must be used within DemoSessionProvider");
  return ctx;
}
