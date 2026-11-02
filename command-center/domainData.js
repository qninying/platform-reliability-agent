// Data rules for the Agent domain tab: the ladder, which capability sits where, and which records are gaps. No
// rendering here. Works in a browser and under the test runner.
//
// Authority is never computed here. The platform runs effectiveAuthority() (services/agentDomain/autonomyLadder.ts)
// and commits what it returns in .colaberry/agent-domain.json (agentDomainSnapshot.ts), so the page renders that
// and never what a capability record asks for.
(function () {
  const RUNGS = [
    ['autonomy:R0', 'Define the workflow, requirements, risks and human decisions.'],
    ['autonomy:R1', 'Prepare isolated development, fixtures and baseline tests.'],
    ['autonomy:R2', 'Answer questions using approved knowledge and records.'],
    ['autonomy:R3', 'Perform approved, user-initiated sandbox tool operations.'],
    ['autonomy:R4', 'Execute and verify stateful, multi-step sandbox tasks.'],
    ['autonomy:R5', 'Evaluate in shadow mode against approved reference outcomes.'],
    ['autonomy:R6', 'Conduct a separately approved, supervised production pilot.'],
    ['autonomy:R7', 'Automate only explicitly authorized action classes within limits.'],
    ['autonomy:R8', 'Coordinate necessary, authorized handoffs with other agents.'],
    ['autonomy:R9', 'Demonstrate reliable operation, monitoring, recovery and ownership.'],
  ];
  // Coordinated handoff does not exist on the platform, so this rung is unreachable by fact, not by choice.
  const UNREACHABLE_BY_FACT = 'autonomy:R8';
  const index = (rung) => RUNGS.findIndex(([r]) => r === rung);

  // The platform's answer for one capability, or null when the snapshot does not carry it.
  function authorityFor(snapshot, capabilityId) {
    return ((snapshot && snapshot.authority) || []).find((a) => a.capability_id === capabilityId) || null;
  }

  // One state per rung for one capability: reachable up to its ceiling, unreachable above it. `now` marks the
  // rung its effective authority sits on, when the platform gave one.
  function rungStates(c, effective) {
    const top = index(c.max_permitted_autonomy);
    const at = effective ? index(effective) : -1;
    return RUNGS.map(([rung], i) => {
      const now = i === at;
      if (rung === UNREACHABLE_BY_FACT) return { rung, state: 'by_fact', now };
      if (i > top) return { rung, state: 'unreachable', now };
      return { rung, state: i === top ? 'ceiling' : 'reachable', now };
    });
  }

  const behaviourByRung = (caps) => RUNGS.map(([rung, words]) => ({
    rung, words,
    entries: caps.flatMap((c) => (c.release_behaviour || []).filter((b) => b.autonomy === rung).map((b) => ({ capability: c.name, behaviour: b.behaviour, acceptance: b.acceptance_criteria }))),
  }));

  const gaps = (caps) => ({
    draft: caps.filter((c) => c.requirement_validation_state === 'draft').length,
    no_behaviour: caps.filter((c) => !(c.release_behaviour || []).length).map((c) => c.name),
  });

  // `kind` omitted means change, as in agentChangeRequestService.ts:114.
  const split = (rows) => ({ tools: rows.filter((r) => r.kind === 'tool'), changes: rows.filter((r) => r.kind !== 'tool') });

  const api = { RUNGS, UNREACHABLE_BY_FACT, index, authorityFor, rungStates, behaviourByRung, gaps, split };
  if (typeof window !== 'undefined') { window.CC = window.CC || {}; window.CC.domain = api; }
  if (typeof module !== 'undefined') module.exports = api;
})();
