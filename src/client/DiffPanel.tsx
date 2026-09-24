import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { DiffBlock, diffTotals } from '@deepseek-ai/dsh-client-ui-primitives';
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives';
import { diffBlockLabels } from './primitive-labels.js';
import { landTurn, scrollerOf } from './conversation-scroll.js';
import css from './Reader.module.css';

/** The disclosure's own motion language, so opening this reads as the same gesture. */
const EASING = 'cubic-bezier(.22,1,.36,1)';
const REVEAL_MS = 260;
/** Upstream's slack past the animation — the same rule the disclosure follows (see motion.tsx). */
const DEADLINE_SLACK_MS = 240;

/**
 * Reveals and withdraws its child by animating real height, in this view's motion language.
 *
 * Height rather than transform, because the panel pushes the transcript down and the reading scroll
 * measures that growth. Closing animates too, which is why the owner keeps the child mounted on an
 * `open` flag instead of unmounting it.
 *
 * Two differences from upstream 0.2.0's version. Upstream dispatches `reader-layout-start` /
 * `reader-layout-end` for its fold choreography to read; this fork has no choreography and nothing
 * listening, so those events are dropped rather than dispatched into the void. And upstream always
 * animates, while here the motion switch decides: with 动效 off the panel opens and closes in one
 * frame, like every other animation in this view.
 */
function Panel({ open, motion, children, onSettled, onClosed }: {
  open: boolean; motion: boolean; children: ReactNode;
  onSettled?: (element: HTMLElement) => void; onClosed: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const commit = () => {
      if (open) { element.style.height = 'auto'; element.style.overflow = 'visible'; onSettled?.(element); }
      else onClosed();
    };
    if (!motion || typeof element.animate !== 'function') { commit(); return; }
    const height = element.scrollHeight;
    const frames = open
      ? [{ height: '0px', opacity: 0, transform: 'translateY(-6px)' },
         { height: `${height}px`, opacity: 1, transform: 'translateY(0)' }]
      : [{ height: `${height}px`, opacity: 1 },
         { height: '0px', opacity: 0 }];
    const animation = element.animate(frames, { duration: REVEAL_MS, easing: EASING });
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      commit();
    };
    animation.onfinish = settle;
    // Without this an animation that never reaches `onfinish` leaves a closing panel mounted forever
    // and an opening one clipped to its first frame.
    const deadline = window.setTimeout(settle, REVEAL_MS + DEADLINE_SLACK_MS);
    return () => { window.clearTimeout(deadline); animation.cancel(); };
  }, [open, motion]);
  return <div ref={ref} className={css.diffOverlay}>{children}</div>;
}

/**
 * Keeps a newly opened panel on screen.
 *
 * Opening grows the row downward, so a badge near the fold reveals its card below the viewport and the reader has to
 * chase it. The card's head is brought to the reading line of the CONVERSATION scroller, through the same helper the
 * rail's jumps use, so "where does a row land" has one answer.
 *
 * It used to hunt for the nearest ancestor whose content is taller than its box, which is not the same question: an
 * `overflow: visible` ancestor passes that test and cannot scroll, so the write was a silent no-op and the card stayed
 * where it was with the reveal having "succeeded". Its fallback called `scrollIntoView`, which walks ancestor scrollers
 * and can lift the sticky composer off the bottom — the exact behaviour `conversation-scroll.ts` bans by name. A panel
 * already fully inside the viewport is left alone.
 */
function revealPanel(element: HTMLElement): void {
  const port = scrollerOf(element);
  const box = port.getBoundingClientRect();
  const head = element.getBoundingClientRect();
  if (head.top >= box.top && head.bottom <= box.bottom) return;
  landTurn(element, port);
}

/**
 * The changed-line counts, and the button that opens the diff surface.
 *
 * This half is small on purpose: it lives INSIDE the tool row, and the primitives' disclosure row is
 * a fixed 24px line with `overflow: hidden`. Only a single line of content can be there, so the
 * panel is a sibling of the row (see `DiffPanel`) rather than a child of it — putting the two halves
 * in one component rendered from the row's collapsed content is what clipped the first version of
 * this into a sliver.
 */
