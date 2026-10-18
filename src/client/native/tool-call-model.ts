/**
 * Pure row-model derivation for tool summary rows: variant classification,
 * one-line summary, expanded-body text, and flattened result output from the
 * frozen call slice. Input material comes from the call ARGUMENTS; output and
 * error material from the settled result node. A call whose render intent is
 * a terminal card gets its expanded body from the views instead, through
 * `terminalCardModel` in terminal-card-model.ts.
 */
// The block union's defining home is runtime (fold-product types); this
// contract only forwards it (type-definition authority stays with the layer
// that produces the values).
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename } from '../deliverables.js'
import { objectValue, stringValue } from '../tool-activity.js'

export type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Tool-call row variants selected by the generic atomic renderer. */
export type ToolRowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

/** Row state semantic; colors self-supplied via StateDot (design gives none). */
export type ToolRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Figma row titles per variant (design literals, not translatable copy). */
export const VARIANT_TITLES: Record<ToolRowVariant, string> = {
  search: 'Search', read: 'Read', bash: 'Bash',
  write: 'Write', edit: 'Edit', code: 'Code', others: 'Tool call',
}

/**
 * Known tool name -> variant.
 *
 * The names here have to be the ones the HOST registers, and a table cannot check that for itself — it is a list. It
 * carried `cordis_package_inspect` and `cordis_runtime_inspect` for a long time, and this host registers neither: the
 * inspect verbs are `cordis_inspect_list`, `cordis_inspect_query` and `cordis_inspect_self`, so the three real calls
 * fell to the generic row while two entries could never match anything at all. They are named correctly now; the note
 * above the titles says what the comment that used to stand here got wrong.
 */
const TOOL_VARIANTS: Record<string, ToolRowVariant> = {
  bash: 'bash',
  // The PowerShell twin is a shell tool: the bash row family (icon, colors)
  // with its own title from TOOL_TITLES, not the generic `others` row.
  pwsh: 'bash',
  read: 'read',
  // A file read that happens to return an image: the row is the path, the image itself renders
  // as media beside the ledger (ToolMedia).
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  // Third-party compatibility names; 0.2.1's official set does not register them.
  str_replace_editor: 'write',
  apply_patch: 'write',
  patch: 'write',
  run_code: 'code',
  // The inspect verbs read: they report on the host's own registries, so they belong to the read row
  // family and carry their own titles below.
  cordis_inspect_list: 'read',
  cordis_inspect_query: 'read',
  cordis_inspect_self: 'read',
  // The run-control verbs take one package id and produce a receipt, so the generic row is the decided
  // intent, not an unclassified default: there is no program to show (that is `cordis_define`, titled
  // below) and no file to open. The id lands in the summary slot.
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
  // Background jobs, persistent terminals and the inspect verbs are all process-control rows.
  job_output: 'bash',
  job_list: 'bash',
  job_kill: 'bash',
  terminal_open: 'bash',
  terminal_send: 'bash',
  terminal_read: 'bash',
  terminal_signal: 'bash',
  terminal_close: 'bash',
  terminal_list: 'bash',
  // Registry / discovery reads.
  list_mcp_resources: 'read',
  list_mcp_resource_templates: 'read',
  read_mcp_resource: 'read',
  lsp: 'read',
  session_trace: 'read',
  session_event_trace: 'read',
  session_event_read: 'read',
  working_directory: 'read',
  // Session search is a discovery row, not a generic one.
  session_search: 'search',
  session_event_search: 'search',
  // Actions whose payload is a receipt, a plan or a coordination message: no file/program slot.
  plugin_manager: 'others',
  plugin_market: 'others',
  stagehand_act: 'others',
  stagehand_extract: 'others',
  stagehand_navigate: 'others',
  stagehand_observe: 'others',
  stagehand_screenshot: 'others',
  stagehand_tabs: 'others',
  exit_plan_mode: 'others',
  create_goal: 'others',
  get_goal: 'others',
  update_goal: 'others',
  schedule_create: 'others',
  schedule_delete: 'others',
  schedule_list: 'others',
  schedule_update: 'others',
  ralph: 'others',
  skill: 'others',
  list_subagent_models: 'others',
  subagent: 'others',
  subagent_fork: 'others',
  interrupt_agent: 'others',
  list_agents: 'others',
  send_message: 'others',
  spawn_teammate: 'others',
  wait_agent: 'others',
  team_task_create: 'others',
  team_task_get: 'others',
  team_task_list: 'others',
  team_task_update: 'others',
  create_worktree: 'others',
  workflow: 'others',
  load_workspace_dependencies: 'others',
  render_ui: 'others',
  show_widget: 'others',
}

