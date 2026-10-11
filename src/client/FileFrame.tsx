import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** One column: a 240px host card plus the 8px gap that follows it. */
const COLUMN_PX = 248;
/** What the frame adds around its columns: one gap it does not need, and the 1px border on each side. */
const FRAME_CHROME_PX = 2;

/**
 * The frame around one message's sent files, sized so that its border lands ON the cards' outer edge.
 *
 * WHY A MEASUREMENT IS UNAVOIDABLE HERE, after four failed attempts at the same arithmetic. The frame hugs the cards only when its
 * width is a whole number of 248px columns, and how many fit is a property of the width AVAILABLE to it. Two things made that hard:
 *
 *  - the available width is the user CLUSTER the host wraps around a message (`min(chat width × 0.702, 82%)`), not the window and not
 *    the reading column. Sizing the frame from the column did nothing at all, because the cluster clamped it back to its own width —
 *    the reader measured exactly that: a 566px frame holding two columns of 240px cards, so 78px of empty frame sat to their left.
 *  - a ResizeObserver callback can read a width mid-resize. Measuring two frames later reads the settled value, which is the
 *    difference between a frame that follows the window and one that only corrects itself on reload.
 *
 * So: measure the cluster, take the columns that fit (one, two or three, never more than there are files), and give the frame that
 * many columns as a LENGTH. Its border then sits on the cards, and it cannot exceed the cluster it lives in.
 */
export const FileFrame = memo(function FileFrame({ count, className, children }: {
  /** How many file cards are inside, which caps the column count. */
  count: number;
  className: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const el = root.current;
    // The frame's parent IS the cluster, which is the width actually available to it.
    const cluster = el?.parentElement;
    if (!el || !cluster) return;
    const measure = (): void => {
      const fits = Math.max(1, Math.floor((cluster.clientWidth + 8) / COLUMN_PX));
      const next = Math.min(count, 3, fits);
      setColumns(previous => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // Read the cluster once this resize has settled; a callback can otherwise catch it mid-drag and keep that value.
      if (typeof requestAnimationFrame !== 'function') { measure(); return; }
      requestAnimationFrame(() => { requestAnimationFrame(() => { measure(); }); });
    });
    observer.observe(cluster);
    return () => { observer.disconnect(); };
  }, [count]);
  return <div ref={root} className={className} style={{ width: `${String(columns * COLUMN_PX - 8 + FRAME_CHROME_PX)}px` }}>{children}</div>;
});
