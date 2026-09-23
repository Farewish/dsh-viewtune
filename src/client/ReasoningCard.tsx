import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { REASON_HOLD, REASON_STEP, reasoningTarget, stepLines } from './reasoning-follow.js';
import type { ReasoningFollowMode } from './reasoning-follow.js';
import css from './Reader.module.css';

const EASING = 'cubic-bezier(.22,1,.36,1)';

/** How long after the last wheel notch a gesture counts as finished. */
const WHEEL_IDLE_MS = 140;

/** One real transcript: reference transform while following, native scroll while reading. */
export function ReasoningCard({ children, step, active, motion, selected, onRead, reasoningMode, rate }: {
  children: ReactNode; step: number; active: boolean; motion: boolean; selected: boolean; onRead: () => void;
  reasoningMode: ReasoningFollowMode; rate: number;
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
  const allowed = following && active && motion && !selected && reasoningMode !== 'manual';

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
    /**
     * The translateY a computed transform is painting, in pixels.
     *
     * The value has to come from `getComputedStyle` — only the browser knows where its own interpolation is — but it does
     * not need a `DOMMatrixReadOnly` object built for it sixty times a second. A 2D `matrix(a, b, c, d, tx, ty)` carries
     * the translation as its fifth and sixth numbers; anything else (a `matrix3d`, which a 2D translate never produces
     * here) falls back to the DOM API rather than guessing.
     */
    const translateYOf = (transform: string): number => {
      if (!transform.startsWith('matrix(')) return transform.startsWith('matrix3d(') ? new DOMMatrixReadOnly(transform).m42 : 0;
      const numbers = transform.slice(7, -1).split(',').map(Number);
      return numbers.length === 6 && numbers.every(Number.isFinite) ? numbers[5]! : 0;
    };
    const paintedOffset = () => {
      if (!automatic) return port.scrollTop;
      const transform = getComputedStyle(scrollTrack).transform;
      // Reduced-motion CSS may win before React receives the media change.
      // Retain the last painted position rather than snapping back to the top.
      return clamp(transform === 'none' ? lastPainted : port.scrollTop - translateYOf(transform));
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
    /**
     * The card's own measurements, and the one thing that is cached across the animation.
     *
     * `--reason-preview-height` is a layout constant of this card (the stylesheet resets it for a narrow container), so
     * reading it is a style recalculation for a number that only changes when the card is resized. `recordHeight` says
     * which kind of call this is: the measuring ones (a resize, a mode change) re-read it, and the animation's
     * per-frame calls reuse the cached value. That per-frame read was one of the two style reads this loop made sixty
     * times a second while reasoning text streamed.
     */
    // Read once at setup: the animation's per-frame calls must never be the first to look at it, or the overflow
    // comparison below would run against a zero.
    let previewHeight = parseFloat(getComputedStyle(port).getPropertyValue('--reason-preview-height'));
    /**
     * The last values handed to React, so an unchanged frame calls neither setter.
     *
     * React already bails out of re-rendering when a state update carries the value it holds, but the update is still
     * scheduled and the component is still rendered once to discover that. The animation calls this every frame for
     * values that only change when a fade starts or stops, so the comparison is made here instead: the rendered result
     * is identical (both states are only ever written from this function) and a streaming card stops offering React
     * one or two renders per frame.
     */
    let lastOverflow = false;
    let lastEdges = 'none';
    const measure = (recordHeight = true) => {
      if (recordHeight) previewHeight = parseFloat(getComputedStyle(port).getPropertyValue('--reason-preview-height'));
      const overflowing = text.offsetHeight > previewHeight + 1;
      if (overflowing !== lastOverflow) { lastOverflow = overflowing; setOverflow(overflowing); }
      lastPainted = paintedOffset();
      const top = lastPainted > 1;
      const bottom = tail() - lastPainted > 1;
      const next = top ? bottom ? 'both' : 'top' : bottom ? 'bottom' : 'none';
      if (next !== lastEdges) { lastEdges = next; setEdges(next); }
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
      // The mode only decides what this step aims at: the reading pace (so many whole lines), the newest line, or —
      // never, because `allowed` is false for it — nothing at all. Nothing else about a step changes, so takeover,
      // the fades and the handoff behave identically in all three.
      const target = reasoningMode === 'latest'
        ? Math.max(0, text.offsetHeight - port.clientHeight)
        : reasoningTarget(from, text.offsetHeight, port.clientHeight, lineHeight, stepLines(rate));
      if (target - from < 1) return;
      const began = performance.now();
      nextAt = began + REASON_HOLD;
      targetOffset = target;
      /**
       * Can this step still change either fade?
       *
       * A step is only worth OBSERVING on the frames where an edge can move. `measure` reads the track's interpolated
       * transform and the content's height — a style read and two layout reads — and while text is streaming the
       * layout it reads is dirty, so each of those can force a fresh layout. Both fades are decided by where the
       * painted offset sits, and the offset travels monotonically from `from` to `target`: if the two ends agree
       * about the top edge (is the card scrolled off it) and about the bottom one (is there more below), no frame in
       * between can disagree, and the state `measure` would publish is the one already on screen. `tail()` is
       * re-read here rather than captured, so text that grew during the step is still accounted for.
       */
      const edgesMayMove = () => {
        const limit = tail();
        return (from > 1) !== (target > 1) || (limit - from > 1) !== (limit - target > 1);
      };
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
        const done = now - began >= REASON_STEP;
        // Observe the browser's actual CSS interpolation for masks and handoff. The last frame always measures, which
        // is what leaves the recorded painted offset on the step's target; the frames in between skip it when the
        // answer cannot differ (see `edgesMayMove`).
        if (done || edgesMayMove()) measure(false);
        else lastPainted = target;
        if (!done) frame = requestAnimationFrame(tick);
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
    // No notch is ever taken away from the browser, and the card's position is never written by
    // script. The browser alone decides what a notch does:
    //
    //   - it scrolls this card's overflow container natively;
    //   - it drops whatever part of the notch that container cannot take (a wheel over the card is
    //     latched to the card's scroll node, and the browser chains the leftover only when the card
    //     cannot move at all);
    //   - once the card is on its edge, it chains the whole notch up to the conversation, animated
    //     exactly like any other wheel scroll.
    //
    // Splitting the overshooting notch by hand does recover those last pixels, but a programmatic
    // scrollBy lands in a single frame where the browser's own scroll glides — and the leftover is
    // at most one notch — so the pixels are not worth a visible step.
    let wheelUntil = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      // Keep automatic following from dragging the scroll position mid-gesture.
      if (automatic) pause();
      wheelUntil = Date.now() + WHEEL_IDLE_MS;
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
    // Not passive on purpose: the browser has to wait for this handler before it applies the
    // notch, so the scroll events that notch produces see wheelUntil already set and stay out of
    // React state. A passive listener would let the scroll land first.
    port.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('visibilitychange', onVisibility);
    // Keep the previous layout height until the resize effect can sample it.
    measure(false); schedule();
    return () => {
      alive = false; cancel(); manual(); observer.disconnect();
      wheelUntil = 0;
      port.removeEventListener('scroll', onScroll); port.removeEventListener('wheel', onWheel);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('visibilitychange', onVisibility);
      stopFollow.current = () => {};
    };
  }, [allowed, pause, reasoningMode, rate]);

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
    // `fill: 'both'` holds the height this animation started from, and the `max-height: none`
    // above is what lets the first frame collapse at all. An animation that never reaches
    // `onfinish` leaves the card pinned at its old height with that override still in place — the
    // size toggle looks dead — so the deadline commits the resize and clears the override. The
    // 240ms of slack past the animation's own duration is upstream 0.2.0's.
    let settled = false;
    const settle = () => {
      if (settled || resize.current !== animation) return;
      settled = true;
      resize.current = null; animation.cancel();
      port.style.maxHeight = ''; port.style.height = '';
      lastHeight.current = port.clientHeight;
    };
    animation.onfinish = settle;
    const deadline = window.setTimeout(settle, 300 + 240);
    return () => { window.clearTimeout(deadline); };
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
