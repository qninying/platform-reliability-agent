# Research Summary: Agentic AI for Platform Automation & Reliability
**Intern:** Quincy Nkwain Ninying | **Manager:** K.D. | **Date:** 2026-10-07
**Stage:** Pre-discovery research. I have not yet had access to the target platform. Everything below about how the agent should behave is the conceptual direction, not a final design. Platform details are open until discovery.
## 1. Five kinds of AI system
| Type | What it does | How independent | When a human steps in |
|---|---|---|---|
| Chatbot | Answers questions from what it knows or is given | Reactive; no actions | Always; the human does the work |
| Automated workflow | Follows predefined steps in a fixed order (an LLM may fill in some steps) | Runs on its own, but the path is fixed in code | When a step fails or an input falls outside expected cases |
| AI agent | Uses tools to complete a task and decides which tool to use next | Chooses its own steps within the tools it has been given | At approval points, and when it is uncertain or blocked |
| Agentic system | Plans, acts, checks the results, and adjusts until the goal is met or it has to stop | Loops through plan, act and verify | At defined checkpoints, at hard limits (cost, time, risk), and before anything irreversible |
| Multi-agent system | Several agents with separate roles that hand work to each other | Each agent works independently; coordination goes through a shared protocol | At handoffs that cross ownership, and when agents conflict or compete for resources |

Anthropic's guidance draws the key line here. In a **workflow**, code defines the path. In an **agent**, the model decides the path. Start with the simplest option that works, and add autonomy only when it measurably helps.

**Applied to this role:** a basic chatbot could answer "Did the job run?" if someone pasted in the logs. It cannot check for itself, and it never notices a problem first. An agentic version watches without being asked and spots problems early. It triages with evidence, acts only within approved limits, confirms the fix worked, and can say what it is waiting on. For existing apps, it can also turn a long investigation into a written summary that a human reviews.
## 2. What the agent is
The **Platform Automation & Reliability Agent** is meant to:
- observe platform operations and detect failures and abnormal behavior
- gather evidence, then investigate and triage incidents
- determine likely causes and recommend a fix
- carry out only actions it is explicitly authorized to take
- verify that the fix actually restored health
- keep an auditable record of its decisions and actions
- report unresolved problems and anything that needs escalating

**Core loop:** Observe → Detect → Investigate → Reason → Decide → Act → Verify → Report

**A command that runs without error is not a success.** Success means the platform condition it was meant to fix has recovered. For example, a re-run job counts only once it completes with the expected result.
## 3. Scope and non-goals
I own this one agent. Other team members are building other agents. My agent should eventually work with theirs through agreed interfaces, but coordinating multiple agents is not my initial responsibility.

**Not in scope:**
- implementing other agents, or becoming a universal orchestrator
- controlling business decisions that belong to other agents
- granting permissions to itself or to other agents, or creating unrestricted tools
- replacing deterministic monitoring and safety controls with LLM reasoning
- carrying out destructive or irreversible production actions on its own
- solving every infrastructure reliability problem
- acting as a general-purpose chatbot
## 4. Autonomy and safety boundaries
**Two layers:**
- **Agentic Reasoning Layer (LLM):** investigates, correlates evidence, diagnoses, plans, picks from the available tools, explains its reasoning, and recommends or requests actions it is permitted to take.
- **Deterministic Control Plane (plain code):** enforces permissions, policies, the list of allowed actions, retry and resource limits, kill switches and circuit breakers, audit requirements, and validation of every action before it runs.

> The LLM can determine what it believes should happen. The deterministic control layer determines whether it is actually allowed to happen.

The agent must never be able to grant itself permissions, change its own authorization policy, or get around the control plane. The control plane is defined here by its responsibilities only. How it is built depends on the platform.

**Staged autonomy:**
- **Level 1: Observe.** Read-only. Detects and reports.
- **Level 2: Diagnose.** Investigates, gathers evidence, works out likely causes, and recommends actions.
- **Level 3: Human-approved remediation.** Requests an action. An authorized human approves it, an approved mechanism carries it out, and the agent verifies recovery.
- **Level 4: Bounded autonomous remediation.** Eventually, proven, reversible, low-risk actions may run automatically under predefined policy.

High-risk, destructive, irreversible, security-sensitive and production-critical actions always need human approval. Level 4 is not assumed to be needed for the MVP.

**People and approvals (known):**
- **Sign-off:** K.D. (manager) gives sign-off, including on agent actions in production. A.M. oversees PR approvals, tool access and governance review.
- **New tools:** each MCP tool is scoped by K.D., then approved by A.M.

