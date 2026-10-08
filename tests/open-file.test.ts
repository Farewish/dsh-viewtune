import assert from 'node:assert/strict';
import { test } from 'node:test';
// The host's own resolver supplies the expected absolute path (platform separators included) rather than a guess at its rules.
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path';
import {
  deliverableOpenModeOf, fileAddressFor, isFolderOpenPath, openDeliverableFile, workspaceImageUrl,
} from '../src/client/open-file.ts';

// An answer's image is authored as a path inside the session workspace, which the browser cannot fetch as written. The host's
// transcript resolves it to its own file route; the reading view showed only the alt text until this step existed. Every case
// below is a decision rather than a detail.
test('a workspace-relative image destination becomes the app file route, and nothing else is touched', () => {
  const origin = 'http://127.0.0.1:62699';
  // The resolved path comes from the host's own resolver, separators and all, so the expectation is derived from it rather than
  // restating its platform rules here: what this asserts is that the resolved path is what reaches the route, encoded.
  const relative = 'pics/circuit.png';
  const built = workspaceImageUrl('D:\\DSH\\proj', relative, origin);
  assert.ok(built?.startsWith(`${origin}/api/file?path=`), 'a relative path is served through the host file route');
  assert.equal(
    decodeURIComponent(built!.slice(built!.indexOf('path=') + 'path='.length)),
    resolveWorkspacePath('D:\\DSH\\proj', relative),
    'the host receives the path resolved against the session workdir',
  );
  assert.equal(
    decodeURIComponent(workspaceImageUrl('/home/me/proj', 'a%20b.png', origin)!.slice(built!.indexOf('path=') + 'path='.length)),
    resolveWorkspacePath('/home/me/proj', 'a b.png'),
    'a percent-encoded path is decoded first, so the host receives the real name',
  );
  // Handed to the renderer's own allowlist, which already knows what to do with them.
  assert.equal(workspaceImageUrl('D:\\DSH\\proj', 'http://x/y.png', origin), undefined, 'an absolute http(s) URL is untouched');
  assert.equal(workspaceImageUrl('D:\\DSH\\proj', '/api/file?path=x', origin), undefined, 'a same-origin route is untouched');
  assert.equal(workspaceImageUrl('D:\\DSH\\proj', '//evil/x.png', origin), undefined, 'a protocol-relative URL is cross-origin');
  assert.equal(workspaceImageUrl('D:\\DSH\\proj', 'data:image/png;base64,AA', origin), undefined, 'a data URL is not a workspace path');
  // Without a workdir there is nothing to resolve against, and a bad escape is not a path this can serve.
  assert.equal(workspaceImageUrl(undefined, 'pics/a.png', origin), undefined, 'no cwd means no resolution');
  assert.equal(workspaceImageUrl('D:\\DSH\\proj', 'a%ZZ.png', origin), undefined, 'a malformed escape falls back to the alt text');
});

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
