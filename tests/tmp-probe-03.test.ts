/**
 * TEMPORARY PROBE — created to watch the commit pipeline, not to test anything.
 *
 * It passes on purpose: a probe that failed would only tell us that a test can fail, while the interesting question is
 * what the chain does with files that are extra.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('temporary probe 03 runs and passes', () => {
  assert.equal(3 + 1, 4);
});
