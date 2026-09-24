/**
 * When the reading view follows the tail, and when a wheel says the reader is driving.
 *
 * Pure, and in a module of its own for two reasons: these are the follower's POLICY — the DOM work lives in
 * `motion.tsx`, which imports a stylesheet and therefore cannot be imported by a test — and both rules were reported
 * through their effects rather than as rules, so they are worth stating where they can be read on their own.
 */

/** How the follower catches up with the tail. */
export type FollowMode = 'glide' | 'snap';

/** The two rows the settings panel offers, in the order it offers them. */
export const FOLLOW_MODES: readonly { id: FollowMode; label: string }[] = [
  { id: 'glide', label: '逐帧滑行' },
  { id: 'snap', label: '直接贴底' },
];

/**
 * The stored value, read defensively: only the exact string asks for the snap.
 *
 * `glide` is what every reader has had so far, so an unrecognised value — a record written before the choice
 * existed — keeps it.
 */
export function followModeOf(value: unknown): FollowMode {
  return value === 'snap' ? 'snap' : 'glide';
}

/**
 * How close to the tail counts as "the reader is at the bottom".
 */
export const FOLLOW_TAIL_PX = 72;
/** A wheel has to move something to count as the reader taking over. */
export const WHEEL_EPSILON_PX = 0;

/**
 * Is the viewport close enough to the tail to keep auto-following?
 *
 * The gap is allowed to be negative: content shorter than the viewport has nothing to scroll and is at the bottom by
 * definition, and requiring a positive gap would leave a short conversation unfollowed.
 */
export function isNearTail(scrollTop: number, scrollHeight: number, clientHeight: number, tailPx = FOLLOW_TAIL_PX): boolean {
  return scrollHeight - scrollTop - clientHeight < tailPx;
}

/**
 * Does this wheel take scroll control away from auto-follow?
 *
 * ANY direction, not just upward. The listener sits on the conversation scroller, so it also sees wheels that bubbled
 * out of the reasoning card — and while the card is being scrolled it handles the wheel natively and lets the event
 * through. Treating only upward wheels as "the reader took over" left `following` true during a downward gesture; the
 * card keeps growing as the model streams, every growth re-armed the follow animation, and that animation wrote
 * scrollTop back toward the bottom each frame. The reader's own scroll fought the wheel and the page stepped instead
 * of gliding until the pointer left the card.
 *
 * The one wheel that is NOT a takeover is the one that cannot go anywhere — see `wheelAtBottom`, which is a separate
 * rule because it is about the scroller's position rather than the gesture.
 */
export function wheelClaimsScroll(deltaY: number, epsilon = WHEEL_EPSILON_PX): boolean {
  return Math.abs(deltaY) > epsilon;
}

/**
 * Is this the downward wheel that finds the scroller already at its tail?
 *
 * It has nothing left to take over, and calling it a takeover is what made the bottom of the reading page misbehave:
 * `following` went off for the instant of the notch, the next scroll event put it straight back, the 「回到最新」 pill
 * appeared and vanished with every one of them, and with content still arriving the two halves of the resize handler
 * wrote against each other — a pixel or two back and forth. A wheel further up the transcript is a real takeover even
 * when it points downward: parking short of the tail is something the reader is allowed to want.
 */
export function wheelAtBottom(deltaY: number, gap: number): boolean {
  return deltaY > 0 && gap < 1;
}

/**
 * The index of the first row for which `passes` returns true, or `rows.length` when none does.
 *
 * The predicate has to be monotone over the list — false, false, …, true — which is what a list of non-overlapping
 * block rows gives for both of the questions the reading view asks of them (has this row's bottom passed the line;
 * has this row's top passed it). Callers pass a predicate rather than a threshold so the same search serves both.
 *
 * Takes the rows rather than querying them, so a caller measures the same list it renders, and stays a plain function
 * over an array-like — the contract is `length` and indexing — so it can be tested without a DOM.
 */
export function firstRowWhere<T>(rows: ArrayLike<T>, passes: (row: T, index: number) => boolean): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (passes(rows[middle]!, middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * How far below the scrollport's own top edge the anchor's reading line sits, in pixels.
 *
 * Both readers of it (`capture`'s anchor and `currentTurnOf`) used to pass a bare `8` to a parameter named `slack`,
 * documented nowhere. Deliberately NOT the same number as `conversation-scroll.ts`'s `READING_LINE_OFFSET_PX` (24),
 * which is where a row is placed when something LANDS on it: this one only decides which row counts as "at the reading
 * line" for the spy and the anchor, and it is a small bias past the very top edge so a row whose bottom has just
 * crossed into the viewport counts as read rather than being missed by a sub-pixel. The two are separate names on
 * purpose — an earlier version of this one was called `READING_LINE_OFFSET_PX` too, which made two different lines
 * look like one.
 */
export const ANCHOR_LINE_OFFSET_PX = 8;

/**
 * The index of the first row whose bottom edge has passed a line, or `rows.length` when none has.
 *
 * Rows are in document order and block rows do not overlap, so their bottom edges increase down the list and the
 * first match can be found by bisection instead of by measuring every row. That matters because both callers run once
 * per scroll event and once per frame while the reader is reading: a measured build showed the two scans together
 * costing 10,000–16,000 `getBoundingClientRect` calls per second, and while a message streams the layout they read is
 * dirty, so every one of them can force a fresh layout.
 *
 * Monotonicity is the caller's premise, not something checked here: a row that is hidden, zero-height or out of order
 * makes the bisection return an index PAST a real match. Callers that need to survive that have to re-test rows
 * themselves from somewhere earlier — `currentTurnOf` re-tests forward from the index it gets, which covers the rows it
 * considers but cannot recover a match the bisection skipped.
 *
 * @param rows - The block rows in document order.
 * @param viewportTop - The scrollport's own top edge, in the same viewport coordinates as the rows' rects.
 * @param lineOffset - How far below that edge the reading line sits; see `ANCHOR_LINE_OFFSET_PX`.
 */
export function firstRowPastIndex(
  rows: ArrayLike<{ getBoundingClientRect(): { bottom: number } }>,
  viewportTop: number,
  lineOffset: number,
): number {
  const line = viewportTop + lineOffset;
  return firstRowWhere(rows, row => row.getBoundingClientRect().bottom > line);
}
