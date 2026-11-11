# Glossary

Part of the [Ellis README](../README.md). Plain-language meanings for the terms used across this repository.

## The autonomy ladder (R0 to R9)

The platform defines how much an agent may do, one level at a time. Each level needs evidence and a named
person's approval before the next. The platform's wording is quoted from
[`autonomyLadder.ts`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/44430870b/backend/src/services/agentDomain/autonomyLadder.ts#L59-L68).

| Level | Platform meaning | In plain words |
|---|---|---|
| R0 | Define the workflow, requirements, risks and human decisions. | Agree what the job is before building |
| R1 | Prepare isolated development, fixtures and baseline tests. | Set up a safe place to test and a starting test suite |
| R2 | Answer questions using approved knowledge and records. | Report and recommend; change nothing |
| R3 | Perform approved, user-initiated sandbox tool operations. | Act on a copy when a person asks |
| R4 | Execute and verify stateful, multi-step sandbox tasks. | Carry out a multi-step job on a copy and prove it worked |
| R5 | Evaluate in shadow mode against approved reference outcomes. | Run alongside people, unacted on, and get scored |
| R6 | Conduct a separately approved, supervised production pilot. | First live use, watched closely |
| R7 | Automate only explicitly authorized action classes within limits. | Act alone, only on named kinds of action |
| R8 | Coordinate necessary, authorized handoffs with other agents. | Work with other agents |
| R9 | Demonstrate reliable operation, monitoring, recovery and ownership. | Run it like a mature production service |

## Terms

| Term | Meaning |
|---|---|
| **Capability** | One narrow job Ellis does, answering one operational question (for example "are the cron jobs running?"). Each has code, tests and a write-up. |
| **Rung** | One step of the autonomy ladder for one capability. A capability can be at R2 for reporting while its R4 rung is built and tested in a sandbox. |
| **Story / verified** | A unit of work in the platform's build plan. *Verified* means the platform itself confirmed it from a commit in this repository, not that Ellis's author says so. |
| **Verdict** | Every check returns one of four: `ok`, `problem`, `unknown` (Ellis could not see enough to say) or `partly_unknown` (some parts seen, the blind spots named). `ok` and `problem` must cite the rows behind them. |
| **Unknown is never healthy** | The core rule: missing evidence is reported as `unknown`, never as `ok`. See [no evidence is not health](no-evidence-is-not-health.md). |
| **Evidence** | The table and row id a verdict came from, so a person can check it. |
| **Blind spot** | Something a check could not see, listed in its output. |
| **Severity** | How serious a problem is, taken only from the manager's severity table. Until that table has rules, severity reads `unassigned`. |
| **Export / snapshot** | A dated copy of platform records that Ellis reads. Ellis never connects to the live platform. |
| **Read boundary** | Capabilities see the platform through an interface with no write method, so they cannot change it. |
| **Sandbox** | A disposable copy where a change can be tried, read back and repeated without touching production. |
| **Idempotent** | Running the same thing twice changes things once; the second run must change nothing. |
| **Pinning** | Every rule copied from the platform names the platform commit and line it came from, and can be re-checked against the live code. |
| **Mutation check** | A key rule is deliberately broken in the code to prove a named test fails, then restored. It shows the tests test something ([decision 004](decisions/004-prove-each-test-can-fail.md)). |
| **Shadow evaluation** | Ellis gives verdicts that nobody acts on; people later record what really happened, and Ellis is scored on misses and false alarms ([shadow evaluation](shadow-evaluation.md)). |
| **Blind review sheet** | The form a person fills in for shadow scoring, with Ellis's verdict hidden so they are not anchored by it. |
| **Gate and broker** | Planned: the layer through which the reasoning agent calls Ellis's checks as tools, with approval enforced. |
| **Command Center** | The live project page, built from the platform's build plan files. |
| **K.D. / A.M.** | The platform's manager (AI Engineer), who approves promotions and production actions; and the reviewer of platform findings and governance. |
| **Forward Deployed Engineer** | An engineer embedded with the people who own a system, doing discovery, design, build and rollout on their real environment. |
