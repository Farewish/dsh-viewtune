import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { basename, createProducedFileMentions, deliverableDisplayOf, dirname, getTurnDeliverableGroups, getTurnDeliverables, showDeliverablesRow, DELIVERABLE_DISPLAYS } from '../src/client/deliverables.ts';
import type { ReaderFlowEntry } from '../src/client/tool-activity.ts';

test('basename and dirname handle POSIX and Windows style paths', () => {
  assert.equal(basename('src/client/Reader.tsx'), 'Reader.tsx');
  assert.equal(dirname('src/client/Reader.tsx'), 'src/client');
  assert.equal(basename('C:\\project\\src\\index.ts'), 'index.ts');
  assert.equal(dirname('C:\\project\\src\\index.ts'), 'C:\\project\\src');
  assert.equal(basename('simple.txt'), 'simple.txt');
  assert.equal(dirname('simple.txt'), '.');
  assert.equal(basename('/root/file.md/'), 'file.md');
  assert.equal(dirname('/root/file.md/'), '/root');
});

test('getTurnDeliverables reads the host’s two published lists, deliveries first', () => {
  // This test used to feed `deliverables.produced` — a field 0.2.0 does not publish — which is how the row ended up
  // built entirely from the tool-flow fallback without anyone noticing. The real shape is `{ changes, presented }`.
  const map = new Map<string, unknown>();
  map.set('deliverables', {
    changes: {
      added: 12,
      deleted: 3,
      files: [
        { path: 'src/client/Reader.tsx' },
        { path: 'src/client/Reader.module.css' },
        { path: 'src/client/Reader.tsx' }, // duplicate
      ],
    },
    presented: [{ seq: 1, path: 'dist/pkg.tgz' }],
  });
  const turn = { data: map } as unknown as TurnLocation;
  // Deliveries first — what was handed over — then what the turn changed, each path once.
  assert.deepEqual(getTurnDeliverables(turn), ['dist/pkg.tgz', 'src/client/Reader.tsx', 'src/client/Reader.module.css']);
});

test('getTurnDeliverables falls back to tool flow when turn data is absent', () => {
  const flow: ReaderFlowEntry[] = [
    {
      kind: 'tool',
      key: 'tool:1',
      callId: 'call:1',
      step: 1,
      order: 0,
      block: {
        kind: 'tool-call',
        name: 'write',
        argsRaw: JSON.stringify({ file_path: 'src/client/new-feature.ts', content: 'hello' }),
      } as any,
    },
    {
      kind: 'tool',
      key: 'tool:2',
      callId: 'call:2',
      step: 2,
      order: 1,
      block: {
        kind: 'tool-call',
        name: 'edit',
        argsRaw: JSON.stringify({ file_path: 'src/client/Reader.tsx', old_string: 'a', new_string: 'b' }),
      } as any,
    },
    {
      kind: 'tool',
      key: 'tool:3',
      callId: 'call:3',
      step: 3,
      order: 2,
      block: {
        kind: 'tool-result',
        isError: true, // error result should be skipped
        name: 'write',
        argsRaw: JSON.stringify({ file_path: 'bad.txt', content: 'err' }),
      } as any,
    },
    {
      kind: 'tool',
      key: 'tool:4',
      callId: 'call:4',
      step: 4,
      order: 3,
      block: {
        kind: 'tool-call',
        name: 'read', // read should not be considered a deliverable
        argsRaw: JSON.stringify({ file_path: 'package.json' }),
      } as any,
    },
  ];

  const paths = getTurnDeliverables(undefined, flow);
  assert.deepEqual(paths, ['src/client/new-feature.ts', 'src/client/Reader.tsx']);
});

