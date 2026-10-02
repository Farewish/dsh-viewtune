import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ReaderFlowEntry } from './tool-activity.js';
import { callDiffHunks, inputFields, stringValue, toolIdentity } from './tool-activity.js';
// Type-only, so this module stays free of the primitives at RUNTIME and can still be unit-tested outside a browser.
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives';

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
/** One commit a turn made, as much as a client can honestly know about it. */
export interface CommitRecord {
  /** The short hash git printed, when the tool's result was readable. */
  readonly hash?: string;
  /** The message's first line, from the command's own `-m`, or a plain 「一次提交」. */
  readonly subject: string;
}

/**
 * `git commit` in COMMAND position, allowing the global options that sit between the program and its subcommand.
 *
 * That allowance is the whole bug the reader reported: every commit in their instance was made as
 * `git -C <dir> commit -m …` — exactly how this project's own commits are made — and a pattern demanding `git` be
 * followed immediately by `commit` never matched one, so 「提交」 stayed empty forever.
 */
const GIT_COMMIT = /(?:^|[;&|]|\bthen\b)\s*git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+)*commit\b/;

/** The message of a `git commit`, from the first `-m`/`--message` argument the command carries. */
function commitSubject(command: string): string {
  const quoted = /(?:^|\s)-{1,2}m(?:essage)?[= ](?:"([^"]+)"|'([^']+)'|([^\s"'&|;]+))/m.exec(command);
  const subject = (quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? '').split('\n')[0]?.trim() ?? '';
  return subject === '' ? '一次提交' : subject;
}

/** Git's own summary line in a result: `[branch 1a2b3c4] the subject`, both halves at once. */
function commitSummary(text: string): { hash?: string; subject?: string } {
  const match = /^\s*\[[^\]\s]+ ([0-9a-f]{7,40})\]\s*(.*)$/m.exec(text);
  if (match === null) return {};
  return { hash: match[1], subject: match[2]?.trim() };
}

/**
 * The commits a turn made: every tool call whose ARGUMENTS carry a `git commit` command.
 *
 * There is no host list for these — a commit is something the turn DID, not a file it touched — so they are read off the
 * calls, and only from the arguments: a document *mentioning* `git commit` arrives as a tool RESULT, never as a call's
 * arguments, so a command field cannot mistake prose for a commit. The hash comes from the result when there is one (git
 * prints it), and the subject from the command's own `-m`, which is the line the reader recognises.
 */
