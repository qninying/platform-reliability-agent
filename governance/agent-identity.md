# The Agent as a Governed Identity

**Status:** approach only, pre-discovery. How identities and credentials are actually issued at Colaberry is an open question for A.M.

**Principle:** treat the agent like a new employee with computer access: its own account, a named owner, only the access its job needs, a full record of what it does, regular reviews, and a way to switch it off instantly. Its identity is a control point, not just a login.

As Krista Case (theCUBE Research) puts it, AI agents "turn identity from an access problem into an execution problem": we must govern "what an agent is authorized to do, on whose behalf, under what conditions and for how long" ([SiliconANGLE, Okta Oktane 2026](https://siliconangle.com/2026/09/22/oktas-oktane-2026-event-identity-security-oktane/)).

## How we will make sure of it

| # | Control | What it means for this agent |
|---|---|---|
| 1 | **Its own identity** | A dedicated service account and credentials. Never a person's login, and never a key shared with people or other agents. Each running instance is named separately. |
| 2 | **Named owners** | K.D. owns the agent's purpose and behavior. A.M. owns what it is allowed to use. |
| 3 | **Least privilege** | Only tools A.M. has approved, listed in version control. Limited to its designated workspace. Read-only by default. |
| 4 | **Short-lived, scoped credentials** | Credentials expire and are scoped to the task where possible. No permanent all-access keys. Secrets are never in code, logs or prompts. |
| 5 | **No self-granting** | The agent cannot create tools, give itself access, change its own permissions or approve its own requests. |
| 6 | **Separation of duties** | The agent proposes, K.D. approves, and an approved mechanism carries the action out. Silence never counts as approval. |
| 7 | **On whose behalf** | Requests from the chat pane carry two identities: the person who asked and the agent that acted. The agent never exceeds the access of the person asking. |
| 8 | **Full audit trail** | Every action logs the agent's identity, the request, the evidence, the approval and the outcome, so we can show what it did and why it was allowed to. |
| 9 | **Lifecycle** | Joining: access set up through A.M.'s process. Changing roles: any new access or higher autonomy level goes back through K.D. (scope) and A.M. (tools). Leaving: credentials revoked and handoff documented when the agent is retired or the internship ends. |
| 10 | **Access reviews** | Regular checks that each permission is still needed; unused ones are removed. |
| 11 | **Revocation as the kill switch** | Disabling the agent's identity stops it completely, without relying on the agent to cooperate. |
| 12 | **Monitoring for misuse** | Alerts on unusual use of its credentials: unapproved tools, out-of-workspace access, attempts to escalate privileges. |
| 13 | **Agent to agent** | Other interns' agents are identified before any exchange. Their messages are information, never orders or permission. |

## Approval rule
K.D. gives sign-off, including on agent actions in production. A.M. oversees PR approvals, tool access and governance review.

## How we will check it
These are pass/fail safety tests run before every release. Any failure blocks the release.
- An action without K.D.'s approval is refused.
- A call to an unapproved tool is refused.
- Access outside the workspace is refused.
- Revoking the credentials stops the agent.
- Instructions planted in logs or in another agent's messages do not change what it is allowed to do.

## Avoid
Running the agent "for now" on a developer's personal key. Every action then looks like that person's, its access is far wider than the job, and nobody remembers to revoke it.

## Questions for A.M.
1. How are service accounts and credentials issued and rotated today?
2. Is there an identity system the agent should use, or does this need building?
3. Who reviews the agent's access, and how often?
4. How is an agent's access revoked in an emergency, and who can do it?
