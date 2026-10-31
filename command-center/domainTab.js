// The Agent domain tab: six panels, each naming what it read. A panel is loading, ready, or says in words that
// it got nothing, and those three look different. Responses a person loads stay in this page view: nothing is
// stored or sent. Blank fields stay blank, because this page is public and cannot call an admin endpoint.
(function () {
  const CC = window.CC;
  const { esc, table } = CC.ui;
  const D = CC.domain;
  const short = (r) => String(r || '').replace('autonomy:', '');
  const held = {}; // endpoint responses a person loaded: { mine, requests }
  const loadErrors = [];
  const ME = 'GET /api/admin/agent-domains-mine';
  const REQ = 'GET /api/admin/agent-domain-change-requests-mine';
  const RECORD = 'GET /api/admin/agent-domains/platform and /coverage';

  function panel(n, title, question, read, state, inner) {
    const chip = { loading: 'Loading', ready: 'Read', nothing: 'Nothing returned' }[state];
    return `<section class="panel dp ${state}" aria-busy="${state === 'loading'}"><h2>${n}. ${esc(title)} <span class="chip dp-${state}">${chip}</span></h2>
      <p class="lead">${esc(question)}</p><p class="read"><span class="label">Endpoint</span> ${read}</p>${inner}</section>`;
  }
  const fromFile = (d) => `<code>${esc(RECORD)}</code>. Not called: this public page holds no admin session. Read instead: <code>${esc(d.source.file)}</code> at commit <code>${esc(d.source.commit)}</code>, the records those routes serve.`;
  const saved = (route, key) => `<code>${esc(route)}</code>. ${held[key] ? 'Read from a response loaded in this page view.' : 'Not called: this public page holds no admin session.'}`;
  const blank = (why) => `<span class="blank">Not available: ${esc(why)}</span>`;

  function employee() {
    const mine = held.mine;
    if (!mine) return panel(1, 'Your employee', 'Does it exist, and what is it allowed to do?', saved(ME, 'mine'), 'nothing', `<p>This endpoint returned nothing here, so this page cannot say whether the agent exists. Load a saved response above.</p>`);
    const row = D.platformRow(mine);
    if (!row || !row.agent_id) return panel(1, 'Your employee', 'Does it exist, and what is it allowed to do?', saved(ME, 'mine'), 'nothing', '<p>No agent appears for this domain in that response.</p>');
    const missing = blank('this endpoint does not return it');
    return panel(1, 'Your employee', 'Does it exist, and what is it allowed to do?', saved(ME, 'mine'), 'ready', table(['Field', 'Value'], [
      ['agent_name', esc(row.agent_display_name || row.agent_id)], ['enabled', missing], ['autonomy_level', missing], ['Tools granted', missing], ['Autonomy last set, and by whom', missing],
    ].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)));
  }

  const draft = (s) => `<span class="chip ${s === 'draft' ? 'in_progress' : 'not_started'}">${esc(s)}</span>`;
  function inventory(d, verified) {
    const rows = d.capabilities.map((c) => {
      const a = D.authorityOf(c, []);
      return `<tr><td>${esc(c.name)}${c.human_decision ? ' <span class="chip human">Human decision</span>' : ''}${verified.has(c.capability_id) ? ' <span class="chip not_started">Story verified, not authority</span>' : ''}</td><td>${esc(c.classification)}</td><td>${esc(c.implementation_state)}</td><td>${draft(c.requirement_validation_state)}</td><td>${esc(short(c.starting_autonomy))}</td><td>${esc(short(a.asks))}</td><td><strong>${esc(short(a.effective_autonomy))}</strong><br><small>${a.reasons.map(esc).join(', ') || 'no limit applied'}</small></td></tr>`;
    });
    return panel(2, 'Your capability inventory', 'What am I actually building?', fromFile(d), d.capabilities.length ? 'ready' : 'nothing',
      `<p class="lead">Effective authority is what the platform's <code>effectiveAuthority()</code> returns for what the record asks for, with no tools granted. The record's ceiling is not authority, and no level has been approved.</p>
      ${table(['Capability', 'Classification', 'Implementation', 'Validation', 'Starts', 'Record asks', 'Effective authority'], rows)}`);
  }

  function ladder(d) {
    const head = D.RUNGS.map(([r, words]) => `<li><strong>${esc(short(r))}</strong> ${esc(words)}${r === D.UNREACHABLE_BY_FACT ? ' <span class="chip by-fact">Unreachable by fact</span>' : ''}</li>`).join('');
    const rows = d.capabilities.map((c) => `<tr><td><details><summary>${esc(c.name)}</summary><small>Why it stops at ${esc(short(c.max_permitted_autonomy))}: ${esc(c.max_autonomy_rationale)}</small></details></td>${D.rungStates(c).map((s) => `<td class="rung ${s.state}" title="${esc(short(s.rung))}: ${s.state}">${s.state === 'ceiling' ? 'Ceiling' : s.state === 'reachable' ? '' : s.state === 'by_fact' ? 'No' : '×'}</td>`).join('')}</tr>`);
    return panel(3, 'The autonomy ladder', 'Where is this going?', fromFile(d), d.capabilities.length ? 'ready' : 'nothing',
      `<ol class="rungs">${head}</ol><p>Your employee's current rung: ${blank('no source this page can read returns autonomy_level')}</p>
      <p class="lead">× is above that capability's ceiling, so it is unreachable, not future work. A ceiling is a decision with a reason: open a capability to read it.</p>
      ${table(['Capability', ...D.RUNGS.map(([r]) => short(r))], rows)}`);
  }

  function behaviour(d) {
    const groups = D.behaviourByRung(d.capabilities).map((g) => `<details><summary>${esc(short(g.rung))}: ${g.entries.length} defined</summary>${g.entries.length
      ? table(['Capability', 'Behaviour', 'Acceptance'], g.entries.map((e) => `<tr><td>${esc(e.capability)}</td><td>${esc(e.behaviour)}</td><td>${esc(e.acceptance)}</td></tr>`))
      : '<p>Nothing is written down for this rung.</p>'}</details>`).join('');
    return panel(4, 'Per-rung behaviour', 'What does the next rung require of me?', fromFile(d), d.capabilities.length ? 'ready' : 'nothing', groups);
  }

  function queueTable(rows) {
    return table(['Title', 'Status', 'Proposed by', 'Decided by', 'When'], rows.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.status)}</td><td>${esc(r.requested_by_identity)}</td><td>${r.approved_by_identity ? esc(r.approved_by_identity) : 'Nobody yet'}</td><td>${esc(r.approved_at || r.requested_at || 'not recorded')}</td></tr>`));
  }
  function governance() {
    const notice = '<p class="lead">A tool request is how a capability is asked for. Filing one grants nothing.</p>';
    const q = held.requests;
    if (!q) return panel(5, 'Your governance queue', 'What am I waiting on a human for?', saved(REQ, 'requests'), 'nothing', `<p>This endpoint returned nothing here, so this page cannot say what is waiting.</p>${notice}`);
    const { tools, changes } = D.split(q.change_requests);
    if (!tools.length && !changes.length) return panel(5, 'Your governance queue', 'What am I waiting on a human for?', saved(REQ, 'requests'), 'nothing', `<p>That response holds no requests.</p>${notice}`);
    return panel(5, 'Your governance queue', 'What am I waiting on a human for?', saved(REQ, 'requests'), 'ready',
      `${notice}<h3>Change requests</h3>${changes.length ? queueTable(changes) : '<p>None.</p>'}<h3>Tool requests</h3>${tools.length ? queueTable(tools) : '<p>None.</p>'}`);
  }

  function notAvailable(d) {
    const g = D.gaps(d.capabilities);
    const items = [
      '<strong>Coordinated handoff between two agents does not exist on this platform,</strong> so autonomy:R8 is unreachable by fact, not merely incomplete.',
      `<strong>${g.draft} of ${d.capabilities.length} capabilities are draft:</strong> nobody has agreed them.`,
      g.no_behaviour.length ? `<strong>No defined next rung:</strong> ${g.no_behaviour.map(esc).join(', ')}. Defining it is the first work on each.` : 'Every capability has at least one rung of behaviour written down.',
      '<strong>Agent name, enabled, autonomy level, tools granted and who last set autonomy</strong> have no source this page can read; <code>agent-domains-mine</code> returns the agent id and display name only.',
      '<strong>Tool grants per capability</strong> have no source here. None is granted today, per this story\'s brief, so authority is computed with none.',
      '<strong>Finishing work promotes nothing.</strong> A story marked complete, elapsed time, a good conversation and a mocked test passing never raise autonomy (<code>promotionCriteria.ts:46-51</code>).',
    ];
    return panel(6, 'What is not available', 'What would I be lying about?', 'None: this panel is the gaps themselves.', 'ready', `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
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
    const verified = new Set(((d.progress && d.progress.stories) || []).filter((s) => s.verification && s.verification.state === 'verified').map((s) => s.id.replace('platform.CAP.', 'platform.')));
    return `<section><h1>Agent domain</h1><p class="lead">Every figure here comes from the source its panel names. Draft is not approved, and progress is not authority.</p></section>
      <div class="panel"><label>Load a saved response from <code>agent-domains-mine</code> or <code>agent-domain-change-requests-mine</code> <input type="file" id="dp-load" accept="application/json" multiple></label>
      <p class="lead">Read in this browser only. Nothing is stored, sent or committed.</p>${loadErrors.map((e) => `<p class="banner error">${esc(e)}</p>`).join('')}</div>
      ${employee()}${inventory(data, verified)}${ladder(data)}${behaviour(data)}${governance()}${notAvailable(data)}`;
  }

  function bind(rerender) {
    const input = document.getElementById('dp-load');
    if (!input) return;
    input.addEventListener('change', async () => {
      loadErrors.length = 0;
      for (const f of input.files) {
        try {
          const body = JSON.parse(await f.text());
          const kind = D.classify(body);
          if (kind) held[kind] = body; else loadErrors.push(`${f.name} is neither response, so it was not read.`);
        } catch (e) { loadErrors.push(`${f.name} could not be read as JSON.`); }
      }
      rerender();
    });
  }

  CC.domainTab = { view, bind, held };
})();
