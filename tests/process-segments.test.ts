import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROCESS_DONE_LABELS, processGroups, processKindOfTool, segmentLabelOf } from '../src/client/process-segments.ts';
import type { ProcessCharacter, ProcessKind } from '../src/client/process-segments.ts';

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

/** A stand-in for a flow item: only the two things `processGroups` reads. */
interface Item {
  readonly id: string;
  readonly character: ProcessCharacter;
  readonly kind: ProcessKind;
}

const step = (id: string, character: ProcessCharacter, kind: ProcessKind = 'tools'): Item => ({ id, character, kind });
const IND: ProcessCharacter = { independent: true };
const THINK: ProcessCharacter = { reasoning: true };
const SAY: ProcessCharacter = { reply: true };
/** The common case the reader reported: thinking AND the narration that follows it live in ONE step. */
const BOTH: ProcessCharacter = { reasoning: true, reply: true };
const OTHER: ProcessCharacter = {};

const shape = (items: readonly Item[], turnClosed = true): readonly string[] => processGroups(
  items,
  item => item.character,
  item => item.kind,
  turnClosed,
).map(unit => unit.kind === 'single'
  ? `single:${unit.item.id}`
  : `run[${unit.members.map(member => member.id).join(',')}]${unit.label === undefined ? '(growing)' : `=${unit.label}`}`);

test('a run is bounded by the host\'s own rules: the INDEPENDENT kinds and the narration', () => {
  // `processGroups` is a transcription of `rebuild` in `conversation-nodes/process-groups.js` (see the module). Each case below was a bug in the
  // earlier narration-only version.
  //
  // 1. THINKING IS A MEMBER: a run that opens with it is a run, and it gets a title like any other.
  assert.deepEqual(shape([step('t1', THINK, 'thinking'), step('read1', OTHER, 'read')]), ['run[t1,read1]=已完成分析并读取文件']);
  // 2. A TOOL CALL IS NOT A BOUNDARY — what the reader saw as 「有时候没有以旁白为界」.
  assert.equal(shape([step('a', OTHER, 'commands'), step('b', OTHER, 'read')]).length, 1, 'two tools stay in ONE run');
  // 3. THE NARRATION ENDS A RUN AND STANDS OUTSIDE IT.
  assert.deepEqual(
    shape([step('t1', THINK, 'thinking'), step('say', SAY), step('t2', THINK, 'thinking')]),
    ['run[t1]=已完成分析', 'single:say', 'run[t2]=已完成分析'],
  );
  // 4. THINKING AND NARRATION IN ONE STEP: the node is a MEMBER — so its thinking is governed by the run's fold control — AND a single whose
  //    render is the BODY alone, so the narration stays on the page. This is the reader's 「旁白上方紧挨着的思考段不受管辖」.
  assert.deepEqual(
    shape([step('t1', THINK, 'thinking'), step('both', BOTH, 'thinking')]),
    ['run[t1,both]=已完成分析', 'single:both'],
  );
  // An INDEPENDENT node does the same, and a growing tail (a running turn) carries no title.
  assert.deepEqual(shape([step('x', OTHER, 'edit'), step('u', IND)]), ['run[x]=修改了文件', 'single:u']);
  assert.deepEqual(shape([step('x', OTHER, 'edit'), step('y', OTHER, 'read')], false), ['run[x,y](growing)']);
});
