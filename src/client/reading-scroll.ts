/**
 * When the reading view follows the tail, and when a wheel says the reader is driving.
 *
 * Pure, and in a module of its own for two reasons: these are the follower's POLICY — the DOM work lives in
 * `motion.tsx`, which imports a stylesheet and therefore cannot be imported by a test — and both rules were reported
 * through their effects rather than as rules, so they are worth stating where they can be read on their own.
 */

/** How close to the tail counts as "the reader is at the bottom". */
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
