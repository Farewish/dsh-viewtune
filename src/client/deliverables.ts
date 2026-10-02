import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ReaderFlowEntry } from './tool-activity.js';
import { inputFields, stringValue, toolIdentity } from './tool-activity.js';

interface PresentedEntry {
  readonly seq?: number;
  readonly path?: string;
  readonly description?: string;
}

/**
 * What the deliverables package publishes ON A TURN in 0.2.0, measured from its own bundle:
 *
 * ```js
 * owner.turn.data.get("deliverables")   // → { changes, presented }
 * ```
 *
 * `changes` is the 「已编辑 x 个文件」 announcement — the files the turn CHANGED, with added/deleted counts.
 * `presented` is what the assistant explicitly DELIVERED — `presentedForClosing` walks it and keeps the latest
 * declaration of each path. The share package the reader saw on the conversation page lives HERE.
 *
 * The first version of this file read `deliverables.produced`, a field this version of the host does not publish at all
 * — so the row was always showing the tool-flow fallback, which is files the turn touched: that is why edited files
 * appeared under 「新增」 and the genuinely delivered file never appeared anywhere.
 */
interface DeliverablesData {
  readonly changes?: unknown;
  readonly presented?: readonly PresentedEntry[];
}

/** Extract standard filename without directory components. */
export function basename(path: string): string {
  const normalized = path.replace(/[/\\]+$/, '');
  const at = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return at === -1 ? normalized : normalized.slice(at + 1);
}

/** Extract parent directory of a path (or '.' if top-level). */
export function dirname(path: string): string {
  const normalized = path.replace(/[/\\]+$/, '');
  const at = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return at === -1 ? '.' : normalized.slice(0, at) || '.';
}

/**
 * The produced-files chip row waits for turn close. Live writes still
 * accumulate, but the row must not interrupt an in-progress process.
 */
export function showDeliverablesRow(status: 'open' | 'closed' | 'unknown', paths: readonly string[]): boolean {
  return status === 'closed' && paths.length > 0
}

/**
 * The turn's files, SPLIT — and the split is the correction the reader made twice.
 *
 * The first version of this function kept the host's official `produced` list apart from the fallback list of files the
 * turn's write/edit tools touched, and labelled the host's list 「新增」. The reader checked it against a real turn (the
 * one that packaged a release) and the truth was the other way round: the host's `produced` held the fourteen files that
 * turn had *changed* — glass.ts, Reader.tsx, package.json, CHANGELOG.md — and the one genuinely new file, the share
 * package, was in neither list. So:
 *
 *   · `edited` — what the turn CHANGED: the host's `produced` list, plus the files the fallback found (same meaning,
 *     so they are one list; a path in both is listed once, host entries first).
 *   · `added`  — what the turn CREATED, and only where a tool call SAYS SO: `str_replace_editor` with `create`/`insert`,
 *     or an `apply_patch` whose patch text carries an `*** Add File:` header for that path. A plain `write` is NOT
 *     evidence of creation (it overwrites as happily as it creates), so it stays in `edited` — the conservative way
 *     round, because a wrong guess here only files a created file under 编辑 instead of 新增.
 *
 * What NO version can show: files a turn made without a file-writing tool call — a share package from `npm pack`, a
 * build artifact, anything a shell command wrote — because the plugin sees only tool calls and the host's published
 * lists, and the reader's own `.tgz` was in neither (shell-written and gitignored). Said plainly in the CHANGELOG.
 */
