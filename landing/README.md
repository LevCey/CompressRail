# landing

The CompressRail landing site. A single hero page: the operator-blind one-liner,
the precise privacy claim and its exact boundary, Live-Demo / Docs calls to action,
and an illustrative terminal preview of the privacy-matrix scoreboard.

## Design system

Reuses the same dealer-terminal design tokens as `../demo` (`src/app/globals.css`):
a dark theme with monospace numerics and signed accent colors. The design is
inspiration only from mature Canton dealer terminals — no third-party code, assets,
or copy are reused.

## Claim boundary

The page states plainly what "operator-blind" does and does not mean: the operator
never sees cleartext economic terms, but it does see cycle topology; this is not
zero-knowledge, homomorphic encryption, or MPC; it makes no claim about legal
enforceability or custody.

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
