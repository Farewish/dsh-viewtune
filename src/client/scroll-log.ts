/**
 * TEMPORARY DIAGNOSTIC — who writes the transcript's scroll offset, and when.
 *
 * The reader reported the page shifting upward on its own after they take a reasoning card over, and two rounds of reading the
 * code produced two wrong fixes, so this exists to replace guessing with a log: every write this plugin makes to the
 * scroller's offset is recorded with its own label, the size of the move, the container's own metrics, and a stack (whose
 * frames name this plugin's built file and line numbers, which map back to the sources because the shipped artifact is
 * byte-identical to the built one).
 *
 * INERT BY DEFAULT: it writes nothing unless the page console has armed it —
 *
 *     localStorage.setItem('viewtune-scroll-log', '1')      // arm, then reproduce
 *     localStorage.removeItem('viewtune-scroll-log')        // disarm
 *
 * …and every call is wrapped, because the diagnostic the reader ran in the console took the page down with it: a diagnostic
 * that can break the thing it measures is worse than none. Removed again once the report is settled.
 */
export function logScroll(tag: string, el: Element | null, from: number, to: number): void {
  try {
    if (window.localStorage.getItem('viewtune-scroll-log') !== '1') return;
    const box = el?.getBoundingClientRect();
    const height = el instanceof HTMLElement ? el.scrollHeight : Number.NaN;
    console.log(
      `[vt-scroll] ${tag}`,
      `${String(Math.round(from))} -> ${String(Math.round(to))}`,
      `d=${String(Math.round(to - from))}`,
      `scrollH=${String(Math.round(height))}`,
      `band=${box === undefined ? '?' : `${String(Math.round(box.top))}..${String(Math.round(box.bottom))}`}`,
      (new Error().stack ?? '').split('\n').slice(2, 5).map(frame => frame.trim()).join('  <-  '),
    );
  } catch {
    // A diagnostic must never be able to break the page it is measuring.
  }
}
