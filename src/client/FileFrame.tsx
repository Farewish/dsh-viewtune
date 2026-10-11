import { memo, type ReactNode } from 'react';

/** One column: a 240px host card plus the 8px gap that follows it, less the gap the last column does not have, plus the border. */
const columnWidth = (columns: number): number => columns * 248 - 8 + 2;

/**
 * A frame around a message's file cards that CANNOT affect them.
 *
 * The dead end, in one paragraph: a wrapping row decides how many cards fit from the width it is given, so a box that CONTAINS the row
 * changes that width and therefore the wrapping; and the frame cannot simply be the row's own border, because the row is as wide as the
 * message cluster while its cards are packed to the right — the cards' left edge is not any element's edge, so no border can land on it.
 * Measuring where the cards ended up works but lags a frame behind, which the reader rejected.
 *
 * The way out is a box that is NOT in the flow. This renders the host's row untouched and then an absolutely positioned overlay anchored
 * to the row's right, top and bottom — three edges the cards share with the row, because the row packs them to the right — and gives it a
 * width the component already knows: the number of columns the file count asks for (one, two or three), 248px each. Nothing is measured,
 * so nothing lags; the overlay is out of flow, so no card moves, resizes or wraps differently; and `max-width: 100%` keeps it inside the
 * cluster when three columns would be wider than the message.
 */
export const FileFrame = memo(function FileFrame({ count, className, frameClassName, children }: {
  /** How many file cards are inside, which is what the frame's width is derived from. */
  count: number;
  className: string;
  frameClassName: string;
  children: ReactNode;
}) {
  return <div className={className}>
    {children}
    <span aria-hidden="true" className={frameClassName} style={{ width: `${String(columnWidth(Math.min(count, 3)))}px` }} />
  </div>;
});
