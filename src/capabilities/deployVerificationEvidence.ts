// platform.deploy_verification_evidence, first release behaviour (R2):
// judges a release's evidence and states whether the deployed SHA, the running image and the live routes agree.
// Evidence missing any of the three is unverified, never deployed, and an edge-level 200 alone is never proof the
// application started. Read-only: a person runs the deploy and collects this record. Ellis never reaches the host
// (production_deploy is default-denied, delivery/execution/executionPolicy.ts:33-42).
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - On 2026-08-28 nginx served 200 while the backend sat in `created` (scripts/deploy-prod.sh:7-10), because
//   `location /` answers any unknown path with the page shell (nginx/nginx.conf:477-481).
// - No route reports a commit: /health returns a status and a timestamp (backend/src/routes/healthRoutes.ts:7-15).
// - Production images are named `:main`, a moving tag (docker-compose.production.yml:44, :145), so the name proves no
//   commit. CI also publishes `:sha-<commit>` (.github/workflows/build-images.yml:95), and the digest behind that tag
//   is what ties a container to a commit.
// - The script's own poll calls /api/health and counts any answer (deploy-prod.sh:305, :312). The health routes are
//   mounted at /health (server.ts:214), so that poll proves a process is serving and nothing more.
// - A compose command run by hand holds no lock (deploy-prod.sh:171-172).

export type Status = 'agrees' | 'missing' | 'disagrees';
export type CheckName = 'deployed_sha' | 'running_image' | 'application_started' | 'changed_routes' | 'tree_state' | 'deploy_lock';
export const THREE: readonly CheckName[] = ['deployed_sha', 'running_image', 'application_started'];

export interface RouteProbe { path: string; via: 'edge' | 'container'; status: number; at: string; body?: string | null; page?: boolean }
export interface ContainerRow { service: string; state: string; image?: string | null; digest?: string | null }
export interface Evidence {
  captured_by?: string;
  intended_sha?: string;
  deployed_sha?: string;
  deployed_at?: string;
  services?: string[];
  changed_routes?: string[];
  pinned_digests?: Record<string, string>;
  tree?: { clean?: boolean; head_is_origin_main?: boolean };
  lock?: { held?: boolean };
  containers?: ContainerRow[];
  routes?: RouteProbe[];
}

export interface Check { check: CheckName; status: Status; detail: string }
export type Verdict = 'evidence_agrees' | 'unverified' | 'disagrees';

export interface ReleaseAnswer {
  intended_sha: string | null;
  verdict: Verdict;
  statement: string;
  checks: Check[];
  human_decision: { whether_the_release_stands: 'person_only'; ellis_may: 'report_and_propose' };
  limits: string[];
}

export const LIMITS: readonly string[] = [
  'Ellis judges the record it is given. It reads no host, container or route, so a false record gets a false answer.',
  'No route reports a commit, so the routes show the application is up, and only the image digest ties it to a commit.',
  'A deploy built on the host has no published image to compare, so its running image stays unverified.',
  'Health covers the process and the database. Only the routes named in the record say anything about what the release changed.',
  'The script\'s own "backend answering" line counts any response, so it is not accepted here as proof.',
  'A record is about the moment it was collected. Later deploys are not seen.',
];

const SHA = /^[0-9a-f]{7,40}$/i;
const sameSha = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x.startsWith(y) || y.startsWith(x);
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const check = (name: CheckName, status: Status, detail: string): Check => ({ check: name, status, detail });

function deployedSha(e: Evidence): Check {
  const want = text(e.intended_sha);
  const got = text(e.deployed_sha);
  const at = Date.parse(e.deployed_at ?? '');
  if (!want || !SHA.test(want)) return check('deployed_sha', 'missing', 'The record names no intended commit.');
  if (!got || !SHA.test(got)) return check('deployed_sha', 'missing', 'The record names no deployed commit.');
  if (Number.isNaN(at)) return check('deployed_sha', 'missing', 'The record has no deploy time, so nothing can be shown to come after it.');
  if (!sameSha(want, got)) return check('deployed_sha', 'disagrees', `Intended ${want}, deployed ${got}.`);
  return check('deployed_sha', 'agrees', `Deployed commit matches ${want}.`);
}

function runningImage(e: Evidence): Check {
  const services = Array.isArray(e.services) ? e.services : [];
  if (!services.length) return check('running_image', 'missing', 'The record names no services.');
  const want = text(e.intended_sha);
  const rows = Array.isArray(e.containers) ? e.containers : [];
  const missing: string[] = [];
  for (const service of services) {
    const row = rows.find((c) => c?.service === service);
    if (!row) { missing.push(`${service} has no container row`); continue; }
    if (row.state !== 'running') return check('running_image', 'disagrees', `${service} is ${row.state}, not running.`);
    const tag = /:sha-([0-9a-f]+)$/i.exec(text(row.image) ?? '')?.[1] ?? null;
    if (tag && want) {
      if (!sameSha(tag, want)) return check('running_image', 'disagrees', `${service} runs sha-${tag}, intended ${want}.`);
      continue;
    }
    const digest = text(row.digest);
    const pinned = text(e.pinned_digests?.[service]);
    if (digest && pinned) {
      if (digest !== pinned) return check('running_image', 'disagrees', `${service} runs ${digest}, and the commit's image is ${pinned}.`);
      continue;
    }
    missing.push(`${service} is not tied to a commit: a tag like :main names no commit, so it needs its digest and the digest of the commit's image`);
  }
  if (missing.length) return check('running_image', 'missing', `${missing.join('; ')}.`);
  return check('running_image', 'agrees', `${services.join(', ')} running on the commit's image.`);
}

