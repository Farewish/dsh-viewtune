import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { toolRowModel } from '../src/client/native/tool-call-model.ts';
import { activitySummary } from '../src/client/tool-activity.ts';

const call = (name: string, args: unknown) => ({
  callId: 'call-1', name, argsRaw: JSON.stringify(args), turn: 1, step: 1, time: 0, subCalls: [],
}) as unknown as ToolCallBlock;

test('the calls the product renders with its own cards are named here, not called "Tool call"', () => {
  const question = toolRowModel('ask_user_question', call('ask_user_question', {
    questions: [{ id: 'a', question: '要改动吗？' }, { id: 'b', question: '范围？' }],
  }));
  assert.equal(question.title, 'Question');
  assert.equal(question.summary, '2 个问题 · 要改动吗？');

  const delivery = toolRowModel('present', call('present', {
    files: [{ path: '/w/one.md', description: '一' }, { path: '/w/two.md' }],
  }));
  assert.equal(delivery.title, 'Deliveries');
  assert.equal(delivery.summary, '2 个文件 · one.md、two.md');

  const todo = toolRowModel('todo_write', call('todo_write', {
    todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }],
  }));
  assert.equal(todo.title, 'Todo');
  assert.equal(todo.summary, '1/2 完成');

  const image = toolRowModel('read_image', call('read_image', { file_path: '/w/shot.png' }));
  assert.equal(image.title, 'Read image');
  assert.equal(image.summary, '/w/shot.png');
});

test('a third delivery is elided, and a genuinely unknown tool keeps the generic row', () => {
  const many = toolRowModel('present', call('present', {
    files: [{ path: '/w/a.md' }, { path: '/w/b.md' }, { path: '/w/c.md' }],
  }));
  assert.equal(many.summary, '3 个文件 · a.md、b.md 等');

  const unknown = toolRowModel('mcp__x__y', call('mcp__x__y', { query: 'hello' }));
  assert.equal(unknown.title, 'Tool call');
  assert.equal(unknown.summary, 'mcp__x__y · hello');
});

test('a list payload with nothing to read falls back to the raw arguments', () => {
  const empty = toolRowModel('todo_write', call('todo_write', { todos: [] }));
  assert.equal(empty.title, 'Todo');
  assert.equal(empty.summary, '{"todos":[]}');
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