/**
 * Tool-owned titles that refine a generic row variant without replacing it.
 *
 * Four entries here are calls the product renders with keyed `tool.call.toolview` cards —
 * `ask_user_question`, `present`, `todo_write` and `read_image`. The reading view renders the
 * process itself and never consults that registry, so without a name they all arrived as
 * "Tool call". A title at least names the act; the first two also get their own body in
 * ToolActivity, which is where a question's answers and a delivery's files belong.
 *
 * The same reasoning is why `cordis_define` is HERE. This file used to say that the keyed card for it
 * made an entry unreachable — which is true of the product's own view and false of this one, because
 * the reading view is the thing reading this table. Without an entry, the verb that DEFINES a plugin
 * was the one cordis call with no name at all.
 */
const TOOL_TITLES: Record<string, string> = {
  cordis_inspect_list: '检查运行时',
  cordis_inspect_query: '检查提供方',
  cordis_inspect_self: '检查会话',
  cordis_define: 'Define Cordis Plugin',
  cordis_run: 'Run Cordis Plugin',
  cordis_stop: 'Stop Cordis Plugin',
  cordis_undefine: 'Remove Cordis Plugin',
  pwsh: 'Pwsh',
  ask_user_question: 'Question',
  present: 'Deliveries',
  read_image: 'Read image',
  todo_write: 'Todo',
  web_fetch: '读取网页',
  web_search: '搜索网页',
  job_output: '任务输出',
  job_list: '任务列表',
  job_kill: '终止任务',
  terminal_open: '打开终端',
  terminal_send: '发送到终端',
  terminal_read: '读取终端',
  terminal_signal: '终端信号',
  terminal_close: '关闭终端',
  terminal_list: '终端列表',
  plugin_manager: '插件管理',
  plugin_market: '插件市场',
  list_mcp_resources: 'MCP 资源',
  list_mcp_resource_templates: 'MCP 资源模板',
  read_mcp_resource: '读取 MCP 资源',
  lsp: '语言服务',
  session_search: '搜索会话',
  session_event_search: '搜索事件',
  session_trace: '会话轨迹',
  session_event_trace: '事件轨迹',
  session_event_read: '读取事件',
  working_directory: '工作目录',
  stagehand_act: '浏览器操作',
  stagehand_extract: '浏览器提取',
  stagehand_navigate: '浏览器导航',
  stagehand_observe: '浏览器观察',
  stagehand_screenshot: '浏览器截图',
  stagehand_tabs: '浏览器标签页',
  exit_plan_mode: '计划评审',
  create_goal: '创建目标',
  get_goal: '读取目标',
  update_goal: '更新目标',
  schedule_create: '创建计划',
  schedule_delete: '删除计划',
  schedule_list: '计划列表',
  schedule_update: '更新计划',
  ralph: 'Ralph 循环',
  skill: '技能',
  list_subagent_models: '子代理模型',
  subagent: '子代理',
  subagent_fork: '子代理（分支）',
  interrupt_agent: '中断代理',
  list_agents: '代理列表',
  send_message: '发送消息',
  spawn_teammate: '派生队友',
  wait_agent: '等待代理',
  team_task_create: '创建团队任务',
  team_task_get: '读取团队任务',
  team_task_list: '团队任务列表',
  team_task_update: '更新团队任务',
  create_worktree: '创建工作树',
  workflow: '工作流',
  load_workspace_dependencies: '加载工作区依赖',
  render_ui: '渲染界面',
  show_widget: '显示组件',
}

