# STORY-000 · Build your Command Center

**Story id:** `platform.STORY-000`
**Rung:** `autonomy:R0` -- the first story of the first rung, before any of this
domain's own work
**Owner:** you, with Claude Code
**Blocked by:** nothing -- this is the first thing you build

---

## The brief

Build one page that shows what you are building and how far along it is, so you can see your
own domain and demonstrate from it.

**Your domain** is Platform Automation & Reliability (`platform`). **Your employee** is the AI employee this project will define, which does not exist yet.
**Your accountable human** is Kesetebirhan Delele.

**The scope you are being handed:** 48 researched capabilities, of which
23 are permanently human decisions that no autonomy level ever automates, and
48 carry a recorded blocker. 38 legacy agent rows have a
disposition recorded against this domain. Capability research was recorded 2026-10-09.

**The ladder you will walk it down:** ten rungs, `autonomy:R0` to `autonomy:R9`. Your
capabilities name 8 distinct rungs between them
(autonomy:R0, autonomy:R1, autonomy:R2, autonomy:R3, autonomy:R4, autonomy:R5, autonomy:R6, autonomy:R7), and 81 per-rung behaviours with their own
acceptance criteria are already written into the capability records. Those are not yours to
invent; they are yours to read, render and then satisfy one rung at a time.

**Nothing here is validated yet.** Every capability is `draft` until your accountable human
has reviewed it. This page must show that state honestly rather than rendering a plan as a
plan that somebody agreed to.

## The capability this fulfils

The Command Center fulfils no capability of this domain because it is not part of the system being built -- it is the window onto it. Every builder gets the same one so the programme can be taught, reviewed and demonstrated as one thing, and so a builder can see the whole of what they are walking their agent through before they start walking it.

## Acceptance -- your stop condition

Every one of these is checkable by looking at the page. None of them can be satisfied by
marking this story complete.

- [ ] Given the Command Center, when it is opened, then all six panels render and each one names the endpoint it read.
- [ ] Given a panel whose endpoint returned nothing, when it renders, then it says so in words and is visibly distinct from a panel that is still loading.
- [ ] Given the autonomy ladder panel, when it renders, then all ten rungs are present with the owner's wording, and each capability's ceiling is marked against the rung it stops at.
- [ ] Given the autonomy ladder panel, when a capability's authority is shown, then the page shows the effective authority `effectiveAuthority()` returns rather than the level the capability record asks for, and names the `no_tool_grants` rule with the number of capabilities it currently constrains, saying so in words when that number is zero.
- [ ] Given the governance panel, when a tool request is shown, then nothing on the page states or implies that filing it granted anything.
- [ ] Trust -- no panel shows a number, a grant, a rung or a result this domain has not actually produced.

## Who closes this story

Reviewed by the domain's accountable human against the page itself, on the evidence the page renders. Marking this story complete is not evidence that it is done.

---

## The build prompt

This is the prompt attached to this story on the portal. It is reproduced here so a Claude Code
session opening this repository cold has the whole brief locally and does not have to author it
from memory of a page it has never seen.

# STORY-000 · Build your Command Center -- Platform Automation & Reliability

This is Claude Code work, and the product is a page in this repository. It is the first thing
you build and the last thing you delete: every later story reports into it.

## The specification is the brief on this story, not this prompt

Read the brief above this prompt on the story page. It names your domain's real counts, your
accountable human and your employee. **Those numbers are not repeated here on purpose:** a
second copy drifts from the first, and then nobody knows which is true. Work from the brief.

## Where the data comes from: a file in this repository, not a live call

Every panel below names an endpoint. **Those names are provenance, not instructions to call
them.** This page is public and every one of those endpoints is behind
`requireSection('dashboard')`, which means an `Authorization: Bearer` header. No cookie is ever
set, so being signed in to the admin site in another tab gives this page nothing to send, and a
page opened from your own machine cannot read that token either. A fetch from here returns
`Authentication required`, and no amount of work on the page will change that.

Read `.colaberry/agent-domain.json` in this repository instead. It is written by the platform
on every document sync, it carries the data for all six panels, and its `sources` map names the
endpoint each section came from -- which is how a panel satisfies "names the endpoint it read"
without calling anything.

Two rules about that file. **Read every figure out of it at runtime**; do not copy a count into
the page, because the records change and a hardcoded number starts lying the day after you
write it. And **the file deliberately carries no timestamp** -- take the staleness from
`.colaberry/manifest.json` and show it, so a reader can tell how old the picture is.

If the file is not there, your repository has not been synced since it started shipping. Click
Sync from GitHub in the portal; if it still does not appear, say so rather than inventing data.

## The six panels, and the question each one answers

**1. Your employee -- "does it exist, and what is it allowed to do?"**

