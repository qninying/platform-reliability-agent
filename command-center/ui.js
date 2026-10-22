// Shared rendering helpers for every tab: escaping, cards, tables, chips, mode, and the
// story detail view that several tabs drill down to.
(function () {
  const CC = window.CC;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  // Escapes text for HTML and hides email addresses, because this page may be public.
  function esc(v) {
    return String(v == null ? '' : v).replace(EMAIL, '[email hidden]')
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const enc = (s) => encodeURIComponent(s);

  function stored(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage blocked: setting lasts this page view only */ }
  }
  const isSample = () => stored('cc-mode', 'real') === 'sample';
  const sampleChip = () => (isSample() ? ' <span class="chip sample">Sample</span>' : '');

  const card = (href, label, big, text) =>
    `<a class="card" href="${href}"><span class="label">${esc(label)}${sampleChip()}</span>${big != null ? `<span class="big">${esc(big)}</span>` : ''}<span>${text}</span><span class="more">Details</span></a>`;
  const back = (href, label = 'Back') => `<a class="back" href="${href}">${esc(label)}</a>`;
  const table = (cols, rows) => `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const stateChip = (s) => `<span class="chip ${esc(s)}">${esc(String(s).replace('_', ' '))}</span>`;
  const empty = (title, what, next) => `<div class="empty"><h2>${esc(title)}${sampleChip()}</h2><p>${what}</p>${next ? `<p class="lead">${next}</p>` : ''}</div>`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // One story in full: what the plan says, and what progress says about it.
  function storyDetail(d, id, backHref) {
    const s = CC.joinStories(d.plan, d.progress).find((x) => x.id === id);
    if (!s) return `${back(backHref)}${empty('Story not found', `No story with id <code>${esc(id)}</code> is in the plan file.`)}`;
    const v = s.verification || {};
    const repo = d.plan.project && d.plan.project.repo_url;
    const commit = v.commit_url || (repo && v.commit_sha ? `${repo}/commit/${v.commit_sha}` : null);
    return `${back(backHref)}
      <section><span class="label">${esc(s.id)}</span><h1>${esc(s.title)}${sampleChip()}</h1></section>
      <div class="panel"><p>${stateChip(s.state)} Release ${esc(s.release)}. Due ${esc(s.due_on || 'not set')}; first given ${esc(s.due_baseline_on || 'not set')}.</p>
        ${commit ? `<p>Verified by commit <a href="${esc(commit)}"><code>${esc((v.commit_sha || '').slice(0, 7))}</code></a>${v.points_awarded != null ? `, ${esc(v.points_awarded)} points` : ''}.</p>` : '<p>No verified commit yet.</p>'}</div>
      <div class="panel"><h2>Acceptance criteria</h2>${s.criteria.length ? `<ul class="checks">${s.criteria.map((c) => `<li class="${c.passed ? 'yes' : 'no'}">${c.passed ? 'Passed' : 'Not yet'}: ${esc(c.text)}</li>`).join('')}</ul>` : '<p>None listed in the plan.</p>'}</div>
      ${s.narrative ? `<div class="panel"><h2>Story</h2><p>${esc(s.narrative)}</p></div>` : ''}
      ${s.notes ? `<div class="panel"><h2>Notes</h2><p>${esc(s.notes)}</p></div>` : ''}`;
  }

  CC.ui = { esc, enc, stored, store, isSample, sampleChip, card, back, table, stateChip, empty, plural, storyDetail };
})();
