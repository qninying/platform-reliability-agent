# Deploy verification evidence

**Story:** `platform.CAP.deploy_verification_evidence` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D.
**Code:** `src/capabilities/deployVerificationEvidence.ts`, `src/cli/releaseEvidence.ts` · **Tests:** `test/deployVerificationEvidence.test.ts`

This first release judges one release's evidence and states whether the deployed commit, the running image and the
live routes agree. A person runs the deploy and collects the record. Ellis never reaches the host, and whether a
release stands stays a person's decision at every autonomy level.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run release-evidence -- --evidence <record.json>
```

Exit code 0 when the evidence agrees, 3 when it disagrees with the intent, 4 when it is unverified, 1 for bad input.
`examples/release-evidence.example.json` shows the record.

## How it decides

| Verdict | Means |
|---|---|
| `evidence_agrees` | All six checks agree. A person still decides whether the release stands |
| `unverified` | Something is missing. Never reported as deployed |
| `disagrees` | The failed-verification signal: the evidence contradicts the intent. This outranks anything missing |

| Check | Agrees when |
|---|---|
| `deployed_sha` | The deployed commit matches the intended one, and the record has a deploy time |
| `running_image` | Every named service is `running`, and its image is tied to the commit |
| `application_started` | `/health` or `/health/full` returned 200 after the deploy, with the application's own healthy body |
| `changed_routes` | Every route the record names answered after the deploy, with more than a bare status |
| `tree_state` | The tree was clean and HEAD was on `origin/main`. A dirty tree disagrees |
| `deploy_lock` | The deploy held the lock. Without it, the evidence is about an indeterminate state |

The first three are the story's three. The other three come from its exceptions, so a record lacking them is unverified
too. That includes a release that changed no route: it has to name one it checked, because Ellis cannot tell
"nothing changed" from "nothing was checked".

## Why a 200 is not enough

On 2026-08-28 the site returned 200 while the backend sat in `created` for about four minutes
(`scripts/deploy-prod.sh:7-10`). `location /` answers any unknown path with the page shell
(`nginx/nginx.conf:477-481`). So a response counts only if the application wrote it: JSON with `status: ok` from
`/health`, or `overall_status` of `ok` or `warning` from `/health/full`. A bare 200, or the page shell, is the edge
talking. A probe from before the deploy does not count either.

## Why the image name is not enough

No route reports a commit: `/health` returns a status and a timestamp (`backend/src/routes/healthRoutes.ts:7-15`).
Production images are named `:main` (`docker-compose.production.yml:44`, `:145`), a tag that moves. So the routes show
the application is up, and only the image can tie it to a commit. Ellis accepts a `:sha-<commit>` tag
(`.github/workflows/build-images.yml:95`), or the running digest matching the digest of that commit's image.

## What the deploy script's own lines prove

Its poll calls `/api/health` and counts any answer (`scripts/deploy-prod.sh:305`, `:312`), while the health routes are
mounted at `/health` (`backend/src/server.ts:214`). So "backend answering" shows a process is serving, not that it is
healthy, and Ellis does not accept it. The script says this itself at the end of each deploy: the surface is not proved
(`:344`). A compose command run by hand holds no lock (`:171-172`).

## Collecting a record

Run on the host by a person, after the deploy, through the real hostname.

| Field | From |
|---|---|
| `deployed_sha`, `tree`, `lock` | `git rev-parse HEAD`, `git status --porcelain`, and the deploy going through `deploy-prod.sh` |
| `containers[].state` | `docker inspect -f '{{.State.Status}}' <container>` |
| `containers[].digest` | `docker inspect -f '{{index .RepoDigests 0}}' <image>` |
| `pinned_digests` | The digest of `:sha-<commit>` from `docker buildx imagetools inspect` |
| `routes` | `curl` through the hostname, with status, body and time |

The record holds no credentials. Keep the probes to routes that return no personal data.

## Limits, stated in every answer

- Ellis judges the record it is given, so a false record gets a false answer.
- The routes show the application is up, and only the digest ties it to a commit.
- A deploy built on the host has no published image to compare, so its running image stays unverified.
- Health covers the process and the database. Only named routes speak to what the release changed.
- The script's "backend answering" line is not proof.
- A record is about the moment it was collected. Later deploys are not seen.

## Evidence

- **Acceptance:** `missing any of the three is unverified, never deployed` and `an edge 200 alone is never proof the
  application started` in `test/deployVerificationEvidence.test.ts`. The 2026-08-28 case has its own test. 29 tests.
- **Each rule can fail:** 45 of 45 deliberate breaks were caught, starting from a passing suite. Two survived the first
  pass and led to stronger tests.
- **Not done:** it has never judged a real release. The first real record needs a person on the host. Nothing stores
  records per release yet, and that storage is a platform change.
