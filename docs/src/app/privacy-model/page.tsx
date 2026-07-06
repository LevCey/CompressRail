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
          trade. Canton&apos;s projection rules then ensure the operator&apos;s
          node is not even notified of those contracts.
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

      <h2>What the operator can see</h2>
      <p>
        That a cycle exists, which trades are nominated (by opaque reference),
        the netting topology (which participant pairs receive replacement
        trades), the opaque commitments, and each participant&apos;s boolean
        &quot;within tolerance&quot; attestation. It sees no economic
        magnitudes.
      </p>

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
            <td>Cycle topology and validity</td>
            <td>own legs</td>
            <td>own legs</td>
            <td>yes (no economics)</td>
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
          <strong>Not topology-hiding.</strong> The operator does see cycle
          topology and which trades are torn up. Hiding that as well requires
          multi-party computation and is on the roadmap, not in this build.
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
          <strong>Not on-ledger teardown consent (yet).</strong> The trades a
          cycle tears up are visible to each participant before it commits, but
          the commit does not yet force it to re-assert consent to that exact
          list on-ledger; binding it via the modeled NominateIntoCycle marker is
          roadmap.
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
