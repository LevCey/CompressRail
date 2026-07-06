export const metadata = { title: "Architecture" };

export default function Architecture() {
  return (
    <>
      <h1>Architecture</h1>

      <h2>Repository layout</h2>
      <pre>{`daml/      Daml model: participant profiles, bilateral trades, cycle proposal and
           participation, the atomic execute, and selective disclosure
app/       Off-ledger client: payload encryption, commitments, per-node verification,
           the matching stand-in, the Ledger API client, and typed model bindings
demo/      Demo application: party selection and the per-party views, each rendered
           from that party's own ledger projection
landing/   Landing site
docs/      This documentation site
deploy/    Local Canton sandbox script and topology notes`}</pre>

      <h2>The Daml model (daml/)</h2>
      <p>
        The on-ledger contracts hold only commitments, ciphertext, topology, and
        boolean attestations — never cleartext economics.
      </p>
      <ul>
        <li>
          <strong>ParticipantProfile</strong> — signatory: the participant;
          optional observer: that participant&apos;s regulator, granted only
          through disclosure. Carries an encrypted sensitivity commitment.
        </li>
        <li>
          <strong>BilateralTrade</strong> — signatories: the two counterparties
          only. Carries the trade&apos;s economic terms as ciphertext plus a hash
          commitment. No operator party is ever a stakeholder. A
          NominateIntoCycle choice can mark a trade eligible for a cycle by
          reference without revealing terms — modeled, though the current live
          flow references the teardown trades directly by contract id.
        </li>
        <li>
          <strong>CompressionCycle</strong> — an accumulating contract. It starts
          signed only by the operator (carrying no economics); each invited
          participant exercises Commit, which recreates the cycle adding that
          participant to the signatory set along with its replacement-leg
          commitments and a withinTolerance boolean. Once every participant has
          committed, the operator exercises Execute: in one transaction it
          archives the nominated trades and creates the replacement legs, each
          signed only by its two counterparties. This composition is required
          because a Daml choice&apos;s authority does not accumulate across
          separate exercises — the accumulating contract is what lets one atomic
          transaction carry every participant&apos;s authority.
        </li>
        <li>
          <strong>SelectiveAuditDisclosure</strong> — participant-initiated;
          adds that participant&apos;s regulator as an observer on that
          participant&apos;s own contracts and decryption scope only, with no
          transitive disclosure to any other participant&apos;s data.
        </li>
      </ul>

      <h2>The off-ledger client (app/)</h2>
      <p>Runs on each participant&apos;s own side.</p>
      <ul>
        <li>
          <strong>crypto/</strong> — per-leg authenticated encryption (libsodium
          crypto_secretbox under a fresh content key), key-wrapping to a
          leg&apos;s counterparties via sealed boxes, and a salted hash
          commitment over the canonical cleartext.
        </li>
        <li>
          <strong>verify/</strong> — the per-node residual-risk check: a real,
          deterministic computation over a participant&apos;s own decrypted
          positions, comparing the movement a proposed compression would cause
          against the participant&apos;s declared tolerance.
        </li>
        <li>
          <strong>cycle/</strong> — composes crypto and verify into what a
          participant actually submits: open and verify each replacement leg,
          then emit the on-ledger participation only if the check passes.
        </li>
        <li>
          <strong>solver/</strong> — the matching stand-in (see Scope below): a
          small, deterministic algorithm that nets each party&apos;s risk across
          a set of nominated trades and rebuilds those net positions with a
          minimal set of replacement legs.
        </li>
        <li>
          <strong>ledger/</strong> — a per-party JSON Ledger API v2 client:
          submit commands, read a party&apos;s own active contracts and its
          CREATE/ARCHIVE activity feed, and manage parties. It holds no key that
          can decrypt a payload.
        </li>
        <li>
          <strong>model/</strong> — typed bindings between the Daml model and
          the JSON the ledger client sends and reads.
        </li>
      </ul>

      <h2>The demo (demo/)</h2>
      <p>
        A party-selection entry followed by per-party views, each rendered from
        that party&apos;s own Ledger API projection: a Compression Console, a
        Ledger/X-ray activity feed with a contract-detail drawer, an animated
        privacy-matrix scoreboard computed from real projection reads, a
        &quot;try to cheat&quot; control that genuinely attempts to reveal a
        position as the operator, and a live counter. Shares a dealer-terminal
        design system with the landing site.
      </p>

      <h2>Scope</h2>
      <p>
        This is a hackathon build focused on the privacy architecture, not a
        production compression engine.
      </p>
      <ul>
        <li>
          <strong>The matching is a real, deterministic algorithm</strong>, not
          a production risk model. It nets sensitivities and rebuilds a minimal
          replacement topology; it does not implement SIMM, SA-CCR, or CRIF.
        </li>
        <li>
          <strong>Operator-blind matching via multi-party computation</strong>,
          topology hiding, a legal-enforceability wrapper, asset settlement, and
          MainNet deployment are roadmap items, not part of this build.
        </li>
        <li>
          <strong>Key handling is demo-grade.</strong> The code is unaudited and
          runs on DevNet/local sandbox only.
        </li>
      </ul>
    </>
  );
}
