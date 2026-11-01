import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginReaderResize, readerResizeActive } from '../src/client/resize-signal.ts';

test('reader resizes are counted and released idempotently', () => {
  assert.equal(readerResizeActive(), false);
  const first = beginReaderResize();
  const second = beginReaderResize();
  assert.equal(readerResizeActive(), true);
  first();
  assert.equal(readerResizeActive(), true);
  first();
  second();
  assert.equal(readerResizeActive(), false);
});
