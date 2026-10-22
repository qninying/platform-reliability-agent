# platform.RESEARCH-1-SYSTEM-CLASSES — Compare the five system classes, and place this domain among them

Write a short, evidenced comparison of chatbots, fixed workflows, tool-using agents, agentic systems and multi-agent systems. Then say which one **Platform Automation & Reliability** actually needs, and why.

Ground it in this domain, not in the abstract: it has **48 candidate capabilities** and **38 inherited legacy records**. Of those capabilities, 23 are reserved to a human at every level. A comparison that does not change depending on that number has not been applied.

State explicitly which class this domain does NOT need, and what would have to change for the next class up to be justified.

**Release:** r0 · Discovery and validation (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Compare the five system classes, and place this domain among them
**Domain:** Platform Automation & Reliability · **Release:** Discovery and validation · **Story:** `platform.RESEARCH-1-SYSTEM-CLASSES`
**Accountable human:** Kesetebirhan Delele · **Deliverable:** `docs/discovery/01-system-classes.md`

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

- Start a Claude Code session in your project folder.
- Ask it to draft the comparison from the brief, then CHECK each claim yourself. A fluent paragraph about agentic systems that would read identically for any domain is the failure mode here.
- Ground the recommendation in this domain's own figures, which the brief gives you. If the argument does not change when those numbers change, it is not applied.
- Look at what this platform actually runs before claiming a class is needed. `backend/src/services/agentRegistrySeed.ts` is the real registry; read a few entries near your domain.

## What the document must contain

- One short section per class: chatbots, fixed workflows, tool-using agents, agentic systems, multi-agent systems. Two or three sentences each, no filler.
- The recommendation for this domain, with the reason stated in terms of its own numbers.
- Which class this domain explicitly does NOT need.
- What would have to change for the next class up to be justified. Name the condition, not a vague "more maturity".
- A sources section. Every factual claim about the platform carries a `file:line` or a query.

Write it as Markdown with real headings. A wall of prose is not a deliverable, and neither is
a bulleted restatement of the brief.

## Evidence this is done

Cite the real thing. For this story that is the committed file `docs/discovery/01-system-classes.md`, and inside it,
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

- [ ] The document compares all five system classes (chatbot, fixed workflow, tool-using agent, agentic system, multi-agent system) and names which one this domain needs.
- [ ] The choice cites this domain's own capability count and its human-reserved count, so the argument would change if those numbers changed.
- [ ] The document states explicitly which class this domain does NOT need, and what would have to change to justify the next class up.

When every box above is ticked, stop and show the demo.
