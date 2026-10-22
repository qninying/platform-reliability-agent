// Knowledge base tab: traceability, stories, notes, and a chat panel that answers only
// from the data on this page and names the tab each answer came from. No model, no key:
// it matches the question against the loaded files and says so when it cannot answer.
(function () {
  const CC = window.CC;
  const { esc, enc, card, back, table, stateChip, empty, plural, sampleChip } = CC.ui;
  let transcript = [];

  function view(d, detail) {
    const all = CC.joinStories(d.plan, d.progress);
    const reqs = (d.plan && d.plan.requirements) || [];
    const noted = all.filter((s) => s.notes);
    if (detail === 'requirements') {
      const byId = new Map(all.map((s) => [s.id, s]));
      return `${back('#/kb')}<h1>Requirements and the stories that cover them${sampleChip()}</h1>${reqs.length
        ? table(['Requirement', 'Kind', 'Priority', 'Covered by'], reqs.map((r) => {
          const by = (r.fulfilled_by || []).map((id) => byId.get(id)).filter(Boolean);
          const gap = !by.length && r.priority === 'must' ? ' <span class="chip warn">gap</span>' : '';
          return `<tr><td>${esc(r.statement)}</td><td>${esc(r.kind || '')}</td><td>${esc(r.priority || '')}${gap}</td><td>${by.length ? by.map((s) => `<a href="#/pm/${enc(s.id)}">${esc(s.title)}</a> ${stateChip(s.state)}`).join('<br>') : 'None'}</td></tr>`;
        }))
        : empty('No requirements yet', 'The plan holds no requirements, so there is nothing to trace. Every story below still stands on its own.')}`;
    }
    if (detail === 'notes') {
      return `${back('#/kb')}<h1>Notes recorded with stories${sampleChip()}</h1>${noted.length
        ? table(['Story', 'Note'], noted.map((s) => `<tr><td><a href="#/pm/${enc(s.id)}">${esc(s.title)}</a></td><td>${esc(s.notes)}</td></tr>`))
        : empty('No notes yet', 'Notes are written into the progress file when a story is finished.')}`;
    }
    if (detail === 'stories') {
      return `${back('#/kb')}<h1>All stories${sampleChip()}</h1>${table(['Story', 'Release', 'State'], all.map((s) => `<tr><td><a href="#/pm/${enc(s.id)}">${esc(s.title)}</a></td><td>${esc(s.release)}</td><td>${stateChip(s.state)}</td></tr>`))}`;
    }
    return `<h1>Knowledge base</h1>
      <div class="grid">${card('#/kb/requirements', 'Traceability', reqs.length, reqs.length ? 'Requirements and the stories that cover them' : 'No requirements in the plan yet')}
        ${card('#/kb/stories', 'Stories', all.length, 'Every story in the plan, with its state')}
        ${card('#/kb/notes', 'Notes and decisions', noted.length, 'Recorded with finished stories')}</div>
      <div class="panel"><h2>Ask about this project${sampleChip()}</h2><p class="lead">Answers come only from the data on this page and name the tab they came from.</p>
        <div id="kb-log" class="kb-log" aria-live="polite">${renderLog()}</div>
        <form id="kb-form" class="kb-form"><label class="sr" for="kb-q">Question</label><input id="kb-q" autocomplete="off" placeholder="For example: how many stories are verified?"><button type="submit">Ask</button></form></div>`;
  }

  const renderLog = () => transcript.map((t) => `<p class="q">${esc(t.q)}</p><p class="a">${t.a}</p>`).join('');

  // Answers from the loaded data only. Returns HTML with the source tab named.
  function answer(d, q) {
    const s = q.toLowerCase();
    const t = (d.progress && d.progress.totals) || {};
    const from = (tab, label) => ` <span class="lead">(from <a href="#/${tab}">${label}</a>)</span>`;
    if (/point/.test(s)) return `${esc(t.points_awarded ?? 0)} points awarded.${from('overview', 'Overview')}`;
    if (/criteri/.test(s)) return `${esc(t.criteria_passed ?? 0)} of ${esc(t.criteria_total ?? 0)} acceptance criteria passed.${from('overview', 'Overview')}`;
    if (/(how many|count|number).*(stor)|verified/.test(s)) return `${esc(t.stories_verified ?? 0)} of ${esc(t.stories_total ?? 0)} stories verified.${from('overview', 'Overview')}`;
    if (/release|where are|current/.test(s)) {
      const r = CC.currentRelease(CC.releaseStatus(d.plan, CC.joinStories(d.plan, d.progress)));
      return r ? `Release ${esc(r.key)} (${esc(r.name)}): ${r.verified} of ${plural(r.stories.length, 'story', 'stories')} verified.${from('overview/release', 'Overview')}` : `The plan has no releases.${from('pm', 'Project management')}`;
    }
    const words = s.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !['what', 'which', 'does', 'about', 'there', 'this', 'that', 'with', 'have', 'from'].includes(w));
    if (words.length) {
      const scored = CC.joinStories(d.plan, d.progress).map((st) => {
        const text = `${st.title} ${st.narrative || ''} ${(st.acceptance || []).join(' ')} ${st.notes || ''}`.toLowerCase();
        return [st, words.filter((w) => text.includes(w)).length];
      }).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (scored.length) return `Closest stories: ${scored.map(([st]) => `<a href="#/pm/${enc(st.id)}">${esc(st.title)}</a> ${stateChip(st.state)}`).join('; ')}.${from('pm', 'Project management')}`;
    }
    return 'I cannot answer that from the data on this page.';
  }

  function bind(d) {
    const form = document.getElementById('kb-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('kb-q');
      const q = input.value.trim();
      if (!q) return;
      transcript = [...transcript, { q, a: answer(d, q) }].slice(-10);
      document.getElementById('kb-log').innerHTML = renderLog();
      input.value = '';
    });
  }

  CC.kb = { view, bind, answer };
})();
