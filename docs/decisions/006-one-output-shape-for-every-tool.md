# 006: One output shape for every tool, with severity set only by K.D.'s table

**Status:** applied on 2026-11-04 to K.D.'s five first monitors and to the four checks A.M.'s ruling of that day added · A.M. approved the shape on 2026-11-04; K.D.'s two questions (partly_unknown, the severity table) are open and not blocking

## Context
K.D.'s architecture (2026-10-28) makes each coded check a tool the agent calls through a broker. The broker
needs one shape from every tool: a verdict, a severity and the row ids behind them. Today each check answers
in its own words (`healthy`, `alerting`, `traced`, ...), and nothing sets a severity. A.M. cleared a contained
version on 2026-11-04: one shared format and a severity, starting with the existing checks.

## Decision
Every tool returns the same envelope, with its own answer carried unchanged inside it:

| Field | What it holds |
|---|---|
| `tool` | the story id, for example `platform.CAP.cron_health_alerting` |
| `as_of` | when the evidence was captured and by whom |
| `verdict` | `problem`, `ok`, `unknown` or `partly_unknown` |
| `severity` | `Critical`, `High`, `Medium`, `Low`, or `unassigned` |
| `severity_rule` | the rule in K.D.'s table that set it, or why none did |
| `platform_signal` | a severity the platform itself attached, shown as evidence, never used as Ellis's severity |
| `evidence` | the rows behind the verdict: table, id, fields read |
| `blind_spots` | what the tool could not see, in plain words |
| `detail` | the tool's own answer, unchanged |

Rules the code enforces:
- A `problem` or an `ok` that cites no row is refused before it leaves the tool.
- A `partly_unknown` must name at least one blind spot, so it can never read as `ok`.
- Only a `problem` gets a severity, and only from a rule in `governance/severity-table.json`, which K.D. owns.
  The table has no rules yet (ISS-032), so every severity is `unassigned` and says why.

## Alternatives considered
- **Report any blind spot as `unknown`.** Safer, but most sweeps would mark the whole fleet unknown, which
  hides the jobs that were checked.
- **Let each tool or the model pick a severity.** Rejected: severity is K.D.'s decision, applied by code
  (BRD RULE-015).

## Consequences
- No monitor's logic changed; each has a small adapter in `src/output/monitorAdapters.ts`. The fifth first monitor,
  the system health probe, folded into system resilience supervision on 2026-11-04, so it has two adapters there:
  the posture, and the health probes, whose evidence is the `GET /health/full` export rather than a table row.
- The checks the 4 November ruling added have adapters in `src/output/foldAdapters.ts`: the fleet stop levers, the
  discovery preview, the registration proposals and manager access. A timer with no row has no table row to cite,
  so its evidence is its entry in the timer inventory read from source; a proposal's is its call site.
- The job checks have adapters in `src/output/jobAdapters.ts`: overlap guard, run records, dead-letter capture,
  dead-letter triage and stale-action recovery. An empty dead-letter queue is never `ok`: it cites no row, and most
  jobs could not have reached it, so it is `partly_unknown` and names them.
- The remaining older checks move over in batches of five or six.
- Until K.D. writes the first rules, the broker can rank by verdict only.

## Evidence
- `src/output/toolOutput.ts`, `src/output/monitorAdapters.ts`, `src/output/foldAdapters.ts`,
  `src/output/jobAdapters.ts`, `test/toolOutput.test.ts` (16 tests), `test/foldAdapters.test.ts` (8 tests),
  `test/jobAdapters.test.ts` (10 tests).
- Thirty-four deliberate breaks of these rules, each caught by a named test (decision 004).
