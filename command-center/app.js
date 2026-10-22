// Command Center shell: header, tabs, routing, the sample/real and day/night switches,
// and the Overview tab. Routes are #/<tab> and #/<tab>/<detail>.
(function () {
  const CC = window.CC;
  const { esc, stored, store, isSample, sampleChip, card, back, table, stateChip, empty, plural } = CC.ui;
  const TABS = [
    ['overview', 'Overview'], ['outcomes', 'Outcomes'], ['users', 'Users and use case'],
    ['guardrails', 'Guardrails'], ['systems', 'Systems'], ['pm', 'Project management'],
    ['agents', 'AI agents'], ['kb', 'Knowledge base'], ['data', 'Data model'],
  ];
  let real = null; // { plan, progress, manifest, profile, errors }

  const data = () => (isSample() ? CC.sampleData() : real);
  const theme = () => stored('cc-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  function applyTheme() { document.documentElement.setAttribute('data-theme', theme()); }

  function currentRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const tab = TABS.some(([k]) => k === parts[0]) ? parts[0] : 'overview';
    return { tab, detail: parts.slice(1).join('/') || null };
  }

  function header(d) {
    const age = CC.dataAge(real && real.manifest);
    const stamp = age.known
      ? `<span class="stamp ${age.level}">Data as of ${esc(age.absolute)} (${esc(age.relative)})${age.level === 'warn' ? ': over a week old, sync from the portal to refresh' : ''}</span>`
      : '<span class="stamp warn">Data age unknown: .colaberry/manifest.json could not be read</span>';
    const title = (d && d.profile && d.profile.headline) || (d && d.plan && d.plan.project && d.plan.project.name) || 'Command Center';
    const route = currentRoute();
    const dark = theme() === 'dark';
    return `<header class="top"><div class="top-row">
      <div class="brand"><i aria-hidden="true"></i>${esc(title)}<small>Command Center</small></div>
      ${stamp}
      <div class="switches">
        <div class="mode" role="group" aria-label="Data mode">
          <button type="button" data-mode="real" aria-pressed="${!isSample()}">Real</button>
          <button type="button" class="sample" data-mode="sample" aria-pressed="${isSample()}">Sample</button></div>
        <button type="button" class="theme" id="theme" aria-label="Switch to ${dark ? 'day' : 'night'} theme">${dark ? 'Day' : 'Night'}</button>
      </div></div>
      <nav class="tabs" aria-label="Tabs">${TABS.map(([k, t]) => `<a href="#/${k}" ${route.tab === k ? 'aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav></header>`;
  }

  // ---------- Overview ----------
  function overview(d, detail) {
    const plan = d.plan, prog = d.progress;
    const t = prog.totals || {};
    const all = CC.joinStories(plan, prog);
    const releases = CC.releaseStatus(plan, all);
    const cur = CC.currentRelease(releases);
    const agents = plan.agents || [];
    if (detail) return `${back('#/overview')}${overviewDetail(detail, { plan, all, releases, agents })}`;
    const title = (d.profile && d.profile.headline) || plan.project.name;
    return `<section><h1>${esc(title)}</h1><p class="lead">${esc(plan.project.descriptor || '')}</p></section>
      <div class="grid">
        ${card('#/overview/release', 'Where you are', cur ? cur.key : 'none', cur ? `${esc(cur.name)}: ${cur.verified} of ${plural(cur.stories.length, 'story', 'stories')} verified` : 'No release in the plan')}
        ${card('#/overview/stories', 'Stories verified', `${t.stories_verified ?? 0} / ${t.stories_total ?? 0}`, 'Confirmed by the platform from commits in this repo')}
        ${card('#/overview/criteria', 'Criteria passed', `${t.criteria_passed ?? 0} / ${t.criteria_total ?? 0}`, 'Acceptance criteria ticked and verified')}
        ${card('#/overview/points', 'Points awarded', t.points_awarded ?? 0, 'Awarded by the platform for verified stories')}
        ${card('#/overview/live', 'What is running', agents.length ? `${agents.length} designed` : 'Nothing yet', agents.length ? 'Agents are designed in the plan; no run history exists in these files' : 'No agent is defined in the plan and nothing reports as running')}
        ${card('#/overview/project', 'The project', null, esc(plan.project.descriptor || plan.project.name))}
      </div>`;
  }

  function overviewDetail(which, x) {
    if (which === 'release') {
      return `<h1>Where you are</h1>${x.releases.map((r) => `<div class="panel"><h2>${esc(r.key)} · ${esc(r.name)}${sampleChip()}</h2>
        <div class="bar"><span style="width:${r.stories.length ? (100 * r.verified) / r.stories.length : 0}%"></span></div>
        <p>${r.verified} of ${plural(r.stories.length, 'story', 'stories')} verified. Planned ${esc(r.starts_on)} to ${esc(r.ends_on)}, as stated in the plan.</p></div>`).join('')}`;
    }
    if (which === 'stories' || which === 'points') {
      const done = x.all.filter((s) => s.state === 'verified');
      return `<h1>${which === 'stories' ? 'Verified stories' : 'Points by story'}${sampleChip()}</h1>${done.length
        ? table(['Story', 'Points', 'Commit'], done.map((s) => `<tr><td><a href="#/pm/${encodeURIComponent(s.id)}">${esc(s.title)}</a></td><td>${esc(s.verification.points_awarded ?? '')}</td><td><code>${esc((s.verification.commit_sha || '').slice(0, 7))}</code></td></tr>`))
        : empty('Nothing verified yet', 'No story has been verified by the platform.')}`;
    }
    if (which === 'criteria') {
      const started = x.all.filter((s) => s.state !== 'not_started' || s.criteria.some((c) => c.passed));
      return `<h1>Criteria by story${sampleChip()}</h1>${started.length
        ? table(['Story', 'Criteria passed', 'State'], started.map((s) => `<tr><td><a href="#/pm/${encodeURIComponent(s.id)}">${esc(s.title)}</a></td><td>${s.criteria.filter((c) => c.passed).length} / ${s.criteria.length}</td><td>${stateChip(s.state)}</td></tr>`))
        : empty('No criteria ticked yet', 'Criteria appear here as stories are started.')}
        <p class="lead">Stories not started are not listed. The totals on the Overview come straight from the progress file.</p>`;
    }
    if (which === 'live') {
      return `<h1>What is running${sampleChip()}</h1>${x.agents.length
        ? x.agents.map((a) => `<div class="panel"><h2>${esc(a.name)}</h2><p><span class="dot"></span>Not checked from here. No runs recorded.</p></div>`).join('')
        : '<div class="panel"><p><span class="dot"></span>Not checked from here</p><p>The plan defines no agent yet, and these files hold no run history. Whether anything is running is a fact about the live system, which this page cannot see.</p></div>'}`;
    }
    const p = x.plan.project;
    return `<h1>The project${sampleChip()}</h1><div class="panel"><p><strong>${esc(p.name)}</strong>: ${esc(p.descriptor || '')}</p>
      ${p.repo_url ? `<p>Repository: <a href="${esc(p.repo_url)}">${esc(p.repo_url)}</a></p>` : ''}
      <p>Plan version ${esc(p.plan_version ?? 'unknown')}. Demo day in the plan: ${esc((x.plan.schedule || {}).demo_day || 'not set')}.</p></div>`;
  }

  function body(d, route) {
    if (!d) return '<p>Loading…</p>';
    if (!d.plan || !d.progress) return '<div class="banner error">The plan or progress file could not be read, so no tab can show anything yet.</div>';
    if (route.tab === 'overview') return overview(d, route.detail);
    if (route.tab === 'kb') return CC.kb.view(d, route.detail);
    return CC.tabs[route.tab](d, route.detail);
  }

  function render() {
    applyTheme();
    const d = data();
    const route = currentRoute();
    const errs = real && real.errors.length && !isSample()
      ? `<div class="banner error">Could not read: ${real.errors.map((e) => esc(e.file)).join(', ')}. Tabs that need it show nothing rather than guess.</div>` : '';
    const sampleBanner = isSample() ? '<div class="banner sample">SAMPLE DATA: made up to show the layout. None of it describes this project. Switch to Real to see your data.</div>' : '';
    document.getElementById('app').innerHTML = `${header(d)}<main>${sampleBanner}${errs}${body(d, route)}</main>`;
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { store('cc-mode', b.dataset.mode); render(); }));
    document.getElementById('theme').addEventListener('click', () => { store('cc-theme', theme() === 'dark' ? 'light' : 'dark'); render(); });
    if (d && route.tab === 'kb' && !route.detail) CC.kb.bind(d);
    document.title = `${TABS.find(([k]) => k === route.tab)[1]} · Command Center`;
  }

  window.addEventListener('hashchange', render);
  CC.load().then((r) => { real = r; render(); });
  render();
})();
