/**
 * Splitting a turn's process by its NARRATION, and naming each stretch the way the host names it.
 *
 * This is the shape the host's conversation page uses, and the labels below are its own words, copied verbatim from
 * `dsh-client-ui-chat`'s string table (`message.stepProcess.done.*`):
 *
 *   thinking 已完成分析 · read 已读取文件 · readImage 已读取图片 · write 已写入文件 · search 已搜索代码 · edit 修改了文件
 *   commands 执行了命令 · code 运行了代码 · webSearch 已搜索网页 · webFetch 已访问网页 · subagents 已协调子智能体
 *   plan 更新了计划 · questions 向用户提出了问题 · tools 已调用工具
 *
 * A stretch's label JOINS the labels of the kinds it contains, deduplicated, in the order they first appear — which is why a turn that ran a
 * command, edited a file and then read one reads 「执行了命令，修改了文件，已读取文件」, exactly as the host's own row does.
 *
 * Pure on purpose: the split and the naming are the parts worth testing, and they hold no React and no store.
 * @module
 */

/** One kind of work a step can be doing. The names are the host's own keys under `message.stepProcess.done.`. */
export type ProcessKind =
  | 'thinking' | 'read' | 'readImage' | 'write' | 'search' | 'edit' | 'commands' | 'code'
  | 'webSearch' | 'webFetch' | 'subagents' | 'plan' | 'questions' | 'tools';

/** The host's finished-work wording, one line per kind, verbatim. */
export const PROCESS_DONE_LABELS: Readonly<Record<ProcessKind, string>> = {
  thinking: '已完成分析',
  read: '已读取文件',
  readImage: '已读取图片',
  write: '已写入文件',
  search: '已搜索代码',
  edit: '修改了文件',
  commands: '执行了命令',
  code: '运行了代码',
  webSearch: '已搜索网页',
  webFetch: '已访问网页',
  subagents: '已协调子智能体',
  plan: '更新了计划',
  questions: '向用户提出了问题',
  tools: '已调用工具',
};

/**
 * Tool names, as this harness spells them, folded into a kind.
 *
 * Matched after lowercasing and stripping the separators tools are named with, so `web_search`, `webSearch` and `WebSearch` are one thing.
 * The order of the tests matters: the more specific names are tested before the general ones (`read_image` before `read`, `web_search` before
 * `search`), which is what keeps 「已读取图片」 and 「已搜索网页」 from being reported as 「已读取文件」 and 「已搜索代码」.
 */
const TOOL_KINDS: readonly (readonly [RegExp, ProcessKind])[] = [
  [/websearch|web_search|searchweb/, 'webSearch'],
  [/webfetch|web_fetch|fetchurl|openurl/, 'webFetch'],
  [/readimage|read_image|viewimage/, 'readImage'],
  [/subagent|delegate|task\b/, 'subagents'],
  [/todo|plan|updateplan/, 'plan'],
  [/question|askuser|ask_user|prompt/, 'questions'],
  [/applypatch|apply_patch|edit|replace|patch/, 'edit'],
  [/write|create|newfile/, 'write'],
  [/read|cat|openfile|viewfile/, 'read'],
  [/grep|search|glob|find|list/, 'search'],
  [/bash|shell|pwsh|powershell|terminal|run|exec|command/, 'commands'],
  [/code|eval|python|node/, 'code'],
];

/** The kind a tool call belongs to, or `tools` when nothing more specific matches. */
export function processKindOfTool(name: string): ProcessKind {
  const normalized = name.toLowerCase().replace(/[\s_-]+/g, '');
  for (const [pattern, kind] of TOOL_KINDS) {
    if (pattern.test(normalized)) return kind;
  }
  return 'tools';
}

/** One stretch's label: the kinds it holds, deduplicated, in first-appearance order, joined the way the host joins them. */
export function segmentLabelOf(kinds: readonly ProcessKind[]): string {
  const seen: ProcessKind[] = [];
  for (const kind of kinds) {
    if (!seen.includes(kind)) seen.push(kind);
  }
  return seen.map(kind => PROCESS_DONE_LABELS[kind]).join('，');
}

/** A stretch of process items between two narrations. */
export interface ProcessSegment<T> {
  /** The items, in order. Never empty: an empty stretch is not a segment. */
  readonly items: readonly T[];
  /** The kinds present, in first-appearance order. */
  readonly kinds: readonly ProcessKind[];
  /** The host's wording for those kinds. */
  readonly label: string;
}

/**
 * Split items into the stretches between narrations.
 *
 * The readers' own report of what the host does, in their words: 「以旁白为分界线，折叠之间的（包括开头到第一段旁白和最后一段旁白到回答正文）各种步骤」.
 * So a narration is a SEPARATOR, not a member: the run of items before the first narration is a segment (its label says what the turn did
 * before saying anything), every run between two narrations is a segment, and the run after the last narration is a segment too — while the
 * narrations themselves stay outside, in flow order, so the page keeps reading as a narrative.
 *
 * `isNarration` decides membership and `kindOf` names an item; both are injected so this stays pure and testable.
 */
export function splitByNarration<T>(
  items: readonly T[],
  isNarration: (item: T) => boolean,
  kindOf: (item: T) => ProcessKind,
): readonly ProcessSegment<T>[] {
  const segments: ProcessSegment<T>[] = [];
  let run: T[] = [];
  let kinds: ProcessKind[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    segments.push({ items: run, kinds, label: segmentLabelOf(kinds) });
    run = [];
    kinds = [];
  };
  for (const item of items) {
    if (isNarration(item)) {
      flush();
      continue;
    }
    const kind = kindOf(item);
    run.push(item);
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  flush();
  return segments;
}
