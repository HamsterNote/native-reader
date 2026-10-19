import assert from 'node:assert/strict';
import test from 'node:test';
import { policyTests, verifyPolicyResults } from './contract.mjs';

const summary = {
  totalTestCount: 5,
  passedTests: 5,
  failedTests: 0,
  skippedTests: 0,
};
const tree = {
  name: 'PdfPolicyTests',
  children: policyTests.map((name) => ({ name })),
};

test('accepts a complete passing policy suite', () => {
  assert.equal(verifyPolicyResults(summary, tree).passed, 5);
});

for (const [name, change] of [
  ['zero tests', { totalTestCount: 0, passedTests: 0 }],
  ['failure', { passedTests: 4, failedTests: 1 }],
  ['skip', { passedTests: 4, skippedTests: 1 }],
  ['expected failure', { expectedFailures: 1 }],
  ['unrecognized result schema', { passedTests: undefined }],
])
  test(`rejects ${name}`, () => {
    assert.throws(() => verifyPolicyResults({ ...summary, ...change }, tree));
  });

test('rejects another suite with the same passing count', () => {
  assert.throws(() => verifyPolicyResults(summary, { name: 'OtherTests' }));
});

test('rejects a missing policy test despite a passing count', () => {
  assert.throws(() =>
    verifyPolicyResults(summary, { ...tree, children: tree.children.slice(1) }),
  );
});
