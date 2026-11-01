// platform.backup_and_restore_verification, first release behaviour (R2):
// states the current recovery position honestly, including that no backup verification exists, with the search
// that establishes it. It never infers a position from pg_dump in an unrelated script. Read-only: an agent can
// neither take nor read a production backup (production_database is default-denied,
// delivery/execution/executionPolicy.ts:35), and the recovery objective, destination and cadence are not agreed.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - Production Postgres sits on a named Docker volume (docker-compose.production.yml:21).
// - The only pg_dump that runs is schema-only (scripts/syncDevSchemaFromProd.sh:110), so it copies no data.
// - The repo disagrees with itself: docs/spec/out-of-scope-nfrs.md:37 says recovery is "git history + Postgres
//   snapshots", scripts/artifacts/tickets/c77Data.js:57 says there is no database backup of any kind. Both are
//   claims. Neither is a restore.
// - Stored tokens are encrypted under a key held outside the database, and the ciphertext in a database backup is
//   worthless without it (backend/src/scripts/generateCredentialMasterKey.ts:15-18).

import type { Reader } from './registryReconciliation.ts';

export const NO_VERIFICATION = 'unknown, no backup verification exists in this repository';
export const SEARCH_INCOMPLETE = 'unknown, the search could not establish anything';
// A broken search also finds nothing, so an absence only counts once this known pg_dump has been found.
export const CONTROL = { file: 'scripts/syncDevSchemaFromProd.sh', kind: 'schema_only' } as const;

export const ROOTS = ['backend/src', 'scripts', 'directives', 'docs', 'execution', 'nginx', 'preview-db-init', '.github'] as const;
export const ROOT_FILES = ['docker-compose.yml', 'docker-compose.dev.yml', 'docker-compose.preview.yml', 'docker-compose.production.yml', 'package.json'] as const;
// The story's own words, and session narrative, would only find this search talking about itself.
export const EXCLUDED = ['backend/src/services/agentDomain/capabilities/', 'docs/sessions/'] as const;
const TEXT_FILE = /(\.(ts|tsx|js|mjs|cjs|sh|py|sql|yml|yaml|conf|md|txt)|package\.json|Dockerfile[^/]*)$/;

export const TOOL_TERMS = /\b(pg_dumpall|pg_dump|pg_basebackup|pg_restore|pgbackrest|barman|wal-g)\b/i;
export const VERIFY_TERMS = /\bpg_restore\b|restore (test|drill|verification)|verify\w* (the )?(backup|restore)/i;
export const CLAIM_TERMS = /[Nn]o database backup|[Pp]ostgres snapshots?|\bDR plan\b|\bRPO\b|\bRTO\b|recovery objective|backup policy/;

export type HitKind = 'schema_only' | 'prose' | 'test' | 'candidate';
export interface Hit { where: string; term: string; kind: HitKind; text: string }
export interface Claim { where: string; text: string }

