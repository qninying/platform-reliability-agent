// Baseline for the reported defect: a ticket whose risk tier is outside the router's vocabulary clears every
// ceiling, because riskTierIndex() returns 0 (the read-only tier) for a tier it does not recognise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskTierAllowed } from './capabilityRouter.excerpt.ts';

test('an unrecognised ticket risk tier does not clear a read-only ceiling', () => {
  assert.equal(riskTierAllowed('high', 'R0'), false, 'unrecognised tier cleared the R0 ceiling');
});

test('control: a recognised tier above the ceiling is refused', () => {
  assert.equal(riskTierAllowed('R3', 'R0'), false);
});
