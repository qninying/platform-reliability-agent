# 002: Unknown is never reported as healthy

**Status:** in force since 2026-10-26 · recorded 2026-10-27

## Context
While building the first capabilities, at least eight platform findings shared one cause: something reported
health it had not measured. A security director stayed "normal" because no threat arrived from a scanner
that never ran; a cleanup logged its error and returned success. These are written up in
[no-evidence-is-not-health.md](../no-evidence-is-not-health.md).

## Decision
A verdict may say healthy, clean or clear only when it holds recent, positive evidence. With no evidence it
says `unknown` and why. A rollup over any unknown part is itself unknown, never green.

## Alternatives considered
- **Treat silence as healthy and alert on errors.** Rejected: it is the platform behaviour that produced the
  findings above.
- **Hide parts that cannot be judged.** Rejected: a list that silently leaves things out reads as complete.
  Ellis lists them with the reason instead (for example the "not evaluated" list in cron health alerting).

## Consequences
- More answers are `unknown` or "clear with blind spots", which is less comfortable to read but true.
- Every capability needs an explicit state for "cannot say", and tests for it.

## Evidence
- `src/capabilities/securityOversightRollup.ts:22-23` (verdicts include `unknown`), `:83` (no scanners means
  unknown); `src/capabilities/securityPostureScan.ts:16`, `:26` (a scan that covered nothing is unknown).
- `src/capabilities/cronHealthAlerting.ts`: the answer is `clear` only when every job was evaluated.
- `src/capabilities/agentHealthScoring.ts`: a score that rests on zero runs is `unscored`, never 100.
