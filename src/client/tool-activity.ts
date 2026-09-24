import type { AssistantBlock, ToolCallBlock, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ReaderGroup } from './projection.js';

export type ToolDraft = Extract<AssistantBlock, { kind: 'tool-call' }>;
export type ToolPhase = 'preparing' | 'running' | 'returned' | 'succeeded' | 'failed' | 'interrupted';
export type ToolCategory = 'write' | 'read' | 'terminal' | 'search' | 'web' | 'question' | 'todo' | 'delivery' | 'other';
export interface ToolActivityEntry {
  kind: 'tool'; key: string; callId: string; step: number; order: number;
  draft?: ToolDraft; block?: ToolCallBlock;
}
export type ReaderFlowEntry = ToolActivityEntry | { kind: 'node'; key: string; nodeKey: string; order: number };

/** Public Step data includes tool-only model output before a chat node exists. */
export function readerFlow(group: ReaderGroup, turn: TurnLocation | undefined, get: (key: string) => ChatConversationViewNode | undefined): ReaderFlowEntry[] {
  const flow: ReaderFlowEntry[] = [];
  const calls = new Map<string, ToolActivityEntry>();
  const assistantOrder = new Map<number, number>();
  for (const key of group.keys) {
    const node = get(key);
    if (!node || node.visibility === 'hidden') continue;
    const step = node.location.kind === 'step' ? node.location.step.step : 0;
    if (node.kind === 'tool-call') {
      const block = (node.data as { root: ToolCallBlock }).root;
      calls.set(block.callId, { kind: 'tool', key: `reader-tool:${block.callId}`, callId: block.callId, step, block, order: node.anchorSeq });
    } else {
      flow.push({ kind: 'node', key, nodeKey: key, order: node.anchorSeq });
      if (node.kind === 'assistant-step') assistantOrder.set(step, node.anchorSeq);
    }
  }
  for (const step of turn?.steps ?? []) {
    const data = step.data.get('assistant-step');
    let index = 0;
    for (const draft of data?.blocks ?? []) {
      if (draft.kind !== 'tool-call' || !draft.callId) continue;
      const previous = calls.get(draft.callId);
      calls.set(draft.callId, previous ? { ...previous, draft } : {
        kind: 'tool', key: `reader-tool:${draft.callId}`, callId: draft.callId, step: step.step, draft,
        order: (assistantOrder.get(step.step) ?? step.start?.seq ?? 0) + .01 + index++ / 10000,
      });
    }
  }
  flow.push(...calls.values());
  return flow.sort((left, right) => left.order - right.order);
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function stringValue(record: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof record?.[key] === 'string' && record[key]) return record[key] as string;
  return undefined;
}

/** Read only top-level JSON string values, including an unfinished final string.
 * This never executes input or mistakes escaped/nested content for a path field. */
export function inputFields(raw: string): Record<string, unknown> {
  try { return objectValue(JSON.parse(raw)) ?? {}; } catch { /* an in-flight argument is normally incomplete */ }
  const fields: Record<string, unknown> = Object.create(null);
  const prefix = raw.slice(0, 262144);
  let depth = 0;
  let key: string | undefined;
  for (let index = 0; index < prefix.length; index++) {
    const char = prefix[index];
    if (char === '{' || char === '[') { depth++; continue; }
    if (char === '}' || char === ']') { depth--; continue; }
    if (char !== '"') continue;
    const start = index;
    let closed = false;
    for (index++; index < prefix.length; index++) {
      if (prefix[index] === '\\') { index++; continue; }
      if (prefix[index] === '"') { closed = true; break; }
    }
    if (depth !== 1) continue;
    const token = prefix.slice(start, closed ? index + 1 : prefix.length);
    let value: string;
    try { value = JSON.parse(token); } catch {
      if (closed) continue;
      // Strip only an unfinished trailing escape/unicode escape, not content.
      let body = token.slice(1);
      const unicode = /(?<!\\)(?:\\\\)*\\u[\da-f]{0,3}$/i.exec(body);
      if (unicode) body = body.slice(0, unicode.index) + unicode[0].replace(/\\u[\da-f]{0,3}$/i, '');
      let slashes = 0; for (let end = body.length - 1; end >= 0 && body[end] === '\\'; end--) slashes++;
      if (slashes % 2) body = body.slice(0, -1);
      try { value = JSON.parse(`"${body}"`); } catch { continue; }
    }
    if (closed && /^\s*:/.test(prefix.slice(index + 1))) key = value;
    else if (key !== undefined) { fields[key] = value; key = undefined; }
  }
  return fields;
}

