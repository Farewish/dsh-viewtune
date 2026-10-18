import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { toolRowModel } from '../src/client/native/tool-call-model.ts';
import { activitySummary } from '../src/client/tool-activity.ts';

/**
 * A dispatched, still-running call.
 *
 * 0.2.0 split the running half of `ToolCallBlock` into a discriminated union — `phase: 'preparing'` (the model has not
 * finished writing the arguments, so there are none) and `phase: 'start'` (`argsRaw` present) — so a fixture that carries
 * `argsRaw` without a phase is a shape the host no longer emits, and the row now reads arguments only off `'start'`.
 */
const call = (name: string, args: unknown) => ({
  phase: 'start', callId: 'call-1', name, argsRaw: JSON.stringify(args), turn: 1, step: 1, time: 0, subCalls: [],
}) as unknown as ToolCallBlock;

/** A call the host has announced but whose arguments are not available yet. */
const preparing = (name: string) => ({
  phase: 'preparing', callId: 'call-2', name, turn: 1, step: 1, time: 0, subCalls: [],
}) as unknown as ToolCallBlock;

/** The 0.2.1 lazy view, reduced to the readers this row uses. */
const argsView = (args: Record<string, unknown>) => ({
  keys: () => Object.keys(args),
  text: (key: string) => typeof args[key] === 'string' ? args[key] as string : undefined,
  value: (key: string) => typeof args[key] === 'string' ? undefined : args[key],
});

test('the calls the product renders with its own cards are named here, not called "Tool call"', () => {
  const question = toolRowModel('ask_user_question', call('ask_user_question', {
    questions: [{ id: 'a', question: '要改动吗？' }, { id: 'b', question: '范围？' }],
  }));
  assert.equal(question.title, '提问');
  assert.equal(question.summary, '2 个问题 · 要改动吗？');

  const delivery = toolRowModel('present', call('present', {
    files: [{ path: '/w/one.md', description: '一' }, { path: '/w/two.md' }],
  }));
  assert.equal(delivery.title, '交付文件');
  assert.equal(delivery.summary, '2 个文件 · one.md、two.md');

  const todo = toolRowModel('todo_write', call('todo_write', {
    todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }],
  }));
  assert.equal(todo.title, '更新任务清单');
  assert.equal(todo.summary, '1/2 完成');

  const image = toolRowModel('read_image', call('read_image', { file_path: '/w/shot.png' }));
  assert.equal(image.title, '读取图片');
  assert.equal(image.summary, '/w/shot.png');
});

test('a third delivery is elided, and a genuinely unknown tool keeps the generic row', () => {
  const many = toolRowModel('present', call('present', {
    files: [{ path: '/w/a.md' }, { path: '/w/b.md' }, { path: '/w/c.md' }],
  }));
  assert.equal(many.summary, '3 个文件 · a.md、b.md 等');

  const unknown = toolRowModel('mcp__x__y', call('mcp__x__y', { query: 'hello' }));
  assert.equal(unknown.title, '工具调用');
  assert.equal(unknown.summary, 'mcp__x__y · hello');
});

test('a list payload with nothing to read falls back to the raw arguments', () => {
  const empty = toolRowModel('todo_write', call('todo_write', { todos: [] }));
  assert.equal(empty.title, '更新任务清单');
  assert.equal(empty.summary, '{"todos":[]}');
});

test('a call whose arguments have not arrived yet is named by its id, not filled in from nothing', () => {
  // The `preparing` half carries no `argsRaw` at all in 0.2.0, and this row must not invent one: the same fallback the
  // row has always used (the call id) is what a preparing row shows, and `runningArgs` is the single place that decides.
  const row = toolRowModel('todo_write', preparing('todo_write'));
  assert.equal(row.title, '更新任务清单');
  assert.equal(row.summary, 'call-2');
  assert.equal(row.body, null);
});

test('a preparing call reads the fields already received through ToolArgs', () => {
  const row = toolRowModel('read', {
    phase: 'preparing', callId: 'call-3', name: 'read', args: argsView({ path: '/w/a.md' }), turn: 1, step: 1, time: 0, subCalls: [],
  } as unknown as ToolCallBlock);
  assert.equal(row.summary, '/w/a.md');
  assert.equal(row.filePath, '/w/a.md');
  assert.match(row.body ?? '', /a\.md/);
});

test('a result whose call left the window keeps the name the result carries', () => {
  const row = toolRowModel('', {
    kind: 'tool-result', seq: 1, time: 0, callId: 'call-4', name: 'read', args: argsView({}),
    call: null, callTime: null, content: [], isError: false, subCalls: [],
  } as unknown as ToolCallBlock);
  assert.equal(row.variant, 'read');
  assert.notEqual(row.title, '工具调用');
  assert.equal(row.summary, 'call-4');
});

test('web_fetch is a read row in both tables', () => {
  const block = call('web_fetch', { url: 'https://example.com' });
  const summary = activitySummary({ block });
  assert.equal(summary.category, 'read');
  assert.equal(summary.title, '网页获取');
  assert.equal(toolRowModel('web_fetch', block).variant, 'read');
});

test('each of those calls is its own kind of row, which is what the icon table keys off', () => {
  const summary = (name: string, args: unknown) => activitySummary({ block: call(name, args) });
  assert.equal(summary('ask_user_question', { questions: [] }).category, 'question');
  assert.equal(summary('ask_user_question', { questions: [] }).title, '提问');
  assert.equal(summary('todo_write', { todos: [] }).category, 'todo');
  assert.equal(summary('todo_write', { todos: [] }).title, '待办');
  assert.equal(summary('present', { files: [] }).category, 'delivery');
  assert.equal(summary('present', { files: [] }).title, '交付文件');
  assert.equal(summary('read_image', { file_path: '/w/shot.png' }).category, 'read');
  assert.equal(summary('mcp__x__y', {}).category, 'other');
});
