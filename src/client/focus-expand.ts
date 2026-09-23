/**
 * How tall a FOCUSED reasoning card asks to be.
 *
 * 「焦点思考展开」 grows the card while it is the one being written into, up to the height the reader could reach with
 * 展开阅读. Two rules make that cheap enough to do while text streams:
 *
 * - The height is quantised to WHOLE lines. A card that grew on every publication would relayout everything below it
 *   on every one of them — a height is not a compositor property, unlike the transform this card glides with — while a
 *   reader perceives the growth by the line anyway. So the target only moves when the content crosses a line.
 * - The CAP is not decided here. The stylesheet owns it (`min(60vh, 560px)`, the same ceiling 展开阅读 uses) and this
 *   module only says what the content wants, so a viewport-relative ceiling stays where the viewport is known.
 *
 * Pure, and in a module of its own, because the quantisation is the whole decision and it is worth testing without a
 * DOM: the height must never fall below the preview the card already has, and never leave a partial line.
 */
export const FOCUS_MIN_LINES = 1;

/**
 * The height a focused card wants for its content.
 *
 * @param contentHeight - The scroll height of the reasoning text.
 * @param previewHeight - The card's own collapsed ceiling; the growth never goes below it (a card under focus that is
 * shorter than the preview must not SHRINK to its content).
 * @param lineHeight - One line, from the card's own computed style; heights are a multiple of it.
 * @returns A whole number of lines, at least the preview height. The caller clamps it to the stylesheet's ceiling.
 */
export function focusedHeight(contentHeight: number, previewHeight: number, lineHeight: number): number {
  const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 0;
  const content = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  const floor = Number.isFinite(previewHeight) ? Math.max(0, previewHeight) : 0;
  if (line === 0) return Math.max(floor, content);
  const lines = Math.max(FOCUS_MIN_LINES, Math.ceil(content / line));
  return Math.max(floor, lines * line);
}