const clip = (s: string) => s.trim().slice(0, 170);
const isTest = (file: string) => /__tests__\/|\.test\.[jt]s$/.test(file);
const isProseFile = (file: string) => /\.(md|txt)$/.test(file);
const isProseLine = (line: string) => /^\s*(\/\/|\/\*|\*|#|--|\+ ['"`]|['"`])/.test(line) || /console\.\w+\(|\becho\b/.test(line);

const BARE_TOOL = /['"`](pg_dumpall|pg_dump|pg_basebackup|pg_restore|pgbackrest|barman|wal-g)['"`]/;

export function classify(file: string, line: string): HitKind {
  if (isTest(file)) return 'test';
  if (isProseFile(file)) return 'prose';
  if (BARE_TOOL.test(line)) return 'candidate'; // spawn('pg_dump', ...) broken over lines reads like a string, and is a run
  if (isProseLine(line)) return 'prose';
  if (/--schema-only|\s-s(\s|$)/.test(line)) return 'schema_only';
  return 'candidate';
}

export interface SearchResult {
  roots_searched: string[];
  roots_not_found: string[];
  files_read: number;
  files_not_read: string[];
  hits: Hit[];
  verifying: Hit[];
  claims: Claim[];
}

export function search(r: Reader): SearchResult {
  const files: string[] = [];
  const found: string[] = [];
  const missing: string[] = [];
  for (const root of ROOTS) {
    try {
      files.push(...r.list(root));
      found.push(root);
    } catch {
      missing.push(root); // reported in the answer, and a missing root stops the search counting as complete
    }
  }
  const out: SearchResult = { roots_searched: found, roots_not_found: missing, files_read: 0, files_not_read: [], hits: [], verifying: [], claims: [] };
  const wanted = [...new Set([...files, ...ROOT_FILES])].filter((f) => TEXT_FILE.test(f) && !EXCLUDED.some((e) => f.startsWith(e)));
  for (const file of wanted) {
    let text: string;
    try {
      text = r.read(file);
    } catch {
      if (!(ROOT_FILES as readonly string[]).includes(file)) out.files_not_read.push(file);
      continue;
    }
    out.files_read++;
    text.split('\n').forEach((line, i) => {
      const where = `${file}:${i + 1}`;
      const tool = TOOL_TERMS.exec(line);
      const hit = tool ? { where, term: tool[1].toLowerCase(), kind: classify(file, line), text: clip(line) } : null;
      if (hit) out.hits.push(hit);
      if (VERIFY_TERMS.test(line)) out.verifying.push(hit ?? { where, term: 'restore', kind: classify(file, line), text: clip(line) });
      if (CLAIM_TERMS.test(line) && !isTest(file)) out.claims.push({ where, text: clip(line) });
    });
  }
  return out;
}

export type Basis = 'nothing_found' | 'candidates_need_a_person' | 'search_incomplete';

export interface PositionAnswer {
  source_commit: string | null;
  position: 'unknown';
  basis: Basis;
  statement: string;
  newest_backup_age: null;
  restore_last_exercised: null;
  search: {
    terms: string;
    roots_searched: string[];
    roots_not_found: string[];
    excluded: string[];
    files_read: number;
    files_not_read: string[];
    control: { file: string; found: boolean };
    hit_counts: Record<HitKind, number>;
  };
  candidates: Hit[];
  verifying_hits: Hit[];
  not_evidence: Hit[];
  claims_in_the_repo: Claim[];
  policy: { recovery_objective: null; destination: null; cadence: null; agreed_by: []; to_agree: string[]; note: string };
  a_restore_counts_only_if: string[];
  human_decision: { taking_reading_or_restoring_a_production_backup: 'person_only'; ellis_may: 'report_and_propose' };
  limits: string[];
}

export const RESTORE_RULES: readonly string[] = [
  'It completed, and the restored database answered a known query. A file existing, or its size, proves nothing.',
  'The target was isolated. A restore over anything live is the incident this exists to prevent.',
  'The credential master key was available too. The tokens in a database backup cannot be read without it.',
];

export const LIMITS: readonly string[] = [
  'This is about this repository. It does not say no backup exists: a host job, a provider snapshot or a copy taken by hand would not appear here.',
  'The crontab is held in no repository, so a backup job could run on the host unseen here. Another system shares that host, and a backup script of its own is not this platform\'s.',
  'Claims in the repo are listed as written. Ellis does not judge between them, because neither is a restore.',
  'Prose and tests are read by line shape, and a hit can be misread. A candidate needs a person; it is never treated as a backup.',
  'A hit outside the searched roots and file types is not seen, and the search list says exactly what was read.',
];

export function backupPosition(r: Reader, source_commit: string | null): PositionAnswer {
  const s = search(r);
  const counts: Record<HitKind, number> = { schema_only: 0, prose: 0, test: 0, candidate: 0 };
  for (const h of s.hits) counts[h.kind]++;
  const controlFound = s.hits.some((h) => h.where.startsWith(`${CONTROL.file}:`) && h.kind === CONTROL.kind);
  const complete = controlFound && s.roots_not_found.length === 0 && s.files_not_read.length === 0;
  const candidates = s.hits.filter((h) => h.kind === 'candidate');
  const live = s.verifying.filter((h) => h.kind === 'candidate');
  const basis: Basis = !complete ? 'search_incomplete' : candidates.length || live.length ? 'candidates_need_a_person' : 'nothing_found';
  const statement = {
    nothing_found: NO_VERIFICATION,
    candidates_need_a_person: `unknown, ${new Set([...candidates, ...live].map((h) => h.where)).size} line(s) may be a backup or restore and need a person to read them`,
    search_incomplete: SEARCH_INCOMPLETE,
  }[basis];
  return {
    source_commit,
    position: 'unknown',
    basis,
    statement,
    newest_backup_age: null,
    restore_last_exercised: null,
    search: {
      terms: `${TOOL_TERMS.source} | ${VERIFY_TERMS.source}`,
      roots_searched: s.roots_searched,
      roots_not_found: s.roots_not_found,
      excluded: [...EXCLUDED],
      files_read: s.files_read,
      files_not_read: s.files_not_read,
      control: { file: CONTROL.file, found: controlFound },
      hit_counts: counts,
    },
    candidates,
    verifying_hits: s.verifying,
    not_evidence: s.hits.filter((h) => h.kind !== 'candidate'),
    claims_in_the_repo: s.claims,
    policy: {
      recovery_objective: null,
      destination: null,
      cadence: null,
      agreed_by: [],
      to_agree: ['K.D.', 'A.M.'],
      note: 'No backup policy is agreed, so there is nothing to verify against. The policy is the first deliverable, and it is theirs.',
    },
    a_restore_counts_only_if: [...RESTORE_RULES],
    human_decision: { taking_reading_or_restoring_a_production_backup: 'person_only', ellis_may: 'report_and_propose' },
    limits: [...LIMITS],
  };
}
