import Link from "next/link";

export const metadata = { title: "Overview" };

export default function Overview() {
  return (
    <>
      <h1>CompressRail</h1>
      <p>
        Confidential multilateral portfolio compression for OTC derivatives, built
        on the Canton Network.
      </p>
      <p>
        CompressRail lets a group of derivatives counterparties tear up offsetting
        bilateral trades and atomically redistribute counterparty exposure —
        without any party, including the operator that runs the cycle, ever seeing
        another participant&apos;s positions.
      </p>
      <blockquote>
        <strong>Status:</strong> early development. Runs on Canton DevNet. Not
        audited. Not for production use.
      </blockquote>

      <h2>The one claim</h2>
      <blockquote>
        The operator computed and committed a multilateral compression cycle
        without ever seeing a single position.
      </blockquote>
      <p>
        That sentence is the entire product. Everything else in this
        documentation exists to make it precise, falsifiable, and bounded.
      </p>

      <h2>The problem</h2>
      <p>
        Multilateral portfolio compression reduces the gross notional and the
        trapped initial margin sitting in offsetting OTC derivatives trades.
        Industry estimates put regulatory initial margin across non-cleared and
        cleared derivatives in the hundreds of billions of dollars, and the
        funding cost of carrying it runs into the billions per year.
      </p>
      <p>
        The mechanism that delivers compression carries a structural cost of its
        own. To find the offsetting cycle, every participant has to submit its trade
        population, valuations, risk values and tolerances to a central operator that
        computes the result — so that operator holds every participant&apos;s book.
        That is a documented property of how the services work, not an inference.
      </p>
      <p>
        Whether it is also what keeps firms away is a separate question, and one we do
        not claim to have answered: public sources do not attribute low participation
        to it, and buy-side and regional-bank participation in existing services is
        documented. What CompressRail removes is the requirement itself. Whether
        removing it changes who participates is the hypothesis being tested, not a
        result being reported.
      </p>

      <h2>What CompressRail does</h2>
      <p>
        CompressRail moves the trust boundary from the operator to the protocol.
        The operator coordinates a compression cycle but is architecturally
        unable to see any participant&apos;s economic terms. Each participant
        verifies, on its own node, that its post-cycle risk stays within its
        declared tolerance, and authorizes only its own legs. The whole
        multilateral rebalance commits atomically — every leg or none. A
        participant can grant its home regulator a read-only view scoped to that
        participant&apos;s contracts alone.
      </p>
      <p>
        Read <Link href="/privacy-model">Privacy model and boundary</Link> for the
        precise claim, then <Link href="/architecture">Architecture</Link> for how
        it is built, <Link href="/run-guide">Run guide</Link> to run it yourself,
        and <Link href="/demo-guide">Demo guide</Link> to see it live.
      </p>
    </>
  );
}
