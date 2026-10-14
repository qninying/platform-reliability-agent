# Review: "Demo to Production. Architect a Real Agentic AI System (Step by Step)"
Sanjay Kumar, https://www.youtube.com/watch?v=ZIAzZtKWmbI (23 min). This review is based on the full transcript.

**Verdict:** a good foundation, but not the gold standard for this project. The video designs a bank's customer chatbot, which mostly reads data and answers questions. This project is an agent that takes actions in production.

## What it gets right
1. Starts from the business problem, with numbers. This is the structure a Problem Brief needs.
2. Builds the architecture one problem at a time, adding each component only when a concrete failure shows it is needed.
3. Separates AI engineering from ordinary software engineering. Most of a production agent is ordinary software engineering.
4. One MCP server per area, so tools live outside the agent's code.
5. Too many tools on one agent causes confusion, so keep the tool list small.
6. Evaluation against a "golden dataset". Here, that dataset would be replayed past incidents.
7. Observability of the agent itself: which agent ran, which tool it called, and with what inputs.
8. Tracking cost.

## What it misses for this project
1. **Guardrails on actions:** human approval levels, an action allowlist, a check that every action can be undone, and an off switch for the agent itself.
2. **Prompt injection:** logs and error messages are untrusted input, and text in them must never be treated as instructions.
3. **The agent's own identity:** its own service account with least privilege.
4. **Agents owned by different people:** needs an agreed message format and protocol (A2A). The video only covers one system under one coordinator.
5. **Failure handling on the agent's own calls:** timeouts, limited retries, circuit breakers, and idempotent actions.
6. **Letting the LLM decide routing:** for reliability work, detection and action selection should be plain code, with the LLM only reasoning and explaining.
7. **Self-hosting the LLM:** a fit for a bank's data rules, but probably unnecessary here. Masking secrets in logs before they reach the model matters more.

## How to use it
Use it as a checklist of layers the design must cover (problem framing, tools behind MCP, permissions, memory, evals, observability, cost, network edge), then add the seven reliability-specific items above.
