// Client-side access to the live Canton ledger, via the app package's own client.
// The base URL is configuration (NEXT_PUBLIC_LEDGER_URL), never hard-coded (R2.3 /
// X.5); this demo targets an unauthenticated local sandbox (R7.3 — demo-grade,
// disclosed in the NoticeBanner). Nothing here holds a key that can decrypt a
// participant's payload beyond what a party's own generated key pair unwraps for
// itself in the browser session.
"use client";

import { fetchTransport, retryingTransport, LedgerClient } from "@compressrail/app/ledger";

export const LEDGER_URL = process.env.NEXT_PUBLIC_LEDGER_URL ?? "http://localhost:7575";

export function createDemoLedgerClient(): LedgerClient {
  // The DevNet participant intermittently returns 503 (backpressure) on party
  // allocation; a bounded retry keeps a live cycle from failing on a transient blip.
  return new LedgerClient({ transport: retryingTransport(fetchTransport(LEDGER_URL)), token: "" });
}
