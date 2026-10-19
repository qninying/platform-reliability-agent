# Map the nine anatomy elements onto this domain's agent

**Story:** Release 1, Discovery and validation · **Version:** 3 · **Date:** 2026-10-19 · **Autonomy level:** R0
**Review:** approved by K.D. on 2026-10-19 (version 3), recorded in the review artifact. This file is a copy of the approved content, kept as evidence.

The map uses the standard components of an agentic system. The last column shows what implements each component.

## The loop

perceive → reason → plan → act → verify → remember

Guardrails sit around every step and are enforced by the runtime, not left to the model.

## The components

| Component | Role in this agent | Implemented by |
|---|---|---|
| Reasoning engine (LLM core) | Interprets logs and signals, forms hypotheses, and decides what to do next. | Model |
| Planner | Builds each investigation workflow at runtime from the evidence it finds, and re-plans when a step fails or new evidence appears. | Model (plan run by the runtime) |
| Memory | Working memory for the current incident (the context window). Long-term memory for confirmed past incidents, runbooks and baselines. Kept separate from the system's own logs. | Data store (model summarizes and matches) |
| Perception layer | System inputs read in place: activity logs, schedules, errors, health checks, performance and capacity data, inventory and lineage, tickets, deploy history. Read-only; nothing is copied. | Runtime code |
| Tool layer | Typed tools the planner may call: read-only queries, saving a report, drafting a ticket. No tool fixes, restarts or changes anything. | Runtime code |
| Orchestration runtime | Runs the plans and supervises the loop: triggers, grouping related alerts into one incident, state, retries, timeouts, follow-ups, routing reports to owners. | Runtime code |
| Agent specification | The system prompt and boundaries: reliability-only scope, definition of done for a report, severity and priority rules, the report schema. | Prompt + config |
| Guardrails and governance | Least-privilege read-only credentials, a tool allowlist, evidence for every claim, step and cost budgets, audit logging, no automatic edits to its own memory. | Runtime code (enforced outside the model) |
| Response generation | Writes the report and answers "why did you flag this?", with stated confidence. Says "I don't know" when evidence is thin. Delivered through the tool layer. | Model |
| Verification and feedback loop (evals) | After a person fixes something, re-runs the check and records whether the problem went away. Feeds evaluation and, once a person confirms it, long-term memory. | Runtime code (model reads unclear results) |

## What comes first
- Audit the existing logging: does it capture enough depth and detail for the agent to diagnose any issue? This defines what perception and memory can rely on.
- Build every component together, each in its smallest useful form, with evaluation from the first run.
- At R0 every component above is a definition. Nothing is built or running yet.

## Version history
- **Version 1:** mapped the nine body-part terms directly; two of nine parts used the LLM.
- **Version 2:** switched to ten standard engineering components with the anatomy terms as a cross-reference; perception is system input, not a user; memory starts with an audit of existing logging and stays separate from it; no separate voice; all components built together with evaluation alongside.
- **Version 3:** "Runs on" became "Implemented by" (model, data store, runtime code, or prompt and config); the anatomy-term column was removed; working memory is named as the context window.