From `agent` in the snapshot (source: `GET /api/admin/agent-domains-mine`). Render the
agent's `agent_name`, whether it is
`enabled`, its `autonomy_level`, how many tools are granted to it, and when its autonomy was
last set and by whom. If the agent does not appear, say so in those words and do not draw an
empty card that looks like a loading state. An agent with no identity rows renders as nothing,
and a panel that cannot tell "no agent" from "still fetching" is the panel that wasted a day.

**2. Your capability inventory -- "what am I actually building?"**

Read `GET /api/admin/agent-domains/platform` and
`GET /api/admin/agent-domains/platform/coverage`. One row per capability showing its
name, `classification`, `implementation_state`, `requirement_validation_state`,
`starting_autonomy`, `max_permitted_autonomy`, and a clear mark on the ones where
`human_decision` is true. Sort by nothing clever: the order the records come in is the order
research recorded them.

**3. The autonomy ladder -- "where is this going?"**

Render all ten rungs, in the owner's own words, with your employee's current rung marked and
each capability's ceiling marked against the rung it stops at:

| Rung | What it means |
|---|---|
| `autonomy:R0` | Define the workflow, requirements, risks and human decisions. |
| `autonomy:R1` | Prepare isolated development, fixtures and baseline tests. |
| `autonomy:R2` | Answer questions using approved knowledge and records. |
| `autonomy:R3` | Perform approved, user-initiated sandbox tool operations. |
| `autonomy:R4` | Execute and verify stateful, multi-step sandbox tasks. |
| `autonomy:R5` | Evaluate in shadow mode against approved reference outcomes. |
| `autonomy:R6` | Conduct a separately approved, supervised production pilot. |
| `autonomy:R7` | Automate only explicitly authorized action classes within limits. |
| `autonomy:R8` | Coordinate necessary, authorized handoffs with other agents. |
| `autonomy:R9` | Demonstrate reliable operation, monitoring, recovery and ownership. |

Rungs above a capability's ceiling are drawn as unreachable for that capability rather than as
future work. A ceiling is a decision somebody made with a reason, and the reason is on the
record -- show it.

**4. Per-rung behaviour -- "what does the next rung require of me?"**

Each capability record carries `release_behaviour[]`: one entry per rung, each with a
`behaviour` and its own `acceptance_criteria`. Render them under their rung. This is the panel
that turns the ladder from a diagram into a list of things to do, and none of it is invented
by you -- it is already written down.

**5. Your governance queue -- "what am I waiting on a human for?"**

Read `GET /api/admin/agent-domain-change-requests-mine`. Show change requests and tool
requests separately, with status, who proposed, who decided and when. A tool request is how
you ask for a capability your agent needs; it grants nothing by itself, and this panel must
not imply that filing one did.

**6. What is not available -- "what would I be lying about?"**

A panel that names the gaps, because the gaps are the work. Specifically:

- Coordinated handoff between two agents does not exist in this platform today, so the rung that asks for it -- `autonomy:R8` -- is unreachable by fact rather than by choice. Say so; do not draw it as merely incomplete.
- A capability whose `requirement_validation_state` is `draft` has not been agreed by anyone.
- A capability with an empty `release_behaviour[]` has no defined next rung, and defining it is the first piece of work on it.
- Anything this page cannot source from a real endpoint is left blank and labelled, never filled with a plausible example.

## The rules this page must not break

**Tool grants are the throttle, and they are not yours.** `effectiveAuthority()` in
`backend/src/services/agentDomain/autonomyLadder.ts` forces any capability above `autonomy:R2`
back down to `autonomy:R2` when no tools are granted, with the reason `no_tool_grants`. Read
that function before you render any authority figure, and render what it returns rather than
what the capability record asks for. The two differ on purpose.

**Finishing work does not promote anything.** `NON_PROMOTING_SIGNALS` in
`promotionCriteria.ts` names the four things that must never raise autonomy: a story marked
complete, elapsed time, a conversation that went well, and a mocked test passing. This page
may show progress; it may never show progress as authority. A named human promotes an agent,
one rung at a time, on evidence.

**Draft is not approved.** Render `draft` as draft everywhere. No panel may read as though a
manager has signed anything off.

## Tools your capabilities say they will need

- read_agent_registry
- read_cron_run_logs
- read_activity_log
- run_sandbox_job
- read_source_tree
- read_dependency_manifest
- static_secret_scan
- create_ticket
- read_audit_log
- emit_alert
- read_health_metrics
- read_schema_metadata

None of these is granted today. Each one is a request you file and a human approves.

## Evidence this story is done

Cite the real thing: a named passing test, a screenshot of the rendered page beside the
endpoint response it was built from, or a file:line. **None of these count:** this story being
marked complete, elapsed time, a conversation that went well, or a mocked test passing.
Kesetebirhan Delele evaluates the evidence.
