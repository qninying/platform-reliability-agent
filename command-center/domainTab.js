// The Agent domain tab: six panels, each naming the endpoint behind it. A panel is loading, ready, or says in words
// that it got nothing, and those three look different. This page is public and holds no admin session, so it calls no
// admin endpoint. It reads what the platform commits instead: command-center/domain.json (the capability records those
// routes serve) and .colaberry/agent-domain.json (the agent, authority and governance snapshot, A.M.'s decision of
// 2026-11-02), with the snapshot's age read from .colaberry/manifest.json. Blank fields stay blank and say why.
(function () {
  const CC = window.CC;
  const { esc, table } = CC.ui;
  const D = CC.domain;
  const short = (r) => String(r || '').replace('autonomy:', '');
  const SNAPSHOT = '.colaberry/agent-domain.json';
  const ME = 'GET /api/admin/agent-domains-mine';
  const REQ = 'GET /api/admin/agent-domain-change-requests-mine';
  const RECORD = 'GET /api/admin/agent-domains/platform and /coverage';
  // The name this repository has used since 2026-10-20. Shown only beside the platform's own value, never in its place.
  const REPO_NAME = 'Ellis';

  function panel(n, title, question, read, state, inner) {
    const chip = { loading: 'Loading', ready: 'Read', nothing: 'Nothing returned' }[state];
    return `<section class="panel dp ${state}" aria-busy="${state === 'loading'}"><h2>${n}. ${esc(title)} <span class="chip dp-${state}">${chip}</span></h2>
      <p class="lead">${esc(question)}</p><p class="read"><span class="label">Endpoint</span> ${read}</p>${inner}</section>`;
  }
  const fromFile = (d) => `<code>${esc(RECORD)}</code>. Not called: this public page holds no admin session. Read instead: <code>${esc(d.source.file)}</code> at commit <code>${esc(d.source.commit)}</code>, the records those routes serve.`;
  const viaSnapshot = (route, s) => `<code>${esc(route)}</code>. Not called: this public page holds no admin session. ${s ? `Read instead: <code>${SNAPSHOT}</code>, which the platform writes from that route.` : `<code>${SNAPSHOT}</code>, which carries its answer, could not be read.`}`;
  const blank = (why) => `<span class="blank">Not available: ${esc(why)}</span>`;
  const notRecorded = (s, field) => ((s && s.not_recorded) || []).find((n) => n.field === field);

  function employee(s) {
    const q = 'Does it exist, and what is it allowed to do?';
    if (!s) return panel(1, 'Your employee', q, viaSnapshot(ME, s), 'nothing', '<p>Nothing was returned, so this page cannot say whether the agent exists.</p>');
    const a = s.agent || {};
    if (!a.exists) return panel(1, 'Your employee', q, viaSnapshot(ME, s), 'nothing', '<p>No agent yet: no <code>ai_agents</code> row is linked to this domain.</p>');
    const setBy = notRecorded(s, 'agent.autonomy_level_set_by');
    const source = { auto: 'set automatically, not chosen by a person', manual: 'chosen by a person' }[a.autonomy_level_source] || a.autonomy_level_source;
    return panel(1, 'Your employee', q, viaSnapshot(ME, s), 'ready', table(['Field', 'Value'], [
      ['agent_name', a.display_name ? esc(a.display_name) : `Not named on the platform yet <small>(this repository calls it ${REPO_NAME}; naming it on the portal is pending. Agent id <code>${esc(a.agent_id)}</code>)</small>`],
      ['enabled', a.enabled === true ? 'Yes' : a.enabled === false ? 'No' : blank('not recorded')],
      ['autonomy_level', a.autonomy_level ? `<code>${esc(a.autonomy_level)}</code> <small>on the agent's own scale (${esc((s.autonomy_models || {}).agent_level || 'observe | suggest | act_audited | communicate')}), not a ladder rung</small>` : blank('not recorded')],
      ['Tools granted', esc(a.tools_granted_count ?? (a.tools_granted || []).length)],
      ['Autonomy last set', a.autonomy_level_set_at ? `${esc(a.autonomy_level_set_at)}${source ? `, ${esc(source)}` : ''}` : blank('not recorded')],
      ['Set by whom', blank(setBy ? setBy.reason : 'the snapshot does not say')],
    ].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)));
  }

  const draft = (st) => `<span class="chip ${st === 'draft' ? 'in_progress' : 'not_started'}">${esc(st)}</span>`;
  function authorityCell(s, c) {
    const a = D.authorityFor(s, c.capability_id);
    if (!a) return blank(s ? 'the snapshot carries no answer for it' : `${SNAPSHOT} could not be read`);
    return `<strong>${esc(a.effective_autonomy ? short(a.effective_autonomy) : 'none')}</strong><br><small>${(a.reasons || []).map(esc).join(', ') || 'no limit applied'}</small>`;
  }
  function ruleLine(s) {
    const r = s && s.authority_rule;
    if (!r) return '';
    return r.binds_nothing
      ? `<p class="lead"><strong>The no-tool-grants rule binds nothing today:</strong> ${esc(r.approved_above_r2)} capabilities are approved above R2, so nothing is forced down to R2 with <code>no_tool_grants</code>.</p>`
      : `<p class="lead"><strong>The no-tool-grants rule binds:</strong> ${esc(r.approved_above_r2)} capabilities are approved above R2 with no tools granted, and each is forced down to R2 with <code>no_tool_grants</code>.</p>`;
  }
  function inventory(d, s, verified) {
    const rows = d.capabilities.map((c) => `<tr><td>${esc(c.name)}${c.human_decision ? ' <span class="chip human">Human decision</span>' : ''}${verified.has(c.capability_id) ? ' <span class="chip not_started">Story verified, not authority</span>' : ''}</td><td>${esc(c.classification)}</td><td>${esc(c.implementation_state)}</td><td>${draft(c.requirement_validation_state)}</td><td>${esc(short(c.starting_autonomy))}</td><td>${esc(short(c.max_permitted_autonomy))}</td><td>${authorityCell(s, c)}</td></tr>`);
    return panel(2, 'Your capability inventory', 'What am I actually building?', fromFile(d), d.capabilities.length ? 'ready' : 'nothing',
      `<p class="lead">Effective authority is what the platform's <code>effectiveAuthority()</code> returned, read from <code>${SNAPSHOT}</code>. The ceiling is not authority.</p>${ruleLine(s)}
      ${table(['Capability', 'Classification', 'Implementation', 'Validation', 'Starts', 'Ceiling', 'Effective authority'], rows)}`);
  }

  function ladder(d, s) {
    const head = D.RUNGS.map(([r, words]) => `<li><strong>${esc(short(r))}</strong> ${esc(words)}${r === D.UNREACHABLE_BY_FACT ? ' <span class="chip by-fact">Unreachable by fact</span>' : ''}</li>`).join('');
    const cell = (st) => [st.state === 'ceiling' ? 'Ceiling' : st.state === 'by_fact' ? 'No' : st.state === 'unreachable' ? '×' : '', st.now ? 'Now' : ''].filter(Boolean).join(' · ');
    const rows = d.capabilities.map((c) => {
      const a = D.authorityFor(s, c.capability_id);
      return `<tr><td><details><summary>${esc(c.name)}</summary><small>Why it stops at ${esc(short(c.max_permitted_autonomy))}: ${esc(c.max_autonomy_rationale)}</small></details></td>${D.rungStates(c, a && a.effective_autonomy).map((st) => `<td class="rung ${st.state}${st.now ? ' now' : ''}" title="${esc(short(st.rung))}: ${st.state}${st.now ? ', effective authority now' : ''}">${cell(st)}</td>`).join('')}</tr>`;
    });
    const level = s && s.agent && s.agent.exists && s.agent.autonomy_level;
    const employeeRung = level
      ? `none. Its <code>autonomy_level</code> is <code>${esc(level)}</code>, on the agent's own scale. ${esc((s.autonomy_models || {}).warning || '')}`
      : blank(s ? 'no agent yet' : `${SNAPSHOT} could not be read`);
    return panel(3, 'The autonomy ladder', 'Where is this going?', fromFile(d), d.capabilities.length ? 'ready' : 'nothing',
      `<ol class="rungs">${head}</ol><p>Your employee's current rung: ${employeeRung}</p>
      <p class="lead">Now is the rung each capability's effective authority sits on. × is above that capability's ceiling, so it is unreachable, not future work. A ceiling is a decision with a reason: open a capability to read it.</p>
      ${table(['Capability', ...D.RUNGS.map(([r]) => short(r))], rows)}`);
  }

  function behaviour(d) {
    const groups = D.behaviourByRung(d.capabilities).map((g) => `<details><summary>${esc(short(g.rung))}: ${g.entries.length} defined</summary>${g.entries.length
      ? table(['Capability', 'Behaviour', 'Acceptance'], g.entries.map((e) => `<tr><td>${esc(e.capability)}</td><td>${esc(e.behaviour)}</td><td>${esc(e.acceptance)}</td></tr>`))
      : '<p>Nothing is written down for this rung.</p>'}</details>`).join('');
    return panel(4, 'Per-rung behaviour', 'What does the next rung require of me?', fromFile(d), d.capabilities.length ? 'ready' : 'nothing', groups);
  }

  function queueTable(rows) {
    const who = blank('the snapshot does not carry it');
    return table(['Title', 'Status', 'Proposed by', 'Decided by', 'When'], rows.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.status)}${r.declined_reason ? `<br><small>${esc(r.declined_reason)}</small>` : ''}</td><td>${who}</td><td>${r.approved_at ? who : 'Nobody yet'}</td><td>${esc(r.approved_at || r.requested_at || 'not recorded')}</td></tr>`));
  }
  function governance(s) {
    const q = 'What am I waiting on a human for?';
    const notice = `<p class="lead">A tool request is how a capability is asked for. Filing one grants nothing.${s && s.governance && s.governance.disclosure ? ` ${esc(s.governance.disclosure.replace('A filed request grants nothing. ', ''))}` : ''}</p>`;
    if (!s || !s.governance) return panel(5, 'Your governance queue', q, viaSnapshot(REQ, s), 'nothing', `<p>Nothing was returned, so this page cannot say what is waiting.</p>${notice}`);
    const { tools, changes } = D.split(s.governance.requests || []);
    if (!tools.length && !changes.length) return panel(5, 'Your governance queue', q, viaSnapshot(REQ, s), 'nothing', `<p>No change requests and no tool requests have been filed for this domain.</p>${notice}`);
    return panel(5, 'Your governance queue', q, viaSnapshot(REQ, s), 'ready',
      `${notice}<h3>Change requests</h3>${changes.length ? queueTable(changes) : '<p>None.</p>'}<h3>Tool requests</h3>${tools.length ? queueTable(tools) : '<p>None.</p>'}`);
  }

  function notAvailable(d, s) {
    const g = D.gaps(d.capabilities);
    const items = [
      '<strong>Coordinated handoff between two agents does not exist on this platform,</strong> so autonomy:R8 is unreachable by fact, not merely incomplete.',
      `<strong>${g.draft} of ${d.capabilities.length} capabilities are draft:</strong> nobody has agreed them.`,
      g.no_behaviour.length ? `<strong>No defined next rung:</strong> ${g.no_behaviour.map(esc).join(', ')}. Defining it is the first work on each.` : 'Every capability has at least one rung of behaviour written down.',
      ...((s && s.not_recorded) || []).map((n) => `<strong><code>${esc(n.field)}</code> is not recorded by the platform:</strong> ${esc(n.reason)}`),
      '<strong>Who proposed and who decided each request</strong> is not in the snapshot, so those columns stay blank.',
      s ? '' : `<strong>The agent, its authority and its governance queue</strong> are unavailable: <code>${SNAPSHOT}</code> could not be read.`,
      '<strong>Finishing work promotes nothing.</strong> A story marked complete, elapsed time, a good conversation and a mocked test passing never raise autonomy (<code>promotionCriteria.ts:46-51</code>).',
    ].filter(Boolean);
    return panel(6, 'What is not available', 'What would I be lying about?', 'None: this panel is the gaps themselves.', 'ready', `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  function age(manifest) {
    const a = CC.dataAge ? CC.dataAge(manifest) : { known: false };
    return a.known
      ? `<code>${SNAPSHOT}</code> last changed ${esc(a.absolute)} (${esc(a.relative)}). The platform rewrites it only when something about the domain changes, so this is when it last changed, not when it was last checked.`
      : `When <code>${SNAPSHOT}</code> last changed is unknown: <code>.colaberry/manifest.json</code> gave no <code>generated_at</code>.`;
  }

  function view(d) {
    if (CC.ui.isSample()) return '<div class="empty"><h2>No sample for this tab</h2><p>This tab shows only what this domain has produced. Switch to Real.</p></div>';
    const data = d.domain;
    const loading = d.domainLoading;
    if (loading || !data) {
      const state = loading ? 'loading' : 'nothing';
      const say = loading ? '<p>Still fetching.</p>' : '<p><code>command-center/domain.json</code> returned nothing, so this panel shows nothing.</p>';
      return ['Your employee', 'Your capability inventory', 'The autonomy ladder', 'Per-rung behaviour', 'Your governance queue', 'What is not available'].map((t, i) => panel(i + 1, t, '', '<code>command-center/domain.json</code>', state, say)).join('');
    }
    const s = d.agentDomain || null;
    const verified = new Set(((d.progress && d.progress.stories) || []).filter((st) => st.verification && st.verification.state === 'verified').map((st) => st.id.replace('platform.CAP.', 'platform.')));
    return `<section><h1>Agent domain</h1><p class="lead">Every figure here comes from the source its panel names. Draft is not approved, and progress is not authority.</p><p class="lead">${age(d.manifest)}</p></section>
      ${employee(s)}${inventory(data, s, verified)}${ladder(data, s)}${behaviour(data)}${governance(s)}${notAvailable(data, s)}`;
  }

  CC.domainTab = { view };
})();
