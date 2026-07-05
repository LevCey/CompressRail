export const metadata = { title: "Demo guide" };

export default function DemoGuide() {
  return (
    <>
      <h1>Demo guide</h1>

      <h2>Party selection</h2>
      <p>
        Choosing a party opens a view scoped by that party&apos;s own Ledger API
        projection. Available roles: Participant A, Participant B, Participant
        C, Operator, and Regulator (A). Nothing about which party you act as
        changes what the interface shows you — it only changes which
        party&apos;s own projection is being read.
      </p>

      <h2>Compression Console</h2>
      <p>
        The main action, <strong>Run compression cycle</strong>, drives the real
        off-ledger client against the live ledger: it writes an offsetting
        three-party ring of encrypted bilateral trades, runs the real matching
        algorithm to compute the teardown and replacement topology, has each
        participant run its real per-node risk check before committing,
        discloses the nominated trades for the operator&apos;s execute, and
        reports what the ledger actually returns — the replacement-leg count,
        the operator&apos;s own trade count, and each participant&apos;s
        post-cycle trade count.
      </p>
      <p>
        A second action, <strong>Run operator-blindness check</strong>, writes a
        single persistent encrypted trade between two participants. Because the
        compression cycle&apos;s offsetting ring fully compresses (nothing is
        left to read once it completes), this second, persistent trade is what
        feeds the privacy matrix and the &quot;try to cheat&quot; control below.
      </p>

      <h2>Ledger / X-ray</h2>
      <p>
        Switch to the acting party&apos;s own ledger activity feed: every CREATE
        and ARCHIVE event in that party&apos;s projection, in order, with a
        contract-detail drawer. Every economic field renders exactly as it
        exists on-ledger — ciphertext, never a simulated redaction.
      </p>

      <h2>&quot;Try to cheat&quot;</h2>
      <p>
        Visible when acting as the Operator, on the Ledger tab. This genuinely
        attempts, as the operator, to read and decrypt a participant&apos;s
        trade from the operator&apos;s own ledger view. It reads the
        operator&apos;s real projection — empty by construction — and reports
        the real outcome: the attempt fails because there is no trade in the
        operator&apos;s own view to open.
      </p>

      <h2>Privacy matrix</h2>
      <p>
        Fills in cell by cell as each underlying live projection read resolves.
        Each cell is computed from a real read of that party&apos;s own
        active-contract set — the same table published in the{" "}
        <a href="/privacy-model">privacy model</a> page, made runnable and
        falsifiable. A cell the running scenario has no basis to measure (for
        example, a regulator row when no regulator was allocated) shows
        honestly as &quot;n/a&quot; rather than a guessed value.
      </p>

      <h2>Live counter</h2>
      <p>
        &quot;Positions seen by the operator&quot; and each counterparty&apos;s
        own trade count, read live rather than asserted as zero.
      </p>
    </>
  );
}