export function getTurnDeliverableGroups(turn: TurnLocation | undefined, flow?: readonly ReaderFlowEntry[]): { added: readonly string[]; edited: readonly string[] } {
  const changed: string[] = [];
  const delivered: string[] = [];
  const touched: string[] = [];
  const added: string[] = [];
  const seenChanged = new Set<string>();
  const seenTouched = new Set<string>();
  const deliverables = (turn?.data as { get(key: string): unknown } | undefined)?.get('deliverables') as DeliverablesData | undefined;
  // (1) The host's own two lists. `presented` is the deliveries — the share package included; `changes` is the change
  // announcement, whose per-file list is read tolerantly because only its added/deleted totals were certain at first
  // (`files` / `paths` / a bare array are all accepted, and an unrecognised shape simply contributes nothing).
  for (const entry of deliverables?.presented ?? []) {
    const clean = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (clean !== '') delivered.push(clean);
  }
  // The change announcement's per-file list, read tolerantly: only its added/deleted totals were certain when this was
  // first written, so `files`, `paths` and a bare array are all accepted, and anything else contributes nothing rather
  // than throwing.
  const rawChanges = deliverables?.changes;
  const changeList: unknown[] = Array.isArray(rawChanges)
    ? rawChanges
    : (typeof rawChanges === 'object' && rawChanges !== null
      ? (Array.isArray((rawChanges as { files?: unknown }).files)
        ? (rawChanges as { files: unknown[] }).files
        : (Array.isArray((rawChanges as { paths?: unknown }).paths) ? (rawChanges as { paths: unknown[] }).paths : []))
      : []);
  for (const entry of changeList) {
    const clean = typeof entry === 'string' ? entry.trim() : (typeof (entry as { path?: unknown })?.path === 'string' ? ((entry as { path: string }).path).trim() : '');
    if (clean !== '' && !seenChanged.has(clean)) {
      seenChanged.add(clean);
      changed.push(clean);
    }
  }
  // (2) The fallback: the files this turn's own write/edit tool calls touched, and — where a call SAYS it created one —
  // the files it added. Kept even when the host published lists, because a turn that changed files without announcing a
  // change summary would otherwise show nothing at all.
  if (flow) {
    for (const item of flow) {
      if (item.kind !== 'tool' || !item.block) continue;
      // Skip failed tool results
      if ('isError' in item.block && item.block.isError) continue;
      const { name, raw } = toolIdentity(item);
      const block = item.block as unknown as { name?: string; argsRaw?: string; call?: { name?: string; argsRaw?: string } };
      const toolName = name !== '工具调用' ? name : (block.name || block.call?.name);
      const toolRaw = raw || (block.argsRaw || block.call?.argsRaw || '');
      const args = inputFields(toolRaw);
      // One entry can name SEVERAL paths — a patch names its files in its own text — so each call yields a list.
      const found: { path: string; created: boolean }[] = [];
      if (toolName === 'apply_patch') {
        const patch = stringValue(args, 'patch', 'input', 'diff') ?? toolRaw;
        for (const match of patch.matchAll(/^\*\*\* (Add|Update|Delete|add|update|delete) File:\s*(.+)$/gm)) {
          const path = match[2].trim();
          if (path !== '') found.push({ path, created: match[1].toLowerCase() === 'add' });
        }
        const field = stringValue(args, 'file_path', 'path', 'filename', 'filePath');
        if (field !== undefined && !found.some(entry => entry.path === field)) found.push({ path: field, created: false });
      } else if (toolName === 'write' || toolName === 'edit') {
        // NOT creation evidence: a write creates and overwrites with the same call, so this stays in 编辑.
        const target = stringValue(args, 'file_path', 'path', 'filename', 'filePath');
        if (target !== undefined) found.push({ path: target, created: false });
      } else if (toolName === 'str_replace_editor') {
        // Only the commands that WRITE: `view` is how the same tool reads a file, and counting it would have put every
        // file the turn merely looked at into 编辑.
        const command = stringValue(args, 'command');
        if (command === 'create' || command === 'str_replace' || command === 'insert') {
          const target = stringValue(args, 'path');
          if (target !== undefined) found.push({ path: target, created: command === 'create' });
        }
      }
      for (const entry of found) {
        const clean = entry.path.trim();
        if (clean === '' || seenTouched.has(clean)) continue;
        seenTouched.add(clean);
        touched.push(clean);
        if (entry.created) added.push(clean);
      }
    }
  }
  // A delivered file is also a NEW file (it was made this turn), so it leads the 新增 list and is never repeated under
  // 编辑. The tool-flow creation evidence joins it, and whatever remains is what the turn changed — each list deduped,
  // both orders first-seen.
  const addedAll: string[] = [];
  const addedSet = new Set<string>();
  for (const path of [...delivered, ...added]) {
    if (path === '' || addedSet.has(path)) continue;
    addedSet.add(path);
    addedAll.push(path);
  }
  const editedAll: string[] = [];
  const seenEdited = new Set<string>();
  for (const path of [...changed, ...touched]) {
    if (path === '' || addedSet.has(path) || seenEdited.has(path)) continue;
    seenEdited.add(path);
    editedAll.push(path);
  }
  return { added: addedAll, edited: editedAll };
}

