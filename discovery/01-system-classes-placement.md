# Compare the five system classes, and place this domain among them

**Story:** Release 1, Discovery and validation · **Version:** 2 · **Date:** 2026-10-19 · **Autonomy level:** R0
**Review:** approved by K.D. on 2026-10-19 (version 2), recorded in the review artifact. This file is a copy of the approved content, kept as evidence.

## The five system classes

| Class | What it does | Who decides the path | Where a human steps in |
|---|---|---|---|
| Chatbot | Answers questions from what it knows or is given | Nobody; it only answers | Always; the human does the work |
| Automated workflow | Runs predefined steps in a fixed order; an LLM may fill one step | Code | When a step fails or an input is unexpected |
| AI agent | Uses tools to finish a task and chooses the next tool itself | The model, within the tools it is given | At approval points, or when it is uncertain or blocked |
| **Agentic system** | Plans, acts, checks the result and adjusts until the goal is met or it must stop | The model, looping plan, act, verify | At checkpoints, at hard limits (cost, time, risk), and before anything irreversible |
| Multi-agent system | Several agents with separate roles hand work to each other | Each agent, coordinating through a shared protocol | At handoffs that cross ownership, and when agents conflict |

In a workflow, code defines the path. In an agent, the model decides it.

## Where the platform domain sits

| | |
|---|---|
| **Class** | **Agentic system.** Platform reliability work needs something that watches without being asked, triages with evidence, and checks that its own result is right. A chatbot cannot check anything for itself and never notices a problem first. |
| **Build** | Build the agent first. Its planner generates each investigation workflow at runtime from the evidence it finds, so no path is hard-coded. Measure cost, accuracy and latency once it runs. Add deterministic pieces only where the measurements show the agent is inefficient. |
| **Input** | The platform's existing logging is the deterministic part. The agent reads it where it lives to learn how the system operates, and never copies it. |
| **Later** | One domain agent among several on the platform, handing work to the others. That makes it part of a multi-agent system. |
| **Today** | R0, read-only. The agent changes nothing. Every action needs a human. |

## Version history
- **Version 1:** placed the domain as an agentic system, starting from deterministic workflows plus one read-only agent.
- **Version 2:** placement kept. The agent is built first and generates its own workflows; measurements decide whether deterministic pieces are added; the existing logging is named as the agent's deterministic input.
