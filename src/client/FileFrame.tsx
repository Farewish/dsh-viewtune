import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A frame drawn AROUND the file cards without touching them: an absolutely positioned overlay, so the row and the cards keep exactly
 * the layout and behaviour the host gives them (the reader's ruling: 「我要的是一点点都不影响文件卡片的行为，只是在外观上加一个贴合的框
 * 而已」).
 *
 * Nothing here can move a card. The overlay is out of flow, and the only measurement taken is where the cards actually are: the first
 * card's left and top and the last card's right and bottom, relative to this wrapper. A box drawn around the cards' union is not
 * expressible in CSS — the row is as wide as the message cluster and packs its cards to the right, so the cards' outer edge is no
 * element's edge — which is why this reads their rects instead of styling a container.
 *
 * The overlay is redrawn when the row resizes (observed, two frames late so a mid-drag width is never kept) and when the card count
 * changes.
 */
export const FileFrame = memo(function FileFrame({ count, className, frameClassName, children }: {
  /** How many cards are inside; a change means the union box has to be measured again. */
  count: number;
  className: string;
  frameClassName: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    const row = el?.firstElementChild;
    if (!el || !(row instanceof HTMLElement)) return;
    const measure = (): void => {
      const cards = Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      const first = cards[0];
      const last = cards[cards.length - 1];
      if (first === undefined || last === undefined) { setBox(null); return; }
      const base = el.getBoundingClientRect();
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      setBox({ top: a.top - base.top, left: a.left - base.left, width: b.right - a.left, height: b.bottom - a.top });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // Read the cards once this resize has settled; a callback can otherwise catch them mid-drag and keep that value.
      if (typeof requestAnimationFrame !== 'function') { measure(); return; }
      requestAnimationFrame(() => { requestAnimationFrame(() => { measure(); }); });
    });
    observer.observe(row);
    for (const card of Array.from(row.children)) if (card instanceof HTMLElement) observer.observe(card);
    return () => { observer.disconnect(); };
  }, [count]);
  return <div ref={root} className={className}>
    {children}
    {box !== null && <span aria-hidden="true" className={frameClassName} style={{ top: `${String(box.top)}px`, left: `${String(box.left)}px`, width: `${String(box.width)}px`, height: `${String(box.height)}px` }} />}
  </div>;
});
