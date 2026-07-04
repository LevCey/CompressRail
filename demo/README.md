# demo

The CompressRail demo application. A party-selection entry followed by a
per-party terminal console — the Compression Console, the Ledger / X-ray view, and
the animated privacy-matrix scoreboard — each rendered from that party's own Canton
Ledger API projection.

## Design system

`src/components/shell/` is the dealer-terminal shell shared by this app and the
landing site: a dark theme with monospace numerics, a top demo/DevNet notice
banner, a party-identity header, a left sidebar, KPI cards, tabbed data tables, and
a sticky connection/cycle status bar. Design tokens live in `src/app/globals.css`.

The design is inspiration only from mature Canton dealer terminals — no third-party
code, assets, or copy are reused.

## Status

Party selection (R8.2), the Compression Console (R8.4), the Ledger / X-ray view
(R8.5), and the privacy-matrix scoreboard (R8.6) are wired to the live Canton ledger
through the sibling `app/` package (installed as a local `file:` dependency): the
"Run compression cycle" action drives the real off-ledger client against a running
sandbox, the "Run operator-blindness check" action writes a persistent encrypted
trade the matrix can read from, and the matrix fills cell-by-cell from real
per-party projection reads — never a hardcoded number or a simulated fill. Requires
a sandbox running at `NEXT_PUBLIC_LEDGER_URL` (defaults to `http://localhost:7575`;
see `../deploy`). Remaining: the "try to cheat" control and the live counter.

## Running

With a Canton sandbox running (`../deploy/sandbox.sh`):

```
npm install
npm run dev
```

Build and lint:

```
npm run build
npm run lint
```
