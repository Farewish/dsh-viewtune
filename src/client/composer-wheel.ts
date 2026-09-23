/**
 * The wheel over the input stays out of the transcript.
 *
 * The composer belongs to the host, so this is installed from here rather than declared in a stylesheet of ours.
 *
 * WHY A LISTENER AND NOT `overscroll-behavior`. The declarative answer was tried first — `contain` on every element
 * the host's composer is built from — and it did nothing, twice. The reason is now known rather than guessed: the
 * element that actually scrolls the composer's text is `.uV2eYG_scroll`
 * (`max-height: var(--dsh-composer-text-max-height); overflow-y: auto`), a CSS-module name with no "composer" in it
 * and a per-build hash in front of it. There is nothing stable to write a selector against, while the listener needs
 * no name at all: it walks up from the event's own target. (An earlier attempt also pinned the lowercase
 * `_composer` substring while the host's editor is `_ComposerContentEditable`, so it matched nothing on top of that;
 * the selector here is the case-insensitive one and is only used to recognise the composer's EDGE.)
 *
 * The listener is on `window` in the CAPTURE phase — the outermost listener there is — and swallows the notch only
 * when the pointer is over the composer AND nothing inside it (the text scroller included, or any scrollable box
 * between the event's target and the composer's edge) can move in that direction. Both `preventDefault` (the
 * browser's own scroll, chaining included) and `stopPropagation` (a host handler that scrolls in script) are called,
 * because cancelling only the default action was a guess that did not hold. A field that still has somewhere to go
 * keeps scrolling normally until its end, which is what keeps a grown composer usable.
 */

/** The composer, matched case-INSENSITIVELY: the host writes `_composerSeat` and `_ComposerContentEditable`, and
 *  pinning one casing is how two earlier attempts failed silently. Used as the EDGE of the search, not as the
 *  scroller — the scroller's own name is not knowable from here. */
const COMPOSER = '[class*="composer" i]';

/**
 * Whether an element with this geometry can take a notch in this direction.
 *
 * Pure, and the one judgement the listener makes: upward needs room above, downward needs room below, and the
 * one-pixel slack absorbs sub-pixel scroll heights (a fractional `scrollHeight` at the end of a list otherwise reads
 * as "still scrollable" forever, which would let the gesture through exactly when it should be swallowed).
 */
export function canTakeNotch(deltaY: number, scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  if (deltaY < 0) return scrollTop > 0;
  if (deltaY > 0) return scrollTop + clientHeight < scrollHeight - 1;
  return false;
}

/** The nearest element at or above `node`, within `boundary`, that can take this notch. */
function scrollableFrom(node: Element, deltaY: number, boundary: Element, view: Window): Element | null {
  for (let at: Element | null = node; at !== null; at = at.parentElement) {
    const overflowY = view.getComputedStyle(at).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      if (canTakeNotch(deltaY, at.scrollTop, at.clientHeight, at.scrollHeight)) return at;
    }
    if (at === boundary) break;
  }
  return null;
}

/** Swallow the notch when the pointer is over the composer and nothing in it can move. */
export function installComposerWheel(doc: Document): () => void {
  const view = doc.defaultView;
  if (view === null) return () => undefined;
  const onWheel = (event: WheelEvent): void => {
    const target = event.target;
    if (!(target instanceof view.Element)) return;
    const composer = target.closest(COMPOSER);
    if (composer === null) return;
    if (scrollableFrom(target, event.deltaY, composer, view) !== null) return;
    event.preventDefault();
    event.stopPropagation();
  };
  view.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => { view.removeEventListener('wheel', onWheel, { capture: true }); };
}
