import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** One column: a 240px host card, the 8px gap that follows it, and the 1px border of each end. */
const columnWidth = (columns: number): number => columns * 248 - 8 + 2;

/**
 * A frame around a message's file cards that CANNOT affect them.
 *
 * The dead end, in one paragraph: a wrapping row decides how many cards fit from the width it is given, so a box that CONTAINS the row
 * changes that width and therefore the wrapping; and the frame cannot be the row's own border either, because the row is as wide as the
 * message cluster while its cards are packed to the RIGHT — the cards' left edge is not any element's edge, so no border can land there.
 *
 * The way out is a box that is NOT in the flow. The host's row is rendered untouched and an absolutely positioned overlay is anchored to
 * the row's right, top and bottom — three edges the cards share with the row — while its width is a whole number of columns: how many of
 * 240px fit in the space available, capped by the file count and by three. `z-index: -1` paints it behind the cards, and
 * `pointer-events: none` keeps it out of the way entirely.
 *
 * The available width is read from this wrapper — the row's own parent, which the frame cannot influence because it is out of flow — so
 * the measurement cannot feed back into the cards and cannot lag: it happens in the same layout pass.
 */
export const FileFrame = memo(function FileFrame({ count, className, frameClassName, children }: {
  /** How many file cards are inside; the column count never exceeds it. */
  count: number;
  className: string;
  frameClassName: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = (): void => {
      const fits = Math.max(1, Math.floor((el.clientWidth + 8) / 248));
      const next = Math.min(count, 3, fits);
      setColumns(previous => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // Same-pass read where possible; a callback otherwise catches the width mid-drag and keeps that value.
      if (typeof requestAnimationFrame !== 'function') { measure(); return; }
      requestAnimationFrame(() => { requestAnimationFrame(() => { measure(); }); });
    });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [count]);
  return <div ref={root} className={className}>
    {children}
    <span aria-hidden="true" className={frameClassName} style={{ width: `${String(columnWidth(columns))}px` }} />
  </div>;
});
