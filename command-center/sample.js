// Made-up data for Sample mode only. Every screen that shows it is labelled SAMPLE.
// It shows the shape of a finished Command Center; none of it describes this project.
(function () {
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  const day = (offset) => new Date(now + offset * 86400000).toISOString().slice(0, 10);

  const stories = [
    ['SAMPLE-1', 'Watch scheduler health every five minutes', 'r0', 'verified'],
    ['SAMPLE-2', 'Trace a failed job back to its run', 'r0', 'verified'],
    ['SAMPLE-3', 'Weekly reliability briefing for the manager', 'r0', 'in_progress'],
    ['SAMPLE-4', 'Flag scheduled jobs that record nothing', 'r1', 'in_progress'],
    ['SAMPLE-5', 'Propose a threshold and replay it on last month', 'r1', 'not_started'],
    ['SAMPLE-6', 'Draft a runbook after a confirmed diagnosis', 'r2', 'not_started'],
  ];

  function build() {
    const plan = {
      schema_version: 2,
      project: { name: 'sample-project', descriptor: 'A made-up reliability agent, shown for layout only.' },
      schedule: { build_start: day(-20), build_end: day(30), demo_day: day(35), demo_release_key: 'r1' },
      releases: [
        { key: 'r0', name: 'Read-only watch', starts_on: day(-20), ends_on: day(-3), story_ids: ['SAMPLE-1', 'SAMPLE-2', 'SAMPLE-3'], is_demo_target: false },
        { key: 'r1', name: 'Diagnosis', starts_on: day(-3), ends_on: day(14), story_ids: ['SAMPLE-4', 'SAMPLE-5'], is_demo_target: true },
        { key: 'r2', name: 'Runbooks', starts_on: day(14), ends_on: day(30), story_ids: ['SAMPLE-6'], is_demo_target: false },
      ],
      stories: stories.map(([id, title, release], i) => ({
        id, title, release,
        narrative: `As an on-call engineer, I want to ${title.toLowerCase()}, so that problems are found before users report them.`,
        acceptance: ['The result cites the record it came from.', 'A person checked it against a known answer.'],
        due_on: day(-10 + i * 6), due_baseline_on: day(-12 + i * 5),
      })),
      requirements: [
        { id: 'SAMPLE-REQ-1', statement: 'Every finding cites the record it came from.', kind: 'SAFE', priority: 'must', fulfilled_by: ['SAMPLE-1', 'SAMPLE-2'] },
        { id: 'SAMPLE-REQ-2', statement: 'The manager receives a weekly briefing.', kind: 'FEATURE', priority: 'should', fulfilled_by: ['SAMPLE-3'] },
      ],
      agents: [
        { name: 'Sample Watcher', purpose: 'Reads scheduler records and flags stalls.', trigger_type: 'schedule', trigger: 'every 5 minutes',
          inputs: ['scheduler registry'], outputs: ['health verdict'], autonomy_level: 'R2', approval_gates: ['manager approves any change'],
          escalation_rules: ['page the manager after two failed runs'], skills: [], owns: ['SAMPLE-1', 'SAMPLE-2'] },
      ],
      derived: {
        measures: [{ id: 'SAMPLE-M1', statement: 'Median time from failure to diagnosis falls below 30 minutes.' }],
        roles: ['on-call engineer', 'manager'],
        guardrails: [{ id: 'SAMPLE-REQ-1', statement: 'Every finding cites the record it came from.' }],
        systems: ['Scheduler', 'Activity log', 'Ticket queue'],
        counts: { agents_by_autonomy: { R2: 1 } },
      },
    };
    const state = Object.fromEntries(stories.map(([id, , , s]) => [id, s]));
    const progress = {
      schema_version: 2,
      totals: { stories_total: 6, stories_verified: 2, criteria_total: 12, criteria_passed: 5, points_awarded: 30 },
      stories: stories.map(([id]) => ({
        id,
        criteria: [
          { text: 'The result cites the record it came from.', passed: state[id] !== 'not_started' },
          { text: 'A person checked it against a known answer.', passed: state[id] === 'verified' },
        ],
        verification: { state: state[id], points_awarded: state[id] === 'verified' ? 15 : null, commit_sha: state[id] === 'verified' ? 'sample00' : null },
      })),
    };
    return { plan, progress, manifest: { generated_at: iso(0.2) }, profile: null, errors: [] };
  }

  window.CC = window.CC || {};
  window.CC.sampleData = build;
})();