/** One list-shaped argument field as records, ignoring entries of another shape. */
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => { const row = objectValue(item); return row === null ? [] : [row] })
    : []
}

/**
 * Tool-owned summaries for calls whose payload is a list rather than one of the file-shaped slots
 * the variant keys read (`path`, `query`, `command`). Without an entry these fall through to the
 * raw arguments, which is how half a JSON object — `{"questions":[{"id"…` — used to reach the
 * summary slot beside the words "Tool call".
 */
const joined = (...values: (string | undefined)[]): string | undefined => {
  const parts = values.filter((value): value is string => value !== undefined && value !== '')
  return parts.length === 0 ? undefined : parts.join(' · ')
}

const TOOL_SUMMARIES: Record<string, (args: Record<string, unknown>) => string | undefined> = {
  ask_user_question: (args) => {
    const lines = records(args.questions).flatMap((question) => {
      const value = stringValue(question, 'question')
      return value === undefined ? [] : [firstLine(value)]
    })
    if (lines.length === 0) return undefined
    return lines.length === 1 ? lines[0]! : `${lines.length} 个问题 · ${lines[0]!}`
  },
  present: (args) => {
    const names = records(args.files).flatMap((file) => {
      const value = stringValue(file, 'path')
      return value === undefined ? [] : [basename(value)]
    })
    if (names.length === 0) return undefined
    return `${names.length} 个文件 · ${names.slice(0, 2).join('、')}${names.length > 2 ? ' 等' : ''}`
  },
  todo_write: (args) => {
    const todos = records(args.todos)
    if (todos.length === 0) return undefined
    return `${todos.filter(todo => todo.status === 'completed').length}/${todos.length} 完成`
  },
  job_output: (args) => joined(stringValue(args, 'job_id'), args.wait === true ? '等待中' : undefined),
  job_list: () => '后台任务',
  job_kill: (args) => joined(stringValue(args, 'job_id'), stringValue(args, 'reason')),
  cordis_inspect_list: () => '所有检查提供方',
  cordis_inspect_query: (args) => joined(stringValue(args, 'platform'), stringValue(args, 'provider'), stringValue(args, 'method')),
  cordis_inspect_self: () => '当前会话',
  terminal_open: (args) => joined(stringValue(args, 'name'), stringValue(args, 'type')),
  terminal_send: (args) => joined(stringValue(args, 'sessionId', 'session_id', 'id'), firstLineOrUndefined(stringValue(args, 'input', 'data'))),
  terminal_read: (args) => joined(stringValue(args, 'sessionId', 'session_id', 'id'), stringValue(args, 'offset')),
  terminal_signal: (args) => joined(stringValue(args, 'sessionId', 'session_id', 'id'), stringValue(args, 'signal')),
  terminal_close: (args) => stringValue(args, 'sessionId', 'session_id', 'id'),
  terminal_list: () => '所有终端',
  plugin_manager: (args) => joined(stringValue(args, 'action'), stringValue(args, 'target', 'name')),
  plugin_market: (args) => joined(stringValue(args, 'action'), stringValue(args, 'name', 'target', 'query')),
  list_mcp_resources: (args) => stringValue(args, 'server', 'name'),
  list_mcp_resource_templates: (args) => stringValue(args, 'server', 'name'),
  read_mcp_resource: (args) => joined(stringValue(args, 'server', 'name'), stringValue(args, 'uri', 'template')),
  lsp: (args) => joined(stringValue(args, 'operation'), stringValue(args, 'file', 'path', 'query')),
  session_search: (args) => stringValue(args, 'query'),
  session_event_search: (args) => stringValue(args, 'query'),
  session_trace: (args) => stringValue(args, 'session_id', 'sessionId'),
  session_event_trace: (args) => stringValue(args, 'session_id', 'sessionId', 'seq'),
  session_event_read: (args) => joined(stringValue(args, 'session_id', 'sessionId'), stringValue(args, 'seq')),
  working_directory: (args) => stringValue(args, 'cd'),
  stagehand_act: (args) => joined(stringValue(args, 'action'), stringValue(args, 'instruction')),
  stagehand_extract: (args) => stringValue(args, 'instruction', 'query'),
  stagehand_navigate: (args) => stringValue(args, 'url'),
  stagehand_observe: (args) => stringValue(args, 'instruction', 'query'),
  stagehand_screenshot: (args) => stringValue(args, 'name', 'path'),
  stagehand_tabs: () => '浏览器标签页',
  exit_plan_mode: (args) => firstLineOrUndefined(stringValue(args, 'plan')),
  create_goal: (args) => firstLineOrUndefined(stringValue(args, 'objective')),
  get_goal: () => '当前目标',
  update_goal: (args) => joined(stringValue(args, 'action'), stringValue(args, 'goal_id')),
  schedule_create: (args) => joined(firstLineOrUndefined(stringValue(args, 'title')), stringValue(args, 'time')),
  schedule_delete: (args) => stringValue(args, 'id'),
  schedule_list: () => '当前会话计划',
  schedule_update: (args) => joined(stringValue(args, 'id'), firstLineOrUndefined(stringValue(args, 'title'))),
  ralph: (args) => firstLineOrUndefined(stringValue(args, 'objective')),
  skill: (args) => stringValue(args, 'name'),
  list_subagent_models: (args) => joined(stringValue(args, 'provider'), stringValue(args, 'model')),
  subagent: (args) => firstLineOrUndefined(stringValue(args, 'description', 'prompt')),
  subagent_fork: (args) => firstLineOrUndefined(stringValue(args, 'description', 'prompt')),
  interrupt_agent: (args) => stringValue(args, 'agent_id', 'agentId', 'name'),
  list_agents: (args) => stringValue(args, 'scope'),
  send_message: (args) => joined(stringValue(args, 'agent_id', 'agentId', 'name'), firstLineOrUndefined(stringValue(args, 'message'))),
  spawn_teammate: (args) => joined(stringValue(args, 'name'), firstLineOrUndefined(stringValue(args, 'description'))),
  wait_agent: (args) => stringValue(args, 'name', 'agent_id'),
  team_task_create: (args) => firstLineOrUndefined(stringValue(args, 'title')),
  team_task_get: (args) => stringValue(args, 'id'),
  team_task_list: () => '团队任务',
  team_task_update: (args) => joined(stringValue(args, 'id'), stringValue(args, 'action')),
  create_worktree: (args) => joined(stringValue(args, 'branch'), stringValue(args, 'path')),
  workflow: (args) => joined(stringValue(args, 'description', 'name'), firstLineOrUndefined(stringValue(args, 'script'))),
  load_workspace_dependencies: () => '工作区依赖',
  render_ui: (args) => stringValue(args, 'title'),
  show_widget: (args) => stringValue(args, 'title'),
}

