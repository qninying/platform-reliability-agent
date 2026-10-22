// Data layer for the Command Center. Everything the page shows comes through here,
// read at runtime from the .colaberry/ files the platform commits. Nothing from the
// plan is copied into this code.
(function () {
  const FILES = {
    plan: '.colaberry/plan.json',
    progress: '.colaberry/progress.json',
    manifest: '.colaberry/manifest.json',
    profile: '.colaberry/profile.json',
  };
  const DAY = 24 * 60 * 60 * 1000;

  async function readJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json();
  }

  // Loads all four files. A missing or unreadable file is reported, never papered over.
  async function load() {
    const out = { errors: [] };
    await Promise.all(Object.entries(FILES).map(async ([key, path]) => {
      try { out[key] = await readJson(path); }
      catch (e) { out[key] = null; out.errors.push({ file: path, message: e.message }); }
    }));
    return out;
  }

  // Joins plan stories to progress stories on id. The plan carries the title, release and
  // dates; progress carries the verification state, commit and points.
  function joinStories(plan, progress) {
    const prog = new Map(((progress && progress.stories) || []).map((s) => [s.id, s]));
    return ((plan && plan.stories) || []).map((s) => {
      const p = prog.get(s.id) || {};
      const v = p.verification || null;
      return {
        ...s,
        criteria: p.criteria || (s.acceptance || []).map((text) => ({ text, passed: false })),
        verification: v,
        state: (v && v.state) || 'not_started',
        notes: p.notes || null,
      };
    });
  }

  // Per-release counts, for "which release you are in". The overall totals are never
  // recomputed here; they come from progress.totals as written.
  function releaseStatus(plan, stories) {
    const byId = new Map(stories.map((s) => [s.id, s]));
    return ((plan && plan.releases) || []).map((r) => {
      const own = (r.story_ids || []).map((id) => byId.get(id)).filter(Boolean);
      return { ...r, stories: own, verified: own.filter((s) => s.state === 'verified').length };
    });
  }

  function currentRelease(releases) {
    return releases.find((r) => r.verified < r.stories.length) || releases[releases.length - 1] || null;
  }

  // "Data as of" with an absolute date and a relative age; a warning past a week.
  function dataAge(manifest, now = Date.now()) {
    const at = manifest && manifest.generated_at ? new Date(manifest.generated_at) : null;
    if (!at || isNaN(at)) return { known: false };
    const days = (now - at.getTime()) / DAY;
    let rel;
    if (days < 1 / 24) rel = 'less than an hour ago';
    else if (days < 1) rel = `${Math.round(days * 24)} hours ago`;
    else rel = `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago`;
    return {
      known: true,
      absolute: at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      relative: rel,
      level: days > 7 ? 'warn' : days > 1 ? 'aging' : 'fresh',
    };
  }

  window.CC = window.CC || {};
  Object.assign(window.CC, { load, joinStories, releaseStatus, currentRelease, dataAge, FILES });
})();
