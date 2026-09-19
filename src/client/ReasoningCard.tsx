import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { REASON_HOLD, REASON_STEP, reasoningTarget } from './reasoning-follow.js';
import css from './Reader.module.css';

const EASING = 'cubic-bezier(.22,1,.36,1)';

/** How long after the last wheel notch a gesture counts as finished. */
const WHEEL_IDLE_MS = 140;

/**
 * Split one notch between the card and the conversation.
 *
 * The wheel event is dispatched BEFORE the browser applies the scroll, so asking "is the card on
 * its edge right now" answers the wrong question: with 5px left, the notch looks like the card's
 * to take, the card is released to scroll them, and only the NEXT notch sees an edge and hands
 * over — the gesture sticks, then jumps. Ask instead what this notch would do: the card may keep
 * the part it can actually consume, and the remainder belongs to the conversation in the same
 * event.
 *
 * `consumed === 0` means the card is already on the edge the notch pushes against, and the browser
 * chains such a notch to the conversation on its own. `remainder === 0` means the notch fits in
 * the card. Only a notch that straddles the edge has to be split by hand.
 *
 * @returns `consumed` for the card (never more than the notch, never past a limit) and
 *          `remainder` for the conversation.
 */
export function splitNotch(
  scrollTop: number,
  delta: number,
  maxOffset: number,
): { consumed: number; remainder: number } {
  const projected = Math.min(maxOffset, Math.max(0, scrollTop + delta));
  const consumed = projected - scrollTop;
  return { consumed, remainder: delta - consumed };
}

/**
 * How small a remainder still counts as no remainder.
 *
 * Subpixel offsets mean a notch that lands exactly on the edge can leave a fraction behind. That
 * fraction is not worth splitting a whole notch over: the browser spends the notch on the card,
 * the card lands on its edge, and nothing perceptible is left over.
 */
export const REMAINDER_EPSILON_PX = 0.5;

