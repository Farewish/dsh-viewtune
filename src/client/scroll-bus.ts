/**
 * One passive `scroll` listener per scroller, fanning out inside one animation frame.
 *
 * The reader, the turn rail, and the reasoning card each reacted to the same conversation scroll.
 * Three listeners meant three layout reads per event, and two of them had their own rAF wrappers.
 * A scroller now owns one listener and one frame; subscribers run together, in registration order,
 * in that frame. A subscriber that throws cannot prevent the others from running.
 */
type ScrollCallback = () => void;

interface ScrollBus {
  readonly listeners: Set<ScrollCallback>;
  readonly onScroll: () => void;
  frame: number;
}

const buses = new WeakMap<EventTarget, ScrollBus>();

/** Schedule callback batches without requiring a DOM in tests or non-browser imports. */
const requestFrame = (callback: () => void): number => {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
};

const cancelFrame = (handle: number): void => {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
};

/**
 * Subscribe to a scroller's passive scroll event, batched to one callback per animation frame.
 *
 * @param scroller - the element that actually scrolls.
 * @param callback - runs once per frame while at least one scroll event arrived.
 * @returns an idempotent unsubscribe; the native listener is removed with the last subscriber.
 */
export function subscribeScroll(scroller: EventTarget, callback: ScrollCallback): () => void {
  let bus = buses.get(scroller);
  if (bus === undefined) {
    const listeners = new Set<ScrollCallback>();
    const created: ScrollBus = {
      listeners,
      frame: 0,
      onScroll: () => {
        if (created.frame !== 0) return;
        created.frame = requestFrame(() => {
          created.frame = 0;
          for (const listener of [...listeners]) {
            try {
              listener();
            } catch (error) {
              console.warn('[dsh-better-display] scroll subscriber failed:', error);
            }
          }
        });
      },
    };
    scroller.addEventListener('scroll', created.onScroll, { passive: true });
    buses.set(scroller, created);
    bus = created;
  }
  bus.listeners.add(callback);
  return () => {
    if (!bus.listeners.delete(callback)) return;
    if (bus.listeners.size > 0) return;
    scroller.removeEventListener('scroll', bus.onScroll);
    if (bus.frame !== 0) cancelFrame(bus.frame);
    bus.frame = 0;
    buses.delete(scroller);
  };
}
