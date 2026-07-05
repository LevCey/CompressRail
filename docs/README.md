# docs

Native public documentation for CompressRail: overview, privacy model and
boundary, architecture, run guide, and demo guide. Never a mirror or sync of any
private specification (D14) — every page here is authored for this public
audience.

## Design system

Reuses the same dealer-terminal design tokens as `../demo` and `../landing`
(`src/app/globals.css`), plus a small prose stylesheet for long-form content. A
role-based sidebar and a client-side search (a substring match over
`src/lib/pages.ts` — no external search service) round out the shell (R8.10).

## Pages

- **Overview** (`/`) — what CompressRail is and the one claim.
- **Privacy model and boundary** (`/privacy-model`) — the exact claim boundary and
  the privacy matrix.
- **Architecture** (`/architecture`) — the Daml model, the off-ledger client, the
  demo, and scope.
- **Run guide** (`/run-guide`) — build, sandbox, tests, demo.
- **Demo guide** (`/demo-guide`) — what each part of the demo does.

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
