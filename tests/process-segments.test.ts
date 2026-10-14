import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROCESS_DONE_LABELS, processGroups, processKindOfTool, segmentLabelOf } from '../src/client/process-segments.ts';

test('the labels are the host\'s own words, verbatim', () => {
  // Copied from `dsh-client-ui-chat`'s table (`message.stepProcess.done.*`). If one of these changes, the reading view has stopped agreeing
  // with the conversation page it replaces.
  assert.equal(PROCESS_DONE_LABELS.thinking, '已完成分析');
  assert.equal(PROCESS_DONE_LABELS.read, '已读取文件');
  assert.equal(PROCESS_DONE_LABELS.readImage, '已读取图片');
  assert.equal(PROCESS_DONE_LABELS.write, '已写入文件');
  assert.equal(PROCESS_DONE_LABELS.search, '已搜索代码');
  assert.equal(PROCESS_DONE_LABELS.edit, '修改了文件');
  assert.equal(PROCESS_DONE_LABELS.commands, '执行了命令');
  assert.equal(PROCESS_DONE_LABELS.code, '运行了代码');
  assert.equal(PROCESS_DONE_LABELS.webSearch, '已搜索网页');
  assert.equal(PROCESS_DONE_LABELS.webFetch, '已访问网页');
  assert.equal(PROCESS_DONE_LABELS.subagents, '已协调子智能体');
  assert.equal(PROCESS_DONE_LABELS.plan, '更新了计划');
  assert.equal(PROCESS_DONE_LABELS.questions, '向用户提出了问题');
});

test('tool names fold into the specific kind, not the general one', () => {
  assert.equal(processKindOfTool('web_search'), 'webSearch');
  assert.equal(processKindOfTool('read_image'), 'readImage');
  assert.equal(processKindOfTool('read'), 'read');
  assert.equal(processKindOfTool('grep'), 'search');
  assert.equal(processKindOfTool('apply_patch'), 'edit');
  assert.equal(processKindOfTool('pwsh'), 'commands');
  assert.equal(processKindOfTool('write'), 'write');
  assert.equal(processKindOfTool('somethingNobodyHasHeardOf'), 'tools');
});

test('a run\'s title follows the host\'s own composition, rule for rule', () => {
  // From `processTitle` in the shipped `dsh-client-ui-chat` bundle (which keeps its source comments):
  //   none ⇒ 已完成分析 · one ⇒ itself · two ⇒ 「A并B」 with a shared 「已」 dropped from the second
  //   three ⇒ comma-joined · more than three ⇒ the same, then 「等」
  assert.equal(segmentLabelOf([]), '已完成分析');
  assert.equal(segmentLabelOf(['thinking']), '已完成分析');
  assert.equal(segmentLabelOf(['commands']), '执行了命令');
  assert.equal(segmentLabelOf(['read', 'search']), '已读取文件并搜索代码');
  assert.equal(segmentLabelOf(['commands', 'edit', 'read']), '执行了命令，修改了文件，已读取文件');
  assert.equal(segmentLabelOf(['commands', 'edit', 'read', 'search']), '执行了命令，修改了文件，已读取文件等');
  // …and when the two labels do NOT share 「已」, nothing is trimmed.
  assert.equal(segmentLabelOf(['commands', 'read']), '执行了命令并已读取文件');
});

test('a run is bounded by the host\'s own rules: the INDEPENDENT kinds and the narration', () => {
  // `processGroups` is a transcription of `rebuild` in `conversation-nodes/process-groups.js` (see the module). Three things it must get right,
  // each of which was wrong in the earlier narration-only version.
  type Character = 'independent' | 'reasoning' | 'reply' | 'other';
  interface Item { readonly id: string; readonly character: Character; readonly kind?: ReturnType<typeof processKindOfTool> }
  const step = (id: string, character: Character, kind: ReturnType<typeof processKindOfTool> = 'tools'): Item => ({ id, character, kind });
  const shape = (items: readonly Item[], turnClosed = true): readonly string[] => processGroups(
    items,
    item => item.character,
    item => item.kind ?? 'tools',
    turnClosed,
  ).map(unit => unit.kind === 'single'
    ? `single:${unit.item.id}`
    : `run[${unit.members.map(member => member.id).join(',')}]${unit.label === undefined ? '(growing)' : `=${unit.label}`}`);

  // 1. THINKING IS A MEMBER: a run that opens with it is a run, and it gets a title like any other — the reader's second report.
  assert.deepEqual(shape([step('t1', 'reasoning', 'thinking'), step('read1', 'other', 'read')]), ['run[t1,read1]=已完成分析并读取文件']);

  // 2. A TOOL CALL IS NOT A BOUNDARY — the bug the reader saw as 「有时候没有以旁白为界」.
  assert.equal(shape([step('a', 'other', 'commands'), step('b', 'other', 'read')]).length, 1, 'two tools stay in ONE run');

  // 3. THE NARRATION ENDS A RUN AND STANDS OUTSIDE IT.
  assert.deepEqual(
    shape([step('t1', 'reasoning', 'thinking'), step('say', 'reply'), step('t2', 'reasoning', 'thinking')]),
    ['run[t1]=已完成分析', 'single:say', 'run[t2]=已完成分析'],
  );

  // An INDEPENDENT node does the same, and a growing tail (a running turn) carries no title.
  assert.deepEqual(shape([step('x', 'other', 'edit'), step('u', 'independent')]), ['run[x]=修改了文件', 'single:u']);
  assert.deepEqual(shape([step('x', 'other', 'edit'), step('y', 'other', 'read')], false), ['run[x,y](growing)']);
});
