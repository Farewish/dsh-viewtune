import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { callDiffHunks } from '../src/client/tool-activity.ts';

/** A settled call: `kind` present is what makes its metadata available to read. */
const settled = (name: string, args: unknown, extra: { meta?: unknown; subCalls?: ToolCallBlock[] } = {}) => ({
  kind: 'tool-result', callId: 'call-1', call: { callId: 'call-1', name, argsRaw: JSON.stringify(args) },
  argsRaw: JSON.stringify(args), subCalls: extra.subCalls ?? [], meta: extra.meta,
  content: [], isError: false, time: 0,
}) as unknown as ToolCallBlock;

test('the host result metadata is preferred over the call’s own arguments', () => {
  // The call's arguments say one thing and the result another: the result is what happened, so it
  // is the side that gets counted, and the arguments must not be added on top of it.
  const block = settled('write', { file_path: '/w/a.ts', content: 'one\ntwo\nthree\n' }, {
    meta: { diffs: [{ path: '/w/a.ts', oldText: 'one\n', newText: 'one\ntwo\n' }] },
  });
  const hunks = callDiffHunks(block, 'write', { file_path: '/w/a.ts', content: 'one\ntwo\nthree\n' });
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0], { path: '/w/a.ts', oldText: 'one\n', newText: 'one\ntwo\n' });
});

test('a call with no result metadata falls back to its arguments only if it mutates a file', () => {
  const args = { file_path: '/w/a.ts', content: 'x\ny\n' };
  const write = callDiffHunks(settled('write', args), 'write', args);
  assert.equal(write.length, 1);
  assert.equal(write[0]!.path, '/w/a.ts');
  assert.equal(write[0]!.newText, 'x\ny\n');
  assert.equal(write[0]!.oldText, null);

  // `content` is a field several unrelated tools carry (a memory note, a typed message). Reading it
  // as a file body would invent additions for a call that changed no file at all.
  const read = callDiffHunks(settled('read', args), 'read', args);
  assert.deepEqual(read, []);
  const renamed = { file_path: '/w/a.ts', content: 'x\ny\n' };
  assert.equal(callDiffHunks(settled('str_replace_editor', renamed), 'str_replace_editor', renamed).length, 1);
});

test('the edit argument aliases are honoured, and a side with nothing in it is dropped', () => {
  const edit = { file_path: '/w/a.ts', old_string: 'old\n', new_str: 'new\n' };
  const hunks = callDiffHunks(settled('edit', edit), 'edit', edit);
  assert.deepEqual(hunks, [{ path: '/w/a.ts', oldText: 'old\n', newText: 'new\n' }]);

  // Nothing on either side is not a diff, and an all-empty metadata entry must not become one.
  const empty = settled('write', { file_path: '/w/a.ts' }, {
    meta: { diffs: [{ path: '/w/a.ts', oldText: '', newText: '' }, { path: '/w/b.ts', oldText: 'gone\n', newText: '' }] },
  });
  const kept = callDiffHunks(empty, 'write', { file_path: '/w/a.ts' });
  assert.deepEqual(kept, [{ path: '/w/b.ts', oldText: 'gone\n', newText: '' }]);

  // A pure creation has no old side at all, and is still a diff.
  const created = settled('write', {}, { meta: { diffs: [{ path: '/w/new.ts', newText: 'a\nb\n' }] } });
  assert.deepEqual(callDiffHunks(created, 'write', {}), [{ path: '/w/new.ts', oldText: null, newText: 'a\nb\n' }]);
});

test('a parent call reports what its children changed, not its own arguments', () => {
  const child = settled('write', {}, { meta: { diffs: [{ path: '/w/child.ts', oldText: 'a\n', newText: 'a\nb\n' }] } });
  // The child's own identity lives on `call`, which is how the fold reads its name and arguments.
  const named = { ...(child as unknown as Record<string, unknown>), call: { callId: 'call-2', name: 'write', argsRaw: '{}' } } as unknown as ToolCallBlock;
  const parent = settled('run_code', { code: 'write files' }, { meta: { diffs: [{ path: '/w/parent.ts', newText: 'one\n' }] }, subCalls: [named] });
  const hunks = callDiffHunks(parent, 'run_code', { code: 'write files' });
  assert.deepEqual(hunks.map(hunk => hunk.path), ['/w/parent.ts', '/w/child.ts']);

  // A parent that changed nothing itself still reports its child, and nothing at all when neither
  // side has a diff to show.
  const bare = settled('run_code', { code: 'ls' }, { subCalls: [named] });
  assert.deepEqual(callDiffHunks(bare, 'run_code', { code: 'ls' }).map(hunk => hunk.path), ['/w/child.ts']);
  assert.deepEqual(callDiffHunks(settled('run_code', {}), 'run_code', {}), []);
});
