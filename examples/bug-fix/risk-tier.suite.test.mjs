// The router's existing behaviour that a fix must keep: written from the platform's own comments
// (backend/src/services/workGraph/capabilityRouter.ts:11 and :34). It passes before any fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskTierAllowed } from './capabilityRouter.excerpt.ts';

test('a ticket with no risk tier is unrestricted, by design', () => {
  assert.equal(riskTierAllowed(null, 'R0'), true);
  assert.equal(riskTierAllowed(undefined, 'R0'), true);
});

test('a recognised tier at or below the ceiling is allowed', () => {
  assert.equal(riskTierAllowed('R0', 'R2'), true);
  assert.equal(riskTierAllowed('R2', 'R2'), true);
});

test('a recognised tier above the ceiling is refused', () => {
  assert.equal(riskTierAllowed('R4', 'R3'), false);
});