export function DiffStatButton({ hunks, label, open, onToggle }: {
  hunks: DiffHunk[]; label: string; open: boolean; onToggle: () => void;
}) {
  const totals = useMemo(() => diffTotals(hunks), [hunks]);
  if (hunks.length === 0) return null;
  /**
   * What these two numbers ARE, said in full rather than assumed.
   *
   * `diffTotals` counts the content lines of each SIDE — the whole old text and the whole new text — not the lines that
   * differ, so a one-line edit to a 812-line file reports 812 and 813. The badge keeps the familiar `+N/-M` shape, which
   * is also the host's own tool-row convention and reads correctly for a `write` (nothing on the old side); the label is
   * where the difference is stated, because `+N/-M` alone means "changed lines" to anyone who has used a diff view.
   */
  const description = `差异视图：新内容 ${String(totals.added)} 行、原内容 ${String(totals.removed)} 行`;
  return <span className={css.diffStatRoot}>
    <button type="button" className={css.diffStatButton} aria-expanded={open}
      aria-label={`${label} · ${description}`}
      title={`${description}（行数按两侧全文统计，不是最小差异的行数）`}
      onClick={event => {
        // The row itself is a disclosure; this click is about the diff, not about opening it.
        event.stopPropagation();
        onToggle();
      }}
      /**
       * …and the KEYBOARD path needs the same interception, which `stopPropagation` on the click does not give it.
       *
       * The host's row is a `role="button"` disclosure whose key handler does not look at `event.target`: Enter or Space
       * pressed on THIS button bubbles to the row, the row calls `preventDefault()`, and the browser's default
       * activation of the button is cancelled — so the diff panel could never be opened from the keyboard, and pressing
       * Enter folded the whole tool row instead. Stopping the bubble here (without `preventDefault`) leaves the button's
       * own activation intact: the row never sees the key, and the click it produces goes through the handler above.
       */
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}>
      <span className={css.diffCaret} aria-hidden>{open ? '\u25be' : '\u25b8'}</span>
      {totals.added > 0 && <span className={css.diffAdded}>+{totals.added}</span>}
      {totals.removed > 0 && <span className={css.diffRemoved}>-{totals.removed}</span>}
    </button>
  </span>;
}

/**
 * The diff surface: one changed file at a time, red removed / green added, through the same
 * `DiffBlock` the official tool row renders.
 *
 * Rendered beside the row — a sibling in the caller's flow, exactly where the detail panel goes —
 * because the flow cell clips: inside the row it would be a clipped sliver, and as a floating popup
 * the cell's `overflow: clip` would cut it off.
 */
export function DiffPanel({ hunks, open, active, motion, onActive, onClosed }: {
  hunks: DiffHunk[]; open: boolean; active: number; motion: boolean;
  onActive: (index: number) => void; onClosed: () => void;
}) {
  if (hunks.length === 0) return null;
  const current = hunks[Math.min(active, hunks.length - 1)]!;
  return <div className={css.diffOverlayRow}>
    <Panel open={open} motion={motion} onSettled={revealPanel} onClosed={onClosed}>
      {hunks.length > 1 && <div className={css.diffTabs}>
        {hunks.map((hunk, index) => <button key={`${hunk.path}:${String(index)}`} type="button"
          className={css.diffTab} data-active={index === active || undefined}
          onClick={() => onActive(index)} title={hunk.path}>
          {hunk.path.split(/[/\\]+/).filter(Boolean).slice(-1)[0] ?? hunk.path}
        </button>)}
      </div>}
      <div className={css.diffScrollArea}>
        <DiffBlock diffs={[current]} maxLines={36} labels={diffBlockLabels} />
      </div>
    </Panel>
  </div>;
}
