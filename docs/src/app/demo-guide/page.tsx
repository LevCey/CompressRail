export const metadata = { title: "Demo guide" };

export default function DemoGuide() {
  return (
    <>
      <h1>Demo guide</h1>

      <h2>Cold load — auto-seed</h2>
      <p>
        On first load the demo seeds a small live book against Canton DevNet with
        zero clicks: an A–B bilateral trade (which Participant A discloses to her
        home regulator) and a separate B–C trade. It shows an honest seeding line
        while the real transactions land (~15–30 s), then every party role has real
        content to show. The seed&apos;s party ids are persisted per-tab so a reload
        repopulates instantly; if the stored ids no longer validate against the
        ledger (for example after a DevNet reset), the demo silently re-seeds.
      </p>

      <h2>Party selection</h2>
      <p>
        Choosing a party opens a view scoped by that party&apos;s own Ledger API
        projection. Available roles: Participant A, Participant B, Participant C,
        Operator, and Regulator (A). Nothing about which party you act as changes
        what the interface shows you — it only changes which party&apos;s own
        projection is being read. The header shows the real allocated party id, with
        a copy control.
      </p>

      <h2>Compression Console</h2>
      <p>
        The result KPIs lead with what the cycle accomplished — <strong>trades torn
        up</strong>, the <strong>compression ratio</strong> (e.g. 3 → 0 legs, 100%),
        and <strong>positions seen by the operator: 0</strong> — rather than a wall
        of zeros.
      </p>
      <p>
        The main action, <strong>Run compression cycle</strong>, drives the real
        off-ledger client against the live ledger and stages the run as a live step
        timeline: each step appears as its real ledger operation completes —
        allocating parties, writing three encrypted trades, the real matching
        result, the operator opening the cycle, each participant verifying its own
        post-cycle risk within tolerance, the atomic execute, and the settled
        after-state. The DevNet latency becomes the proof that every step is a real
        transaction, not dead air. When it finishes, a prompt jumps you straight to
        the operator&apos;s view — the operator coordinated the whole cycle; see what
        it saw, and try to read a book yourself.
      </p>
      <p>
        A second action, <strong>Run operator-blindness check</strong>, re-runs the
        seed — the persistent A–B and B–C trades the privacy matrix, the blotter, and
        the &quot;try to cheat&quot; control read from.
      </p>

      <h2>Trade blotter</h2>
      <p>
        The acting party&apos;s own bilateral trades, read from its live projection:
        trade ref, counterparty, terms, commitment, status. Where this session holds
        the party&apos;s key, the terms cell shows the real decrypted economics
        (instrument and notional); where it does not, it shows the real on-ledger
        ciphertext, truncated and labeled as such — never a simulated redaction. The
        operator&apos;s blotter is empty: it holds no book, the honest message. A
        gross-notional figure is shown only over trades this session can actually
        decrypt.
      </p>

      <h2>Compression ring</h2>
      <p>
        A native before/after diagram of the fixture ring: three nodes (A, B, C) with
        the gross ring edges before the cycle, and the replacement topology after —
        for this fixture, zero legs, i.e. three bilateral trades fully compressed.
        The three-node shape is fixed (the fixture is deterministic), but the edge
        counts come from the real matching result, not constants.
      </p>

      <h2>Ledger / X-ray</h2>
      <p>
        The acting party&apos;s own ledger activity feed, loaded automatically: every
        CREATE and ARCHIVE event in that party&apos;s projection, in order, with a
        contract-detail drawer and an &quot;N events · Live&quot; badge of the real
        event count. Every economic field renders exactly as it exists on-ledger —
        ciphertext, never a simulated redaction.
      </p>

      <h2>&quot;Try to cheat&quot;</h2>
      <p>
        Available when acting as the Operator (on the Ledger tab, and one click from
        the cycle&apos;s finale prompt). This genuinely attempts, as the operator, to
        read and decrypt a participant&apos;s trade from the operator&apos;s own
        ledger view. It reads the operator&apos;s real projection — empty by
        construction — and reports the real outcome: the attempt fails because there
        is no trade in the operator&apos;s own view to open.
      </p>

      <h2>Privacy matrix</h2>
      <p>
        Fills in cell by cell as each underlying live projection read resolves. Each
        cell is computed from a real read of that party&apos;s own active-contract
        set — the same table published in the{" "}
        <a href="/privacy-model">privacy model</a> page, made runnable and
        falsifiable. Because the seed discloses A–B to the regulator but leaves B–C
        undisclosed, the regulator column is a measured result: it sees A&apos;s
        terms (scoped) and genuinely does not see B&apos;s separate B–C trade.
      </p>

      <h2>Live counter</h2>
      <p>
        &quot;Positions seen by the operator&quot; and each counterparty&apos;s own
        trade count, read live rather than asserted as zero.
      </p>
    </>
  );
}
