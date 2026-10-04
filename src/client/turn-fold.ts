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
 * What one press of 「加载更早记录」 actually achieved — the outcome of a load whose failure mode is SILENCE.
 *
 * The host's loader resolves without doing anything in several cases: `hasMore` false, its own re-entrancy flag still set,
 * or a generation that moved on so the page was dropped. A resolve that changed nothing is indistinguishable from a load
 * that never ran, and the reader was left with a button that looked broken and nothing said. So the caller counts the
 * loaded turns before and after:
 *
 *   · more than before            → `progress`  (say nothing; the list grew)
 *   · no more, host says no more  → `exhausted` (the reader is at the earliest record)
 *   · no more, host says MORE     → `stuck`     (something above exists and did not arrive — worth naming, and retryable)
 *
 * The count rather than a sequence number, because it is the reader's own question: did anything new arrive? A page that
 * adds only messages inside a turn the reader already has is, from this control's point of view, no answer at all.
 */
export function loadOlderOutcome(before: number, after: number, hasMore: boolean): 'progress' | 'exhausted' | 'stuck' {
  if (after > before) return 'progress';
  return hasMore ? 'stuck' : 'exhausted';
}
