/** Transitions.dev Reasoning stream, adapted to appended content, never a loop. */
export const REASON_HOLD = 840;
export const REASON_STEP = 500;
/** Lines advanced per follow step; only {@link reasoningTarget} reads it. */
const REASON_LINES = 2;

/** How the reasoning card keeps up with what is being written into it. */
export type ReasoningFollowMode = 'auto' | 'latest' | 'manual';

/** The three rows the settings panel offers, in the order it offers them. */
export const REASONING_FOLLOW_MODES: readonly { id: ReasoningFollowMode; label: string }[] = [
  { id: 'auto', label: '自动滚动' },
  { id: 'latest', label: '跟随最新' },
  { id: 'manual', label: '手动滚动' },
];

/**
 * The stored mode, read defensively: only the two exact strings leave the reading pace behind.
 *
 * `auto` is the pace every reader has had so far (two lines per step), so anything unrecognised — a record written
 * before this choice existed — keeps it.
 */
export function reasoningFollowModeOf(value: unknown): ReasoningFollowMode {
  return value === 'latest' || value === 'manual' ? value : 'auto';
}

/**
 * Reading paces the panel offers, in lines per second.
 *
 * Presets rather than a slider: the pace is quantised by the step cadence anyway (see {@link stepLines}), so a
 * continuous control would promise a precision this mechanism does not have. `2` is the default and reproduces the
 * two-lines-per-step pace exactly.
 */
export const REASONING_RATES: readonly { id: number; label: string }[] = [
  { id: 1, label: '1 行/秒' },
  { id: 2, label: '2 行/秒（标准）' },
  { id: 3, label: '3 行/秒' },
  { id: 5, label: '5 行/秒' },
];

/** The stored pace, read defensively: anything off the list means the standard one. */
export function reasoningRateOf(value: unknown): number {
  return REASONING_RATES.some(entry => entry.id === value) ? (value as number) : 2;
}

/**
 * How many lines one step advances, given the reading pace.
 *
 * The card advances in WHOLE lines on a fixed cadence (`REASON_HOLD`), so a pace is realised by choosing the step
 * size, never by shortening the cadence: a step shorter than a line would leave the text crawling between two line
 * boxes. Rounding is what makes the standard pace (2 lines/second on an 840ms cadence) come out as exactly the two
 * lines this card has always advanced.
 */
export function stepLines(rate: number, holdMs = REASON_HOLD): number {
  return Math.max(1, Math.round(rate * holdMs / 1000));
}

export function reasoningTarget(top: number, contentHeight: number, viewportHeight: number, lineHeight: number, lines = REASON_LINES): number {
  const end = Math.max(0, contentHeight - viewportHeight);
  const current = Math.min(end, Math.max(0, top));
  // Receiving a burst changes the available transcript, never the step size.
  // Only the final, partial step may be shorter than the reference's two lines.
  return Math.min(end, current + Math.max(1, lineHeight) * Math.max(1, lines));
}