export function toolIdentity(entry: Pick<ToolActivityEntry, 'block' | 'draft'>) {
  const block = entry.block;
  return {
    name: block ? 'kind' in block ? block.call?.name ?? entry.draft?.name ?? '工具调用' : block.name : entry.draft?.name ?? '工具调用',
    raw: block ? 'kind' in block ? block.call?.argsRaw ?? entry.draft?.argsRaw ?? '' : block.argsRaw : entry.draft?.argsRaw ?? '',
  };
}

export function executionFacts(block: ToolCallBlock | undefined): { exitCode?: number; signal?: string } {
  if (!block || !('kind' in block)) return {};
  const meta = objectValue(block.meta);
  const code = meta?.exitCode ?? meta?.exit_code;
  const text = block.content.length === 1 && block.content[0]?.type === 'text' ? block.content[0].text : '';
  const exit = /\n\[exit code: (\d+)\]$/.exec(text);
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text);
  const parsedCode = exit?.[1] === undefined ? undefined : Number(exit[1]);
  return {
    exitCode: typeof code === 'number' && Number.isFinite(code) ? code : parsedCode,
    signal: stringValue(meta, 'signal') ?? signal?.[1],
  };
}

export function activityPhase(entry: Pick<ToolActivityEntry, 'block' | 'draft'>, turnClosed = false): ToolPhase {
  if (!entry.block) return turnClosed ? 'interrupted' : 'preparing';
  if (!('kind' in entry.block)) return turnClosed ? 'interrupted' : 'running';
  // RC1 publishes canonical cancellation as an error result with a typed code.
  if (entry.block.error?.code === 'ABORTED' || entry.block.error?.code === 'interrupted') return 'interrupted';
  const facts = executionFacts(entry.block);
  if (entry.block.isError || facts.signal || (facts.exitCode !== undefined && facts.exitCode !== 0)
    || entry.block.subCalls.some(block => activityPhase({ block }, turnClosed) === 'failed')) return 'failed';
  if (facts.exitCode === 0) return 'succeeded';
  return 'returned';
}

export function activitySummary(entry: Pick<ToolActivityEntry, 'block' | 'draft'>) {
  const { name, raw } = toolIdentity(entry);
  const args = inputFields(raw);
  const target = stringValue(args, 'file_path', 'path', 'filename', 'filePath');
  const command = stringValue(args, 'command', 'cmd', 'script');
  const description = stringValue(args, 'description');
  const file = target?.split(/[/\\]/).at(-1);
  const category: ToolCategory = /^(write|edit|apply_patch|patch|str_replace_editor)$/.test(name) ? 'write'
    : /^(read|read_file|read_image)$/.test(name) ? 'read'
    : /^(bash|shell|terminal|terminal_send|exec_command|pwsh)$/.test(name) ? 'terminal'
    : /^(grep|glob|find|search)$/.test(name) ? 'search'
    : /^(web_search|web_fetch|web_open)$/.test(name) ? 'web'
    // Three calls the product renders with its own keyed card, each its own kind of thing rather
    // than a machine step: they take their product counterpart's glyph and title instead of the
    // generic sparkle. The product's read_image row is a read row, so it is one here too.
    : name === 'ask_user_question' ? 'question'
    : name === 'todo_write' ? 'todo'
    : name === 'present' ? 'delivery'
    : 'other';
  const title = category === 'write' ? `${name === 'write' ? '写入' : '修改'}${file ? ` ${file}` : name === 'apply_patch' ? '代码补丁' : '文件'}`
    : category === 'read' ? `读取${file ? ` ${file}` : '文件'}`
    : category === 'terminal' ? description || '运行命令'
    : category === 'search' ? name === 'glob' ? '查找文件' : '搜索内容'
    : category === 'web' ? name === 'web_search' ? '搜索网页' : '读取网页'
    : category === 'question' ? '提问'
    : category === 'todo' ? '待办'
    : category === 'delivery' ? '交付文件'
    : name;
  // `content` reads the same field names `DIFF_NEW_FIELDS` does, and it did not: `new_str` was missing here, so
  // `str_replace_editor` — which spells its replacement `new_str` — showed a +N/-M badge while the body it is supposed
  // to describe ("the tool returned; this is what it wrote") never rendered, because `content` stayed null.
  return { name, raw, args, category, title, target: target ?? command ?? stringValue(args, 'query', 'pattern', 'url'), command,
    cwd: stringValue(args, 'workdir', 'cwd'), content: stringValue(args, 'content', 'new_string', 'new_str', 'newText', 'file_text') };
}

