# platform.RESEARCH-4-MANAGER-INTERVIEW — Prepare a 30-minute interview with Kesetebirhan Delele and propose a weekly check-in

Produce the interview agenda and the questions, as project work.

**This story sends nothing.** No calendar invite, no scheduling link, no attendee list, no email. Arranging the meeting is a human action taken outside this project, and this story is complete when the agenda exists -- not when a meeting is booked. Any wording that implies a meeting is scheduled is wrong.

Cover: which capabilities they want first, which must stay human forever, what "good" looks like in measurable terms, and what they would want switched off immediately if it misbehaved.

**Blocker to raise in the interview:** Kesetebirhan Delele cannot reach the agent surface today. manager_has_no_admin_login: Kesetebirhan Delele has an org_members row but no admin_users row, so they cannot open their employee's Agent Detail or Talk surface. Already the reports_to target for workforce_intelligence_engine. Until that is fixed they cannot see what they are being asked to validate.

**Release:** r0 · Discovery and validation (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Prepare a 30-minute interview with Kesetebirhan Delele and propose a weekly check-in
**Domain:** Platform Automation & Reliability · **Release:** Discovery and validation · **Story:** `platform.RESEARCH-4-MANAGER-INTERVIEW`
**Accountable human:** Kesetebirhan Delele · **Deliverable:** `docs/discovery/04-manager-interview.md`

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

- **THIS STORY SENDS NOTHING.** No calendar invite, no scheduling link, no attendee list, no email. The story is complete when the agenda exists, not when a meeting is booked. Any wording implying a meeting is scheduled is wrong and will fail review.
- Draft the questions with Claude Code, then cut them. Thirty minutes is roughly eight real questions, not twenty.
- Carry the blocker named in the brief into the agenda as an item. A manager who cannot reach the surface cannot validate what they are being asked to validate, and that is worth their meeting time.

## What the document must contain

- A 30-minute agenda with time budgeted per section, adding up to 30.
- The questions, grouped by: which capabilities they want first, which must stay human forever, what "good" looks like in measurable terms, and what they would want switched off immediately if it misbehaved.
- The access blocker from the brief, written as something to raise rather than something to fix in the meeting.
- A short section for their answers, left empty, so the same file becomes the record afterwards.

Write it as Markdown with real headings. A wall of prose is not a deliverable, and neither is
a bulleted restatement of the brief.

## Evidence this is done

Cite the real thing. For this story that is the committed file `docs/discovery/04-manager-interview.md`, and inside it,
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

- [ ] The interview plan fits 30 minutes, and every question is specific to this domain rather than reusable for any agent.
- [ ] A weekly check-in is proposed with a named day, a duration, and the three things it reviews.
- [ ] The plan states what to do with each answer, so a completed interview changes the build rather than only recording opinions.

When every box above is ticked, stop and show the demo.
