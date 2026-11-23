# `/capability` — taking one capability all the way down the path

This is the brief for every stage of one capability. Your Claude Code session can read it
from this repository with no access to the portal.

**It is a document, not an installed command.** The platform cannot register a slash command
on your machine. `docs/agent/README.md` says how to install it as one locally if you want to;
either way the instructions below are the same.

---

## Where the four candidates come from

You are **not** being asked what you do by hand. You do not hold this job, and a list built
from guesses about somebody else's week is how the first attempt at this went wrong. Four
candidates arrive, each labelled with where it came from, and you choose one.

**Your own research** (`research`)

You read the domain. Strongest on what the product can do, weakest on what the work actually feels like week to week.

**The person who holds the job** (`manager`)

They do this work. Treat anything from here as the most reliable signal on the list, and the one worth a conversation if it surprises you.

**Ali** (`owner`)

He is deciding what the agent is for. A candidate from here may be less obvious and more important than the rest.

**Scored against this rung** (`suggested`)

Generated and scored against the rung's criteria. A starting point, not an instruction: it has never watched anybody do the job.

Four at a time, in parallel, so you are never waiting on a decision that is not yours to
make. If one stalls, start the next.

---

# The 8 stages

One capability at a time. Each stage produces a file, and the checklist in
`docs/agent/README.md` ticks a stage only when that file is present — there is no flag and no
API call that marks one done.

## Stage 1 of 8: Pick one from the list

**Stage key:** `proposed`
**Whose move:** builder
**Produces:** `artifacts/capability/{slug}/00-chosen.md`
**Board row:** the story ending `L0-CHOOSE`

Four candidates are on the table. Nobody has checked yet whether the product already does any of them.

### What to do

1. Read all four candidates and the source label on each.
2. Pick ONE. Write down why this one before the other three, in a paragraph.
3. Run it past the product front door and record the answer: `in_app`, `partly`,
   `api_only` or `not_built`, with the feature it matched when it matched one.

That answer decides which way the path forks, so do not skip it and do not guess it. The
app may already do this, may half do it, may have the machinery with no screen, or may
not do it at all. Those are four different next steps and only two of them are yours.

### Done when

It names the candidate chosen, which of the four sources it came from, and in one paragraph why this one before the other three.

Write `artifacts/capability/{slug}/00-chosen.md` and the checklist in `docs/agent/README.md` ticks on the next document sync. Nothing else can tick it: there is no flag and no API call.

## Stage 2 of 8: Write the scope sheet

**Stage key:** `scope_sheet_owed`
**Whose move:** builder
**Produces:** `artifacts/capability/{slug}/10-scope-sheet.md`
**Board row:** the story ending `L0-SCOPE-SHEET`

The product cannot do this at all. Before anybody builds anything, write down what the thing is, who acts on its output, and what number would say it worked.

### What to do

The front door said the product cannot do this at all. That is the only state that is a
build request, and it is also where the most expensive mistake is available: arguing for
a tool nobody can tell whether worked.

Answer three questions before anybody writes code:

1. **Who acts on the output** — a person, by name, in the people record's spelling. Not
   a role, not "the team".
2. **What number decides it worked** — one threshold, stated so somebody else could
   check it.
3. **What the system already records that would produce that number** — and if nothing
   does, say so plainly. The measurement is then part of the build, not an afterthought.

### Done when

It answers who acts on the output, what threshold decides success, and what the system already records that would produce that number.

Write `artifacts/capability/{slug}/10-scope-sheet.md` and the checklist in `docs/agent/README.md` ticks on the next document sync. Nothing else can tick it: there is no flag and no API call.

## Stage 3 of 8: Waiting on the platform

**Stage key:** `platform_owed`
**Whose move:** owner
**Produces:** `artifacts/capability/{slug}/20-what-is-missing.md`
**Board row:** the story ending `L0-ASK-FOR-A-SCREEN`

The app has the machinery and no screen, or it half does this. Ali owes you a screen or a ruling. You are not blocked on yourself.

### What to do

The app has the endpoints for this and nobody built the page, or it does part of the job
and whether that part is enough is not yours to settle. Either way the next move is
Ali's and **you are not blocked on yourself**.

What you owe is a request that is BUILDABLE: name the screen and the route it would live
at, not the frustration. Do **not** write a scope sheet — a scope sheet argues something
should exist, and most of this already does.

Once it is approved, Ali builds the page, you test it until it does the job, and only
then are you doing this by hand.

### Done when

It names the exact screen or ruling needed and the route it would live at, so the request is buildable rather than a complaint.

This stage is **not yours to clear**. Write what is needed, then start another candidate rather than waiting.

## Stage 4 of 8: Go and use what was built

**Stage key:** `screen_built`
**Whose move:** builder
**Produces:** `artifacts/capability/{slug}/30-tested-the-screen.md`
**Board row:** the story ending `L2-IN-THE-APP`

The screen exists now. Use it until it does the job, or say plainly that it does not. Testing it is the work, not a formality before the work.

### What to do

The screen exists now. Use it on real work until it does the job, or say plainly that it
does not.

