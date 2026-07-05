export const metadata = { title: "Run guide" };

export default function RunGuide() {
  return (
    <>
      <h1>Run guide</h1>

      <h2>Prerequisites</h2>
      <ul>
        <li>The Daml SDK 3.5.x toolchain (via DPM), for building and running the Daml model.</li>
        <li>Node.js, for the off-ledger client and the demo/landing/docs sites.</li>
      </ul>

      <h2>Build the Daml model</h2>
      <pre>{`cd daml
dpm build`}</pre>

      <h2>Start a local Canton sandbox</h2>
      <pre>{`deploy/sandbox.sh`}</pre>
      <p>
        This starts a local Canton sandbox with the CompressRail DAR loaded and
        the JSON Ledger API exposed on :7575 by default. It runs without
        authentication — do not expose it to a network.
      </p>

      <h2>Run the off-ledger client&apos;s tests</h2>
      <pre>{`cd app
npm install
npm test`}</pre>
      <p>With the sandbox running, the live end-to-end checks can also run:</p>
      <pre>{`E2E_LEDGER_URL=http://localhost:7575 npm run e2e`}</pre>

      <h2>Run the demo</h2>
      <p>With the sandbox running:</p>
      <pre>{`cd demo
npm install
npm run dev`}</pre>
      <p>
        The demo consumes the app package as a local dependency, so it drives
        the same client the tests exercise — not a separate mock.
      </p>
    </>
  );
}