/**
 * Classify a tool name into its row variant.
 * @param toolName - wire tool name.
 * @returns matching variant, others when unknown.
 */
export function classifyTool(toolName: string): ToolRowVariant {
  return TOOL_VARIANTS[toolName] ?? 'others'
}

/** The tool-owned title, or undefined when this name has no dedicated row title. */
export function toolTitleOf(toolName: string): string | undefined {
  return TOOL_TITLES[toolName]
}

/** Everything ToolRow needs, derived once from the frozen slice. */
export interface ToolRowModel {
  variant: ToolRowVariant
  title: string
  summary: string
  /**
   * Filesystem path from args (`path` / `file_path`) when the row is a file
   * tool; absent for URL reads and non-file tools. The chat view resolves
   * relative values against the session cwd before opening.
   */
  filePath: string | undefined
  /** Expanded-body input text (pretty args); null = no input section. */
  body: string | null
  /** Flattened result text ({@link resultText}); null while running or when the result carries no text. */
  output: string | null
  /** First line of the result text on an error row; null for every other state. */
  errorSummary: string | null
  state: ToolRowState
}

/**
 * Flatten a settled result's content blocks to display text: text blocks
 * verbatim, other block shapes as pretty JSON. Empty content on a failed call
 * falls back to the structured error's `name: code` line.
 * @param node - the settled result node.
 * @returns the flattened result text (may be empty).
 */
