// platform.production_deploy_review_and_approval, first release behaviour (R1), which is also its ceiling:
// reports preflight readiness as measured facts and acts on none of them. It never merges, pushes or deploys:
// merging is push_to_protected_main and releasing is production_deploy, and no rung can grant either
// (delivery/execution/executionPolicy.ts:33-42). Preparing a change in isolation is capability 16's sandbox
// runner (src/sandbox/baselineRunner.ts), which this release reuses and does not repeat.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - Preflight counts a modified tracked file as dirty and treats untracked files as noise (scripts/prod-preflight.sh:44).
// - It compares HEAD with origin/main after `git fetch ... || true` (:55), so a failed fetch compares against
//   an old local ref and can still pass. So Ellis asks the remote itself, and a remote it cannot reach is unknown.
// - The approval gate is A.M.: main needs one approving review, an author cannot approve their own PR, and any new
//   commit re-requires it (MERGE_WORKFLOW.md:87-90). That setting is not readable without admin access.

import { spawnSync } from 'node:child_process';
import type { Reader } from './registryReconciliation.ts';

// What this capability may hold. A test asserts none of these is denied and none is a deploy tool.
export const GRANTS = ['read_source_tree', 'run_sandbox_job', 'read_approval_records'] as const;
// Copied from executionPolicy.ts:33-42. An answer says whether the checkout's own list still matches.
export const DENIED = ['production_deploy', 'production_database', 'dns', 'live_email', 'cloud_resource_deletion', 'push_to_protected_main', 'unbounded_network', 'secret_exfiltration'] as const;
export const POLICY_FILE = 'backend/src/services/delivery/execution/executionPolicy.ts';

// Every git command this capability can run. Nothing else gets through, and none of these writes.
export const GIT_READS = [
  ['status', '--porcelain'],
  ['rev-parse', 'HEAD'],
  ['rev-parse', '--abbrev-ref', 'HEAD'],
  ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'],
  ['ls-remote', 'origin', 'refs/heads/main'],
] as const;

export class ReadinessError extends Error {
  readonly errorClass: 'ContractViolation' | 'NotARepository';
  constructor(errorClass: ReadinessError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

export type GitRun = (args: readonly string[]) => { ok: boolean; out: string };

export function gitReader(root: string): GitRun {
  return (args) => {
    if (!GIT_READS.some((allowed) => allowed.length === args.length && allowed.every((a, i) => a === args[i]))) {
      throw new ReadinessError('ContractViolation', `git ${args.join(' ')} is not a read this capability may run`);
    }
    // GIT_OPTIONAL_LOCKS=0 stops status refreshing the index, so the checkout is left exactly as found.
    const r = spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: r.status === 0, out: r.stdout ?? '' };
  };
}

export const deniedInGrants = (grants: readonly string[]) => grants.filter((g) => (DENIED as readonly string[]).includes(g) || /deploy|merge|push/i.test(g));

export function policyMatches(r: Reader): { read: boolean; matches: boolean | null } {
  let text: string;
  try {
    text = r.read(POLICY_FILE);
  } catch {
    return { read: false, matches: null }; // a checkout without the policy file is reported, not assumed to agree
  }
  const list = /DENIED_CAPABILITIES[^=]*=\s*\[([^\]]*)\]/.exec(text)?.[1];
  if (!list) return { read: false, matches: null };
  const names = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  return { read: true, matches: names.length === DENIED.length && DENIED.every((d) => names.includes(d)) };
}

export type Readiness = 'facts_ready' | 'not_ready' | 'unknown';

export interface ReadinessAnswer {
  source_commit: string | null;
  readiness: Readiness;
  statement: string;
  tree: { clean: boolean; tracked_changes: number; untracked: number; tracked_paths: string[] };
  head: { sha: string; branch: string | null };
  origin_main: { sha: string | null; read_from: 'remote' | 'none'; local_ref: string | null; local_ref_stale: boolean | null };
  head_matches_origin_main: boolean | null;
  not_measured: string[];
  approval: { state: 'unknown'; gate: string };
  isolation: string;
  grants: string[];
  denied_in_grants: string[];
  policy_list: { read: boolean; matches: boolean | null };
  never_does: string[];
  human_decision: { merging_and_deploying: 'person_only'; ellis_may: 'report_and_propose' };
  limits: string[];
}

export const NOT_MEASURED: readonly string[] = [
  'Whether another deploy is running (a host fact).',
  'Root volume use (a host fact).',
  'Whether this checkout is the one on the production host.',
  'Whether the change has been reviewed or approved.',
];

export const LIMITS: readonly string[] = [
  'These are facts about one checkout at one moment. A person can change either before the deploy starts.',
  'Facts ready is not approved. It means the tree and HEAD would pass those two checks, and nothing more.',
  'Untracked files are counted but do not fail the check, matching preflight. A build still copies what is on disk.',
  'A green deploy command is not a green release. What came up is judged afterwards, by deploy verification evidence.',
];

export function readiness(git: GitRun, r: Reader): ReadinessAnswer {
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  if (!head.ok || !status.ok) throw new ReadinessError('NotARepository', 'the checkout could not be read as a git repository with a commit');
  const lines = status.out.split('\n').filter(Boolean);
  const tracked = lines.filter((l) => !l.startsWith('??'));
  const clean = tracked.length === 0;
  const sha = head.out.trim();
  const name = git(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();

  const remote = git(['ls-remote', 'origin', 'refs/heads/main']);
  const originSha = remote.ok ? remote.out.split(/\s/)[0] || null : null;
  const local = git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
  const localRef = local.ok ? local.out.trim() : null;
  const matches = originSha === null ? null : originSha === sha;

  const result: Readiness = !clean || matches === false ? 'not_ready' : matches === null ? 'unknown' : 'facts_ready';
  const statement = {
    facts_ready: `Measured: the tree is clean and HEAD matches origin/main at ${sha.slice(0, 9)}. This is not an approval.`,
    not_ready: `Measured: ${[!clean ? `${tracked.length} tracked file(s) modified` : null, matches === false ? 'HEAD does not match origin/main' : null].filter(Boolean).join(', and ')}.`,
    unknown: 'Measured: the tree is clean. Whether HEAD matches origin/main is unknown, because the remote could not be read.',
  }[result];

  return {
    source_commit: sha.slice(0, 9),
    readiness: result,
    statement,
    tree: { clean, tracked_changes: tracked.length, untracked: lines.length - tracked.length, tracked_paths: tracked.slice(0, 20).map((l) => l.slice(3)) },
    head: { sha, branch: name === 'HEAD' ? null : name },
    origin_main: { sha: originSha, read_from: originSha ? 'remote' : 'none', local_ref: localRef, local_ref_stale: originSha && localRef ? originSha !== localRef : null },
    head_matches_origin_main: matches,
    not_measured: [...NOT_MEASURED],
    approval: { state: 'unknown', gate: 'main needs one approving review, and on this platform that is A.M. (MERGE_WORKFLOW.md:87-90). Ellis does not read it.' },
    isolation: 'Prepared with capability 16: npm run bug-baseline, in a sandbox that only reads the checkout.',
    grants: [...GRANTS],
    denied_in_grants: deniedInGrants(GRANTS),
    policy_list: policyMatches(r),
    never_does: ['merge', 'push', 'deploy'],
    human_decision: { merging_and_deploying: 'person_only', ellis_may: 'report_and_propose' },
    limits: [...LIMITS],
  };
}
