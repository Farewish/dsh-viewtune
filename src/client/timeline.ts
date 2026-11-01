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
interface OutlineEntry {
  readonly turn: number;
  readonly seq: number;
  readonly prompt: string;
  readonly response: string;
}

interface OutlineBase {
  readonly entries: ReadonlyMap<number, OutlineEntry>;
  /** Ascending, computed once per outline array. */
  readonly turns: readonly number[];
}

const EMPTY_OUTLINE: OutlineBase = { entries: new Map(), turns: [] };

/**
 * The validated, sorted outline, cached by the projection array's identity.
 *
 * `useProjection` keeps the array stable until the host's outline changes; the reading view re-merges
 * it whenever a turn becomes rendered or gains a deliverable. Without this cache every such pass
 * re-validated every raw entry and sorted the whole log again.
 */
const outlineBases = new WeakMap<object, OutlineBase>();

function outlineBase(outline: readonly unknown[]): OutlineBase {
  const cached = outlineBases.get(outline);
  if (cached !== undefined) return cached;
  const entries = new Map<number, OutlineEntry>();
  for (const raw of outline) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as RawOutlineEntry;
    if (typeof entry.turn !== 'number' || !Number.isSafeInteger(entry.turn) || entry.turn < 0) continue;
    if (typeof entry.seq !== 'number' || !Number.isSafeInteger(entry.seq) || entry.seq < 0) continue;
    entries.set(entry.turn, {
      turn: entry.turn,
      seq: entry.seq,
      prompt: typeof entry.prompt === 'string' ? entry.prompt.trim() : '',
      response: typeof entry.response === 'string' ? entry.response.trim() : '',
    });
  }
  const base: OutlineBase = { entries, turns: [...entries.keys()].sort((a, b) => a - b) };
  outlineBases.set(outline, base);
  return base;
}

export function mergeTimelineItems(
  loaded: readonly LoadedTurnNavigationItem[] | undefined,
  outline: unknown,
  turnsWithDeliverables?: ReadonlySet<number>,
  rendered?: ReadonlyMap<number, string>,
): readonly TimelineItem[] {
  const base = Array.isArray(outline) ? outlineBase(outline) : EMPTY_OUTLINE;
  const byTurn = new Map<number, TimelineItem>();
  const order = [...base.turns];
  let sorted = true;

  // 1. The cached outline, with the live render/deliverable facts applied.
  for (const turn of base.turns) {
    const entry = base.entries.get(turn)!;
    const renderedKey = rendered?.get(turn);
    byTurn.set(turn, {
      turn,
      prompt: entry.prompt,
      response: entry.response,
      hasDeliverables: turnsWithDeliverables?.has(turn) ?? false,
      // Present in the node store = loaded, whatever the windowed navigation list says.
      anchor: renderedKey === undefined ? { kind: 'unloaded', seq: entry.seq } : { kind: 'loaded', key: renderedKey },
    });
  }

  // 2. Overlay loaded items (taking loaded anchor, preferring freshest previews). A loaded turn that
  // was absent from the outline is appended; only then can the order need a sort.
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
      if (preview === undefined) {
        if (order.length > 0 && item.turn < order[order.length - 1]!) sorted = false;
        order.push(item.turn);
      }
    }
  }

  if (byTurn.size === 0) return [];
  if (!sorted) order.sort((a, b) => a - b);
  return order.map(turn => byTurn.get(turn)!);
}