**Chat interface (concept):** a chat pane in the Colaberry portal. It lets A.M., K.D. and me ask the agent about incidents, evidence, actions and status, with answers grounded in its records. Every request in chat goes through the same authorization, approval, audit and control checks as anything else. Whether the pane is part of the MVP, and whether approvals happen in chat, are both still open.
## 5. Candidate use cases
Two candidates for the MVP. The final choice will be made once I have access to the target platform and have assessed the existing operational environment.
- **Scheduled-job monitoring (reference):** used as the reference use case because it shows the complete reliability loop clearly (flow below).
- **Understanding existing apps and drafting runbooks:** the agent reads an app's code, configuration, logs and deploy history. It then drafts what the app does, what it depends on and why, plus runbooks for the failures it observes, for K.D. to review. It is read-only (Levels 1 and 2), and later remediation depends on it, since fixes need runbooks.

**Example flow:**
1. A scheduled job runs, and its telemetry and history are recorded.
2. An abnormal condition is detected.
3. The agent investigates and gathers evidence.
4. It diagnoses the likely cause and recommends a fix.
5. A human approves.
6. The approved action runs.
7. The agent verifies recovery.
8. The incident is closed or escalated.

Whatever MVP is chosen, it should show this closed loop, not just produce alerts.
## 6. Known today vs. requires discovery
**Known:**
- K.D. is the manager and gives sign-off. A.M. oversees PR approvals, tool access and governance review.
- Tool access is admin-controlled, and agents cannot grant themselves tools.
- The chat pane, if built, lives in the Colaberry portal.

**Assumption:** the platform runs scheduled jobs that are worth monitoring. K.D. needs to confirm this.

**Discovery areas**, each to be recorded as Known, Assumption, Open Question or Constraint:
- **Platform:** which systems, services, jobs and infrastructure will the agent observe or manage?
- **Observability:** which logs, metrics, events, monitoring tools and health signals already exist?
- **Access & Security:** what identity will the agent use? What permissions will it have, what can it do, and what needs approval?
- **Operations:** which runbooks, incident processes, escalation paths, fix mechanisms and sources of truth already exist?
- **Agent Integration:** what will be needed to communicate with other team members' agents?

**Decision gate:** detailed implementation architecture is not finalized until discovery establishes the actual systems, telemetry, integration points, permissions and operational boundaries. Until then, no database, cloud service, monitoring product, message broker, deployment platform, framework or infrastructure component is chosen. Any technology named here is an example only.
## 7. Future integration with other agents
Later, the agent may need to:
- receive health signals and incident handoffs
- report platform degradation or dependencies that are unavailable
- request information from other agents
- isolate an unhealthy component or agent, but only if platform policy explicitly authorizes it

Candidate standards, neither yet decided:
- **MCP:** for controlled access to tools.
- **A2A, or another agreed protocol:** for communication between agents.

Other agents may eventually need to expose basic operational information, such as:
- identity and role
- owner and version
- health status and current task
- heartbeat or last-seen time
- expected resource use
- who to escalate to

This is a future interoperability consideration. It is not an MVP requirement, and there is no schema yet.
## 8. Success criteria
| Area | Metric |
|---|---|
| Detection | Detection time; detection accuracy; false-positive rate |
| Diagnosis | Diagnosis accuracy; mean time to diagnosis |
| Remediation | Mean time to fix; fix success rate; share of actions verified after running |
| Workload | Less manual investigation; less repetitive operational work |
| Safety | Unauthorized actions attempted and blocked |

No targets are set. Each metric is first measured against the current process, once the platform is understood.
## 9. Key takeaways and principles
- **Eliminating toil (SRE Book):** automate manual, repetitive work that grows with the system. Measure it before and after.
- **Monitoring distributed systems (SRE Book):** alert on symptoms users feel. Every alert must call for action, or people learn to ignore alerts.
- **SLOs and alerting on SLOs (SRE Book, SRE Workbook):** define "reliable enough" first, then alert when that target is at risk.
- **Handling overload (SRE Book) and circuit breakers (Fowler, *Release It!*):** cut off a failing component quickly so it cannot drag others down.
- **Claude API and MCP courses (Anthropic Academy):** tools are how an agent acts. MCP is a standard, auditable way to expose them.
- **A2A protocol:** a shared standard for agents to discover and message each other.
- **Agentic AI and Evaluating AI Agents (DeepLearning.AI):** reflection, tool use, planning and multi-agent patterns. Evaluate agents with measurements, not impressions.
- **"Demo to Production" (video):** a useful checklist of production layers. It underweights action guardrails, prompt injection through logs, the agent's own identity, and failure handling.

