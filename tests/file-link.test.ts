import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFileLink } from '../src/client/markdown/file-link.ts';

// Ported with the module it tests, from the harness's own `client/ui-primitives/src/markdown/file-link.ts`. The cases below are
// the contract the reading view now shares with the host's transcript: a destination the host turns into a link must become one
// here too, and one it refuses must stay plain text.
//
// Fixture names avoid a `.ts` extension on purpose: this runner rewrites `.ts` to `.js` across the emitted tree, string literals
// included, so a fixture named `a.ts` reaches the assertion as `a.js` while an argument carrying a `#L12` suffix does not.
test('a local file destination is decoded, with its optional line, and nothing else is accepted', () => {
  assert.deepEqual(parseFileLink('src/client/Reader.md'), { path: 'src/client/Reader.md' }, 'a relative path is local');
  assert.deepEqual(parseFileLink('a%20b/c.md'), { path: 'a b/c.md' }, 'percent escapes are decoded');
  assert.deepEqual(parseFileLink('/abs/path.png'), { path: '/abs/path.png' }, 'an absolute POSIX path is local');
  assert.deepEqual(parseFileLink('C:\\work\\a.md'), { path: 'C:\\work\\a.md' }, 'a Windows drive path is local, not a scheme');
  assert.deepEqual(parseFileLink('src/a.md#L12'), { path: 'src/a.md', line: 12 }, 'a line fragment is carried');
  assert.deepEqual(parseFileLink('src/a.md#L12-L20'), { path: 'src/a.md', line: 12 }, 'a range uses its first line');
  // Refusals: each of these must stay plain text rather than become a broken link.
  assert.equal(parseFileLink('https://x/y.png'), undefined, 'an absolute URL is not a local file');
  assert.equal(parseFileLink('mailto:a@b.c'), undefined, 'a non-file scheme is not a local file');
  assert.equal(parseFileLink('//host/share'), undefined, 'a protocol-relative destination is not local');
  assert.equal(parseFileLink('#L12'), undefined, 'a fragment-only link names no file');
  assert.equal(parseFileLink('a.md?raw=1'), undefined, 'a query is not a filename component');
  assert.equal(parseFileLink('a%ZZ.md'), undefined, 'a malformed escape is ambiguous');
  assert.equal(parseFileLink('a.md#nope'), undefined, 'a non-line fragment is not accepted');
  assert.equal(parseFileLink('a.md#L0'), undefined, 'line numbers are 1-based');
  assert.equal(parseFileLink('a.md#L20-L12'), undefined, 'a reversed range is invalid');
  assert.equal(parseFileLink(''), undefined, 'an empty destination names no file');
});
