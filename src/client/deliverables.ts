import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ReaderFlowEntry } from './tool-activity.js';
import { inputFields, stringValue, toolIdentity } from './tool-activity.js';

interface ProducedEntry {
  readonly seq?: number;
  readonly path: string;
}

interface DeliverablesData {
  readonly produced: readonly ProducedEntry[];
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
 * The turn's files, SPLIT — and the split is the point.
 *
 * The old single list answered one question from two sources: the host's official `produced` data when there was any,
 * and otherwise the files this turn's write/edit tools touched. Flattened together, the fallback arrived under the
 * label 「产物」 — files that were EDITED presented as files that were DELIVERED, which is a claim about the turn that
 * is not true. Both are kept apart here, and a path in both is shown only as produced: delivering a file is the
 * stronger statement.
 */
export function getTurnDeliverableGroups(turn: TurnLocation | undefined, flow?: readonly ReaderFlowEntry[]): { edited: readonly string[]; produced: readonly string[] } {
  const produced: string[] = [];
  const edited: string[] = [];
  const seen = new Set<string>();
  const deliverables = (turn?.data as { get(key: string): unknown } | undefined)?.get('deliverables') as DeliverablesData | undefined;
  if (deliverables?.produced && Array.isArray(deliverables.produced)) {
    for (const item of deliverables.produced) {
      const clean = typeof item?.path === 'string' ? item.path.trim() : '';
      if (clean === '' || seen.has(clean)) continue;
      seen.add(clean);
      produced.push(clean);
    }
  }
  if (flow) {
    for (const item of flow) {
      if (item.kind !== 'tool' || !item.block) continue;
      // Skip failed tool results
      if ('isError' in item.block && item.block.isError) continue;
      const { name, raw } = toolIdentity(item);
      const toolName = name !== '工具调用' ? name : ((item.block as unknown as { name?: string }).name || (item.block as unknown as { call?: { name?: string } }).call?.name);
      const toolRaw = raw || ((item.block as unknown as { argsRaw?: string }).argsRaw || (item.block as unknown as { call?: { argsRaw?: string } }).call?.argsRaw || '');
      const args = inputFields(toolRaw);
      let target: string | undefined;
      if (toolName === 'write' || toolName === 'edit' || toolName === 'apply_patch') {
        target = stringValue(args, 'file_path', 'path', 'filename', 'filePath');
      } else if (toolName === 'str_replace_editor') {
        const cmd = stringValue(args, 'command');
        if (cmd === 'create' || cmd === 'str_replace' || cmd === 'insert') target = stringValue(args, 'path');
      }
      const clean = target?.trim() ?? '';
      if (clean === '' || seen.has(clean)) continue;
      seen.add(clean);
      edited.push(clean);
    }
  }
  return { edited, produced };
}

/**
 * The one list the rest of this plugin asks for: the files a turn DELIVERED, or — when the host published none — the
 * files it touched. Mention resolution and the row's own gate both want that single answer, so it stays exactly as it
 * behaved while the row above gained the ability to show the two apart.
 */
export function getTurnDeliverables(turn: TurnLocation | undefined, flow?: readonly ReaderFlowEntry[]): readonly string[] {
  const { edited, produced } = getTurnDeliverableGroups(turn, flow);
  return produced.length > 0 ? produced : edited;
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