**Principles:**
- Start with the simplest architecture that works.
- Add autonomy only when it creates measurable value.
- Automate repetitive operational work.
- Alert on actionable symptoms, not noise.
- Define reliability expectations before alerting.
- Use bounded actions and circuit breakers.
- Make tool access explicit and auditable.
- Evaluate on measured outcomes, not impressive demos.
- Do not add complexity just because something is described as "agentic."
## 10. Guiding principle
> The Platform Automation & Reliability Agent is responsible for determining what is wrong, what evidence supports that conclusion, what should happen next, and whether the intervention worked. Deterministic platform controls remain responsible for determining what the agent is actually authorized to do.
## 11. Sources
**Agent design**
- Anthropic, *Building Effective Agents*: https://www.anthropic.com/engineering/building-effective-agents

**Anthropic courses (Anthropic Academy)**
- *Building with the Claude API*: https://anthropic.skilljar.com/claude-with-the-anthropic-api
- *Introduction to Model Context Protocol*: https://anthropic.skilljar.com/introduction-to-model-context-protocol

**Other courses**
- DeepLearning.AI, *Agentic AI* (Andrew Ng): https://www.deeplearning.ai/courses/agentic-ai/
- DeepLearning.AI, *Evaluating AI Agents*: https://www.deeplearning.ai/short-courses/evaluating-ai-agents/

**Books: Google SRE (free online at sre.google)**
- Beyer, Jones, Petoff, Murphy (eds.), *Site Reliability Engineering: How Google Runs Production Systems* (O'Reilly, 2016): https://sre.google/sre-book/table-of-contents/
  - Ch. 4, Service Level Objectives: https://sre.google/sre-book/service-level-objectives/
  - Ch. 5, Eliminating Toil: https://sre.google/sre-book/eliminating-toil/
  - Ch. 6, Monitoring Distributed Systems: https://sre.google/sre-book/monitoring-distributed-systems/
  - Ch. 21, Handling Overload: https://sre.google/sre-book/handling-overload/
- Beyer, Murphy, Rensin, Kawahara, Thorne (eds.), *The Site Reliability Workbook: Practical Ways to Implement SRE* (O'Reilly, 2018): https://sre.google/workbook/table-of-contents/
  - Ch. 5, Alerting on SLOs: https://sre.google/workbook/alerting-on-slos/

**Other books and articles**
- Michael T. Nygard, *Release It! Design and Deploy Production-Ready Software*, 2nd ed. (Pragmatic Bookshelf, 2018): https://pragprog.com/titles/mnee2/release-it-second-edition/
- Martin Fowler, *CircuitBreaker*: https://martinfowler.com/bliki/CircuitBreaker.html

**Protocols**
- Model Context Protocol: https://modelcontextprotocol.io/
- Agent2Agent (A2A) Protocol: https://a2a-protocol.org/ (spec repo: https://github.com/a2aproject/A2A)

**Video**
- Sanjay Kumar, "Demo to Production": https://www.youtube.com/watch?v=ZIAzZtKWmbI
## 12. Open questions for K.D.
**Already asked; K.D. will answer once we have platform access:**
1. Can you walk me through a real task, from start to finish?
2. Which responsibilities support DA students today, and how should they work for AI students?
3. What could the agent handle on its own, and what needs your approval?
4. What would make this agent valuable to you?

**New:**
5. Scope: should the agent start with platform reliability and add cross-agent control (such as a hard stop for a misbehaving agent) later?
6. Which comes first: understanding existing apps and drafting runbooks, or monitoring scheduled jobs?
7. Which existing app would be most useful to document first?
8. Is the chat pane in the MVP? Should approvals happen in chat or on a separate screen?
9. When the production approver is unavailable, who is the backup, and what happens to an unanswered request? (Proposal: it expires and is escalated; silence never counts as approval.)
10. Is a team-wide protocol for agents talking to each other being decided, and by whom? Who can authorize one agent isolating another? (for A.M.)
11. Do deployment support and compliance monitoring fall within this agent's scope, or only reliability?
12. Is there any existing documentation, checklist, report or workflow you can share?
13. Can we set up a recurring weekly meeting? What day and time work for you?
