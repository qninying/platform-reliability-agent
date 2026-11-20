# Security

## What Ellis can and cannot touch

- **Read-only.** Capabilities read platform records through an interface with no write method
  (`src/readSource.ts`). The checks hold no database credentials, API keys or tokens, and make no network calls.
- **Changes only in a sandbox.** The three capabilities that change state do so on sandbox copies that journal
  every write, or in a directory locked down by Node's permission model (`src/sandbox/`). See
  [decision 001](docs/decisions/001-read-only-first-sandbox-for-change.md).
- **No production data in this repository.** Everything in `examples/` is built from platform source code or
  written by hand for tests. Secret values are never passed on: the security posture scan reports where a
  secret was found, never the value.
- **The checks have no runtime dependencies,** so there is no third-party code in their run path.
- **The agent layer (`npm run ask`) is the one exception.** It uses the Anthropic SDK (pinned to an exact
  version) to call the model API with a key the operator supplies in a git-ignored `.env`. The key is never
  logged, never written to the run record, and removed from the environment of every check the model runs.
  The model can only call the read-only checks on an approved list, and a proposed change is recorded for a
  person, never carried out (`src/agent/gate.ts`).

## Platform findings

Weaknesses found in the Colaberry platform while building Ellis are sent to the platform's governance
reviewer (A.M.), who verifies each one against the code. They are also written up, with file:line
references, under "What the code showed" in each capability write-up. The platform repository is public, so
these describe code anyone can already read.

## Reporting an issue

If you find a security problem in Ellis, or in what this repository discloses about the platform, please
contact the maintainer through GitHub rather than opening a public issue with the details.
