import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recallReadingScroll, rememberReadingScroll } from '../src/client/scroll-memory.ts';

test('reading scroll is remembered per key and the latest position wins', () => {
  assert.equal(recallReadingScroll('session-a'), undefined);
  rememberReadingScroll('session-a', 120, false);
  rememberReadingScroll('session-a', 240, true);
  rememberReadingScroll('session-b', 40, false);
  assert.deepEqual(recallReadingScroll('session-a'), { top: 240, following: true });
  assert.deepEqual(recallReadingScroll('session-b'), { top: 40, following: false });
  rememberReadingScroll('', 999, false);
  assert.equal(recallReadingScroll(''), undefined);
});
