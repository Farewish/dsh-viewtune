import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { REASON_HOLD, REASON_LATEST_STEP, REASON_STEP, reasoningTarget, stepLines } from './reasoning-follow.js';
import type { ReasoningFollowMode } from './reasoning-follow.js';
import { focusedHeight } from './focus-expand.js';
import { isNearTail } from './reading-scroll.js';
import css from './Reader.module.css';

const EASING = 'cubic-bezier(.22,1,.36,1)';

/** How long after the last wheel notch a gesture counts as finished. */
const WHEEL_IDLE_MS = 140;

/**
 * An upper bound on chasing a height transition.
 *
 * The stylesheet eases the focused card's height over 160ms (Reader.module.css), and the chase ends on reaching the
 * target — but a card whose content has outgrown the ceiling is asked for a height the browser will not give, so the
 * deadline is what ends that one. Comfortably past the transition, far below anything a reader could perceive as lag.
 */
const HEIGHT_CHASE_MS = 400;

/** One real transcript: reference transform while following, native scroll while reading. */
export function ReasoningCard({ children, step, active, motion, selected, onRead, reasoningMode, rate, focusExpand, focusKey, focused, onFocusChange }: {
  children: ReactNode; step: number; active: boolean; motion: boolean; selected: boolean; onRead: () => void;
  reasoningMode: ReasoningFollowMode; rate: number;
  focusExpand: boolean; focusKey: string; focused: boolean; onFocusChange: (key: string, focused: boolean) => void;
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
  /** The focus, readable from the frame loop's closure without putting it in that effect's dependencies. */
  const focusedRef = useRef(false);
  /** The ceiling the focus has published — what the card last ASKED to be. */
  const focusHeight = useRef(0);
  /**
   * What the card was actually RENDERED at, the last time it was written.
   *
   * The compensation below is the delta the browser applied, and the two are not the same number: the stylesheet caps
   * this box at `min(60vh, 560px)` (the ceiling 展开阅读 uses), so a card whose content has outgrown the ceiling keeps
   * being asked to grow while its rendered height stands still. Comparing the request with the request compensated the
   * scroll for height that never existed — a line of page movement per line of text that added no height, which is the
   * opposite of what the compensation is for. Seeded when the focus is granted, from the element itself.
   */
  const focusRendered = useRef(0);
  /**
   * When this card's OWN content last grew.
   *
   * The focus belongs to a card that is being written INTO, not to a card that merely sits in the step being written:
   * a mid-turn narration streams in the same step but outside this card, and while the focus was keyed on the step
   * alone it stayed held through that narration — which kept the page's tail-follow suspended, so the narration
   * arrived and the page did not follow it. Measuring this card's own growth is what tells the two apart.
   */
  const ownGrowthAt = useRef(performance.now());
  const lastOwnHeight = useRef(-1);
  const allowed = following && active && motion && !selected && reasoningMode !== 'manual';

  /**
   * The focus is REQUESTED here and granted above.
   *
   * Only one card can hold it, and the newest request wins — which is what the reader asked for: the card that is
   * being written into, or one that has just started, supersedes whatever held the focus before. A card asks when it
   * is the one being written into AND the reader is sitting at the bottom of the transcript, the moment
   * 「焦点思考展开」 specifies for a new determination. Losing the tail does NOT release it (a reader who scrolls up to
   * re-read must not watch the card shrink under them); what releases it is the reader taking the card over, the
   * reader asking for the full height with 展开阅读, or this card no longer being the one being written into — which is
   * EVERY mode, not only 跟随最新: it is the focus, not the height, that suspends the page's tail-follow. (跟随最新 is
   * the only mode that also folds the card back to its preview height; the release itself is not mode-specific — see
   * the effect below, which says the same thing where it is done.)
   */
  useEffect(() => {
    if (expanded || !focusExpand) return;
    if (focused) {
      // The focus ends when this card is no longer the one being written into — in EVERY mode. It is the focus, not the
      // height, that suspends the page's tail-follow, and a card that has finished thinking must not keep the page
      // pinned off the bottom until it unmounts: that is what made a reader who was plainly at the bottom see no
      // following at all, with 「回到最新」 as the only way back (it writes one scroll position; the suspension stayed).
      if (!following || !active) onFocusChange(focusKey, false);
      return;
    }
    if (!active || !following) return;
    const scroller = viewport.current?.closest<HTMLElement>('[data-conversation-scroll]');
    if (!scroller) return;
    const atTail = () => isNearTail(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
    /**
     * The determination is "the page is at the bottom", so it has to be re-asked whenever the page ARRIVES there —
     * not only when this card's own state changed.
     *
     * Sending a message is what made that plain: a new turn's header and the reader's own bubble are laid out before
     * the card has any text, so at the instant this card became the one being written the viewport was still catching
     * up and the question had a false answer — and since nothing about the CARD changed afterwards, it was never asked
     * again. That is exactly the shape of the report: the first thinking card of a turn never expanded while every
     * later one did. Watching the scroller is also what the rule says in as many words.
     */
    const request = () => { if (atTail()) onFocusChange(focusKey, true); };
    request();
    scroller.addEventListener('scroll', request, { passive: true });
    return () => scroller.removeEventListener('scroll', request);
  }, [expanded, focusExpand, focused, following, active, reasoningMode, focusKey, onFocusChange]);
  /**
   * The focus, in a LAYOUT effect, and the rendered height seeded with it.
   *
   * `focusedRef` is read by `measure`, which the port's own ResizeObserver calls — and the focus flip is exactly what
   * resizes that port (the preview ceiling gives way to `min(60vh, 560px)`), so the growth it causes can reach the
   * observer before a passive effect would have written the new value. That is the same ordering the page follower's
   * refs are written for. Seeding `focusRendered` here is the other half: the accounting of "what the browser actually
   * applied" has to start from the height the card already has, or the first write would claim the whole card as growth.
   */
  useLayoutEffect(() => {
    focusedRef.current = focused;
    if (focused) { focusRendered.current = viewport.current?.offsetHeight ?? 0; return; }
    focusHeight.current = 0;
    focusRendered.current = 0;
    viewport.current?.style.removeProperty('height');
  }, [focused]);
  // A card that unmounts while focused must hand the focus back, or the follower below would stay suspended forever.
  useEffect(() => () => { onFocusChange(focusKey, false); }, [focusKey, onFocusChange]);
  /**
   * The focus follows this card's OWN writing, not the step it happens to sit in.
   *
   * The request effect above cannot see growth: its dependencies are the card's states, and the whole point of the
   * distinction is that a sibling block can stream without changing any of them. So the focus is watched here instead,
   * against the timestamp `measure` keeps: a card that has not grown for a beat hands the focus back (the page follows
   * the narration, and keeps following), and one that starts growing again takes it back — still only while the page is
   * at the bottom, which is where a new determination is allowed to start. Cheap by construction: the timer is a third
   * of a second, so just over three checks a second, and only while this card is the one being written into. The beat
   * it waits for is `IDLE_MS`, twice the timer: a growth timestamp that has not moved for that long is a card that has
   * stopped being written into — and note that the timestamp only moves when this card's HEIGHT changes, so a card
   * still streaming inside one line of text reads as idle here. That is the intended trade: the focus exists to make
   * room for text that is arriving, and text that arrives without crossing a line has nothing to make room for.
   */
  useEffect(() => {
    if (!active || !following || expanded || !focusExpand) return;
    const IDLE_MS = 600;
    const check = window.setInterval(() => {
      const idle = performance.now() - ownGrowthAt.current > IDLE_MS;
      if (focused) {
        if (idle) onFocusChange(focusKey, false);
        return;
      }
      if (!idle) return;
      const scroller = viewport.current?.closest<HTMLElement>('[data-conversation-scroll]');
      if (scroller && isNearTail(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight)) onFocusChange(focusKey, true);
    }, 300);
    return () => window.clearInterval(check);
  }, [active, following, expanded, focusExpand, focused, focusKey, onFocusChange]);

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
    /** The line box, cached with the preview height and for the same reason: a focused card grows in whole lines. */
    let lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 24;
    let heightChase = 0;
    /**
     * Take the growth the browser has ACTUALLY applied out of the space above the card, and keep taking it while the
     * browser still owes some.
     *
     * With 逐帧滑行 the stylesheet eases the focused card's `height` (see the rule in Reader.module.css), so at the moment
     * of the write the height has not moved yet: one read would see no growth at all and the content below the card
     * would be pushed down and never pulled back. Charging the scroll the whole REQUESTED growth instead would lead the
     * box — the bottom edge would rise and then settle — which is why this is a chase rather than a one-shot read.
     * Untouched for 直接贴底, 动效关 and reduced motion: there the first read IS the target and nothing is scheduled.
     */
    const compensateHeight = (target: number): boolean => {
      const rendered = port.offsetHeight;
      const grew = rendered - focusRendered.current;
      focusRendered.current = rendered;
      if (grew > 0) {
        const scroller = port.closest<HTMLElement>('[data-conversation-scroll]');
        if (scroller !== null) scroller.scrollTop += grew;
      }
      return rendered === target;
    };
    const chaseHeight = (target: number): void => {
      cancelAnimationFrame(heightChase);
      heightChase = 0;
      if (compensateHeight(target)) return;
      // The deadline is what ends it when the stylesheet's ceiling clamps the target, so a card past `min(60vh, 560px)`
      // cannot leave a frame loop running for as long as it holds the focus.
      const deadline = performance.now() + HEIGHT_CHASE_MS;
      const step = (): void => {
        heightChase = 0;
        if (compensateHeight(target) || performance.now() > deadline) return;
        heightChase = requestAnimationFrame(step);
      };
      heightChase = requestAnimationFrame(step);
    };
    const measure = (recordHeight = true) => {
      if (recordHeight) {
        previewHeight = parseFloat(getComputedStyle(port).getPropertyValue('--reason-preview-height'));
        lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 24;
      }
      // Note the card's OWN growth (see ownGrowthAt): the height is already in hand, so this costs nothing.
      const ownHeight = text.offsetHeight;
      if (ownHeight !== lastOwnHeight.current) { lastOwnHeight.current = ownHeight; ownGrowthAt.current = performance.now(); }
      /**
       * 「焦点思考展开」 asks the stylesheet for a taller ceiling, in whole lines, while this card holds the focus.
       *
       * Only the CONTENT-side number is published here: the ceiling itself (`min(60vh, 560px)`) stays in the
       * stylesheet, where the viewport is known, so this loop needs no viewport arithmetic. Dropping the property is
       * what returns the card to its preview height — see the focus effect.
       */
      /**
       * 「焦点思考展开」 asks for a taller card while this one holds the focus — and asks for it from the space ABOVE.
       *
       * The card sits in the flow, so height added at the bottom pushes everything below it down: the line the reader
       * is watching, and the end of the transcript out of the viewport. That is not a cosmetic problem — it forces the
       * very scroll that breaks the next focus determination, which only starts while the page sits at the bottom.
       * Moving the conversation's own scroll by exactly the growth keeps the card's BOTTOM edge where it was and takes
       * the new height out of the space above it. This is safe only because the page's tail-follow is suspended while
       * a card holds the focus: nothing else is writing that scroll position. Where there is no room above, the
       * clamp leaves the write short and the card grows downward as it always did.
       *
       * The height is whole lines and INTENTIONAL rather than content-driven, which is what keeps the layout below this
       * card changing once per line instead of once per publication. What the compensation moves the scroll by, though,
       * is not the request but the RENDERED delta (see `focusRendered`): the request is allowed to run past the
       * stylesheet's ceiling, and charging the scroll for a height the browser refused is what walked the page upward
       * line by line once a long card was capped. The ceiling itself (min(60vh, 560px)) stays in the stylesheet, so
       * nothing here needs the viewport.
       */
      if (focusedRef.current) {
        const wanted = focusedHeight(text.offsetHeight, previewHeight, lineHeight);
        if (wanted !== focusHeight.current) {
          focusHeight.current = wanted;
          port.style.height = `${String(wanted)}px`;
          chaseHeight(wanted);
        }
      } else if (focusHeight.current !== 0 && !active && reasoningMode === 'latest') {
        // 跟随最新 is the one mode specified to fold back to the small card once the thinking ends. The other two KEEP the
        // height they grew to, and so does a card whose focus ended for any other reason — losing the tail, or the
        // reader taking it over — because shrinking a card under someone who is reading it is exactly what the
        // reader's rule 5 forbids. Dropping the property is what returns it, through the declared transition.
        focusHeight.current = 0;
        port.style.height = '';
      }
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
      // `lineHeight` is `measure`'s cached read, refreshed whenever the mode or the size changes. It used to be
      // re-read here under the same name, which shadowed the cache the note above it promises and gave the two copies
      // a chance to disagree after a resize.
      // The mode only decides what this step aims at: the reading pace (so many whole lines), the newest line, or —
      // never, because `allowed` is false for it — nothing at all. Nothing else about a step changes, so takeover,
      // the fades and the handoff behave identically in all three.
      const target = reasoningMode === 'latest'
        ? Math.max(0, text.offsetHeight - port.clientHeight)
        : reasoningTarget(from, text.offsetHeight, port.clientHeight, lineHeight, stepLines(rate));
      if (target - from < 1) return;
      const began = performance.now();
      // 跟随最新 is a continuous follow, the reading pace is a step every 840ms: see REASON_LATEST_STEP for why one
      // cadence cannot serve both. Everything else about a step — the pose commit, the tick, the fades, the handoff —
      // is the same either way.
      const step = reasoningMode === 'latest' ? REASON_LATEST_STEP : REASON_STEP;
      nextAt = began + (reasoningMode === 'latest' ? REASON_LATEST_STEP : REASON_HOLD);
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
      scrollTrack.style.transition = reasoningMode === 'latest' ? 'transform 180ms var(--reason-ease)' : 'transform var(--reason-step) var(--reason-ease)';
      scrollTrack.style.transform = `translateY(-${target}px)`;
      port.dataset.reasoningMoving = 'true';
      port.dataset.reasoningFrom = String(from);
      port.dataset.reasoningTarget = String(target);
      port.dataset.reasoningBegan = String(began);
      const tick = (now: number) => {
        frame = 0;
        if (!canFollow()) { cancel(); manual(); return; }
        const done = now - began >= step;
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
      cancelAnimationFrame(heightChase);
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

  return <div className={css.reasonCard} data-reader-reasoning-card data-reader-anchor data-expanded={expanded} data-focus={focused} data-following={allowed} data-overflow={overflow} data-ud-motion="reader-reasoning-size">
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
