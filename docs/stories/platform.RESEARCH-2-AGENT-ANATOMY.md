# platform.RESEARCH-2-AGENT-ANATOMY — Map the nine anatomy elements onto this domain's agent

Map each of reasoning, memory, inputs, communication, tools, procedures, coordination, safeguards and verification onto **the AI employee this project will define (none exists yet)**.

For each element, answer with evidence or with "unknown": what exists today, what is missing, and what the first honest version looks like. Because no agent exists yet, every element is a design question and "unknown" is an acceptable answer.

Coordination specifically: agent-to-agent handoff does NOT exist in this platform. Record what coordination would require rather than describing it as available.

**Release:** r0 · Discovery and validation (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Map the nine anatomy elements onto this domain's agent
**Domain:** Platform Automation & Reliability · **Release:** Discovery and validation · **Story:** `platform.RESEARCH-2-AGENT-ANATOMY`
**Accountable human:** Kesetebirhan Delele · **Deliverable:** `docs/discovery/02-agent-anatomy.md`

## What this is

This is Claude Code work, and the product is a written document. There is no feature to ship
and no agent to switch on. The document is the thing your manager reviews, so it is written
to be read by them rather than by you.

## The specification is the brief on this story, not this prompt

Read the brief above this prompt on the story page. It names this domain's real figures, your
accountable human, and the specific blockers discovery already found. **Those numbers are not
repeated here on purpose:** a second copy drifts from the first, and then nobody knows which
is true. Work from the brief; this prompt tells you how to turn it into a document.

## How to build it

- Work the nine elements one at a time. Ask Claude Code to search the repo for what exists today for each one before you write anything about it.
- No agent exists for this domain yet, so most answers are design questions. **"Unknown" is the correct answer wherever you have no evidence**, and the brief says so.
- Coordination is the trap: agent-to-agent handoff does NOT exist in this platform. Record what it would require rather than describing it as available.

## What the document must contain

- Nine sections: reasoning, memory, inputs, communication, tools, procedures, coordination, safeguards, verification.
- Each answers three things: what exists today, what is missing, what the first honest version looks like.
- An explicit count at the top of how many of the nine are currently "unknown". That number is the honest headline of this document.
- A sources section with `file:line` for every claim that something does exist.

Write it as Markdown with real headings. A wall of prose is not a deliverable, and neither is
a bulleted restatement of the brief.

## Evidence this is done

Cite the real thing. For this story that is the committed file `docs/discovery/02-agent-anatomy.md`, and inside it,
every claim carrying either a source or the word unknown.

**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, a document that restates the brief without answering it, or a confident sentence
with no source. Your accountable manager evaluates the evidence.

**Unknown is a real answer and is worth more than a guess.** Several of these questions have
no source material in this repository. Writing "the source does not exist, and here is what
would have to be written" is a complete answer, not a failure to find one.

## Before you start

- **The platform source is PUBLIC. You do not need access granted.** Wherever this brief
  cites a file like `backend/src/services/agentRegistrySeed.ts`, it means the Colaberry
  platform repository:
  **https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator**
  Clone it read-only beside your own project and point Claude Code at it. Sarbjit hit this
  within hours of starting and was right to stop rather than invent an answer: a brief that
  cites a path without naming its repository is the brief being wrong, not you.
- **Nothing in this story authorizes an outbound message.** Do not send an invitation, an
  email or a direct message, and do not record a meeting as booked. Arranging anything with a
  person is a human action taken outside this project.
- **Nothing here changes an agent.** Do not enable one, grant it a tool, or raise an autonomy
  level. A capability stays `draft` until your manager has actually reviewed it.
- Your repo may not be connected yet. The prompt works either way; the story cannot be
  verified and no points are awarded until a repo is connected, because verification is a
  read of your repo.

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] All nine anatomy elements are addressed, with none left blank and none dismissed as not applicable without a stated reason.
- [ ] Each element names the concrete platform surface, tool or record it maps to, rather than describing the element in general terms.
- [ ] Any element that cannot be filled is recorded as a gap with what is missing, rather than omitted.

When every box above is ticked, stop and show the demo.
