import Link from "next/link";

export const metadata = { title: "Privacy model and boundary" };

export default function PrivacyModel() {
  return (
    <>
      <h1>Privacy model and boundary</h1>
      <p>
        Privacy claims in this space are easy to overstate, so this page states
        the exact boundary — what the operator can and cannot see, and what
        CompressRail is not.
      </p>

      <h2>What &quot;operator-blind&quot; means, precisely</h2>
      <p>
        The operator never sees any participant&apos;s economic terms —
        positions, sensitivities, notionals, or trade details. Two mechanisms
        enforce this together:
      </p>
      <ul>
        <li>
          <strong>Daml stakeholder scoping.</strong> The operator is never a
          signatory or observer on any contract that carries a participant&apos;s
          trade, so it is not notified when those trades are created and never
          holds one as an active contract. When it executes a cycle it does
          receive the trades being torn up and the new legs, as ciphertext
          (below).
        </li>
        <li>
          <strong>Application-layer encryption.</strong> Every economic field is
          written on-ledger only as authenticated-encryption ciphertext plus a
          hash commitment, and the operator holds no decryption key. This second
          layer is necessary, not redundant: on Canton, the participant that
          submits a transaction interprets all of it, so anything stored in
          cleartext would be visible to whoever submits.
        </li>
      </ul>

      <h2>What is exposed — to the operator and to every firm in a cycle</h2>
      <p>
        Economic payloads are encrypted, and the operator party is not a
        decryption recipient. The operator and invited cycle participants
        receive transaction metadata, including counterparty identities and
        ciphertext. This does not guarantee topology privacy or prevent
        inferences from participants&apos; own trades and cycle outcomes. In
        this build the matching runs with all inputs in one place. Private
        matching and reduced execution visibility are separate roadmap items.
        The current multi-node test uses a shared test process holding
        participant keys.
      </p>
      <ul>
        <li>
          <strong>From the moment a cycle is proposed</strong>, every invited
          firm sees which pairs are to receive replacement trades — including a
          firm that later declines.
        </li>
        <li>
          <strong>When the cycle executes</strong>, the operator and every
          committed firm receive the whole transaction: every trade torn up and
          every new leg, with counterparties, references, ciphertext and
          commitments. In Daml, a party that is an informee of an action also
          sees its consequences. Measured on a three-node run by reading each
          party&apos;s ledger-effects stream; its active contracts and flat
          stream do not show these trades.
        </li>
        <li>
          <strong>Inference.</strong> Reading nothing, a firm can still derive
          amounts. In a ring A–B 100, B–C 60, C–A 60, firm A knows its own C–A
          trade and sees that C receives no new leg, so it can work out that
          B–C is 60. The operator, which sees no amount, still learns that C&apos;s
          two trades offset exactly.
        </li>
      </ul>

      <h2>The privacy matrix</h2>
      <table>
        <thead>
          <tr>
            <th>Can see…</th>
            <th>Participant A</th>
            <th>Participant B</th>
            <th>Operator</th>
            <th>Regulator (A&apos;s)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>A&apos;s economic terms</td>
            <td>yes</td>
            <td>no</td>
            <td>no</td>
            <td>yes (scoped)</td>
          </tr>
          <tr>
            <td>B&apos;s economic terms</td>
            <td>no</td>
            <td>yes</td>
            <td>no</td>
            <td>no</td>
          </tr>
          <tr>
            <td>Full cycle plan in cleartext</td>
            <td>own legs only</td>
            <td>own legs only</td>
            <td>no</td>
            <td>no</td>
          </tr>
          <tr>
            <td>Cycle structure (who with whom), as ciphertext</td>
            <td>yes, if invited</td>
            <td>yes, if invited</td>
            <td>yes</td>
            <td>no</td>
          </tr>
          <tr>
            <td>Own positions compressed</td>
            <td>yes</td>
            <td>yes</td>
            <td>no</td>
            <td>yes (scoped)</td>
          </tr>
        </tbody>
      </table>
      <p>
        This is enforced by Canton and verified by reading each party&apos;s own
        ledger view — not by filtering in the interface. The last row is a
        visibility proxy — whether a party&apos;s own trades were torn up by the
        cycle — not a computed margin number; initial-margin models (SIMM, SA-CCR)
        are out of scope. Its values describe the post-cycle state; the demo&apos;s{" "}
        <Link href="/demo-guide">privacy-matrix scoreboard</Link> computes this
        table live from real per-party projection reads, driven from a persistent
        disclosed trade (no cycle has run in that view), so that row reads
        &quot;no&quot; across it there.
      </p>

      <h2>What this is not</h2>
      <ul>
        <li>
          <strong>Not topology-hiding, not inference-proof.</strong> The
          operator and every invited firm receive the cycle&apos;s structure, and
          amounts can be inferred from a firm&apos;s own trades and the outcome
          (above). Multi-party computation would remove the need to collect all
          inputs in one place; on its own it would not stop the result&apos;s
          parties from propagating at execution.
        </li>
        <li>
          <strong>Not zero-knowledge, not fully homomorphic encryption, not
          MPC.</strong>
        </li>
        <li>
          <strong>Not a legal-enforceability layer.</strong> CompressRail does
          not make a replacement trade legally enforceable, EMIR/CSA-compliant,
          or a counterparty creditworthy. Those are questions for the
          parties&apos; own agreements and legal review.
        </li>
        <li>
          <strong>Not custody.</strong> CompressRail never takes custody of any
          asset. It produces compression instructions and records.
        </li>
        <li>
          <strong>Not production-grade key management.</strong> Key handling in
          this build is demo-grade, clearly labeled as such. Production key
          management (KMS/HSM, rotation, external signing) is future work.
        </li>
        <li>
          <strong>Authenticity is from the ledger, not the sealed box.</strong>{" "}
          The sealed payload is anonymous, so a leg&apos;s terms are trustworthy
          only together with the Daml signatories on the contract carrying its
          commitment — never standalone.
        </li>
        <li>
          <strong>No on-ledger record that a trade was offered up.</strong> Consent
          to the plan itself is bound: a participant commits on one specific cycle
          contract carrying that exact teardown list and topology, and neither field
          can change as commits accumulate. What is missing is the step before —
          nothing records that a listed trade was ever one the participant agreed to
          include, so the check is that the participant reviewed the list, not that
          the ledger can verify it did. Binding that via the modeled
          NominateIntoCycle marker is roadmap. Separately, no ledger can attest that
          a participant&apos;s own client showed it the list it actually committed
          to; the per-node tolerance check is computed against the list read back
          from the cycle contract, which narrows that gap without closing it.
        </li>
      </ul>

      <h2>Why Canton</h2>
      <p>
        The problem needs three properties at the same time, which Canton
        provides natively:
      </p>
      <ul>
        <li>
          <strong>Sub-transaction privacy</strong> — a party sees only the
          contracts it is a stakeholder of.
        </li>
        <li>
          <strong>Atomic multi-party composition</strong> — one transaction can
          archive many bilateral trades and create their replacements across
          many counterparties, all-or-nothing.
        </li>
        <li>
          <strong>Selective disclosure</strong> — a regulator can be added as a
          scoped observer without seeing the rest of the graph.
        </li>
      </ul>
      <p>
        A public chain would expose positions, or hide them behind heavyweight
        cryptography with no native settlement. A centralized service would
        reintroduce the trusted operator that is the whole problem.
      </p>
    </>
  );
}
