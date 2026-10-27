# Decision records

The five decisions that shape how Ellis is built. Each one names the alternatives that were considered, what
the decision costs, and the code or tests that hold it in place.

| # | Decision |
|---|---|
| [001](001-read-only-first-sandbox-for-change.md) | Read-only first; any change runs on a sandbox copy |
| [002](002-unknown-is-not-healthy.md) | Unknown is never reported as healthy |
| [003](003-pin-to-platform-code.md) | Pin every copied rule to the platform's code, and re-check it live |
| [004](004-prove-each-test-can-fail.md) | Prove each key test can fail |
| [005](005-evidence-layer-before-reasoning.md) | Build the agent's evidence layer before its reasoning layer |
