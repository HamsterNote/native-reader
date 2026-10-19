import assert from 'node:assert/strict';

export const policyTests = [
  'testLocalSchemesAndEncodedControls',
  'testStrictIntegerAndEnvelope',
  'testCancellationAndIndependentReadGrant',
  'testSnapshotNeverWritesOrDeletesHostFile',
  'testReadDeniedWhenFileSystemDoesNotGrantRead',
  'testInvalidAndOversizeSourcesFailBeforePdfViewBinding',
];

export function verifyPolicyResults(summary, tests) {
  assert.equal(
    summary.totalTestCount,
    policyTests.length,
    'Unexpected XCTest count',
  );
  assert.equal(
    summary.passedTests,
    policyTests.length,
    'Every policy test must pass',
  );
  assert.equal(summary.failedTests, 0, 'XCTest failures are not accepted');
  assert.equal(
    summary.skippedTests,
    0,
    'Skipped policy tests are not accepted',
  );
  assert.equal(
    summary.expectedFailures ?? 0,
    0,
    'Expected failures are not passes',
  );
  const tree = JSON.stringify(tests);
  assert(
    tree.includes('PdfPolicyTests'),
    'Missing actual PdfPolicyTests suite',
  );
  for (const name of policyTests)
    assert(tree.includes(name), `Missing actual XCTest result: ${name}`);
  return {
    passed: summary.passedTests,
    failed: 0,
    skipped: 0,
    tests: policyTests,
  };
}
