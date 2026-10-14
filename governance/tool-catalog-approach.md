# MCP Tool Governance and Catalog Approach

**Rule (A.M., 2026-10-06):** every tool the agent exposes through its MCP server needs approval. Agents cannot create or grant themselves tools.
**Flow (confirmed 2026-10-07):** K.D. reviews each tool for scope first, then A.M. approves.

## Principles
- The tool catalog is a formal deliverable. Unapproved tools are never registered.
- Approval is enforced in code: the MCP server registers only tools on the approved list, and that list lives in version control.
- Any change needs re-approval. That includes a new tool, or a read tool gaining a write ability.

## Fields for each tool entry
| Field | Example |
|---|---|
| Name and purpose | `get_job_run_history`: shows the last N runs of one scheduled job (example only) |
| Read or write | Read |
| What it can touch | One job's run records |
| Can it be undone? | N/A (read-only) / Yes, with how / No |
| Approval at runtime | None / K.D. approves each use / never automatic |
| Why it's needed | Traced to a specific pain point K.D. described |
| How it fails | Timeout, retry limit, what the agent sees on failure |

## Request approval in stages
1. **Read-only tools first:** listing, history, health status, recent errors.
2. **Reversible write tools later** (for example, pausing or resuming a job), backed by evidence that earlier diagnoses were correct.
3. **Probably never:** deploys, schema changes, deleting anything, editing job code.

**Open question for A.M.:** does approval cover only which tools exist, or also when write tools may run without a human?

Tool names are illustrative until platform discovery.
