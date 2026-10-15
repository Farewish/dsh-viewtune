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

/** How many kinds a title names before it starts saying 「等」. The host's own `slice(0, 3)`. */
const HOST_LABEL_LIMIT = 3;
/** `message.stepProcess.sharedPrefix` — the 「已」 that two labels may share, and that the second then drops. */
const HOST_SHARED_PREFIX = '已';
/** `message.stepProcess.comma`. */
const HOST_COMMA = '，';
/** `message.stepProcess.more`. */
const HOST_MORE = '等';

/** The host's `continuation`: a later label loses its first letter's case so the phrase reads as one (`已搜索代码` → `搜索代码`). */
function continuation(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * One stretch's title, composed exactly as the host composes it.
 *
 * The host's own function, taken verbatim from `lib/types/client/chat/step-process.js` in the shipped `dsh-client-ui-chat` bundle (which keeps its
 * source comments):
 *
 *   function processTitle(summary, t) {
 *     const labels = summary.counts.slice(0, 3).map(({ kind }) => t(`message.stepProcess.done.${kind}`));
 *     const first = labels[0];
 *     if (first === void 0) return t("message.stepProcess.done.thinking");
 *     const continuation = (label) => label.charAt(0).toLowerCase() + label.slice(1);
 *     const second = labels[1];
 *     if (second === void 0) return first;
 *     if (labels.length === 2) {
 *       const prefix = t("message.stepProcess.sharedPrefix");
 *       return t("message.stepProcess.joinTwo", { first, second: continuation(prefix !== "" && first.startsWith(prefix) && second.startsWith(prefix) ? second.slice(prefix.length) : second) });
 *     }
 *     const title = [first, ...labels.slice(1).map(continuation)].join(t("message.stepProcess.comma"));
 *     return summary.counts.length > 3 ? t("message.stepProcess.more", { title }) : title;
 *   }
 *
 * …with its own Chinese strings: `sharedPrefix` is 「已」, `joinTwo` is 「{first}并{second}」, `comma` is 「，」 and `more` is 「{title}等」. So:
 *
 *   none 已完成分析 · one 执行了命令 · two 已读取文件并搜索代码 · three 执行了命令，修改了文件，已读取文件 · four 执行了命令，修改了文件，已读取文件等
 *
 * The ordering it consumes is the host's RANKED `summary.counts`; this takes the kinds in the order the caller supplies, which is the order the
 * turn did them in (see the caller). The shape of the title is identical either way; only the sequence can differ.
 */
export function segmentLabelOf(kinds: readonly ProcessKind[]): string {
  const labels = kinds.slice(0, HOST_LABEL_LIMIT).map(kind => PROCESS_DONE_LABELS[kind]);
  const first = labels[0];
  if (first === undefined) return PROCESS_DONE_LABELS.thinking;
  if (labels.length === 1) return first;
  const second = labels[1] ?? '';
  // Two kinds read as one phrase, and the shared 「已」 of the second is dropped so the pair does not say it twice.
  if (labels.length === 2) {
    const trimmed = first.startsWith(HOST_SHARED_PREFIX) && second.startsWith(HOST_SHARED_PREFIX)
      ? second.slice(HOST_SHARED_PREFIX.length)
      : second;
    return `${first}并${continuation(trimmed)}`;
  }
  const title = [first, ...labels.slice(1).map(continuation)].join(HOST_COMMA);
  return kinds.length > HOST_LABEL_LIMIT ? `${title}${HOST_MORE}` : title;
}

/**
 * What one flow item is, in the host's own terms.
 *
 * NOT a single value, and that is the whole point: the host runs `if (reasoning(node)) pending.push(...)` and then
 * `if (reply(node)) { flush(true); emit(key, { groupPart: "response" }) }` over the SAME node, so one step can be a member of a run AND stand
 * outside it at once. Treating it as one-or-the-other is exactly the bug the reader reported — a step whose thinking sits immediately above its
 * own narration never got a fold control, because the node was classified as a reply and its thinking was therefore never added to any run.
 *
 * `independent` is the host's `INDEPENDENT` set — user, steering, turn-trigger, model-retry, turn-error, turn-max-tokens, turn-tail — which is the
 * WHOLE of its boundary list, so anything else is a member of the run it sits in.
 */
export interface ProcessCharacter {
  /** In the host's `INDEPENDENT` set: stands outside every run and is never a member. */
  readonly independent?: boolean;
  /** Carries thinking: a MEMBER of the run it sits in. */
  readonly reasoning?: boolean;
  /** Carries the answer body, i.e. the turn's narration: ends the run before it and stands outside it. */
  readonly reply?: boolean;
}

/** A run of members — the host's `ProcessGroup`. */
export interface ProcessGroupRun<T> {
  readonly kind: 'group';
  /** The members, in order. Never empty. */
  readonly members: readonly T[];
  /** The kinds present, in first-appearance order (see `segmentLabelOf`). */
  readonly kinds: readonly ProcessKind[];
  /** The host's `closed`: true once a later node ended the run, false only for a run still growing. */
  readonly closed: boolean;
  /**
   * The host's title, and ONLY for a closed run — its `refresh` keeps just `counts` once closed and leaves a growing run with live detail instead,
   * so the title is a finished fact. `undefined` means "still growing: show it, do not label it".
   */
  readonly label?: string;
}

