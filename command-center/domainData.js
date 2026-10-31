// Data rules for the Agent domain tab: the ladder, effective authority, which endpoint answers what, and which
// records are gaps. No rendering here. Works in a browser and under the test runner.
//
// effectiveAuthority is copied from the platform (services/agentDomain/autonomyLadder.ts:185-222, commit
// bbde6ef), because this public page cannot call it. It must stay a copy of that function: render what it
// returns, never what a capability record asks for. A copy, so test/commandCenterDomain.test.ts pins its cases.
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
  const isStage = (rung) => index(rung) >= 0;

  function effectiveAuthority(input) {
    const reasons = [];
    if (!isStage(input.approved_autonomy)) {
      reasons.push('no_approved_autonomy');
      return { capability_id: input.capability_id, effective_autonomy: null, reasons };
    }
    let level = input.approved_autonomy;
    if (isStage(input.max_permitted_autonomy) && index(input.max_permitted_autonomy) < index(level)) {
      level = input.max_permitted_autonomy;
      reasons.push('capped_by_max_permitted');
    }
    if (input.environment === 'production' && index(level) >= index('autonomy:R6')) reasons.push('production_requires_separate_pilot_approval');
    if (input.granted_tools.length === 0 && index(level) > index('autonomy:R2')) {
      level = 'autonomy:R2';
      reasons.push('no_tool_grants');
    }
    if (input.human_decision) {
      reasons.push('human_decision_required_at_every_level');
      if (index(level) > index('autonomy:R5')) {
        level = 'autonomy:R5';
        reasons.push('capped_below_automation_because_human_decision');
      }
    }
    return { capability_id: input.capability_id, effective_autonomy: level, reasons };
  }

  // What the record asks for, put through the platform's rule. No level has been approved and no tool granted.
  function authorityOf(c, grantedTools) {
    const asks = c.max_permitted_autonomy;
    return { asks, ...effectiveAuthority({ capability_id: c.capability_id, approved_autonomy: asks, max_permitted_autonomy: asks, granted_tools: grantedTools, environment: 'sandbox', human_decision: c.human_decision === true }) };
  }

  // One state per rung for one capability: reachable up to its ceiling, unreachable above it.
  function rungStates(c) {
    const top = index(c.max_permitted_autonomy);
    return RUNGS.map(([rung], i) => {
      if (rung === UNREACHABLE_BY_FACT) return { rung, state: 'by_fact' };
      if (i > top) return { rung, state: 'unreachable' };
      return { rung, state: i === top ? 'ceiling' : 'reachable' };
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

  // Names a saved endpoint response by its shape. Anything else is refused, never guessed at.
  function classify(body) {
    if (!body || typeof body !== 'object') return null;
    if (Array.isArray(body.domains) && 'resolved_identities' in body) return 'mine';
    if (Array.isArray(body.change_requests)) return 'requests';
    return null;
  }

  const platformRow = (mine) => ((mine && mine.domains) || []).find((d) => d.domain_key === 'platform') || null;
  // `kind` omitted means change, as in agentChangeRequestService.ts:114.
  const split = (rows) => ({ tools: rows.filter((r) => r.kind === 'tool'), changes: rows.filter((r) => r.kind !== 'tool') });

  const api = { RUNGS, UNREACHABLE_BY_FACT, index, effectiveAuthority, authorityOf, rungStates, behaviourByRung, gaps, classify, platformRow, split };
  if (typeof window !== 'undefined') { window.CC = window.CC || {}; window.CC.domain = api; }
  if (typeof module !== 'undefined') module.exports = api;
})();