export function resultText(node: ToolResultNode): string {
  const parts: string[] = []
  for (const block of node.content) {
    if (block.type === 'text') parts.push(block.text)
    else parts.push(JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  return parts.join('\n')
}

function parseArgs(argsRaw: string): unknown {
  try {
    return JSON.parse(argsRaw)
  } catch {
    // Non-JSON args (mid-stream truncation): summary/body fall back to the raw string.
    return undefined
  }
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

function firstLineOrUndefined(text: string | undefined): string | undefined {
  return text === undefined ? undefined : firstLine(text)
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = args[key]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/**
 * Materialize the fields a `ToolArgs` view has received so far.
 *
 * 0.2.1 publishes the lazy view on preparing, started and result rows; its `text` reader returns a
 * streaming string prefix, and `value` returns a non-string only once it closed. A preparing row used
 * to have no arguments at all here, so its expanded body stayed empty until dispatch. The view is
 * read structurally because this build still type-checks against 0.2.0, where it does not exist.
 */
interface ToolArgsView {
  keys(): readonly string[];
  text(key: string): string | undefined;
  value(key: string): unknown;
}

function argsObjectOf(args: unknown): Record<string, unknown> | undefined {
  const view = args as Partial<ToolArgsView> | undefined;
  if (view === undefined || typeof view.keys !== 'function' || typeof view.text !== 'function' || typeof view.value !== 'function') {
    return undefined;
  }
  const keys = view.keys();
  if (keys.length === 0) return undefined;
  const object: Record<string, unknown> = {};
  for (const key of keys) {
    const text = view.text(key);
    if (text !== undefined) { object[key] = text; continue }
    const value = view.value(key);
    if (value !== undefined) object[key] = value;
  }
  return object;
}

/** Summary key preference per variant (args-derived; result-derived summaries are a ledger item). */
const SUMMARY_KEYS: Record<ToolRowVariant, readonly string[]> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}

/**
 * Strip the workspace root from a workspace-rooted absolute path (display only).
 * @param text - the path to shorten.
 * @param cwd - session workspace root; absent or empty leaves the path unchanged.
 * @returns the path relative to the workspace root, or unchanged when it is not rooted there.
 */
export function relativizeToCwd(text: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return text
  const root = cwd.replace(/[/\\]+$/, '')
  if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1)
  return text
}

function deriveSummary(toolName: string, variant: ToolRowVariant, argsRaw: string, argsObject?: Record<string, unknown>): string {
  const parsed = argsObject ?? parseArgs(argsRaw)
  if (typeof parsed !== 'object' || parsed === null) return firstLine(argsRaw)
  const args = parsed as Record<string, unknown>
  const owned = TOOL_SUMMARIES[toolName]?.(args)
  if (owned !== undefined) return owned
  if (variant === 'search' && Array.isArray(args.queries)) {
    const queries = args.queries.filter((query): query is string => typeof query === 'string' && query !== '')
    if (queries.length > 0) return queries.map(firstLine).join(', ')
  }
  const picked = pickString(args, SUMMARY_KEYS[variant])
  if (picked !== undefined) return firstLine(picked)
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v !== '') return firstLine(v)
  }
  return firstLine(argsRaw)
}

