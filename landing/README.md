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
cannot read economic terms, but it and every invited firm receive the cycle's
transaction metadata (counterparties and ciphertext), and amounts can be inferred
from a firm's own trades and the outcome; this is not
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
