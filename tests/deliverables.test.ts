/**
 * The turn's files and commits, and the three ways to show them.
 *
 * The story this file pins, because it took three corrections from the reader to get right:
 *   · the host publishes `{ changes, presented }` on a turn — NOT `produced`, a field this version never writes, which
 *     is why the row was silently the tool-flow fallback (edited files under 「新增」, the delivered file nowhere);
 *   · which of those files were NEW and which were EDITED cannot be told apart, so the reader's call is one 「编辑」 list;
 *   · the second box therefore records the other thing a client CAN tell apart: the turn's commits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { basename, createProducedFileMentions, deliverableDisplayOf, deliverableHeadingHint, dirname, getTurnDeliverableGroups, getTurnDeliverables, needsExpand, showDeliverablesRow, turnChanges, turnCommits, DELIVERABLE_BOX_CAP, DELIVERABLE_DISPLAYS } from '../src/client/deliverables.ts';
import type { ReaderFlowEntry } from '../src/client/tool-activity.ts';

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

test('getTurnDeliverables reads the host’s two published lists: 交付 and 编辑', () => {
  // This used to feed `deliverables.produced` — a field 0.2.0 does not publish — which is how the row ended up built
  // entirely from the tool-flow fallback without anyone noticing. The real shape is `{ changes, presented }`: `presented`
  // is what was DELIVERED (the reader's share package — 交付), `changes` is what was edited (编辑).
  //
  // The two OVERLAP, which the reader corrected: 编辑 answers "what did this turn change" and 交付 answers "what did it
  // hand over", so a file that was edited and then delivered belongs in both. Only the older 新增/编辑 shape made them
  // mutually exclusive.
  const turn = turnWith({
    changes: {
      added: 12,
      deleted: 3,
      files: [
        { path: 'src/client/Reader.tsx' },
        { path: 'src/client/Reader.module.css' },
        { path: 'src/client/Reader.tsx' }, // duplicate
      ],
    },
    presented: [{ seq: 1, path: 'src/client/Reader.tsx' }, { seq: 2, path: 'dist/pkg.tgz' }],
  });
  assert.deepEqual(getTurnDeliverableGroups(turn), {
    delivered: ['src/client/Reader.tsx', 'dist/pkg.tgz'],
    // …the delivered files lead (first-seen), and the one that was only changed follows; each path appears once per list.
    edited: ['src/client/Reader.tsx', 'dist/pkg.tgz', 'src/client/Reader.module.css'],
  });
  // The flat list — inline mentions, and the row's gate — is the union, deliveries first.
  assert.deepEqual(getTurnDeliverables(turn), ['src/client/Reader.tsx', 'dist/pkg.tgz', 'src/client/Reader.module.css']);
});

test('getTurnDeliverables falls back to the tool flow when the host published nothing', () => {
  const flow = [tool('write', { file_path: 'src/client/new-feature.ts', content: 'hello' }), tool('edit', { file_path: 'src/client/Reader.tsx' })];
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), flow), { delivered: [], edited: ['src/client/new-feature.ts', 'src/client/Reader.tsx'] });
});

test('the old `produced` field is not read, because this version of the host never publishes it', () => {
  // The first version of this file read `deliverables.produced`. That field does not exist in 0.2.0 — so the row was
  // always the tool-flow fallback: edited files shown under 「新增」, and the delivered file nowhere.
  assert.deepEqual(getTurnDeliverableGroups(turnWith({ produced: [{ path: 'src/phantom.ts' }] })), { delivered: [], edited: [] });
});

test('created and edited files are ONE list, because the client cannot tell them apart', () => {
  // The reader's own call. A `write` creates and overwrites with the same call and the host's announcement covers both,
  // so 「新增」 was a claim this client could not stand behind.
  //
  // NOTE the `.md` paths on the field-derived entries: this test file's own runner rewrites a bare `.ts` string literal
  // into `.js` while compiling (which is why the patch text below keeps its `.ts` — it lives inside one longer string),
  // so a `.ts` fixture here would be asserting on the harness's rewrite rather than on this plugin's behaviour.
  const flow = [
    tool('str_replace_editor', { command: 'create', path: 'src/new.md' }),
    tool('str_replace_editor', { command: 'view', path: 'src/looked-at.md' }),
    tool('write', { file_path: 'src/written.md' }),
    tool('apply_patch', { patch: '*** Begin Patch\n*** Add File: src/patched.md\n+x\n*** Update File: src/updated.md\n@@\n-a\n+b\n*** End Patch\n' }),
  ];
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), flow).edited, ['src/new.md', 'src/written.md', 'src/patched.md', 'src/updated.md']);
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
  assert.deepEqual(getTurnDeliverableGroups(turn, flow).edited, ['src/changed.ts', 'src/a.ts', 'src/e.ts']);
});

test('a turn with neither list has neither', () => {
  assert.deepEqual(getTurnDeliverableGroups(turnWith(undefined), []), { delivered: [], edited: [] });
  assert.deepEqual(getTurnDeliverables(turnWith({ presented: [] }), []), []);
});

test('the commits a turn made are read from its calls: hash and subject', () => {
  const flow = [
    tool('bash', { command: 'git add -A && git commit -m "Fix the box heading" && git log --oneline -1' }),
    tool('pwsh', { command: 'git status --short' }),
    tool('read', { path: 'CHANGELOG.md' }),
  ];
  // …and git's own summary line in the result supplies the short hash.
  (flow[0].block as unknown as { content: unknown }).content = [{ type: 'text', text: '[adapt-0.2.0 1a2b3c4] Fix the box heading\n 1 file changed' }];
  assert.deepEqual(turnCommits(flow), [{ hash: '1a2b3c4', subject: 'Fix the box heading' }]);
});

test('a commit made with a global option is still a commit — the reader’s own case', () => {
  // Every commit in the reader's instance is made as `git -C <dir> commit …` (it is how this project's are made), and a
  // pattern demanding `git` be followed immediately by `commit` matched none of them: 「提交」 never appeared.
  const flow = [tool('pwsh', { command: 'git -C D:\\DSH\\dsh-better-display-tools\\worktree\\dsh-viewtune commit -m "A real one"' })];
  assert.deepEqual(turnCommits(flow), [{ subject: 'A real one' }]);
  assert.deepEqual(turnCommits([tool('pwsh', { command: 'git -c core.pager=cat commit --message "And another"' })]), [{ subject: 'And another' }]);
});

test('a commit with no -m takes its subject from git’s own summary line', () => {
  // …which is the `-F <file>` case: this project's own commits are made that way.
  const flow = [tool('pwsh', { command: 'git -C repo commit -F msg.txt' })];
  (flow[0].block as unknown as { content: unknown }).content = [{ type: 'text', text: '[adapt-0.2.0 e49eaa9] Merge the file lists into 编辑' }];
  assert.deepEqual(turnCommits(flow), [{ hash: 'e49eaa9', subject: 'Merge the file lists into 编辑' }]);
});

test('a command that merely MENTIONS a commit is not one, and neither is a document about commits', () => {
  // The false positive that matters: this plugin's own CHANGELOG discusses `git commit`, and a `write` carries its file
  // content in its ARGUMENTS — so only a command-shaped field may count.
  const flow = [
    tool('write', { file_path: 'CHANGELOG.md', content: 'we ran git commit -m "x" and it worked' }),
    tool('bash', { command: 'git log --grep="git commit"' }),
    tool('bash', { command: 'git commit --amend --no-edit' }, true),
  ];
  assert.deepEqual(turnCommits(flow), []);
});

test('a commit keeps its subject even when the result carries no readable hash', () => {
  assert.deepEqual(turnCommits([tool('bash', { command: 'git commit --message "Only a subject"' })]), [{ subject: 'Only a subject' }]);
});

test('createProducedFileMentions resolves exact paths and unique basenames, leaving ambiguous basenames inert', () => {
  const opened: string[] = [];
  const openFile = (p: string) => { opened.push(p); };
  const paths = ['src/client/Reader.tsx', 'src/server/Reader.tsx', 'src/client/Reader.module.css'];
  const mentions = createProducedFileMentions(paths, openFile);
  const exact = mentions.resolve('src/client/Reader.tsx');
  assert.ok(exact);
  assert.equal(exact.title, 'src/client/Reader.tsx');
  exact.open();
  assert.deepEqual(opened, ['src/client/Reader.tsx']);
  assert.equal(mentions.resolve('Reader.tsx'), undefined);
  assert.equal(mentions.resolve('unknown.js'), undefined);
});

test('produced-files row waits for turn close even when paths already exist', () => {
  const paths = ['src/client/Watcher.tsx'];
  assert.equal(showDeliverablesRow('open', paths), false);
  assert.equal(showDeliverablesRow('closed', paths), true);
  assert.equal(showDeliverablesRow('closed', []), false);
});

test('the three modes are named, and an unknown stored value opens on 平衡', () => {
  assert.deepEqual(DELIVERABLE_DISPLAYS.map(entry => entry.id), ['brief', 'balanced', 'cards']);
  assert.deepEqual(DELIVERABLE_DISPLAYS.map(entry => entry.label), ['简略气泡', '平衡', '详细卡片']);
  assert.equal(deliverableDisplayOf('brief'), 'brief');
  assert.equal(deliverableDisplayOf('cards'), 'cards');
  assert.equal(deliverableDisplayOf('balanced'), 'balanced');
  // Anything else — an older profile, a hand-edited record, a value from a future version — is the MIDDLE mode, which is
  // what a fresh install opens with.
  assert.equal(deliverableDisplayOf(undefined), 'balanced');
  assert.equal(deliverableDisplayOf(null), 'balanced');
  assert.equal(deliverableDisplayOf('detailed'), 'balanced');
  assert.equal(deliverableDisplayOf(3), 'balanced');
});

test('a box needs its 「展开」 switch only when something is hidden behind the cap', () => {
  // The reader's rule: 无需展开的时候展开不用出现. The cap is two rows of a 28px chip with a 6px gap — the same 62px the
  // stylesheet caps the lane with (the guard pins that side, so the two cannot drift apart silently).
  assert.equal(DELIVERABLE_BOX_CAP, 62);
  assert.equal(needsExpand(28), false);
  assert.equal(needsExpand(62), false);
  assert.equal(needsExpand(63), false);
  assert.equal(needsExpand(64), true);
  assert.equal(needsExpand(200), true);
});

test('the turn’s changed files carry their hunks and the call that changed them', () => {
  // Two consumers of one list: the hover window (paths with ± counts, read through `diffTotals`) and the heading's click
  // (the call to inspect). The hunks come from `callDiffHunks`, the same normaliser the tool rows use.
  const first = tool('write', { file_path: 'src/a.md', content: 'one' });
  (first.block as unknown as { meta: unknown }).meta = { diffs: [{ path: 'src/a.md', oldText: 'one', newText: 'one\ntwo' }] };
  const second = tool('edit', { file_path: 'src/a.md' });
  (second.block as unknown as { meta: unknown }).meta = { diffs: [{ path: 'src/a.md', oldText: 'one', newText: 'one\nthree' }] };
  const third = tool('write', { file_path: 'src/b.md', content: 'b' });
  (third.block as unknown as { meta: unknown }).meta = { diffs: [{ path: 'src/b.md', oldText: '', newText: 'b' }, { path: '', oldText: 'x', newText: 'y' }] };

  const changes = turnChanges([first, second, third]);
  // One entry per path — the LAST call wins, the way the host keeps the latest declaration of a path — and a hunk with no
  // path is skipped rather than becoming an entry with an empty name. Order is first-seen.
  assert.deepEqual(changes.map(change => change.path), ['src/a.md', 'src/b.md']);
  assert.equal(changes[0]?.callId, 'call:edit');
  assert.equal(changes[0]?.hunks[0]?.newText, 'one\nthree');
  assert.equal(changes[1]?.callId, 'call:write');
  // Nothing changed ⇒ nothing to show, and nothing to click.
  assert.deepEqual(turnChanges([]), []);
  assert.deepEqual(turnChanges(undefined), []);
});

test('the heading’s hover sentence follows the switch', () => {
  // The host swaps its ± counts for a preview hint on hover; the reader asked for the same sentence, and the switch is what
  // decides where a preview lands — so the sentence says that.
  assert.equal(deliverableHeadingHint(true), '在侧边栏预览');
  assert.equal(deliverableHeadingHint(false), '预览差异');
});
