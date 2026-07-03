// A small hook for running an async live-scenario call from a button and tracking
// its loading/result/error state, used by the Compression Console (R8.4) and the
// Ledger / X-ray view.
"use client";

import { useCallback, useState } from "react";

export type RunState<T> =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly result: T }
  | { readonly status: "error"; readonly message: string };

export function useLiveRun<T>(run: () => Promise<T>) {
  const [state, setState] = useState<RunState<T>>({ status: "idle" });

  const trigger = useCallback(() => {
    setState({ status: "running" });
    run()
      .then((result) => setState({ status: "done", result }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof Error ? err.message : String(err) }));
  }, [run]);

  return { state, trigger };
}
