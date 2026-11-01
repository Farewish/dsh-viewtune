import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recallFoldState, rememberFoldState } from '../src/client/fold-memory.ts';

test('the reveal window is remembered per session and overwrites', () => {
  assert.equal(recallFoldState('session-a'), undefined);
  rememberFoldState('session-a', { liveTurn: 7, foldWindow: 5, revealed: 10 });
  rememberFoldState('session-b', { liveTurn: 7, foldWindow: 3, revealed: 0 });
  assert.deepEqual(recallFoldState('session-a'), { liveTurn: 7, foldWindow: 5, revealed: 10 });
  assert.deepEqual(recallFoldState('session-b'), { liveTurn: 7, foldWindow: 3, revealed: 0 });
  rememberFoldState('', { liveTurn: 1, foldWindow: 1, revealed: 1 });
  assert.equal(recallFoldState(''), undefined);
});
