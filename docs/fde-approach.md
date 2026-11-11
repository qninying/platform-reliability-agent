# Forward-deployed engineering approach

Part of the [Ellis README](../README.md).

| Step | What it meant here | Evidence |
|---|---|---|
| **Discover** | Classify the system, map the agent's anatomy onto the platform, interview the manager | [discovery](discovery/), each version approved by K.D. |
| **Map** | Inventory every timer, the wrapper that runs it and the row it reads; grants; admin sections | [`timer-inventory.example.json`](../examples/timer-inventory.example.json), [`agentGrants.ts`](../src/grants/agentGrants.ts) |
| **Bound** | Read-only interface, sandbox stores, per-capability autonomy ceilings | [decision 001](decisions/001-read-only-first-sandbox-for-change.md), [`sandbox/`](../src/sandbox) |
| **Build** | One narrow question per capability, against the real platform's rules, pinned to a commit | [`src/capabilities/`](../src/capabilities) |
| **Verify** | Happy path, failure path, boundaries, same-input-twice, and deliberate defects | [`test/`](../test), the Evidence section of each write-up |
| **Report** | Platform weaknesses found while building go to the governance reviewer | [findings that changed the platform](../README.md#findings-that-changed-the-platform) |
| **Observe** | First live export, compared with what the platform shows | outstanding: see [status](STATUS.md) |
| **Expand** | Promotion one rung at a time, on evidence K.D. approves | [autonomy](autonomy.md) |
