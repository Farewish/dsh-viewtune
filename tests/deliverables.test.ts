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

test('getTurnDeliverables extracts produced paths from turn deliverables data', () => {
  const map = new Map<string, unknown>();
  map.set('deliverables', {
    produced: [
      { seq: 1, path: 'src/client/Reader.tsx' },
      { seq: 2, path: 'src/client/Reader.module.css' },
      { seq: 3, path: 'src/client/Reader.tsx' }, // duplicate
    ],
  });
  const turn = { data: map } as unknown as TurnLocation;
  const paths = getTurnDeliverables(turn);
  assert.deepEqual(paths, ['src/client/Reader.tsx', 'src/client/Reader.module.css']);
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

test('what a turn DELIVERED and what it merely EDITED are two lists, not one', () => {
  // The correction the reader asked for: the fallback list is files the turn TOUCHED, and calling those 「产物」 claims
  // something about the turn that is not true. Both lists are available now, and the single flat list the mention
  // resolver asks for is untouched — it still prefers what was delivered.
  const turn = turnWith({ produced: [{ path: 'out/report.md' }, { path: 'out/chart.png' }] });
  const flow = [tool('write', { file_path: 'src/a.ts' }), tool('edit', { file_path: 'src/b.ts' })];
  assert.deepEqual(getTurnDeliverableGroups(turn, flow), {
    edited: ['src/a.ts', 'src/b.ts'],
    produced: ['out/report.md', 'out/chart.png'],
  });
  assert.deepEqual(getTurnDeliverables(turn, flow), ['out/report.md', 'out/chart.png']);
});

test('a path in both lists is shown only as a 产物: delivering it is the stronger claim', () => {
  const turn = turnWith({ produced: [{ path: 'out/report.md' }] });
  const flow = [tool('write', { file_path: 'out/report.md' }), tool('write', { file_path: 'src/a.ts' })];
  assert.deepEqual(getTurnDeliverableGroups(turn, flow), { edited: ['src/a.ts'], produced: ['out/report.md'] });
});

test('a turn that delivered nothing shows the files it edited, under that label now', () => {
  const turn = turnWith({ produced: [] });
  const flow = [tool('apply_patch', { path: 'src/a.ts' })];
  assert.deepEqual(getTurnDeliverableGroups(turn, flow), { edited: ['src/a.ts'], produced: [] });
  assert.deepEqual(getTurnDeliverables(turn, flow), ['src/a.ts']);
});

test('blank paths, repeated paths, failed calls and non-editing tools contribute nothing', () => {
  const turn = turnWith({ produced: [{ path: '  ' }, { path: 'out/report.md' }, { path: 'out/report.md' }, { seq: 3 }] });
  const flow = [
    tool('write', { file_path: 'src/a.ts' }),
    tool('write', { file_path: 'src/a.ts' }),
    tool('edit', { file_path: 'src/b.ts' }, true),
    tool('read', { file_path: 'src/c.ts' }),
    tool('str_replace_editor', { command: 'view', path: 'src/d.ts' }),
    tool('str_replace_editor', { command: 'str_replace', path: 'src/e.ts' }),
    tool('write', {}),
  ];
  assert.deepEqual(getTurnDeliverableGroups(turn, flow), { edited: ['src/a.ts', 'src/e.ts'], produced: ['out/report.md'] });
});

test('a turn with neither list has neither', () => {
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), []), { edited: [], produced: [] });
  assert.deepEqual(getTurnDeliverables(turnWith({ produced: [] }), []), []);
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