export function turnCommits(flow?: readonly ReaderFlowEntry[]): readonly CommitRecord[] {
  const commits: CommitRecord[] = [];
  const seen = new Set<string>();
  if (!flow) return commits;
  for (const item of flow) {
    if (item.kind !== 'tool' || !item.block) continue;
    if ('isError' in item.block && item.block.isError) continue;
    const block = item.block as unknown as {
      name?: string;
      argsRaw?: string;
      call?: { name?: string; argsRaw?: string };
      content?: readonly { text?: string; type?: string }[];
    };
    const raw = block.call?.argsRaw ?? block.argsRaw ?? '';
    if (raw === '') continue;
    const args = inputFields(raw);
    // ONLY a command-shaped field counts. Searching the whole argument text would count a `write` whose CONTENT happens to
    // mention `git commit` — this very plugin's CHANGELOG does — and a false commit is worse than a missed one.
    const command = stringValue(args, 'command', 'cmd', 'script', 'input');
    if (command === undefined || !GIT_COMMIT.test(command)) continue;
    const result = (block.content ?? []).map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    const summary = commitSummary(result);
    // The command's own `-m` names the commit first; git's summary line is the fallback, and it also carries the hash —
    // which is what a commit made with `-F <file>` (as this project's own are) has to rely on.
    const subject = commitSubject(command);
    const finalSubject = subject === '一次提交' && summary.subject !== undefined && summary.subject !== '' ? summary.subject : subject;
    const key = `${summary.hash ?? ''}\u0000${finalSubject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    commits.push(summary.hash === undefined ? { subject: finalSubject } : { hash: summary.hash, subject: finalSubject });
  }
  return commits;
}

/**
 * The turn's work, in the two lists the row shows — a shape the READER's own call decided.
 *
 * They asked for 新增/编辑 to be told apart, checked it against a real turn, and found the client cannot: the host's
 * change announcement covers everything the turn wrote, and a plain `write` creates and overwrites with the same call.
 * So the two file lists are MERGED under 「编辑」 (their instruction), and the second box records what the client
 * genuinely CAN tell apart: the turn's commits.
 *
 * `edited` is therefore every file the turn is known to have touched — the host's `changes` list, its `presented`
 * deliveries (the share package the reader saw on the conversation page: a file the turn made is a file it made), and the
 * fallback's reading of the write/edit calls. `commits` is read from the calls themselves (`turnCommits`).
 */
export function getTurnDeliverableGroups(turn: TurnLocation | undefined, flow?: readonly ReaderFlowEntry[]): { changesSeq?: number; delivered: readonly DeliveredFile[]; edited: readonly string[] } {
  const changed: string[] = [];
  const delivered: DeliveredFile[] = [];
  const touched: string[] = [];
  const added: string[] = [];
  const seenChanged = new Set<string>();
  const seenTouched = new Set<string>();
  const deliverables = (turn?.data as { get(key: string): unknown } | undefined)?.get('deliverables') as DeliverablesData | undefined;
  // (1) The host's own two lists. `presented` is the deliveries — the share package included; `changes` is the change
  // announcement, whose per-file list is read tolerantly because only its added/deleted totals were certain at first
  // (`files` / `paths` / a bare array are all accepted, and an unrecognised shape simply contributes nothing).
  // `presented` carries the assistant's own DESCRIPTION of each delivered file — the second line of the host's card — so
  // it is kept rather than reduced to a path here: that is what lets the reading view's cards mode match that card
  // instead of inventing a caption.
  for (const entry of deliverables?.presented ?? []) {
    const clean = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (clean === '') continue;
    const description = typeof entry?.description === 'string' && entry.description.trim() !== '' ? entry.description.trim() : undefined;
    delivered.push(description === undefined ? { path: clean } : { path: clean, description });
  }
  // The change announcement's per-file list, read tolerantly: only its added/deleted totals were certain when this was
  // first written, so `files`, `paths` and a bare array are all accepted, and anything else contributes nothing rather
  // than throwing.
  const rawChanges = deliverables?.changes;
  // The announcement's own sequence, which the review address needs: the host publishes it beside the file list and uses
  // it for its own previews (`seq: changes.seq`). Absent when the change data is a bare array, in which case the address
  // cannot be built and the caller falls back to the in-page panel.
  const changesSeq = typeof (rawChanges as { seq?: unknown } | undefined)?.seq === 'number'
    ? (rawChanges as { seq: number }).seq
    : undefined;
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
  // The turn's work in the two lists the row shows, and the reader settled both:
  //   · 编辑 — every file the turn is known to have touched: the host's change announcement, the fallback's reading of the
  //     write/edit calls, and (in the older shape) whatever the calls said they created. Whether a file was NEW or EDITED
  //     cannot be told apart, so they are one list under 「编辑」.
  //   · 交付 — what was DELIVERED: the host's `presented` list, the assistant's own hand-over (the share package).
  // The two OVERLAP on purpose, which the reader corrected: the boxes answer different questions — what did this turn
  // change, and what did it hand over — so a file that was edited and then delivered answers both. Only the older shape
  // (新增 vs 编辑) made them mutually exclusive, and that shape is gone. A delivered-only file is in 编辑 as well, for
  // the same reason the client cannot tell a created file from an edited one.
  const deliveredPaths = delivered.map(entry => entry.path);
  const editedList: string[] = [];
  const seen = new Set<string>();
  for (const path of [...deliveredPaths, ...changed, ...touched]) {
    if (path === '' || seen.has(path)) continue;
    seen.add(path);
    editedList.push(path);
  }
  return { changesSeq, delivered, edited: editedList };
}

/**
 * The files the rest of this plugin asks for — inline file mentions, and the flat list behind them. Commits are not
 * files, so they are not in it; the row's own gate asks about both (see the reader).
 */
export function getTurnDeliverables(turn: TurnLocation | undefined, flow?: readonly ReaderFlowEntry[]): readonly string[] {
  const { delivered, edited } = getTurnDeliverableGroups(turn, flow);
  // Deduped, because the two lists overlap BY DESIGN (a file can be edited and delivered): this flat list feeds inline
  // mention resolution and the row's gate, and neither wants the same path twice. Deliveries first, as they were.
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const path of [...delivered.map(entry => entry.path), ...edited]) {
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
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

/** One DELIVERED file: the assistant handed it over, with whatever it said about it. */
export interface DeliveredFile {
  /** The assistant's own words about the file, which the host's card shows as the second line. */
  readonly description?: string;
  readonly path: string;
}

/** One file a turn changed, with the raw hunks and the call that changed it. */
export interface TurnChange {
  /** The tool call responsible, when the flow knows one — this is what the heading's click hands to the host's inspector. */
  readonly callId?: string;
  /** The host's own rows for this file, read through the one normaliser (`callDiffHunks`). */
  readonly hunks: DiffHunk[];
  readonly path: string;
}

/**
 * The turn's changed files, each with its hunks and the call that changed it.
 *
 * Two consumers, one list: the hover window shows the files with their ± counts (the reader's own screenshot of the
 * conversation page), and the heading's click needs a call to inspect. Both read the SAME normaliser the tool rows use
 * (`callDiffHunks`), so a file cannot be counted one way on a row and another way in the window. The counts themselves
 * are left to the caller: they come from `diffTotals` in the primitives, which this module stays clear of so it can be
 * unit-tested without a browser.
 *
 * A path changed by several calls keeps the LAST one, the way the host's own `presentedForClosing` keeps the latest
 * declaration of a path, and the order is first-seen.
 */
export function turnChanges(flow?: readonly ReaderFlowEntry[]): readonly TurnChange[] {
  const byPath = new Map<string, TurnChange>();
  if (!flow) return [];
  for (const item of flow) {
    if (item.kind !== 'tool' || !item.block) continue;
    const { name, raw } = toolIdentity(item);
    const block = item.block as unknown as { name?: string; argsRaw?: string; call?: { name?: string; argsRaw?: string } };
    const toolName = name !== '工具调用' ? name : (block.name || block.call?.name);
    const toolRaw = raw || (block.argsRaw || block.call?.argsRaw || '');
    const hunks = callDiffHunks(item.block, toolName, inputFields(toolRaw));
    for (const hunk of hunks) {
      if (typeof hunk.path !== 'string' || hunk.path === '') continue;
      byPath.set(hunk.path, { path: hunk.path, hunks: [hunk], callId: item.callId });
    }
  }
  return [...byPath.values()];
}

/** The tab kind the deliverables package owns for its changes review. */
export const CHANGES_REVIEW_KIND = 'changes-review';

/** The address prefix a changes-review resource lives under, read from the package's own builder. */
const CHANGES_REVIEW_ADDRESS = 'dsh-resource://changes-review/session/';

/**
 * The address of the HOST'S OWN changes review for one turn — the tab its 「已编辑 x 个文件」 card opens.
 *
 * Spelled exactly as the deliverables package spells it (`changesReviewAddress`), because the address is what its
 * `canOpen` parses: `dsh-resource://changes-review/session/<encodeURIComponent(sessionId)>/<seq>/<turn>`, with `seq` the
 * announcing event's sequence and `turn` the 1-based turn number the package validates as `^[1-9]\d*$`.
 *
 * This is the one route to the host's review that a View actually has. The card itself cannot be imported — the packages
 * export only `apply`/`inject`, and the card's slot occupant needs the package's own stores — but opening its resource
 * makes the HOST draw it, unmodified, in the sidebar.
 */
export function changesReviewAddress(coordinates: { readonly sessionId: string; readonly seq: number; readonly turn: number }): string {
  return `${CHANGES_REVIEW_ADDRESS}${encodeURIComponent(coordinates.sessionId)}/${String(coordinates.seq)}/${String(coordinates.turn)}`;
}

/** The single produced path whose basename is exactly value, or undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
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
