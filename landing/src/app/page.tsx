// The landing site (R8.9): hero, the precise privacy claim and its boundary,
// Live-Demo/Docs CTAs, and a terminal-style preview — in the shared dealer-terminal
// design language (R8.1). No third-party design, code, or copy is reused (D17).
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="border-b border-border bg-surface px-4 py-1.5 text-center text-xs text-muted">
        <span className="font-mono uppercase tracking-wide text-accent-propose">Demo</span>{" "}
        Canton DevNet — demo-grade authentication, no real funds, resets periodically.
      </div>

      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-mono text-sm font-semibold tracking-tight">CompressRail</span>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <a href="#privacy-boundary" className="hover:text-foreground">
            Privacy boundary
          </a>
          <a
            href="https://docs.compressrail.com"
            className="hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            Docs
          </a>
          <a
            href="https://demo.compressrail.com"
            className="rounded border border-border px-3 py-1.5 text-foreground transition-colors hover:border-accent-action"
            target="_blank"
            rel="noopener noreferrer"
          >
            Live demo
          </a>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 py-20">
        <div className="flex max-w-2xl flex-col items-center gap-6 text-center">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
            Multilateral OTC-derivatives compression on Canton where no party —
            <span className="text-accent-propose"> not even the operator</span> —
            ever sees another participant&apos;s book.
          </h1>
          <p className="text-sm text-muted sm:text-base">
            Counterparties tear up offsetting bilateral trades and atomically
            redistribute counterparty exposure. The operator coordinates the cycle
            without ever seeing any participant&apos;s positions, sensitivities, or
            trade terms.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://demo.compressrail.com"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-accent-action px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Live demo
            </a>
            <a
              href="https://docs.compressrail.com"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-border px-5 py-2.5 text-sm text-foreground transition-colors hover:border-accent-action"
            >
              Docs
            </a>
          </div>
        </div>

        {/* Terminal preview: a small static render of the demo's privacy-matrix
            scoreboard, in the shared design language — not a screenshot, and not a
            claim about a specific run; illustrative only. */}
        <div className="mt-16 w-full max-w-3xl overflow-hidden rounded-md border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-accent-alert" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent-propose" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent-live" />
            <span className="ml-2 font-mono text-xs text-muted">Privacy matrix — illustrative</span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                  Can see…
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted">
                  Participant A
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted">
                  Participant B
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted">
                  Operator
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted">
                  Regulator (A)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["A's economic terms", "yes", "no", "no", "scoped"],
                ["B's economic terms", "no", "yes", "no", "no"],
                ["Cycle topology and validity", "own legs", "own legs", "scoped", "no"],
              ].map(([label, a, b, op, reg]) => (
                <tr key={label}>
                  <td className="px-4 py-2 text-foreground">{label}</td>
                  <td className="px-4 py-2 text-center font-mono text-xs text-accent-live">{a}</td>
                  <td className="px-4 py-2 text-center font-mono text-xs text-muted">{b}</td>
                  <td className="px-4 py-2 text-center font-mono text-xs text-muted">{op}</td>
                  <td className="px-4 py-2 text-center font-mono text-xs text-accent-propose">{reg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section id="privacy-boundary" className="mt-20 flex max-w-2xl flex-col gap-4 text-sm">
          <h2 className="text-lg font-semibold text-foreground">
            What &quot;operator-blind&quot; means — precisely
          </h2>
          <p className="text-muted">
            The operator never sees a participant&apos;s cleartext economic
            terms — positions, sensitivities, notionals, or trade details. Two
            mechanisms enforce this together: the operator is never a signatory or
            observer on a position-bearing contract, and every economic field is
            written on-ledger only as authenticated-encryption ciphertext, with the
            operator holding no decryption key.
          </p>
          <p className="text-muted">
            <strong className="text-foreground">What this is not.</strong> The
            operator does see cycle topology — which participant pairs receive
            replacement legs. Hiding that as well requires multi-party computation
            and is on the roadmap, not in this build. This is not zero-knowledge,
            not fully homomorphic encryption, and not MPC. It does not make
            replacement trades legally enforceable, and it never takes custody of
            any asset.
          </p>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted">
        CompressRail — Apache-2.0 —{" "}
        <a
          href="https://github.com/LevCey/CompressRail"
          className="hover:text-foreground"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/LevCey/CompressRail
        </a>
      </footer>
    </div>
  );
}