const bodyOf = (p: RouteProbe): Record<string, unknown> | null => {
  try {
    const b = JSON.parse(p.body ?? '');
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
};

function afterDeploy(e: Evidence): RouteProbe[] {
  const from = Date.parse(e.deployed_at ?? '');
  const rows = Array.isArray(e.routes) ? e.routes : [];
  return rows.filter((r) => r && Date.parse(r.at) >= from);
}

// Only the application's own answer counts. A 200 with no body, or with the page shell, is the edge talking.
function applicationStarted(e: Evidence): Check {
  const probes = afterDeploy(e).filter((r) => r.path === '/health' || r.path === '/health/full');
  if (!probes.length) return check('application_started', 'missing', 'No probe of /health or /health/full after the deploy.');
  for (const p of probes) {
    const b = bodyOf(p);
    if (p.status === 200 && (b?.status === 'ok' || b?.overall_status === 'ok' || b?.overall_status === 'warning')) {
      return check('application_started', 'agrees', `${p.path} answered through ${p.via} with the application's own body.`);
    }
  }
  const bad = probes.find((p) => p.status >= 500 || (p.status === 200 && bodyOf(p) !== null));
  if (bad) return check('application_started', 'disagrees', `${bad.path} answered ${bad.status} and the application is not reporting healthy.`);
  return check('application_started', 'missing', 'Only a bare response was recorded. An edge-level 200 is not proof the application started.');
}

function changedRoutes(e: Evidence): Check {
  const named = Array.isArray(e.changed_routes) ? e.changed_routes : [];
  if (!named.length) return check('changed_routes', 'missing', 'The record names no routes this release changed.');
  const probes = afterDeploy(e);
  const missing: string[] = [];
  for (const path of named) {
    const p = probes.find((r) => r.path === path);
    if (!p) { missing.push(path); continue; }
    if (p.status >= 400) return check('changed_routes', 'disagrees', `${path} answered ${p.status}.`);
    if (!p.page && /^\s*<(!doctype|html)/i.test(p.body ?? '')) missing.push(`${path} (the page shell, which answers any unknown path)`);
    else if (!p.page && !text(p.body)) missing.push(`${path} (a bare status)`);
  }
  if (missing.length) return check('changed_routes', 'missing', `Not proven: ${missing.join(', ')}.`);
  return check('changed_routes', 'agrees', `${named.join(', ')} answered.`);
}

function treeState(e: Evidence): Check {
  const t = e.tree;
  if (typeof t?.clean !== 'boolean' || typeof t?.head_is_origin_main !== 'boolean') return check('tree_state', 'missing', 'The record does not state the tree and HEAD.');
  if (!t.clean) return check('tree_state', 'disagrees', 'The tree was dirty, so the build used files the commit does not contain.');
  if (!t.head_is_origin_main) return check('tree_state', 'disagrees', 'HEAD was not origin/main.');
  return check('tree_state', 'agrees', 'Clean tree, HEAD on origin/main.');
}

function deployLock(e: Evidence): Check {
  if (e.lock?.held === true) return check('deploy_lock', 'agrees', 'The deploy held the lock.');
  return check('deploy_lock', 'missing', 'No deploy lock on record, so this evidence is about an indeterminate state.');
}

export function judgeRelease(e: Evidence): ReleaseAnswer {
  const checks = [deployedSha(e), runningImage(e), applicationStarted(e), changedRoutes(e), treeState(e), deployLock(e)];
  const failed = checks.filter((c) => c.status === 'disagrees');
  const open = checks.filter((c) => c.status === 'missing');
  const verdict: Verdict = failed.length ? 'disagrees' : open.length ? 'unverified' : 'evidence_agrees';
  const statement = {
    disagrees: `Failed verification. Evidence and intent disagree on: ${failed.map((c) => c.check).join(', ')}.`,
    unverified: `Unverified. The evidence does not show: ${open.map((c) => c.check).join(', ')}.`,
    evidence_agrees: 'The commit, the running image and the live routes agree. Whether the release stands is a person\'s call.',
  }[verdict];
  return {
    intended_sha: text(e.intended_sha),
    verdict,
    statement,
    checks,
    human_decision: { whether_the_release_stands: 'person_only', ellis_may: 'report_and_propose' },
    limits: [...LIMITS],
  };
}
