# End to end: a repair proven safe to repeat

Part of the [Ellis README](../README.md).

The platform's auto-repair agent fixes broken prompt links on a timer, every minute. Ellis runs the same two
authorized repairs, but only on a sandbox copy, and proves that running them twice changes things once.

```
npm run orchestration-repair -- --fixture examples/orchestration-repair.fixture.json
```

1. **Signal.** Six fault events, shaped like the platform's `ai_system_events` rows: one of each authorized
   kind, a duplicate (the monitor runs every minute), and faults Ellis must not touch.
2. **Plan.** Each fault is matched against the authorized repair set and an allowlist of columns. A fault
   outside the set is reported, not improvised on.
3. **Act, in the sandbox.** Every write goes through a store that journals it.
4. **Verify.** Each changed value is read back; any mismatch marks the run failed
   ([`orchestrationAutoRepair.ts:92`](../src/capabilities/orchestrationAutoRepair.ts#L92)).
5. **Repeat.** A second run must make no change, counted from the journal.

Excerpt of the real output on that fixture (trimmed; the fixture is test data, not production):

```json
{
  "runs": [
    { "run": 1, "outcome": "changed", "verified": true,
      "applied": [ { "table": "prompt_templates", "row_id": "prompt-off", "column": "is_active",
                     "from": false, "to": true, "repair_class": "inactive_prompt_reactivation" }, "...3 more" ],
      "no_op": [ { "fault_id": "evt-2", "reason": "duplicate signal: prompt_templates:prompt-off:is_active is already planned by an earlier fault" } ],
      "left_alone": [ "...2 more", { "fault_id": "evt-6", "event_type": "gating_deadlock",
                      "reason": "outside the authorized repair set; reported, not repaired" } ] },
    { "run": 2, "outcome": "no_op", "verified": true, "applied": [] }
  ],
  "total_changes": 4
}
```

6. **Approval boundary.** A production pilot is R6 and needs K.D.'s separate approval. One of the two repairs
   can undo a person's deliberate decision, so it needs K.D.'s decision before any production pilot ([write-up](capabilities/orchestration-auto-repair.md)).
