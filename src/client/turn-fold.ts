/**
 * 「自动折叠更早的轮次」: how many turns this view RENDERS, and how the reader gets the older ones back.
 *
 * WHAT FOLDS. A folded TURN is not rendered at all — the reader's message, the process and the answer together — so
 * the page keeps a window of the newest turns and everything behind it stops contributing DOM, layout, reasoning cards
 * and text highlights. That is a different thing from 「自动收起更早流程」 (see `processExpanded` in projection.ts):
 * that one folds a turn's PROCESS, only while a turn streams, and it stays the only setting that touches the
 * disclosure at all.
 *
 * WHEN IT FOLDS. Only when a NEW turn starts. The window is therefore a COMMITTED number rather than a live one: a
 * reader working through turn 40 does not have the ground move under them because turn 41 arrived mid-sentence, and a
 * reader who edits the setting sees it take effect at the next turn (the effect lives in `Reader.tsx`).
 *
 * WHAT THE READER GETS BACK. `revealStepOf` is one press of the reveal control, and the reveal always serves what is
 * already in hand before anything is read from disk: the timeline holds the turns the host has loaded, so revealing is
 * free until that runs out, and only then does the control fall through to `loadOlder`. That is the reader's own
 * compromise — N rendered, the next band held in memory by the host, anything older read from disk on demand — and it
 * comes with one limit this plugin cannot lift: it can stop RENDERING what it does not need, but it cannot free what
 * the HOST holds (stated in the CHANGELOG rather than left for someone to discover).
 *
 * 0 is OFF, and OFF is the shipped default: this view does not fold a reader's history behind their back.
 */
export const TURN_FOLD_MAX = 50;

/** The stored count, clamped: an absent or unusable value means OFF. */
export function turnFoldOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(TURN_FOLD_MAX, Math.max(0, Math.round(value)));
}

/**
 * How many turns are rendered: the committed window plus what the reader has revealed.
 *
 * `Infinity` when the setting is OFF, which is what makes the call sites read the same way either way — a window that
 * cannot be reached is the same thing as no window at all, and no caller has to special-case 0.
 */
export function renderedTurnsOf(window: number, revealed: number): number {
  if (window <= 0) return Number.POSITIVE_INFINITY;
  return window + Math.max(0, revealed);
}

/**
 * One press of the reveal control: the next band, the same size as the window, so a press cannot skip turns and the
 * amount revealed never depends on how much has already been revealed.
 */
export function revealStepOf(window: number): number {
  return window > 0 ? window : 0;
}

/** Whether the turn at `index` (0-based, oldest first) is inside the rendered window. */
export function insideWindow(index: number, total: number, rendered: number): boolean {
  return total - 1 - index < rendered;
}

/**
 * How much must be revealed for the turn at `index` to be RENDERED — the reader's own jump, and the reason it used to fail.
 *
 * The rail can navigate to any turn in the log, and for one outside the window the load does succeed: `loadThrough` brings
 * the records in. The jump still could not land, because landing means finding the row — `[data-reader-turn="…"]` — and a
 * turn the folding window hides has no row at all. So navigation has to grow the window first, and this is by how much:
 * the window is a count from the TAIL, so the turn at `index` is inside it exactly when `total - 1 - index < rendered`.
 *
 * Returns the value `revealed` needs (`0` when the window already covers it, or when the setting is off). The caller takes
 * the MAXIMUM with what the reader has already revealed, so a jump never hides anything they had opened by hand.
 */
export function revealForTurn(index: number, total: number, window: number, revealed: number): number {
  if (window <= 0 || index < 0 || index >= total) return revealed;
  const needed = total - index - window;
  return needed <= revealed ? revealed : needed;
}

/**
 * Which unloaded turn to ask for on the Nth attempt at reading older history — the walk around a platform defect.
 *
 * Measured from the reader's console: BOTH loaders trip the same failure. `loadOlder` (50-message pages) and `loadThrough`
 * (200-message pages) each died in `ConversationNodeAssembler` with "system-message withdrew materialized target chat",
 * killing the event feed subscriber so the batch never landed. Page size is not the variable — whether the requested batch
 * HAPPENS TO CONTAIN the offending event is. The reader's own experience says the same thing from the other side: jumping
 * far back "sometimes" works, and then many loads succeed, which is exactly a batch that stepped over the event.
 *
 * So the attempts grow the step: one turn back, then two, four, eight. Each asks for a different batch, and one of them
 * excludes the event. `unloaded` is every unloaded sequence ASCENDING (oldest first), `attempt` is 0-based; `null` means the
 * ladder has run out of log, which is the caller's signal to stop asking.
 */
export function historyStepTarget(unloaded: readonly number[], attempt: number): number | null {
  const ladder = [0, 1, 3, 7];
  // Past the ladder there is nothing new to ask for: repeating the deepest rung would send the same request twice and call
  // it a retry. `null` is the caller's signal to stop.
  if (attempt < 0 || attempt >= ladder.length) return null;
  const index = unloaded.length - 1 - ladder[attempt]!;
  return index >= 0 ? unloaded[index]! : null;
}

/** How many attempts the ladder above is worth before the caller stops and says so. */
export const HISTORY_STEP_ATTEMPTS = 4;

/**
 * What a load of older history can be said to have achieved — and, honestly, what it cannot.
 *
 * The host's loader resolves without doing anything in several cases: `hasMore` false, its own re-entrancy flag still set,
 * or a generation that moved on so the page was dropped. Distinguishing "the page landed" from "the page was dropped"
 * needs the window's oldest sequence, and the session snapshot does not carry it (`hasMore`, `loadingOlder` and `openState`
 * are all it offers), so both proxies that were tried lied: a count of loaded turns (the host's turn navigation is
 * windowed, so a successful load left it unchanged) and `baseSeq` (not on the snapshot at all).
 *
 * What is left is only what the host STATES: with `hasMore` false there is certainly nothing older, and with it true
 * something older exists and this call did not settle whether it arrived. The caller therefore reveals unconditionally —
 * revealing costs nothing when nothing arrived — and says 「已经是最早」 only in the certain case.
 */
export function olderHistoryState(hasMore: boolean): 'exhausted' | 'more' {
  return hasMore ? 'more' : 'exhausted';
}
