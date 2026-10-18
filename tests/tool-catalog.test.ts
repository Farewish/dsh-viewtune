/**
 * Every model-visible tool in 0.2.1's generated catalog must have a process-row identity.
 *
 * The catalog is generated from `docs/tool-catalog.md`; this list is the subset the plugin's tables
 * have to name. It is intentionally exhaustive: a new tool without a title silently falls back to
 * "Tool call · {...}" in the reading view's process flow, which is exactly the gap this test prevents.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { activitySummary } from '../src/client/tool-activity.ts';
import { classifyTool, toolRowModel } from '../src/client/native/tool-call-model.ts';
import { isStructuredTool } from '../src/client/tool-result-model.ts';

/**
 * 0.2.1 catalog names, plus the aliases and plugin-owned verbs this view also renders.
 * (`subagent_fork` is the fixed-route alias; `cordis_*` and `render_ui/show_widget` are extensions.)
 */
const TOOLS = [
  'ask_user_question', 'bash', 'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
  'create_goal', 'create_worktree', 'edit', 'exit_plan_mode', 'get_goal', 'glob', 'grep',
  'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents',
  'list_mcp_resource_templates', 'list_mcp_resources', 'list_subagent_models',
  'load_workspace_dependencies', 'lsp', 'plugin_manager', 'plugin_market', 'present', 'pwsh', 'ralph',
  'read', 'read_image', 'read_mcp_resource', 'run_code', 'schedule_create', 'schedule_delete',
  'schedule_list', 'schedule_update', 'send_message', 'session_event_read', 'session_event_search',
  'session_event_trace', 'session_search', 'session_trace', 'skill', 'spawn_teammate',
  'stagehand_act', 'stagehand_extract', 'stagehand_navigate', 'stagehand_observe',
  'stagehand_screenshot', 'stagehand_tabs', 'str_replace_editor', 'subagent', 'subagent_fork',
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
  'terminal_close', 'terminal_list', 'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal',
  'todo_write', 'update_goal', 'wait_agent', 'web_fetch', 'web_search', 'workflow', 'working_directory', 'write',
  'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'render_ui', 'show_widget',
] as const;

const call = (name: string) => ({
  phase: 'start', callId: `call:${name}`, name, argsRaw: '{}', turn: 1, step: 1, time: 0, subCalls: [],
}) as unknown as ToolCallBlock;

const callWith = (name: string, args: unknown) => ({
  phase: 'start', callId: `call:${name}`, name, argsRaw: JSON.stringify(args), turn: 1, step: 1, time: 0, subCalls: [],
}) as unknown as ToolCallBlock;

test('every 0.2.1 tool has a process-row title and variant', () => {
  for (const name of TOOLS) {
    const row = toolRowModel(name, call(name));
    assert.notEqual(row.title, 'Tool call', `${name} still falls back to the generic title`);
    assert.ok(row.variant.length > 0, name);
    assert.equal(classifyTool(name).length > 0, true, name);
  }
});

test('job and inspect rows carry the id or target in the collapsed summary', () => {
  const job = toolRowModel('job_output', callWith('job_output', { job_id: 'job-7', wait: true }));
  assert.equal(job.title, 'Read job output');
  assert.match(job.summary, /job-7/);
  assert.match(job.summary, /waiting/);

  const inspect = toolRowModel('cordis_inspect_query', callWith('cordis_inspect_query', {
    platform: 'host', provider: 'cordis', method: 'services',
  }));
  assert.equal(inspect.title, 'Query runtime');
  assert.match(inspect.summary, /host/);
  assert.match(inspect.summary, /cordis/);
});

test('the registry and job tools use their own categories', () => {
  assert.equal(activitySummary({ block: call('job_output') }).category, 'terminal');
  assert.equal(activitySummary({ block: call('job_list') }).category, 'terminal');
  assert.equal(activitySummary({ block: call('cordis_inspect_list') }).category, 'read');
  assert.equal(activitySummary({ block: call('cordis_inspect_query') }).category, 'read');
  assert.equal(activitySummary({ block: call('session_search') }).category, 'search');
  assert.equal(activitySummary({ block: call('working_directory') }).category, 'read');
});

test('the structured result cards cover the new receipt/registry tools', () => {
  for (const name of ['job_output', 'job_list', 'job_kill', 'cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager', 'plugin_market', 'schedule_list', 'get_goal', 'list_agents', 'working_directory']) {
    assert.equal(isStructuredTool(name), true, name);
  }
  // A subagent's answer is prose and a skill's body is instructions for the model; both stay markdown.
  assert.equal(isStructuredTool('subagent'), false);
  assert.equal(isStructuredTool('skill'), false);
  assert.equal(isStructuredTool('terminal_read'), false);
});
