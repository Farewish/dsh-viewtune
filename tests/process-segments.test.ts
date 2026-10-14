import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROCESS_DONE_LABELS, processKindOfTool, segmentLabelOf, splitByNarration } from '../src/client/process-segments.ts';

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

test('a segment\'s title follows the host\'s own composition, rule for rule', () => {
  // From `processTitle` in the shipped `dsh-client-ui-chat` bundle: none ⇒ 已完成分析; one ⇒ itself;
  // two ⇒ 「A并B」 with a shared 「已」 dropped from the second; three ⇒ comma-joined; more than three ⇒ 「…等」.
  assert.equal(segmentLabelOf([]), '已完成分析');
  assert.equal(segmentLabelOf(['thinking']), '已完成分析');
  assert.equal(segmentLabelOf(['commands']), '执行了命令');
  assert.equal(segmentLabelOf(['read', 'search']), '已读取文件并搜索代码');
  assert.equal(segmentLabelOf(['commands', 'edit', 'read']), '执行了命令，修改了文件，已读取文件');
  assert.equal(segmentLabelOf(['commands', 'edit', 'read', 'search']), '执行了命令，修改了文件，已读取文件等');
  // …and when the two labels do NOT share 「已」, nothing is trimmed.
  assert.equal(segmentLabelOf(['commands', 'read']), '执行了命令并已读取文件');
});

test('narration separates the stretches: before the first, between them, and after the last', () => {
  type Item = { kind: 'narration' | 'step'; name?: string };
  const narration = (text: string): Item => ({ kind: 'narration', name: text });
  const step = (name: string): Item => ({ kind: 'step', name });
  const items: Item[] = [
    step('thinking'),
    narration('我先说明一下'),
    step('pwsh'),
    step('apply_patch'),
    narration('中途交代一句'),
    step('read'),
    step('read'),
  ];
  // `thinking` is NOT a tool: it is a reasoning node, so the caller names it and `processKindOfTool` only speaks for tool calls.
  const kindOf = (item: Item): ReturnType<typeof processKindOfTool> => item.name === 'thinking' ? 'thinking' : processKindOfTool(item.name ?? '');
  const segments = splitByNarration(items, item => item.kind === 'narration', kindOf);
  assert.equal(segments.length, 3, 'a run before the first narration, one between, and one after the last');
  assert.equal(segments[0]?.label, '已完成分析');
  assert.equal(segments[1]?.label, '执行了命令并修改了文件', 'two kinds read as one phrase, per the host');
  assert.equal(segments[2]?.label, '已读取文件', 'two reads of the same kind are one word, not two');
  assert.deepEqual(segments[2]?.items.length, 2);
});

test('an empty stretch is not a segment, and no narration at all is ONE whole segment', () => {
  type Item = { kind: 'narration' | 'step'; name?: string };
  const step = (name: string): Item => ({ kind: 'step', name });
  const narration = (): Item => ({ kind: 'narration' });
  const kindOf = (item: Item): ReturnType<typeof processKindOfTool> => processKindOfTool(item.name ?? '');
  assert.deepEqual(splitByNarration<Item>([], () => false, kindOf), []);
  assert.equal(splitByNarration([narration(), narration()], item => item.kind === 'narration', kindOf).length, 0);
  const whole = splitByNarration([step('read'), step('write')], item => item.kind === 'narration', kindOf);
  assert.equal(whole.length, 1);
  assert.equal(whole[0]?.label, '已读取文件并写入文件');
});
