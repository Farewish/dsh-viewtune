import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import css from './Reader.module.css';

/** One row of the clip: the head spacer plus a single 64px card. More content than this means the cards wrap. */
const ONE_ROW_PX = 76;

/** One column: a 240px host card, the 8px gap after it, and the 1px border of each end — so N columns are N × 248 − 6. */
const columnWidth = (columns: number): number => columns * 248 - 6;

/**
 * A frame around a message's sent files that cannot affect them, with a collapse control beside its label.
 *
 * THE FRAME. A wrapping row decides how many cards fit from the width it is given, so a box that CONTAINS the row changes that width and
 * therefore the wrapping; and the frame cannot be the row's own border either, because the row is as wide as the message cluster while the
 * cards are packed to the RIGHT — the cards' left edge is not any element's edge. The way out is a box that is NOT in the flow: an
 * absolutely positioned plate anchored to the row's right, top and bottom, with a width of whole columns. The column count is computed by
 * the STYLESHEET — `round(down, 100% + 8px, 248px)`, floored by `--file-cols` — so layout, not a script, decides it and the plate is the
 * right width in the SAME PAINT as the cards. The label and the collapse control are CHILDREN of that plate, so the plate's own box places
 * them: no second copy of the geometry, and nothing drifts when the reading column changes width.
 *
 * THE COLLAPSE clips a box that holds the spacer and the host's row — the plate is anchored to that same box, so it ends where the visible
 * row ends. The clip box, not the wrapper, is `position: relative`, which is what makes the plate follow the collapsed height.
 *
 * The JavaScript below is only a fallback for an engine without `round()`, and it writes the width inline only then, so it can never
 * override the stylesheet.
 */
export const FileFrame = memo(function FileFrame({ count, className, clipClassName, frameClassName, surfaceClassName, titleClassName, children }: {
  /** How many file cards are inside; the column count never exceeds it, and one row is shown until expanded. */
  count: number;
  className: string;
  clipClassName: string;
  frameClassName: string;
  /** Shares the plate's geometry for the label row; kept separate so the label is not painted behind the cards with the plate. */
  surfaceClassName: string;
  titleClassName: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  /** The clip's unclipped content height, so the expand/collapse can animate to a real value. */
  const [full, setFull] = useState<number | null>(null);
  /** Whether the cards need more than the one row the collapse shows — the only case that needs a control. */
  const [wraps, setWraps] = useState(false);
  const [open, setOpen] = useState(false);
  const [fallbackWidth, setFallbackWidth] = useState<number | null>(null);
  const columns = Math.min(count, 3);
  const needsFallback = typeof CSS === 'undefined' || !CSS.supports('width', 'round(down, 100%, 248px)');
  useLayoutEffect(() => {
    // `scrollHeight` is the content height even while the box is clipped, which is exactly the value the transition needs to travel to;
    // a huge `max-height` instead would make the animation reach the content almost immediately and look instant.
    const el = clip.current;
    if (!el) return;
    const measure = (): void => {
      setFull(el.scrollHeight);
      // The clip holds the head spacer plus the cards, so anything taller than one row has wrapped. That is exactly when a control is
      // worth showing, and it costs no extra measurement: this box is already observed.
      setWraps(el.scrollHeight > ONE_ROW_PX);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { measure(); });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [count, open]);

  useLayoutEffect(() => {
    if (!needsFallback) return;
    const el = root.current;
    if (!el) return;
    const measure = (): void => {
      const fits = Math.max(1, Math.floor((el.clientWidth + 8) / 248));
      setFallbackWidth(columnWidth(Math.min(columns, fits)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { measure(); });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [columns, needsFallback]);
  return <div
    ref={root}
    className={className}
    data-open={open ? 'true' : 'false'}
    style={{ '--file-cols': String(columns), ...(full === null ? {} : { '--frame-full': `${String(full)}px` }) } as React.CSSProperties}
  >
    {/* The clip box holds ONLY the spacer and the host's row: the plate is its SIBLING, because `overflow: hidden` on the box that
        contained the plate clipped the plate on all four sides (it deliberately overhangs the row by its padding). The wrapper still hugs
        the clip's height, so the plate — anchored to the wrapper — ends exactly where the visible row ends. */}
    <div ref={clip} className={clipClassName}>
      <span className={css.fileFrameHead} aria-hidden="true" />
      {children}
    </div>
    {/* The plate draws the surface BEHIND the cards (`z-index: -1`), so the label and the control must not live inside it — they would be
        painted behind the cards with it and disappear. They sit in a second overlay that shares the plate's geometry through one rule
        (`frameClassName` and `surfaceClassName` are selected together), so there is still no second copy of the arithmetic. */}
    <span
      className={frameClassName}
      {...(needsFallback && fallbackWidth !== null ? { style: { width: `${String(fallbackWidth)}px` } } : {})}
    />
    <span className={surfaceClassName}>
      <span className={titleClassName}>附件</span>
      {wraps && <button
        type="button"
        className={`${css.deliverablesToggle} ${css.fileFrameToggle}`}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value); }}
      >
        {open ? '收起' : '展开'}
      </button>}
    </span>
  </div>;
});
