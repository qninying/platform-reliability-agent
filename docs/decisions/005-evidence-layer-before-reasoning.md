# 005: Build the agent's evidence layer before its reasoning layer

**Status:** in force since 2026-10-26 · recorded 2026-10-27

## Context
Ellis is an AI agent, built in phases. Discovery mapped its anatomy onto the platform: the reasoning
component is partial, because a shared model call path exists but the model and system prompt for this
agent are not yet chosen (`docs/discovery/02-agent-anatomy.md`). Every capability starts at R0, and the first
releases sit at R2 (answer from approved records), with two at R4 and one at R1, all in a sandbox, on the
platform's autonomy ladder.

## Decision
The first phase builds the agent's senses and judgement rules: deterministic code that turns platform
records into verdicts with citations, explicit unknowns and exit codes. It makes no model calls at run time.
Model-backed reasoning comes in a later phase and works from these verdicts and their citations, so a
model's answer can always be traced to records and checked.

## Alternatives considered
- **Start with a model reading the records directly.** Rejected for the first phase: its answers could not be
  pinned, reproduced or mutation-tested, and K.D. would have no fixed evidence to approve a promotion on.

## Consequences
- Today Ellis answers fixed questions, one per capability, and cannot take a free-form question.
- Every answer is reproducible from its input, which is what promotion up the autonomy ladder needs.

## Evidence
- `src/` has no runtime dependencies and no network calls (`package.json`: devDependencies only).
- Most capability test files run the same input twice and require the same answer (for example
  `test/agentHealthScoring.test.ts`, `test/orchestrationAutoRepair.test.ts`).