test('createProducedFileMentions resolves exact paths and unique basenames, leaving ambiguous basenames inert', () => {
  const opened: string[] = [];
  const openFile = (p: string) => { opened.push(p); };
  const paths = [
    'src/client/Reader.tsx',
    'src/server/Reader.tsx', // duplicate basename
    'src/client/Reader.module.css', // unique basename
  ];
  const mentions = createProducedFileMentions(paths, openFile);

  // Exact path resolves
  const exact = mentions.resolve('src/client/Reader.tsx');
  assert.ok(exact);
  assert.equal(exact.title, 'src/client/Reader.tsx');
  assert.equal(exact.label, '打开 src/client/Reader.tsx');
  exact.open();
  assert.deepEqual(opened, ['src/client/Reader.tsx']);

  // Unique basename resolves
  const unique = mentions.resolve('Reader.module.css');
  assert.ok(unique);
  assert.equal(unique.title, 'src/client/Reader.module.css');
  unique.open();
  assert.deepEqual(opened, ['src/client/Reader.tsx', 'src/client/Reader.module.css']);

  // Ambiguous basename leaves undefined (never guess or open the wrong file)
  const ambiguous = mentions.resolve('Reader.tsx');
  assert.equal(ambiguous, undefined);

  // Unrelated file leaves undefined
  const unrelated = mentions.resolve('unknown.js');
  assert.equal(unrelated, undefined);
});

test('produced-files row waits for turn close even when paths already exist', () => {
  const paths = ['src/client/Watcher.tsx'];
  assert.equal(showDeliverablesRow('open', paths), false);
  assert.equal(showDeliverablesRow('closed', paths), true);
  assert.equal(showDeliverablesRow('closed', []), false);
});

/** A turn whose data map holds whatever the deliverables package published for it. */
function turnWith(deliverables: unknown): TurnLocation {
  const map = new Map<string, unknown>();
  if (deliverables !== undefined) map.set('deliverables', deliverables);
  return { data: map } as unknown as TurnLocation;
}

/** One tool entry in the shape the flow builds them (`toolIdentity` reads the name and the raw arguments off the block). */
function tool(name: string, args: unknown, isError = false): ReaderFlowEntry {
  return {
    kind: 'tool',
    key: `tool:${name}`,
    callId: `call:${name}`,
    step: 1,
    order: 0,
    block: { kind: 'tool-call', name, argsRaw: JSON.stringify(args), isError } as any,
  };
}

test('the host publishes TWO lists on a turn, and they mean「新增」and「编辑」', () => {
  // Measured from the deliverables package's own bundle: `turn.data.get("deliverables")` is `{ changes, presented }`.
  // `presented` is what the assistant declared it delivered — the reader's share package lives there, which is why it
  // shows on the conversation page. `changes` is the change announcement: the files the turn EDITED.
  const turn = turnWith({
    changes: { added: 40, deleted: 3, files: [{ path: 'src/glass.ts' }, { path: 'src/Reader.tsx' }] },
    presented: [{ seq: 93, path: 'dsh-viewtune-0.5.4.tgz', description: '分享包' }],
  });
  assert.deepEqual(getTurnDeliverableGroups(turn), {
    added: ['dsh-viewtune-0.5.4.tgz'],
    edited: ['src/glass.ts', 'src/Reader.tsx'],
  });
});

test('the old `produced` field is not read, because this version of the host never publishes it', () => {
  // The first version of this file read `deliverables.produced`. That field does not exist in 0.2.0 — so the row was
  // always the tool-flow fallback, which is why edited files appeared under 「新增」 and the delivered file nowhere.
  const turn = turnWith({ produced: [{ path: 'src/phantom.ts' }] });
  assert.deepEqual(getTurnDeliverableGroups(turn), { added: [], edited: [] });
});

test('with nothing published, the turn’s own tool calls answer instead', () => {
  const flow = [tool('write', { file_path: 'src/a.ts' }), tool('edit', { file_path: 'src/b.ts' })];
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), flow), { added: [], edited: ['src/a.ts', 'src/b.ts'] });
  assert.deepEqual(getTurnDeliverables(turnWith(undefined), flow), ['src/a.ts', 'src/b.ts']);
});

