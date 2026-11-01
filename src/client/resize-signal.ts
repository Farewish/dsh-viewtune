/**
 * A counter for card resizes that the page follower must not mistake for the reader scrolling.
 *
 * The marker used to be read back out of the DOM (`querySelector('[data-reader-resizing]')`) on
 * every scroll event and every content resize; with no card resizing that walked the whole
 * transcript. The writer and the reader are both in this bundle, so a module counter carries the
 * same fact in O(1).
 */
let active = 0;

/**
 * Mark one reader-initiated card resize, returning its idempotent release.
 *
 * Nested resizes are counted: the page waits until the last one settles.
 */
export function beginReaderResize(): () => void {
  active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active = Math.max(0, active - 1);
  };
}

/** Whether any card is currently animating a reader-initiated resize. */
export function readerResizeActive(): boolean {
  return active > 0;
}