/** One real transcript: reference transform while following, native scroll while reading. */
export function ReasoningCard({ children, step, active, motion, selected, onRead }: {
  children: ReactNode; step: number; active: boolean; motion: boolean; selected: boolean; onRead: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const controls = useId();
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(true);
  const [overflow, setOverflow] = useState(false);
  const [edges, setEdges] = useState('none');
  const lastHeight = useRef(0);
  const resize = useRef<Animation | null>(null);
  const previousExpanded = useRef(expanded);
  const stopFollow = useRef<() => void>(() => {});
  const allowed = following && active && motion && !selected;

  const pause = useCallback(() => {
    stopFollow.current();
    setFollowing(false);
    onRead();
  }, [onRead]);

  useLayoutEffect(() => {
    // The parent's selection observer can suspend this card before its own
    // listener runs. Clearing a selection must not silently resume following.
    if (!selected) return;
    stopFollow.current();
    setFollowing(false);
  }, [selected]);

  useLayoutEffect(() => {
    const port = viewport.current;
    const text = content.current;
    const scrollTrack = track.current;
    if (!port || !text || !scrollTrack) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextAt = performance.now() + REASON_HOLD;
    let alive = true;
    let automatic = false;
    let lastPainted = port.scrollTop;
    let targetOffset = lastPainted;
    const tail = () => Math.max(0, text.offsetHeight - port.clientHeight);
    const clamp = (value: number) => Math.max(0, Math.min(tail(), value));
    const paintedOffset = () => {
      if (!automatic) return port.scrollTop;
      const transform = getComputedStyle(scrollTrack).transform;
      // Reduced-motion CSS may win before React receives the media change.
      // Retain the last painted position rather than snapping back to the top.
      return clamp(transform === 'none' ? lastPainted : port.scrollTop - new DOMMatrixReadOnly(transform).m42);
    };
    const hasSelection = () => {
      const selection = document.getSelection();
      return !!selection && !selection.isCollapsed && !!selection.anchorNode && text.contains(selection.anchorNode);
    };
    const cancel = () => {
      cancelAnimationFrame(frame); frame = 0;
      clearTimeout(timer); timer = undefined;
      delete port.dataset.reasoningMoving;
    };
    const manual = () => {
      if (!automatic) return;
      const top = paintedOffset();
      automatic = false;
      scrollTrack.style.transition = 'none';
      scrollTrack.style.transform = 'none';
      // Set both in the same layout effect/event, before a frame can paint.
      // The first wheel gesture must already have a native scrollable viewport.
      port.style.overflow = 'auto';
      port.scrollTop = top;
      lastPainted = port.scrollTop;
      port.dataset.reasoningMode = 'manual';
    };
    const follow = () => {
      if (automatic) return;
      targetOffset = lastPainted = clamp(port.scrollTop);
      scrollTrack.style.transition = 'none';
      scrollTrack.style.transform = `translateY(-${lastPainted}px)`;
      port.scrollTop = 0;
      port.style.overflow = 'hidden';
      automatic = true;
      port.dataset.reasoningMode = 'transform';
    };
    const measure = (recordHeight = true) => {
      const previewHeight = parseFloat(getComputedStyle(port).getPropertyValue('--reason-preview-height'));
      setOverflow(text.offsetHeight > previewHeight + 1);
      lastPainted = paintedOffset();
      const top = lastPainted > 1;
      const bottom = tail() - lastPainted > 1;
      const next = top ? bottom ? 'both' : 'top' : bottom ? 'bottom' : 'none';
      setEdges(value => value === next ? value : next);
      if (recordHeight && !resize.current) lastHeight.current = port.clientHeight;
    };
    stopFollow.current = () => { cancel(); manual(); measure(false); };
    const canFollow = () => allowed && alive && !document.hidden && !hasSelection();
    const schedule = () => {
      if (!canFollow() || frame || timer !== undefined) return;
      follow();
      if (tail() - paintedOffset() < 1) return;
      timer = setTimeout(start, Math.max(0, nextAt - performance.now()));
    };
    const start = () => {
      timer = undefined;
      if (!canFollow()) return;
      const from = paintedOffset();
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 24;
      const target = reasoningTarget(from, text.offsetHeight, port.clientHeight, lineHeight);
      if (target - from < 1) return;
      const began = performance.now();
      nextAt = began + REASON_HOLD;
      targetOffset = target;
      // The supplied recipe: commit the start pose, then transition the track.
      // No per-frame scrollTop writes and no catch-up across unread lines.
      scrollTrack.style.transition = 'none';
      scrollTrack.style.transform = `translateY(-${from}px)`;
      void scrollTrack.offsetHeight;
      scrollTrack.style.transition = 'transform var(--reason-step) var(--reason-ease)';
      scrollTrack.style.transform = `translateY(-${target}px)`;
      port.dataset.reasoningMoving = 'true';
      port.dataset.reasoningFrom = String(from);
      port.dataset.reasoningTarget = String(target);
      port.dataset.reasoningBegan = String(began);
      const tick = (now: number) => {
        frame = 0;
        if (!canFollow()) { cancel(); manual(); return; }
        // Observe the browser's actual CSS interpolation for masks and handoff.
        measure();
        if (now - began < REASON_STEP || Math.abs(lastPainted - target) > .05) frame = requestAnimationFrame(tick);
        else { delete port.dataset.reasoningMoving; schedule(); }
      };
      frame = requestAnimationFrame(tick);
    };
    const onScroll = () => {
      // A wheel gesture owns the scroll position until it ends, and the browser
      // applies it natively. Measuring on every notch would set React state
      // (overflow / edges / data attributes) mid-gesture, and each re-render
      // interrupts the native scrolling — that is the stutter. Edges settle once
      // the gesture stops.
      if (Date.now() < wheelUntil) return;
      measure();
      // Focus/keyboard-induced native scroll wins even while the track moves.
      if (automatic && port.scrollTop > 1) pause();
    };
    // The card never writes its own scroll position: the browser scrolls the
    // overflow container natively, which keeps the same feel as the rest of the
    // page. This listener decides, per notch, whether the card can still use it —
    // judged from where the notch would land, not from where the card already is,
    // so the handoff happens on the notch that would overshoot instead of one
    // notch later.
    let wheelUntil = 0;
    let wheelTick = 0;
    const seenWheelEvents = new Set();
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      // Keep automatic following from dragging the scroll position mid-gesture.
      if (automatic) pause();
      wheelUntil = Date.now() + WHEEL_IDLE_MS;
      if (event.timeStamp !== undefined) {
        const key = `${String(event.timeStamp)}:${String(event.deltaY)}`;
        if (seenWheelEvents.has(key)) return;
        seenWheelEvents.add(key);
      } else {
        seenWheelEvents.add(`t:${String(wheelTick += 1)}`);
      }
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? parseFloat(getComputedStyle(text).lineHeight) || 24
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? port.clientHeight : 1;
      const delta = event.deltaY * unit;
      // A notch the card can use is left entirely to the browser: writing scrollTop on every
      // notch replaces a composited subpixel scroll with an integer jump, which is what made the
      // card step instead of glide. The only write is at a handoff, to land it on its edge.
      if (!overflow) return;
      if (!event.cancelable) return;
      const maxOffset = Math.max(0, port.scrollHeight - port.clientHeight);
      const { consumed, remainder } = splitNotch(port.scrollTop, delta, maxOffset);
      // Two notches are none of this handler's business, and taking them over is what made the
      // gesture jump.
      //
      //  - The card is already on its bottom edge, so the notch is not the card's at all. Left
      //    alone, the browser chains it to the conversation by itself and animates it exactly like
      //    every other wheel scroll. Intercepting it here replaced that with a programmatic
      //    scrollBy, which lands in a single frame — and it did so on every notch for as long as
      //    the pointer stayed over the card.
      if (consumed === 0) return;
      //  - The notch fits inside the card, so it is not the conversation's either; the browser
      //    scrolls the card natively.
      if (Math.abs(remainder) < REMAINDER_EPSILON_PX) return;
      // Only a notch that straddles the edge is split, because the browser would spend the whole
      // notch on the card and drop the rest. The card takes the pixels it still has and the
      // remainder walks up to the conversation in the same event, so a gesture that ends on the
      // edge never loses part of a notch and never needs one more notch to hand over.
      let host = port.parentElement;
      while (host && !host.hasAttribute('data-conversation-scroll')) host = host.parentElement;
      if (!host) return;
      event.preventDefault();
      port.scrollTop += consumed;
      host.scrollBy(0, remainder);
    };
    const onSelection = () => { if (hasSelection()) pause(); };
    const onVisibility = () => {
      cancel(); manual();
      nextAt = performance.now() + REASON_HOLD;
      if (!document.hidden) schedule();
    };
    const observer = new ResizeObserver(() => {
      if (automatic && targetOffset > tail() + 1) {
        cancel(); manual();
        nextAt = performance.now() + REASON_HOLD;
      }
      measure(); schedule();
    });
    observer.observe(text); observer.observe(port);
    port.addEventListener('scroll', onScroll, { passive: true });
    port.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('visibilitychange', onVisibility);
    // Keep the previous layout height until the resize effect can sample it.
    measure(false); schedule();
    return () => {
      alive = false; cancel(); manual(); observer.disconnect();
      seenWheelEvents.clear(); wheelUntil = 0;
      port.removeEventListener('scroll', onScroll); port.removeEventListener('wheel', onWheel);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('visibilitychange', onVisibility);
      stopFollow.current = () => {};
    };
  }, [allowed, pause, overflow]);

  useLayoutEffect(() => {
    const port = viewport.current;
    if (!port) return;
    const changed = expanded !== previousExpanded.current;
    previousExpanded.current = expanded;
    const from = resize.current ? port.clientHeight : lastHeight.current;
    resize.current?.cancel(); resize.current = null;
    port.style.maxHeight = ''; port.style.height = '';
    const target = port.clientHeight;
    if (!changed || !motion || from < 1 || Math.abs(target - from) < 1) {
      lastHeight.current = target;
      return;
    }
    // max-height otherwise clamps the very first collapse frame to the new cap.
    port.style.maxHeight = 'none';
    const animation = port.animate([{ height: `${from}px` }, { height: `${target}px` }], { duration: 300, easing: EASING, fill: 'both' });
    resize.current = animation;
    animation.onfinish = () => {
      if (resize.current !== animation) return;
      resize.current = null; animation.cancel();
      port.style.maxHeight = ''; port.style.height = '';
      lastHeight.current = port.clientHeight;
    };
  }, [expanded, motion, selected]);
  useEffect(() => () => resize.current?.cancel(), []);

  const toggleReading = () => {
    // Resize the same transcript without changing follow intent or position.
    // Wheel, selection and viewport focus still explicitly pause following.
    onRead();
    setExpanded(value => !value);
  };

  return <div className={css.reasonCard} data-reader-reasoning-card data-reader-anchor data-expanded={expanded} data-following={allowed} data-overflow={overflow} data-ud-motion="reader-reasoning-size">
    <div className={css.reasonHeading} data-reader-reasoning-heading data-ud-check="reasoning-identity">
      <span className={css.reasonLabel} data-reader-reasoning-label>思考</span>
      <span>步骤 {step}</span>
    </div>
    <div ref={viewport} id={controls} className={css.reasonViewport} data-reader-reasoning-scroll data-edges={edges}
      data-ud-motion="reader-reasoning-scroll" role="region" aria-label={`步骤 ${step} 的思考${overflow ? '，可滚动阅读' : ''}`}
      tabIndex={overflow ? 0 : undefined} onPointerDown={pause} onFocus={pause}>
      <div ref={track} className={css.reasonTrack} data-reader-reasoning-track>
        <div ref={content} className={css.reasonText} data-reader-reasoning-text>{children}</div>
      </div>
    </div>
    {(overflow || expanded) && <div className={css.reasonFooter} data-ud-check="reasoning-controls">
      {active && motion ? <button type="button" className={css.reasonAction} disabled={selected} aria-controls={controls}
        aria-label={following ? '暂停自动跟随思考' : '继续跟随最新思考'}
        title={selected ? '取消文字选择后可继续跟随' : undefined}
        onClick={() => { if (following) pause(); else { onRead(); setFollowing(true); } }}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">{following ? <path d="M5.5 4v8m5-8v8" /> : <path d="M8 3v10m-4-4 4 4 4-4" />}</svg>
        {following ? '暂停跟随' : '跟随最新'}
      </button> : <span className={css.reasonCaption}>{expanded ? '手动阅读' : '可滚动阅读'}</span>}
      <button type="button" className={css.reasonAction} aria-expanded={expanded} aria-controls={controls}
        aria-label={expanded ? '收起完整思考' : '展开阅读完整思考'} onClick={toggleReading}>
        {expanded ? '收起' : '展开阅读'}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">{expanded ? <path d="m4 10 4-4 4 4" /> : <path d="m4 6 4 4 4-4" />}</svg>
      </button>
    </div>}
  </div>;
}
