# platform.CAP.orchestration_health_watch.L0-SCOPE-SHEET — Curriculum content health scan · 0.2 · write the scope sheet

**Write the scope sheet.** The product cannot do this at all. Before anybody builds anything, write down what the thing is, who acts on its output, and what number would say it worked.

The front door said the product cannot do this. That is the ONLY state that is a build request, and it is also the state where the most expensive mistake is available: arguing for a tool nobody can tell whether worked.

So the scope sheet answers three questions before anybody writes code:

1. **Who acts on the output.** A person, by name, in the people record's own spelling. Not a role, not "the team".
2. **What number decides it worked.** One threshold, stated so somebody else could check it.
3. **What the system already records that would produce that number.** If nothing does, the measurement is part of the build, not an afterthought.

For `platform.orchestration_health_watch`. If you cannot answer the third question, say so plainly here rather than inventing a metric that happens to be available.

This step belongs to one capability and runs in its place in the path. A later step opened before its predecessor is finished is the thing the path exists to prevent -- say so and go back rather than working ahead.

**Release:** autonomy:R0 · Legacy migration plan (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

This story is human work, not a Claude Code build, and it carries no prompt on purpose.

It is research or a conversation with the accountable manager. Record what you find in the story body. Nothing here authorizes an outbound message: do not send an invitation, and do not record a meeting as booked. A capability stays `draft` until the manager has actually reviewed it, and that review is the output of this story.

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The scope sheet names the person who will act on the output, by name rather than by role.
- [ ] It states one threshold that decides whether the capability worked.
- [ ] It names what the system already records that would produce that number, or says plainly that nothing does and that the measurement is part of the build.

When every box above is ticked, stop and show the demo.
