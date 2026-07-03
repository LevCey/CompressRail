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

Early scaffold: the shell renders with static preview data. Real per-party Ledger
API reads, the Compression Console, the X-ray, and the privacy-matrix scoreboard
land in following iterations.

## Running

```
npm install
npm run dev
```

Build and lint:

```
npm run build
npm run lint
```
