import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deliverableOpenModeOf, fileAddressFor, isFolderOpenPath, openDeliverableFile,
} from '../src/client/open-file.ts';

// Fixture file names deliberately avoid a `.ts` extension: this repository's test runner rewrites
// `.ts` specifiers to `.js` across the emitted tree, string literals included, so a fixture named
// `a.ts` arrives at the assertion as `a.js`.
const resolve = (cwd: string | undefined, path: string) => (cwd === undefined ? path : `${cwd}/${path}`);

test('the session address matches the official scheme, and a cwd prefix is stripped', () => {
  // The product's own tab actions build `fileAddressFor(sessionId, root, path)` before calling the
  // sidebar opener, so this fork has to produce the same string for the same file.
  assert.equal(
    fileAddressFor('s-1', '/w', 'src/a b.md'),
    'dsh-resource://file/session/s-1/src/a%20b.md',
  );
  assert.equal(
    fileAddressFor('s-1', 'C:\\work', 'C:\\work\\src\\b.md'),
    'dsh-resource://file/session/s-1/src/b.md',
  );
  // Windows drive colons survive encoding; a leading ./ is dropped.
  assert.equal(fileAddressFor('s-1', '/w', './d.md'), 'dsh-resource://file/session/s-1/d.md');
  // A path outside the workspace root is passed through as it stands — which, for an absolute path,
  // leaves a doubled slash in the address. That is the OFFICIAL builder's behaviour, not a slip: this
  // function mirrors it rather than inventing a cleaner address the host would not resolve.
  assert.equal(
    fileAddressFor('s-1', '/w', '/elsewhere/c.md'),
    'dsh-resource://file/session/s-1//elsewhere/c.md',
  );
});

test('the stored mode is read defensively, and anything unknown means the system app', () => {
  // The value arrives from the React side's `useStore` subscription, and a record written before the
  // preference existed simply has no such key — so `undefined` has to mean the system app rather than
  // throwing. There is deliberately no `modeFromSnapshot` helper left to test here: the handle
  // `createReaderStore()` returns carries no snapshot, and a helper that read one off it is exactly
  // what made this switch a no-op (every click resolved to `undefined` → the system app).
  assert.equal(deliverableOpenModeOf('sidebar'), 'sidebar');
  assert.equal(deliverableOpenModeOf('external'), 'external');
  assert.equal(deliverableOpenModeOf(undefined), 'external');
  assert.equal(deliverableOpenModeOf('nonsense'), 'external');
  assert.equal(deliverableOpenModeOf({ deliverableOpenMode: 'sidebar' }), 'external');
});

test('a workspace folder always goes to the system opener, whatever the mode says', async () => {
  const opened: string[] = [];
  const sidebar: string[] = [];
  for (const path of ['.', '']) {
    assert.ok(isFolderOpenPath(path));
    const where = await openDeliverableFile({
      path, mode: 'sidebar', sessionId: 's-1', cwd: '/w', resolveWorkspacePath: resolve,
      openExternal: async absolute => { opened.push(absolute); },
      openSidebar: address => { sidebar.push(address); },
    });
    assert.equal(where, 'external');
  }
  assert.deepEqual(opened, ['/w', '/w']);
  assert.deepEqual(sidebar, []);
});

test('sidebar mode uses the opener when there is one, and falls back loudly when there is not', async () => {
  const opened: string[] = [];
  const sidebar: string[] = [];
  const warnings: string[] = [];
  const common = {
    path: 'src/a.md', sessionId: 's-1', cwd: '/w', resolveWorkspacePath: resolve,
    openExternal: async (absolute: string) => { opened.push(absolute); },
    warn: (message: string) => { warnings.push(message); },
  };

  assert.equal(await openDeliverableFile({ ...common, mode: 'sidebar', openSidebar: address => { sidebar.push(address); } }), 'sidebar');
  assert.deepEqual(sidebar, ['dsh-resource://file/session/s-1/src/a.md']);
  assert.deepEqual(opened, [], 'the system app is not also asked to open it');
  assert.deepEqual(warnings, []);

  // No opener registered on this host: the click still opens the file, and says why in the console.
  assert.equal(await openDeliverableFile({ ...common, mode: 'sidebar' }), 'external');
  assert.deepEqual(opened, ['/w/src/a.md']);
  assert.equal(warnings.length, 1);

  // An opener that throws is the same deal.
  opened.length = 0; warnings.length = 0;
  assert.equal(await openDeliverableFile({ ...common, mode: 'sidebar', openSidebar: () => { throw new Error('no tab'); } }), 'external');
  assert.deepEqual(opened, ['/w/src/a.md']);
  assert.equal(warnings.length, 1);

  // And the default mode never even looks for the sidebar.
  opened.length = 0;
  assert.equal(await openDeliverableFile({ ...common, mode: 'external', openSidebar: () => { throw new Error('must not be called'); } }), 'external');
  assert.deepEqual(opened, ['/w/src/a.md']);
});
