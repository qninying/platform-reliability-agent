# platform.RESEARCH-3-ROLE-AND-DA-TRANSITION — Document Kesetebirhan Delele's role, and which DA responsibilities transition

Study the employee's role as it is actually performed. Write down the existing Data Analyst responsibilities in this domain and which of them are intended to transition to AI.

**A warning from discovery:** no document in this repository enumerates DA duties for ANY domain. Three independent researchers confirmed this separately. So this story's honest output may be "the source material does not exist, and here is what would have to be written" -- which is a real deliverable. Do not infer a duty list from a job title.

Record each responsibility as: stays human / transitions to AI / splits, with the reason.

**Release:** r0 · Discovery and validation (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Document Kesetebirhan Delele's role, and which DA responsibilities transition
**Domain:** Platform Automation & Reliability · **Release:** Discovery and validation · **Story:** `platform.RESEARCH-3-ROLE-AND-DA-TRANSITION`
**Accountable human:** Kesetebirhan Delele · **Deliverable:** `docs/discovery/03-role-and-da-transition.md`

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

- Read the warning in the brief first. No document in this repository enumerates Data Analyst duties for ANY domain, and three researchers confirmed that separately.
- **Do not infer a duty list from a job title.** If you cannot source a responsibility, the honest output is "the source material does not exist, and here is what would have to be written" - which the brief states is a real deliverable.
- Ask Claude Code to search the repo for the role before concluding it is absent, and record what you searched so the absence is evidenced rather than assumed.

## What the document must contain

- What you searched and what you found, so the gap is proved rather than asserted.
- A table of responsibilities with one row each: **stays human / transitions to AI / splits**, and the reason.
- For a split, exactly where the line falls and who holds each side.
- If the source does not exist: a short outline of the document that would have to be written, and who would have to write it.

Write it as Markdown with real headings. A wall of prose is not a deliverable, and neither is
a bulleted restatement of the brief.

## Evidence this is done

Cite the real thing. For this story that is the committed file `docs/discovery/03-role-and-da-transition.md`, and inside it,
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

- [ ] The document names the accountable human for this domain and the specific responsibilities proposed to transition to the agent.
- [ ] Each transitioning responsibility states what evidence would show the agent is ready to hold it.
- [ ] Responsibilities that must stay human are listed separately, each with the reason it is reserved.

When every box above is ticked, stop and show the demo.