/**
 * A node that sits OUTSIDE every run: an `INDEPENDENT` node, or the narration (the host's `groupPart: "response"`).
 *
 * `part` says how the caller must render it, and it matters when the SAME node was also a member of the run before it: then the single is the
 * step's ANSWER BODY only (`'body'`), because the caller has already rendered its thinking inside the run.
 */
export interface ProcessSingle<T> {
  readonly kind: 'single';
  readonly item: T;
  readonly character: 'independent' | 'reply';
  /** Which of the item's parts this single stands for: everything (`whole`), or the answer body alone (`body`). */
  readonly part: 'whole' | 'body';
}

export type ProcessUnit<T> = ProcessGroupRun<T> | ProcessSingle<T>;

/**
 * The host's segmentation, transcribed from `rebuild` in `lib/types/client/conversation-nodes/process-groups.js`:
 *
 *   if (INDEPENDENT.has(node.kind))  { flush(true); emit(key, { kind: "node", key }) }
 *   else if (node.kind === "assistant-step") {
 *     if (reasoning(node)) pending.push({ key, groupPart: "reasoning" })
 *     if (reply(node))     { flush(true); emit(key, { kind: "node", key, groupPart: "response" }) }
 *   } else pending.push({ kind: "node", key })
 *   …flush(followed)   // the tail is closed only if something followed it
 *
 * Three consequences matter, and each of them was a bug in the earlier narration-only version:
 *
 *  1. THINKING IS A MEMBER. A run usually opens with the thinking that preceded any narration, which is why a run starting at a 思考 has its own
 *     fold control — the reader reported it missing.
 *  2. THE BOUNDARIES ARE THE `INDEPENDENT` SET, not "anything that is not an assistant step". A tool call, a command, a question reply — all
 *     MEMBERS. Treating them as boundaries split runs that the host keeps whole ("有时候没有以旁白为界").
 *  3. THE NARRATION BOTH ENDS A RUN AND STANDS OUTSIDE IT. It is emitted as its own node, so the page still reads as a narrative, and the run
 *     before it closes.
 *
 * `turnClosed` is the host's `input.timeline.turns.get(turn)?.status === "closed"`, which closes the trailing run as well: a finished turn has
 * no growing tail. The host's `position.previous !== previous` rule (a break in NODE ORDER) has no counterpart here — the flow this view renders
 * is already one ordered list — so it is deliberately absent rather than forgotten.
 */
export function processGroups<T>(
  items: readonly T[],
  characterOf: (item: T) => ProcessCharacter,
  /** What kind of work the item is, or undefined when it is no work at all — an unnamed kind would invent activity the turn never had. */
  kindOf: (item: T) => ProcessKind | undefined,
  turnClosed: boolean,
): readonly ProcessUnit<T>[] {
  const units: ProcessUnit<T>[] = [];
  let pending: T[] = [];
  let kinds: ProcessKind[] = [];
  const flush = (closed: boolean): void => {
    if (pending.length === 0) return;
    units.push({
      kind: 'group', members: pending, kinds, closed,
      ...(closed ? { label: segmentLabelOf(kinds) } : {}),
    });
    pending = [];
    kinds = [];
  };
  let followed = false;
  for (const item of items) {
    const character = characterOf(item);
    // An INDEPENDENT node is only ever a single: it is never a member of a run.
    if (character.independent === true) {
      flush(true);
      units.push({ kind: 'single', item, character: 'independent', part: 'whole' });
      followed = true;
      continue;
    }
    // A node with thinking is a MEMBER, and its kind counts towards the run's title. This is the half that was missing: a step whose thinking
    // sits immediately above its own narration used to be classified as a reply and never entered a run at all.
    if (character.reasoning === true) {
      pending.push(item);
      const kind = kindOf(item);
      // An item may be NO kind of work (a step that merely carries text). It is still a member — the host keeps it in the run — but it must not put
      // a word in the title, or a stretch would claim activity the turn never had (the reader saw 「已调用工具」 on a stretch that called nothing).
      if (kind !== undefined && !kinds.includes(kind)) kinds.push(kind);
    } else if (character.reply !== true) {
      // Anything else — a tool call, a command, a question reply — is a member too.
      pending.push(item);
      const kind = kindOf(item);
      if (kind !== undefined && !kinds.includes(kind)) kinds.push(kind);
    }
    // …and a node carrying the answer body ends the run and stands outside it. When it was ALSO a member (thinking and body in one step) the
    // single stands for the BODY alone, because the caller has already rendered its thinking inside the run.
    if (character.reply === true) {
      flush(true);
      units.push({ kind: 'single', item, character: 'reply', part: character.reasoning === true ? 'body' : 'whole' });
    }
    followed = true;
  }
  // The trailing run: closed when the turn is over, still growing otherwise — the host's `flush(followed)` plus its turn-status check.
  flush(turnClosed);
  return units;
}