Testing it IS the work at this stage, not a formality before the work. A clean report
with nothing to say is a sign it was not really used.

### Done when

It records what was done in the screen, what worked, and what did not. A clean pass with nothing to report is a sign it was not really used.

Write `artifacts/capability/{slug}/30-tested-the-screen.md` and the checklist in `docs/agent/README.md` ticks on the next document sync. Nothing else can tick it: there is no flag and no API call.

## Stage 5 of 8: Do it by hand, in the app

**Stage key:** `by_hand_pending`
**Whose move:** builder
**Produces:** `artifacts/capability/{slug}/40-doing-it-by-hand.md`
**Board row:** the story ending `L1-BY-HAND`

The app already does this. Do it yourself first. Everything downstream is a judgement about work you have personally done.

### What to do

The app already does this. Do it by hand yourself first, start to finish, on real inputs
producing the real outcome.

Record the run: what you entered, what came out, how long it took, every judgement call
you made, and at least one way the real work differed from how it is written down.

Everything after this stage is a judgement about work you have personally done. That is
the whole reason it comes first.

### Done when

It records the run: what was entered, what came out, how long it took, and what was annoying about it.

Write `artifacts/capability/{slug}/40-doing-it-by-hand.md` and the checklist in `docs/agent/README.md` ticks on the next document sync. Nothing else can tick it: there is no flag and no API call.

## Stage 6 of 8: Write the tool request

**Stage key:** `proven_by_hand`
**Whose move:** builder
**Produces:** `artifacts/capability/{slug}/50-tool-request.md`
**Board row:** the story ending `L3-TOOL-REQUEST`

You have done it by hand and you know what it costs. Now ask for the tool, with the evidence rather than the idea.

### What to do

You have done it by hand, so you know what it costs. Now ask for the tool, with the
evidence rather than the idea.

Cite the run you recorded. The request carries six field groups, and the manual-today
section is the one that has to point at that run rather than describe the work in
general.

Filing a request grants nothing. A named human other than you records a decision on it,
and a decline counts as a decision.

### Done when

It carries the six field groups the tool request asks for, and the manual-today section cites the run recorded at the previous stage.

Write `artifacts/capability/{slug}/50-tool-request.md` and the checklist in `docs/agent/README.md` ticks on the next document sync. Nothing else can tick it: there is no flag and no API call.

## Stage 7 of 8: Waiting on a decision

**Stage key:** `tool_requested`
**Whose move:** owner
**Produces:** `artifacts/capability/{slug}/60-filed.md`
**Board row:** none, deliberately. Nothing is owed by you here, and a task telling you to wait is how a board fills up with items nobody can finish.

The request is filed and sitting with Ali. Nothing here is yours to move.

### What to do

The request is filed and sitting with Ali. Record its id so the decision can be found
later without searching.

Then **start another candidate**. Nothing here is yours to move, and waiting is not work.

### Done when

It records the change request id, so the decision can be found later without searching.

This stage is **not yours to clear**. Write what is needed, then start another candidate rather than waiting.

## Stage 8 of 8: The agent does it, and you watch

**Stage key:** `agent_watched`
**Whose move:** builder
**Produces:** `artifacts/capability/{slug}/70-watched-runs.md`
**Board row:** the story ending `L4-AGENT-WATCHED`

Approved. The agent runs it and you check the output against what you produced by hand. This is the rung, and only this counts toward the gate.

### What to do

Approved. The agent runs it and you watch.

Compare at least one agent run against the by-hand run you recorded, on the same inputs,
including the exceptions. State whether the threshold from the scope sheet was met.

Every run in the evidence window is approved by a named human before it takes effect,
and the record shows who. **This stage is the gate** — doing a capability by hand is real
progress and it is not this.

### Done when

It compares at least one agent run against the by-hand run, and states whether the threshold from the scope sheet was met.

Write `artifacts/capability/{slug}/70-watched-runs.md` and the checklist in `docs/agent/README.md` ticks on the next document sync. Nothing else can tick it: there is no flag and no API call.

---

# The gate for each rung

A rung is cleared when this many capabilities in your domain are being done by the agent,
watched. The number rises with the rung on purpose: an early rung asks you to get one thing
all the way through, a late one asks whether you can do it reliably.

| Rung | What it means | Capabilities the agent must do, watched |
|---|---|---|
| `R0` | Define the workflow, requirements, risks and human decisions. | 1 |
| `R1` | Prepare isolated development, fixtures and baseline tests. | 1 |
| `R2` | Answer questions using approved knowledge and records. | 2 |
| `R3` | Perform approved, user-initiated sandbox tool operations. | 2 |
| `R4` | Execute and verify stateful, multi-step sandbox tasks. | 3 |
| `R5` | Evaluate in shadow mode against approved reference outcomes. | 3 |
| `R6` | Conduct a separately approved, supervised production pilot. | 4 |
| `R7` | Automate only explicitly authorized action classes within limits. | 4 |
| `R8` | Coordinate necessary, authorized handoffs with other agents. | 5 |
| `R9` | Demonstrate reliable operation, monitoring, recovery and ownership. | 5 |