export function preparingLabel(name: string): string {
  return /^(write|edit|apply_patch)$/.test(name) ? '正在生成文件内容' : /^(bash|shell|exec_command|pwsh)$/.test(name) ? '正在准备命令' : '正在准备工具输入';
}

/** Line counts of one text side; a trailing newline does not start a line. */
function lineCount(text: string | null): number {
  if (text === null) return 0;
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body === '' ? 0 : body.split('\n').length;
}

/** Argument fields that name the file a mutation targets, and the texts it replaces and writes. */
const DIFF_PATH_FIELDS = ['file_path', 'path', 'filePath'] as const;
const DIFF_OLD_FIELDS = ['old_string', 'old_str', 'oldText'] as const;
const DIFF_NEW_FIELDS = ['content', 'new_string', 'new_str', 'newText', 'file_text'] as const;
/**
 * Only these tools change a file, so only these may fall back to reading their own arguments as a
 * diff. Several unrelated tools take a field named `content` — a memory note, a typed message — and
 * reading that as a file body invents additions for calls that changed no file at all.
 */
export const DIFF_FALLBACK_TOOLS = ['write', 'edit', 'str_replace_editor'] as const;
const DIFF_MUTATION_TOOLS = new Set<string>(DIFF_FALLBACK_TOOLS);

function firstString(source: Record<string, unknown> | undefined, fields: readonly string[]): string | null {
  if (!source) return null;
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/**
 * Every changed file this call is responsible for, in the order they ran.
 *
 * Three sources, in the order the reader would trust them:
 *
 *   - the host's own result metadata (`meta.diffs`), which is what the official row renders;
 *   - the call's own arguments, for `write` / `edit` / `str_replace_editor` only — the same source
 *     the official row reads while a write is still pending, and the reason the tool-name whitelist
 *     exists at all;
 *   - whatever the call's children changed. A script that writes files reports those writes rather
 *     than what its own arguments contain, so a run whose edits live one level down does not lose
 *     its counts.
 */
export function callDiffHunks(block: ToolCallBlock | undefined, name?: string, args?: Record<string, unknown>): DiffHunk[] {
  const nested: DiffHunk[] = [];
  for (const child of block?.subCalls ?? []) {
    const identity = toolIdentity({ block: child });
    nested.push(...callDiffHunks(child, identity.name, inputFields(identity.raw)));
  }
  if (block && 'kind' in block) {
    const diffs = objectValue(block.meta)?.diffs;
    if (Array.isArray(diffs) && diffs.length > 0) {
      const hunks: DiffHunk[] = [];
      for (const raw of diffs) {
        const row = objectValue(raw);
        if (!row) continue;
        const oldText = typeof row.oldText === 'string' ? row.oldText : null;
        const newText = typeof row.newText === 'string' ? row.newText : '';
        if (!lineCount(newText) && !lineCount(oldText)) continue;
        hunks.push({ path: firstString(row, DIFF_PATH_FIELDS) ?? '', oldText, newText });
      }
      if (hunks.length > 0) return [...hunks, ...nested];
    }
  }
  if (!name || !DIFF_MUTATION_TOOLS.has(name)) return nested;
  const path = firstString(args, DIFF_PATH_FIELDS);
  if (!path) return nested;
  const oldText = firstString(args, DIFF_OLD_FIELDS);
  const newText = firstString(args, DIFF_NEW_FIELDS) ?? '';
  if (!lineCount(newText) && !lineCount(oldText)) return nested;
  return [{ path, oldText, newText }, ...nested];
}
