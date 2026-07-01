# deploy

Configuration and scripts for running CompressRail on Canton.

## Local sandbox

`sandbox.sh` starts a local Canton sandbox with the CompressRail DAR loaded and the
JSON Ledger API exposed. It is demo-grade: the sandbox runs without authentication,
so the JSON API accepts requests with no token. Do not expose it to a network.

```
# build the model once
(cd daml && dpm build)

# start the sandbox (JSON Ledger API on :7575 by default)
deploy/sandbox.sh
```

Ports are configurable via `JSON_API_PORT`, `LEDGER_API_PORT`, and `ADMIN_API_PORT`.

## End-to-end operator-blindness check

With the sandbox running, the `app` end-to-end test allocates parties, writes an
encrypted bilateral trade signed by its two counterparties, and reads each party's
own projection:

```
cd app
npm install
E2E_LEDGER_URL=http://localhost:7575 npm run e2e
```

It asserts, against the live ledger, that the two counterparties see the trade and
can decrypt it, while the operator's projection contains no trade at all — the
operator is a stakeholder of nothing, and what is on-ledger is ciphertext. Visibility
is enforced by Canton's projection, not by filtering in the client. Without
`E2E_LEDGER_URL`, the check is skipped, so the ordinary unit test run needs no ledger.

## Scope

This is the local topology: the parties are hosted on a single sandbox participant,
which is enough to demonstrate the per-party projection privacy. Running the operator
and each participant on **separate** participant nodes — the cross-node proof — is the
next step, and reuses the same off-ledger client and model bindings.
