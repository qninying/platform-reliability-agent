# platform.RESEARCH-5-THREE-PROPOSED-TASKS — Capture three proposed agent tasks with boundaries and completion evidence

Pick three candidate tasks for this domain and write each one up with: the tools and data it needs, its approval boundary, and what counts as evidence it completed correctly.

Choose from this domain's own draft capabilities rather than inventing tasks -- there are 48 to choose from. For each, state the starting autonomy and the ceiling, and why the ceiling is where it is.

**Completion evidence may not be any of these:** a story being marked done, time having passed, a conversation that went well, or a mocked test passing. This platform already has 106 approval rows whose only recorded decider is a 4.25-hour timer, which is the failure this requirement exists to prevent.

**Release:** r0 · Discovery and validation (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Capture three proposed agent tasks with boundaries and completion evidence
**Domain:** Platform Automation & Reliability · **Release:** Discovery and validation · **Story:** `platform.RESEARCH-5-THREE-PROPOSED-TASKS`
**Accountable human:** Kesetebirhan Delele · **Deliverable:** `docs/discovery/05-three-proposed-tasks.md`

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

- **Choose from this domain's own draft capabilities rather than inventing tasks.** The brief says how many there are to choose from. An invented task cannot be validated against anything.
- For each, state the starting autonomy and the ceiling on the `autonomy:R0` to `autonomy:R9` ladder, and WHY the ceiling is where it is. Read `backend/src/services/agentDomain/autonomyLadder.ts` for what each rung means.
- Write the completion evidence before the task description. If you cannot say what would prove it worked, the task is not ready to propose.

## What the document must contain

- Three tasks, each with: the tools and data it needs, its approval boundary, and what counts as evidence it completed correctly.
- Starting autonomy and ceiling for each, with the reason for the ceiling.
- The named human who approves each one.
- An explicit statement, per task, of what would make you switch it off.

Write it as Markdown with real headings. A wall of prose is not a deliverable, and neither is
a bulleted restatement of the brief.

## The evidence rule this story exists to teach

**Completion evidence may not be any of these:** a story marked done, time having passed, a
conversation that went well, or a mocked test passing. This platform already carries 106
approval rows whose only recorded decider is a 4.25-hour timer. That is the failure this
requirement exists to prevent, and proposing a task with timer-shaped evidence repeats it.

## Evidence this is done

Cite the real thing. For this story that is the committed file `docs/discovery/05-three-proposed-tasks.md`, and inside it,
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

- [ ] Exactly three agent tasks are proposed, each with its boundary stated as what the agent must NOT do.
- [ ] Each task names the evidence that proves it completed, and that evidence is something other than the task being marked done.
- [ ] Each task names the human who approves it wherever approval is required.

When every box above is ticked, stop and show the demo.