test('the flat list is the union, deliveries first, so a delivered file is mentionable and shows a row', () => {
  // A turn that only delivered something publishes no change summary and may have no write call the fallback can see —
  // the delivered path is then the only reason a row exists at all, and the only thing worth clicking.
  const turn = turnWith({ presented: [{ seq: 4, path: 'dist/pkg.tgz' }] });
  assert.deepEqual(getTurnDeliverableGroups(turn), { added: ['dist/pkg.tgz'], edited: [] });
  assert.deepEqual(getTurnDeliverables(turn), ['dist/pkg.tgz']);
});

test('a file a tool call SAYS it created is 新增, and is no longer listed under 编辑', () => {
  const flow = [
    tool('str_replace_editor', { command: 'create', path: 'src/new.ts' }),
    tool('str_replace_editor', { command: 'str_replace', path: 'src/old.ts' }),
  ];
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), flow), { added: ['src/new.ts'], edited: ['src/old.ts'] });
});

test('an apply_patch names its files in its own text, and only Add File is creation evidence', () => {
  const patch = JSON.stringify({ patch: [
    '*** Begin Patch',
    '*** Add File: src/patched.ts',
    '+hello',
    '*** Update File: src/updated.ts',
    '@@',
    '-a',
    '+b',
    '*** End Patch',
  ].join('\n') });
  const flow = [
    { kind: 'tool', key: 't1', callId: 'c1', step: 1, order: 0, block: { kind: 'tool-call', name: 'apply_patch', argsRaw: patch } } as unknown as ReaderFlowEntry,
    // A `write` creates as happily as it overwrites, so it is NOT evidence of creation: the path stays under 编辑.
    tool('write', { file_path: 'src/written.ts' }),
  ];
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), flow), {
    added: ['src/patched.ts'],
    edited: ['src/updated.ts', 'src/written.ts'],
  });
});

test('blank paths, repeated paths, failed calls and non-writing commands contribute nothing', () => {
  const turn = turnWith({ changes: { files: [{ path: 'src/changed.ts' }, { path: 'src/changed.ts' }, { path: '  ' }] } });
  const flow = [
    tool('write', { file_path: 'src/a.ts' }),
    tool('write', { file_path: 'src/a.ts' }),
    tool('edit', { file_path: 'src/b.ts' }, true),
    tool('read', { file_path: 'src/c.ts' }),
    tool('str_replace_editor', { command: 'view', path: 'src/d.ts' }),
    tool('str_replace_editor', { command: 'str_replace', path: 'src/e.ts' }),
    tool('write', {}),
  ];
  assert.deepEqual(getTurnDeliverableGroups(turn, flow), { added: [], edited: ['src/changed.ts', 'src/a.ts', 'src/e.ts'] });
});

test('a turn with neither list has neither', () => {
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), []), { added: [], edited: [] });
  assert.deepEqual(getTurnDeliverables(turnWith({ presented: [] }), []), []);
});

test('the three modes are named, and an unknown stored value opens on 平衡', () => {
  assert.deepEqual(DELIVERABLE_DISPLAYS.map(entry => entry.id), ['brief', 'balanced', 'cards']);
  assert.deepEqual(DELIVERABLE_DISPLAYS.map(entry => entry.label), ['简略气泡', '平衡', '详细卡片']);
  assert.equal(deliverableDisplayOf('brief'), 'brief');
  assert.equal(deliverableDisplayOf('cards'), 'cards');
  assert.equal(deliverableDisplayOf('balanced'), 'balanced');
  // Anything else — an older profile, a hand-edited record, a value from a future version — is the MIDDLE mode, which is
  // what a fresh install opens with: it tells the two lists apart without giving up the row's density.
  assert.equal(deliverableDisplayOf(undefined), 'balanced');
  assert.equal(deliverableDisplayOf(null), 'balanced');
  assert.equal(deliverableDisplayOf('detailed'), 'balanced');
  assert.equal(deliverableDisplayOf(3), 'balanced');
});