/**
 * The one list the rest of this plugin asks for — inline file mentions, and whether the row appears at all — as the
 * union of both, deliveries first. It has to be the union: the delivered file is exactly the one the reader wants to be
 * able to click, and a turn that only delivered something (no change announcement, no write tool call the fallback can
 * see) would otherwise show no row at all.
 */
export function getTurnDeliverables(turn: TurnLocation | undefined, flow?: readonly ReaderFlowEntry[]): readonly string[] {
  const { added, edited } = getTurnDeliverableGroups(turn, flow);
  return [...added, ...edited];
}

/** The three ways this view can show a turn's files — 「产物展示」. */
export type DeliverableDisplay = 'brief' | 'balanced' | 'cards';

/**
 * WHY THERE ARE THREE. The trade in one line each: a pill costs about 24px per file and says the least (name only, one
 * generic glyph); the host's card is 60px and says the most (per-extension icon tile, a description line, the whole card
 * clickable). Neither suits every turn — one delivered file deserves the card, twelve deserve the row — so the middle
 * mode keeps the row's density for BOTH lists, makes each item recogniseable by type, and reveals the full detail on
 * demand rather than by a preference the reader has to get right in advance.
 */
export const DELIVERABLE_DISPLAYS: readonly { readonly id: DeliverableDisplay; readonly label: string }[] = [
  { id: 'brief', label: '简略气泡' },
  { id: 'balanced', label: '平衡' },
  { id: 'cards', label: '详细卡片' },
];

/** The stored mode, read defensively: anything unrecognised is 「平衡」, which is what this view now opens with. */
export function deliverableDisplayOf(value: unknown): DeliverableDisplay {
  return value === 'brief' || value === 'cards' ? value : 'balanced';
}

/** The chip row's height: `.deliverableChip { height: 28px }` in the balanced box. */
export const DELIVERABLE_CHIP_HEIGHT = 28;
/** The row gap inside the box's chip lane (`.deliverablesBoxLane { gap: 6px }`). */
export const DELIVERABLE_CHIP_GAP = 6;
/**
 * How tall the balanced box's chip lane is allowed to grow before it needs opening: two rows exactly.
 *
 * Kept in step with the CSS by hand, and the guard pins the CSS side (`max-height:62px`), so a drift between the two is
 * caught at build time rather than showing up as a switch that appears when there is nothing to open.
 */
export const DELIVERABLE_BOX_CAP = DELIVERABLE_CHIP_HEIGHT * 2 + DELIVERABLE_CHIP_GAP;

/**
 * Whether a chip lane of this natural height has anything hidden behind the cap — and therefore whether the box needs an
 * 「展开」 switch at all. A box whose chips already fit shows no switch, which is what the reader asked for.
 *
 * The comparison is against the CAPPED height, not the lane's current one, so the answer does not change when the box is
 * opened: `scrollHeight` is the content's height either way, and a box that was openable stays closable.
 */
export function needsExpand(contentHeight: number, cap: number = DELIVERABLE_BOX_CAP): boolean {
  // A pixel of slack: sub-pixel line boxes round, and a switch that flickers in and out on a rounding error is worse
  // than one that appears a row early.
  return contentHeight > cap + 1;
}

/** The single produced path whose basename is exactly value, or undefined. */function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * File-mention resolver: converts inline-code tokens matching produced paths
 * into clickable file references that open the corresponding file on the host.
 */
export function createProducedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
): MarkdownFileMentions {
  return {
    resolve(value: string) {
      if (!value || value.includes('\n')) return undefined;
      const clean = value.trim();
      const path = paths.includes(clean) ? clean : onlyPathWithBasename(paths, clean);
      if (path === undefined) return undefined;
      return {
        open: () => { openFile(path); },
        label: `打开 ${path}`,
        title: path,
      };
    },
  };
}