/** Path keys only — never `url` (web_fetch lands on the read variant). */
const FILE_PATH_KEYS = ['path', 'file_path'] as const

/** File-tool variants whose summary may be an openable workspace path. */
const FILE_PATH_VARIANTS: ReadonlySet<ToolRowVariant> = new Set(['read', 'write', 'edit'])

function deriveFilePath(variant: ToolRowVariant, argsRaw: string, argsObject?: Record<string, unknown>): string | undefined {
  if (!FILE_PATH_VARIANTS.has(variant)) return undefined
  const parsed = argsObject ?? parseArgs(argsRaw)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const picked = pickString(parsed as Record<string, unknown>, FILE_PATH_KEYS)
  return picked === undefined ? undefined : firstLine(picked)
}

function deriveBody(variant: ToolRowVariant, argsRaw: string, argsObject?: Record<string, unknown>): string | null {
  if (argsObject !== undefined) {
    if (variant === 'code' && typeof argsObject.code === 'string' && argsObject.code !== '') return argsObject.code
    return JSON.stringify(argsObject, null, 2)
  }
  if (argsRaw === '') return null
  const parsed = parseArgs(argsRaw)
  if (parsed === undefined) return argsRaw
  // The code row's expanded body IS the program (monospace via the row's
  // variant styling), not the args JSON envelope around it.
  if (variant === 'code' && typeof parsed === 'object' && parsed !== null) {
    const code = (parsed as Record<string, unknown>).code
    if (typeof code === 'string' && code !== '') return code
  }
  return JSON.stringify(parsed, null, 2)
}

/**
 * Derive the full row model from a frozen call slice.
 * @param toolName - wire tool name (dispatch-supplied; survives windowless results).
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @param cwd - session workspace root; workspace-rooted path summaries display relative to it.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @returns the row model.
 */
export function toolRowModel(toolName: string, block: ToolCallBlock, cwd?: string, home?: string): ToolRowModel {
  const done = 'kind' in block
  // `block.argsRaw` off the running union stops compiling in 0.2.0: a `phase: 'preparing'` call carries no arguments yet,
  // and only `phase: 'start'` does. 0.2.1 adds the lazy `args` view on every phase, which is what lets a preparing row
  // show the fields received so far and a window-truncated result keep its tool name.
  const argsRaw = (done ? block.call?.argsRaw : block.phase === 'start' ? block.argsRaw : undefined) ?? ''
  const argsObject = argsObjectOf((block as unknown as { args?: unknown }).args)
  const resultName = done ? (block as unknown as { name?: string }).name : undefined
  const effectiveName = toolName !== '' ? toolName : resultName ?? ''
  const variant = classifyTool(effectiveName)
  const state: ToolRowState = !done ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const derived = argsRaw === '' && argsObject === undefined
    ? ''
    : deriveSummary(effectiveName, variant, argsRaw, argsObject)
  const base = derived === ''
    ? block.callId
    : abbreviateHomePath(relativizeToCwd(derived, cwd), home)
  const toolTitle = TOOL_TITLES[effectiveName]
  // Others keeps the static "Tool call" title (figma literal); the real tool
  // name rides the mutable summary slot unless the tool owns a specific title.
  const summary = variant === 'others' && effectiveName !== '' && toolTitle === undefined
    ? `${effectiveName} · ${base}`
    : base
  // The empty string is "no text" for both derived result fields: a settled
  // call with blank content has nothing to expand, and a blank first line
  // would erase the collapsed error row's summary slot.
  const output = done ? (resultText(block) || null) : null
  const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
  return {
    variant,
    title: toolTitle ?? VARIANT_TITLES[variant],
    summary,
    filePath: deriveFilePath(variant, argsRaw, argsObject),
    body: deriveBody(variant, argsRaw, argsObject),
    output,
    errorSummary,
    state,
  }
}
