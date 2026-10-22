// Tabs 2 to 7 and 9. Each reads only from the loaded plan and progress files, shows an
// honest empty state where the plan defines nothing, and drills down one level per card.
(function () {
  const CC = window.CC;
  const { esc, enc, card, back, table, stateChip, empty, plural, sampleChip, storyDetail } = CC.ui;
  const derived = (d) => (d.plan && d.plan.derived) || {};
  const stories = (d) => CC.joinStories(d.plan, d.progress);

  // A card shown when a tab has no data: it still drills down to say what will be there.
  const emptyCard = (tab, label, text) => `<div class="grid">${card(`#/${tab}/about`, label, 'None yet', text)}</div>`;
  const about = (tab, title, what, next) => `${back(`#/${tab}`)}${empty(title, what, next)}`;

  function outcomes(d, detail) {
    const m = derived(d).measures || [];
    if (detail === 'about') return about('outcomes', 'Outcomes', 'Each measure this project has to move gets a card here, with its statement and target.', 'The plan carries no measures yet. They are added to the plan, then appear here on the next sync.');
    if (detail) { const x = m.find((e) => e.id === detail); return `${back('#/outcomes')}${x ? `<h1>${esc(x.id)}${sampleChip()}</h1><div class="panel"><p>${esc(x.statement)}</p><p class="lead">No measurement exists until the system runs.</p></div>` : empty('Not found', 'No such measure in the plan.')}`; }
    return `<h1>Outcomes: the numbers this has to move</h1>${m.length
      ? `<div class="grid">${m.map((e) => card(`#/outcomes/${enc(e.id)}`, e.id, null, esc(e.statement))).join('')}</div>`
      : emptyCard('outcomes', 'Measures', 'The plan carries no numeric target yet.')}`;
  }

  function users(d, detail) {
    const roles = derived(d).roles || [];
    if (detail === 'about') return about('users', 'Users and use case', 'Each role a story is written for ("As a role, I want ...") gets a card, with the stories behind it.', 'Roles are not yet named in the stories, so none can be shown.');
    if (detail) {
      const from = stories(d).filter((s) => (s.narrative || '').toLowerCase().includes(detail.toLowerCase()));
      return `${back('#/users')}<h1>${esc(detail)}${sampleChip()}</h1>${from.length ? table(['Story', 'Narrative'], from.map((s) => `<tr><td><a href="#/pm/${enc(s.id)}">${esc(s.title)}</a></td><td>${esc(s.narrative)}</td></tr>`)) : empty('No narrative names this role', 'The role is in the plan, but no story narrative mentions it.')}`;
    }
    return `<h1>Users and use case</h1>${roles.length
      ? `<div class="grid">${roles.map((r) => card(`#/users/${enc(r)}`, 'Role', null, esc(r))).join('')}</div>`
      : emptyCard('users', 'Roles', 'Roles are not yet named in your stories.')}`;
  }

  function guardrails(d, detail) {
    const g = derived(d).guardrails || [];
    const reqs = (d.plan && d.plan.requirements) || [];
    const byId = new Map(stories(d).map((s) => [s.id, s]));
    const enforcedBy = (id) => ((reqs.find((r) => r.id === id) || {}).fulfilled_by || []).map((sid) => byId.get(sid)).filter(Boolean);
    if (detail === 'about') return about('guardrails', 'Guardrails', 'Each thing that must never happen gets a card, showing which stories enforce it and whether they are verified.', 'The plan has no requirement typed SAFE yet, which usually means a safety promise was recorded as an ordinary feature. Worth raising with the instructor early.');
    if (detail) {
      const x = g.find((e) => e.id === detail);
      if (!x) return `${back('#/guardrails')}${empty('Not found', 'No such guardrail in the plan.')}`;
      const by = enforcedBy(x.id);
      return `${back('#/guardrails')}<h1>${esc(x.id)}${sampleChip()}</h1><div class="panel"><p>${esc(x.statement)}</p></div>${by.length
        ? table(['Enforced by', 'State'], by.map((s) => `<tr><td><a href="#/pm/${enc(s.id)}">${esc(s.title)}</a></td><td>${stateChip(s.state)}</td></tr>`))
        : empty('Nothing enforces this yet', 'No story is linked to this guardrail.')}`;
    }
    return `<h1>Guardrails: what must never happen</h1>${g.length ? `<div class="grid">${g.map((e) => {
      const by = enforcedBy(e.id); const kept = by.length && by.every((s) => s.state === 'verified');
      return card(`#/guardrails/${enc(e.id)}`, e.id, null, `${esc(e.statement)}<br><span class="lead">${kept ? 'Enforced by verified stories.' : 'A promise made and not yet kept: its stories are not all verified.'}</span>`);
    }).join('')}</div>` : emptyCard('guardrails', 'Guardrails', 'No requirement typed SAFE in the plan yet.')}`;
  }

  function systems(d, detail) {
    const sys = derived(d).systems || [];
    const dot = '<span class="dot"></span>Not checked from here';
    if (detail === 'about') return about('systems', 'Systems', 'Each system this project connects to gets a card with a status light. Lights stay grey until the running system reports otherwise.', 'The plan names no external system yet.');
    if (detail) return `${back('#/systems')}<h1>${esc(detail)}${sampleChip()}</h1><div class="panel"><p>${dot}</p><p>The plan names this system. Whether it is connected right now is a fact about the running system, which this page cannot see.</p></div>`;
    return `<h1>Systems: what this connects to</h1>${sys.length
      ? `<div class="grid">${sys.map((n) => card(`#/systems/${enc(n)}`, 'System', null, `${esc(n)}<br>${dot}`)).join('')}</div>`
      : emptyCard('systems', 'Systems', 'The plan names no external system yet.')}`;
  }

  function pm(d, detail) {
    if (detail) return storyDetail(d, detail, '#/pm');
    const all = stories(d);
    const releases = CC.releaseStatus(d.plan, all);
    const sch = d.plan.schedule || {};
    const days = (s) => new Date(`${s}T00:00:00Z`).getTime();
    const dates = releases.flatMap((r) => [r.starts_on, r.ends_on]).filter(Boolean).map(days);
    const lo = Math.min(...dates), hi = Math.max(...dates), span = Math.max(hi - lo, 1);
    const gantt = releases.map((r) => {
      const left = ((days(r.starts_on) - lo) / span) * 100, width = Math.max(((days(r.ends_on) - days(r.starts_on)) / span) * 100, 2);
      return `<div class="gantt-row"><span><a href="#/overview/release">${esc(r.key)} · ${esc(r.name)}</a>${r.is_demo_target ? ' <span class="chip in_progress">demo</span>' : ''}</span>
        <div class="gantt-track"><span style="left:${left}%;width:${width}%"></span></div><span class="lead">${esc(r.starts_on)} to ${esc(r.ends_on)}</span></div>`;
    }).join('');
    const rows = all.map((s) => {
      const slip = s.due_baseline_on && s.due_on && s.due_on !== s.due_baseline_on;
      return `<tr><td><a href="#/pm/${enc(s.id)}">${esc(s.title)}</a></td><td>${esc(s.release)}</td><td>${esc(s.due_on || '')}</td><td>${esc(s.due_baseline_on || '')}${slip ? ' <span class="chip in_progress">moved</span>' : ''}</td><td>${stateChip(s.state)}</td></tr>`;
    });
    return `<h1>Project management${sampleChip()}</h1>
      <div class="panel"><h2>Releases</h2><p class="lead">Build ${esc(sch.build_start || '?')} to ${esc(sch.build_end || '?')}; demo day ${esc(sch.demo_day || 'not set')} (release ${esc(sch.demo_release_key || '?')}), as stated in the plan.</p>${gantt}</div>
      <div class="panel"><h2>Every story (${all.length})</h2><p class="lead">"Due" is the current date; "First given" is the original. A difference is slippage.</p>
      ${table(['Story', 'Release', 'Due', 'First given', 'State'], rows)}</div>`;
  }

  function agents(d, detail) {
    const list = (d.plan && d.plan.agents) || [];
    const all = stories(d);
    if (list.length) {
      if (detail) {
        const a = list.find((x) => x.name === detail);
        if (!a) return `${back('#/agents')}${empty('Not found', 'No such agent in the plan.')}`;
        const f = (k) => esc([].concat(a[k] || []).join('; ') || 'not stated');
        return `${back('#/agents')}<h1>${esc(a.name)}${sampleChip()}</h1><div class="panel"><p>${esc(a.purpose)}</p><p><span class="dot"></span>No runs recorded.</p>
          ${table(['Field', 'Design'], [['Trigger', `${f('trigger_type')}: ${f('trigger')}`], ['Inputs', f('inputs')], ['Outputs', f('outputs')], ['Autonomy', f('autonomy_level')], ['Approval gates', f('approval_gates')], ['Escalation', f('escalation_rules')], ['Skills', (a.skills || []).length ? f('skills') : 'No skills registered yet'], ['Owns', f('owns')]].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`))}</div>`;
      }
      return `<h1>AI agents</h1><div class="grid">${list.map((a) => card(`#/agents/${enc(a.name)}`, `Autonomy ${a.autonomy_level || '?'}`, null, `<strong>${esc(a.name)}</strong><br>${esc(a.purpose)}<br><span class="lead">No runs recorded</span>`)).join('')}</div>`;
    }
    // No agent roster in the plan: group stories by owner, and say these are owners, not agents.
    const owners = new Map();
    all.forEach((s) => { const o = s.owner_agent || 'Unassigned'; owners.set(o, [...(owners.get(o) || []), s]); });
    if (detail) {
      const own = owners.get(detail) || [];
      return `${back('#/agents')}<h1>${esc(detail)}${sampleChip()}</h1><div class="panel"><p>An owner of stories, not a scoped AI agent. No skills registered yet. No runs recorded.</p></div>
        ${table(['Story', 'State'], own.map((s) => `<tr><td><a href="#/pm/${enc(s.id)}">${esc(s.title)}</a></td><td>${stateChip(s.state)}</td></tr>`))}`;
    }
    return `<h1>AI agents</h1><div class="banner">The plan has no scoped agent roster yet. These cards are story owners, not AI agents.</div>
      <div class="grid">${[...owners].map(([o, list2]) => card(`#/agents/${enc(o)}`, 'Owner', plural(list2.length, 'story', 'stories'), `${esc(o)}<br><span class="lead">No skills registered yet</span>`)).join('')}</div>`;
  }

  function dataModel(d, detail) {
    const reqs = (d.plan && d.plan.requirements) || [];
    const files = { plan: d.plan, progress: d.progress };
    if (detail && files[detail]) {
      const obj = files[detail];
      const first = (k) => (Array.isArray(obj[k]) && obj[k][0] && typeof obj[k][0] === 'object' ? Object.keys(obj[k][0]).join(', ') : '');
      return `${back('#/data')}<h1>.colaberry/${esc(detail)}.json${sampleChip()}</h1><p class="lead">Fields read from the file as it is now, not typed into this page.</p>
        ${table(['Field', 'Holds', 'Each entry has'], Object.keys(obj).map((k) => `<tr><td><code>${esc(k)}</code></td><td>${Array.isArray(obj[k]) ? plural(obj[k].length, 'entry', 'entries') : typeof obj[k]}</td><td>${esc(first(k))}</td></tr>`))}`;
    }
    if (detail === 'about') return about('data', 'Your data model', 'The tables this system stores, with fields and relationships, derived from your requirements and shown for review before any table is created.', 'The plan holds no requirements yet, so there is nothing to derive tables from.');
    return `<h1>Data model</h1>${reqs.length ? `<div class="panel"><p>${plural(reqs.length, 'requirement', 'requirements')} to derive tables from. A model is proposed here for review before any table is created.</p></div>` : emptyCard('data', 'Your tables', 'No requirements yet, so no tables can be derived.')}
      <h2>What this page reads</h2><p class="lead">The plan and progress files join on story id: plan <code>stories[].id</code> matches progress <code>stories[].id</code>.</p>
      <div class="grid">${card('#/data/plan', 'File', null, '<code>.colaberry/plan.json</code>: the plan, written by the platform')}${card('#/data/progress', 'File', null, '<code>.colaberry/progress.json</code>: what is done, with verification')}</div>`;
  }

  CC.tabs = { outcomes, users, guardrails, systems, pm, agents, data: dataModel };
})();
