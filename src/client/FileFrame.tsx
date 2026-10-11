import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** One column: a 240px host card, the 8px gap that follows it, and the 1px border of each end — so N columns are N × 248 − 6. */
const columnWidth = (columns: number): number => columns * 248 - 6;

/**
 * A frame around a message's file cards that CANNOT affect them, and that moves WITH them rather than a frame behind.
 *
 * The dead end, in one paragraph: a wrapping row decides how many cards fit from the width it is given, so a box that CONTAINS the row
 * changes that width and therefore the wrapping; and the frame cannot be the row's own border either, because the row is as wide as the
 * message cluster while its cards are packed to the RIGHT — the cards' left edge is not any element's edge, so no border can land there.
 *
 * The way out is a box that is NOT in the flow: an absolutely positioned overlay anchored to the row's right, top and bottom — three
 * edges the cards share with the row — with a width of whole columns. The column count is computed by the STYLESHEET, not by this file:
 *
 *     width: min(round(down, 100% + 8px, 248px) - 6px, calc(var(--file-cols) * 248px - 6px))
 *
 * `100%` is the width available to the overlay (its containing block is the row's parent), and `round()` floors it to a whole number of
 * 248px columns. Because LAYOUT does that arithmetic, the frame is the right width in the same paint as the cards — the earlier version
 * set the width from React state, which necessarily landed a frame later, and the reader both saw that (「框的变化略晚于卡片的变化」) and
 * asked for simultaneity, with a frame EARLIER as the fallback. `--file-cols` caps it at the file count and at three.
 *
 * The JavaScript below is only a fallback for an engine without `round()`, and it writes the width inline only in that case, so it can
 * never override the stylesheet. `z-index: -1` paints the plate behind the cards and `pointer-events: none` keeps it out of the way.
 */
export const FileFrame = memo(function FileFrame({ count, className, frameClassName, children }: {
  /** How many file cards are inside; the column count never exceeds it. */
  count: number;
  className: string;
  frameClassName: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [fallbackWidth, setFallbackWidth] = useState<number | null>(null);
  const columns = Math.min(count, 3);
  const needsFallback = typeof CSS === 'undefined' || !CSS.supports('width', 'round(down, 100%, 248px)');
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
  return <div ref={root} className={className} style={{ '--file-cols': String(columns) } as React.CSSProperties}>
    {children}
    <span
      aria-hidden="true"
      className={frameClassName}
      {...(needsFallback && fallbackWidth !== null ? { style: { width: `${String(fallbackWidth)}px` } } : {})}
    />
  </div>;
});
