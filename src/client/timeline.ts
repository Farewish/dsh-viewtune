export interface TimelineItem {
  readonly turn: number;
  readonly prompt: string;
  readonly response: string;
  readonly hasDeliverables: boolean;
  readonly anchor:
    | { readonly kind: 'loaded'; readonly key: string }
    | { readonly kind: 'unloaded'; readonly seq: number };
}

interface RawOutlineEntry {
  readonly turn?: unknown;
  readonly seq?: unknown;
  readonly prompt?: unknown;
  readonly response?: unknown;
}

interface LoadedTurnNavigationItem {
  readonly turn: number;
  readonly anchorKey: string;
  readonly prompt: string;
  readonly response: string;
}

/**
 * Merge host turn outline with loaded navigation items and turn deliverables.
 * Guarantees strictly ascending turn order and dedupes entries.
 *
 * `rendered` is what the NODE STORE holds, keyed by turn number: the host's turn navigation is a WINDOW, so it stops
 * naming turns as soon as they fall outside it — while the records for them are loaded and rendered all the same. Trusting
 * the navigation alone therefore marked loaded turns as `unloaded`, which produced two visible bugs: clicking the rail at
 * such a turn asked to load something already present (a silent no-op), and the reading view's history button decided there
 * was more to fetch and re-offered its "load everything" escape hatch after everything had been loaded.
 */
export function mergeTimelineItems(
  loaded: readonly LoadedTurnNavigationItem[] | undefined,
  outline: unknown,
  turnsWithDeliverables?: ReadonlySet<number>,
  rendered?: ReadonlyMap<number, string>,
): readonly TimelineItem[] {
  const byTurn = new Map<number, TimelineItem>();

  // 1. Process host whole-log outline (if available)
  if (Array.isArray(outline)) {
    for (const raw of outline) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as RawOutlineEntry;
      if (typeof entry.turn !== 'number' || !Number.isSafeInteger(entry.turn) || entry.turn < 0) continue;
      if (typeof entry.seq !== 'number' || !Number.isSafeInteger(entry.seq) || entry.seq < 0) continue;
      const renderedKey = rendered?.get(entry.turn);

      byTurn.set(entry.turn, {
        turn: entry.turn,
        prompt: typeof entry.prompt === 'string' ? entry.prompt.trim() : '',
        response: typeof entry.response === 'string' ? entry.response.trim() : '',
        hasDeliverables: turnsWithDeliverables?.has(entry.turn) ?? false,
        // Present in the node store = loaded, whatever the windowed navigation list says.
        anchor: renderedKey === undefined ? { kind: 'unloaded', seq: entry.seq } : { kind: 'loaded', key: renderedKey },
      });
    }
  }

  // 2. Overlay loaded items (taking loaded anchor, preferring freshest previews)
  if (Array.isArray(loaded)) {
    for (const item of loaded) {
      if (typeof item.turn !== 'number') continue;
      const preview = byTurn.get(item.turn);
      const prompt = item.prompt?.trim() || preview?.prompt || '';
      const response = item.response?.trim() || preview?.response || '';
      const hasDeliverables = turnsWithDeliverables?.has(item.turn) ?? preview?.hasDeliverables ?? false;

      byTurn.set(item.turn, {
        turn: item.turn,
        prompt,
        response,
        hasDeliverables,
        anchor: { kind: 'loaded', key: item.anchorKey },
      });
    }
  }

  if (byTurn.size === 0) return [];
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}
