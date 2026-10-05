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

/**
 * How many consecutive frames of a still layout end the chase before its deadline.
 *
 * The deadline above is the backstop; this is the actual end for the case that motivated it. A card asked for a height
 * past the stylesheet's ceiling never reaches its target, so the equality test never fires and the whole 400ms is spent
 * reading layout every frame for a box that stopped moving after the first one. One or two still frames are normal at
 * the START of a transition (the style write has not been sampled yet); four is ~66ms, which no part of a 160ms ease
 * can spend without moving the integer `offsetHeight` unless there is less than a pixel left to move.
 */
const CHASE_STILL_FRAMES = 4;

/** One real transcript: reference transform while following, native scroll while reading. */
export function ReasoningCard({ children, step, active, motion, selected, onRead, reasoningMode, rate, focusExpand, fold, alignBottom, focusKey, focused, onFocusChange, onFocusPin, onLeaveTail, pageAtTail }: {
  children: ReactNode; step: number; active: boolean; motion: boolean; selected: boolean; onRead: () => void;
  reasoningMode: ReasoningFollowMode; rate: number;
  focusExpand: boolean; fold: boolean; focusKey: string; focused: boolean; onFocusChange: (key: string, focused: boolean) => void;
  /** Whether this card is PINNING the focus it holds — the reader is reading inside it (see the pin effect). */
  onFocusPin: (key: string, pinned: boolean) => void;
  /**
   * Leave the page's tail on the reader's behalf, when they close the card themselves.
   *
   * The page's follow is only SUSPENDED while a card holds the focus, so handing that focus back resumed it and snapped the
   * page to the newest line the instant 收起 was pressed — the reader's report. Closing the card one is reading is a
   * deliberate decision to stop following, exactly like a rail jump, so it takes the same release.
   */
  onLeaveTail: () => void;
  /** Whether opening this card also brings its BOTTOM to the composer's top — 「展开后底端对齐输入栏顶」, on by default. */
  alignBottom: boolean;
  /**
   * Whether the READER is still at the page's tail — the follower's own `detached`, inverted.
   *
   * Needed by the focus compensation and for nothing else, and it cannot be worked out here: this card's own
   * `following` tracks ITS inner scroller, so a wheel over the transcript moves the reader away without the card
   * ever noticing (see the compensation's gate).
   */
  pageAtTail: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  /**
   * The card's own root element, for the one attribute a reader-initiated resize publishes.
   *
   * Looked up from the viewport rather than held in a ref of its own: the root already carries
   * `data-reader-reasoning-card`, and one more ref would be one more thing this component can get wrong.
   */
  const cardRoot = (): HTMLElement | null => viewport.current?.closest<HTMLElement>('[data-reader-reasoning-card]') ?? null;
  const track = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const controls = useId();
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(true);
  const [overflow, setOverflow] = useState(false);
  const [edges, setEdges] = useState('none');
  const lastHeight = useRef(0);
  const resize = useRef<Animation | null>(null);
  /**
   * 「思考卡折叠成一行」: folded unless the reader opened THIS card or it is the one holding the focus. The two states that win
   * over the fold are the two the reader is looking at on purpose — the card they opened, and the card being written into —
   * so the fold never hides the content someone is actually reading. Nothing here is remembered: `expanded` is this
   * component's own state, so every remount starts folded. Declared here rather than at the render because it gates
   * `allowed` below as well: a folded card must not be driven by the follower, or the one visible line would be whichever
   * line the follower last scrolled to instead of the FIRST line, which is what the reader asked to see.
   */
  /**
   * 「思考卡折叠成一行」: folded unless the card is one the reader is looking at on purpose.
   *
   * FOUR reasons to stay open, and the fourth is what keeps 「焦点思考展开」 alive. `active` is the step the process is showing
   * as its newest (`processOpen && open && step === latestStep`), which is exactly the card that may CLAIM the focus — and
   * `folded` requires `!focused`, so a folded card could never claim it: with the request gated on `folded` the expansion
   * simply stopped working the moment the fold switch was on (the reader reported exactly that). Excluding `active` here
   * instead settles both ends at once: the card being written into is never folded, so it can take the focus as it always
   * did, while the COMPLETED cards of the same process — the ones the reader asked to fold — are folded and take no part in
   * the focus machinery at all, which is also what stopped the folded line from flickering.
   *
   * `expanded` is the reader having opened this card, and `focused` is the card holding the focus (including a card they
   * have taken over by reading inside it). Nothing here is remembered: `expanded` is this component's own state, so every
   * remount starts folded again.
   */
  const folded = fold && !expanded && !focused && !active;
  /**
   * The card's SIZE state, as the two things that change its viewport's height: the reader having opened it, and the fold to
   * one line. Both must animate, and the fold did not: this ref used to hold `expanded` alone, so a card that folded when the
   * focus ended switched to its one-line row in a single frame — the reader's 「由大卡片变为一行折叠没有动画」. A string,
   * because either can change while the other stays put. Declared after `folded` because it reads it.
   */
  const previousSize = useRef(`${String(expanded)}:${String(folded)}`);
  const stopFollow = useRef<() => void>(() => {});
  /**
   * The compensation, reachable from the effects outside the follower's own.
   *
   * The grant has to do two things BEFORE the browser paints — close the page's tail gap, and take the ceiling jump it
   * causes out of the space above the card — and the second one lives inside the follower's effect, whose closers are
   * not visible here. A ref is how this file already hands `stopFollow` out to the same kind of caller.
   */
  const compensateNow = useRef<() => void>(() => {});
  /** The focus, readable from the frame loop's closure without putting it in that effect's dependencies. */
  const focusedRef = useRef(false);
  /**
   * Whether the reader is still at the page's tail, readable from the same closures.
   *
   * A ref for the same reason `focusedRef` is one: the compensation runs from the observer's and the chase loop's
   * closures, which are not re-created when this prop changes. Seeded true, because a card that has not seen a scroll
   * event yet has not seen the reader leave — and the focus it is about to ask for requires being at the tail anyway.
   */
  const pageAtTailRef = useRef(true);
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
  // `motion` is deliberately NOT part of this. It decides HOW the card follows — a glide while the reader keeps 动效 on, a
  // direct jump to the newest line when they turn it off (the follow loop's own comment says exactly that: "动效关 … the
  // first read IS the target and nothing is scheduled"). Treating it as "the feature is off" is the bug the reader found:
  // they switched 动效 off to test scroll jank and 「跟随最新」 silently stopped working — and so did its own button below.
  // A cosmetic switch must not turn off a reading behaviour.
  const allowed = following && active && !selected && reasoningMode !== 'manual' && !folded;

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
      // …EXCEPT WHILE THE READER IS INSIDE THIS CARD. Taking its own scroller over (`!following`) used to be a
      // release; it is a PIN now, and that is the reader's own rule: scrolling inside a card is READING it, so the card
      // stays open under them, no newer card's request takes the focus away, and the idle beat below cannot end it
      // either (that effect returns early while the card is not following). Only the reader ends a pin — coming back to
      // the bottom of the page, or the 「回到最新」 pill, both of which the Reader watches for.
      if (following && !active) onFocusChange(focusKey, false);
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
    const request = () => { if (atTail()) { recordCardHeight(); onFocusChange(focusKey, true); } };
    request();
    scroller.addEventListener('scroll', request, { passive: true });
    return () => scroller.removeEventListener('scroll', request);
  }, [expanded, focusExpand, focused, following, active, reasoningMode, focusKey, onFocusChange]);
  /**
   * The card's height right now, recorded before the focus is REQUESTED.
   *
   * Granting the focus changes the viewport's ceiling in the same commit (`224px` → `min(60vh, 560px)`), so by the time
   * any effect of ours runs the card is already taller than it was — and the compensation, which reads the card, has to
   * be measuring against the height of the frame BEFORE that. Recording it here is the only place that value exists.
   */
  const recordCardHeight = useCallback((): void => {
    focusRendered.current = viewport.current?.closest<HTMLElement>('[data-reader-reasoning-card]')?.offsetHeight ?? 0;
  }, []);

  /**
   * The focus, in a LAYOUT effect, and the gap it hands back.
   *
   * `focusedRef` is read by `measure`, which the port's own ResizeObserver calls — and the focus flip is exactly what
   * resizes that port (the preview ceiling gives way to `min(60vh, 560px)`), so the growth it causes can reach the
   * observer before a passive effect would have written the new value. That is the same ordering the page follower's
   * refs are written for. `focusRendered` is deliberately NOT seeded here: the height to measure against is the one
   * recorded before the request (`recordCardHeight`), because this effect runs after the card has already grown.
   */
  useLayoutEffect(() => {
    focusedRef.current = focused;
    if (!focused) {
      focusHeight.current = 0;
      focusRendered.current = 0;
      const port = viewport.current;
      // The height the focus was holding, before the stylesheet's own ceiling takes over again.
      const from = port?.clientHeight ?? 0;
      if (resize.current !== null) { resize.current.cancel(); resize.current = null; }
      port?.style.removeProperty('height');
      /**
       * …and the shrink is ANIMATED, for the reader's report: after taking a card's focus over and scrolling to the bottom,
       * the page jumped upward by a fixed distance the moment the pin ended. What jumps is this: releasing the focus drops the
       * ceiling from `min(60vh, 560px)` back to the preview, the card loses that height in one frame, and the page — which is
       * sitting at its bottom — is carried up with it. Animating the same change lets the follower ride the height down frame
       * by frame instead, so the page slides rather than jumps. Gated on `motion` like every other size change here, and it
       * writes nothing when the card was already at its natural height.
       */
      const to = port?.clientHeight ?? 0;
      if (port !== null && port !== undefined && motion && from > 1 && Math.abs(to - from) >= 1) {
        port.style.maxHeight = 'none';
        const animation = port.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 300, easing: EASING, fill: 'both' });
        resize.current = animation;
        let settled = false;
        const settle = () => {
          if (settled || resize.current !== animation) return;
          settled = true;
          resize.current = null; animation.cancel();
          port.style.maxHeight = ''; port.style.height = '';
          lastHeight.current = port.clientHeight;
        };
        animation.onfinish = settle;
        window.setTimeout(settle, 300 + 240);
      }
      return;
    }
    /**
     * The frame the focus is granted: close the page's tail gap, then take the ceiling jump out of the space above.
     *
     * Both before paint, and both here rather than on the next measure, because the reader's report pins exactly this:
     * the card's bottom was cut off, no 「回到最新」 appeared, clicking that pill (which writes the maximum scroll
     * position) made the bottom "just exactly complete", and there was still room to scroll afterwards. That is the tail
     * GAP: the focus is only granted while the reader is within `isNearTail`'s 72px of the tail, the page's follow is
     * then suspended for as long as the card holds it, and nothing ever closed those pixels — so the card's bottom, the
     * reading row included, sat behind the composer's edge by up to that much. The grant is the one moment where closing
     * it is exactly what the reader asked for: they are at the bottom, by the precondition of this very call.
     */
    const scroller = viewport.current?.closest<HTMLElement>('[data-conversation-scroll]');
    if (scroller !== null && scroller !== undefined) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    // The card has already grown in this commit (the ceiling changed with the focus), and the height recorded before the
    // request is what that jump has to be measured against.
    //
    // RESTORED, after one attempt removed it. That attempt was aimed at a DIFFERENT report — the reader's 「展开本流程中已经
    // 完成的思考卡，靠上就向上长、靠下就向下长，应该统一向下」 — and the mechanism for THAT is the page's own scroll
    // anchoring (the reading view sets `overflow-anchor: none` and compensates itself), not this grant-time jump. Changing
    // this one only moved where a FOCUSED card's growth came from, which is not what was asked, so it is back as it was
    // until the real fix lands.
    compensateNow.current();
  }, [focused]);
  // A card that unmounts while focused must hand the focus back, or the follower below would stay suspended forever.
  useEffect(() => () => { onFocusChange(focusKey, false); }, [focusKey, onFocusChange]);
  /**
   * The reader's position on the page, in a LAYOUT effect like the focus above it.
   *
   * Read by the compensation, which the observer calls in the same commit as a growth — so this has to be current for
   * that commit rather than one paint later, exactly like `focusedRef`.
   */
  useLayoutEffect(() => { pageAtTailRef.current = pageAtTail; }, [pageAtTail]);
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
      if (scroller && isNearTail(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight)) { recordCardHeight(); onFocusChange(focusKey, true); }
    }, 300);
    return () => window.clearInterval(check);
  }, [active, following, expanded, focusExpand, focused, focusKey, onFocusChange]);

  /**
   * Publish the pin: the reader has taken THIS card's own scroller over while it holds the focus.
   *
   * The Reader needs it, because the focus is singular and its default rule is "the newest request wins" — which would
   * hand the focus to a newer card while the reader is reading inside this one, folding this card shut under them. A
   * pinned card refuses that, so the pin travels up beside the grant. Derived rather than stored: `focused &&
   * !following` is exactly "the reader is reading inside the card that holds the focus".
   */
  const pin = focused && !following;
  useEffect(() => { onFocusPin(focusKey, pin); }, [pin, focusKey, onFocusPin]);
  /**
   * …and while the reader is INSIDE this card, the PAGE stops following them too.
   *
   * Reading inside a card is a decision to hold this place, so the page must stay where they put it. Without this the page
   * was still following, and every change to the card's height was absorbed by snapping the page to its bottom: the reader
   * scrolled down, the pin ended (returning to the bottom is what ends it), the card gave up its focused height, and the
   * content was carried upward by exactly that much — 「应该滑到哪里就是哪里，而不是还要被动上移一段」. With the page detached
   * first, the anchor compensation keeps the visible content still through that change, animated or not.
   *
   * The reader's own close button takes the same release (see `toggleReading`), for the same reason and in the same words.
   */
  useEffect(() => { if (pin) onLeaveTail(); }, [pin, onLeaveTail]);

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
    if (!port) return;
    // The card itself, for the compensation below: what pushes the page is the CARD's height, not the viewport's (the
    // reading row under the viewport is part of it).
    const card = port.closest<HTMLElement>('[data-reader-reasoning-card]');
    const text = content.current;
    const scrollTrack = track.current;
    if (!text || !scrollTrack) return;
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
    /**
     * Move the conversation by exactly what the CARD grew, so the card's BOTTOM edge stays where the reader's eye is.
     *
     * The measurement is the whole CARD, not the viewport whose height this code writes, and that difference is a bug
     * the reader reported: the reading row under the viewport (可滚动阅读 / 暂停跟随 / 展开阅读) is part of the card, it
     * appears the moment the card starts to overflow, and pushing the card's bottom down without any compensation left
     * the bottom of the card — that row, and the last lines above it — below the visible area with nothing to bring it
     * back, because the page's tail-follow is deliberately suspended while a card holds the focus.
     *
     * The same hole covered the bigger jump: on the frame the focus is GRANTED the viewport's ceiling changes
     * (`224px` → `min(60vh, 560px)`), which can be hundreds of pixels of card height in one commit, and none of it was
     * compensated either. `focusRendered` is therefore recorded just before the focus is requested — see
     * `recordCardHeight` — so the first measurement after the grant sees that jump and takes it out of the space above.
     *
     * A card that does NOT hold the focus still records its height and scrolls nothing: the recorded value has to be the
     * pre-grant one at the moment of the grant.
     */
    const compensateHeight = (): void => {
      // A FRACTIONAL height, not `offsetHeight`: the stylesheet eases this box's height in glide mode, so between two
      // frames the layout moves by a fraction of a pixel while `offsetHeight` reports a rounded integer. Charging the
      // scroll in whole pixels against a smooth change is a step of up to a pixel every frame — visible as a tremble at
      // the card's bottom edge — where the rect reports exactly what the layout did.
      const rendered = card?.getBoundingClientRect().height ?? 0;
      const grew = rendered - focusRendered.current;
      focusRendered.current = rendered;
      if (!focusedRef.current || grew <= 0) return;
      const scroller = port.closest<HTMLElement>('[data-conversation-scroll]');
      if (scroller === null) return;
      /**
       * …AND ONLY WHILE THE READER IS STILL WATCHING THE TAIL.
       *
       * The focus is deliberately kept when they scroll up — the card must not shrink under them (see the request
       * effect) — but this write must not be kept with it. What it is for is holding the card's BOTTOM EDGE still for
       * someone watching it grow; for someone reading further up the transcript it is a tug of war with their own
       * wheel, one line per line of reasoning: reported as 「只有在卡片变高的时候」 the page being pulled back under a
       * scroll that is otherwise fine. The card cannot see this on its own — its own `following` tracks ITS inner
       * scroller — which is why the page's tail state arrives as a prop.
       *
       * The recorded height above still advances on every measure, so coming back to the tail does not charge the
       * growth that happened while they were away (one jump), and it resumes on the next line.
       */
      if (!pageAtTailRef.current) return;
      scroller.scrollTop += grew;
    };
    const chaseHeight = (target: number): void => {
      cancelAnimationFrame(heightChase);
      heightChase = 0;
      compensateHeight();
      // The stop condition is the VIEWPORT's height — the property the stylesheet eases — while the compensation above
      // is the card's. They are different numbers on purpose: the ceiling clamps the former and the footer moves the
      // latter.
      if (port.offsetHeight === target) return;
      // The deadline is what ends it when the stylesheet's ceiling clamps the target, so a card past `min(60vh, 560px)`
      // cannot leave a frame loop running for as long as it holds the focus. The still-frame count below is what usually
      // ends exactly that case, and well before the deadline.
      const deadline = performance.now() + HEIGHT_CHASE_MS;
      let still = 0;
      let previous = port.offsetHeight;
      const step = (): void => {
        heightChase = 0;
        compensateHeight();
        const rendered = port.offsetHeight;
        if (rendered === target) return;
        if (rendered === previous) {
          // A frame in which the eased height did not move by so much as the integer this reads. See CHASE_STILL_FRAMES:
          // the transition has either not been sampled yet or has finished at a height the browser refused to exceed.
          if (++still >= CHASE_STILL_FRAMES) return;
        } else {
          still = 0;
          previous = rendered;
        }
        if (performance.now() > deadline) return;
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
      // Everything that can move the card's bottom, not only the height written above: the reading row appears in a
      // LATER commit (it is React state, set from this function), and the focus grant changed the ceiling in an earlier
      // one. Recording and compensating here on every measure is what catches those; the delta is zero when nothing
      // moved, and a card without the focus records without scrolling.
      compensateHeight();
      // Read again rather than reusing the height taken at the top of this function: a height write above can put the
      // port's scrollbar in or out, and a scrollbar changes the text's WIDTH, which rewraps it. The comparison is against
      // the preview height rather than the port's, so only a rewrap can move this answer — which is the one case the
      // second read is for. An audit read it as a redundant read; it is the cheap side of that trade.
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
    // Handed out so the grant can take the ceiling jump out of the space above BEFORE the browser paints (see the focused
    // effect): on the next measure would be one painted frame of the card hanging below the fold.
    compensateNow.current = compensateHeight;
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
      compensateNow.current = () => {};
    };
  }, [allowed, pause, reasoningMode, rate]);

  useLayoutEffect(() => {
    const port = viewport.current;
    if (!port) return;
    const sizeState = `${String(expanded)}:${String(folded)}`;
    const changed = sizeState !== previousSize.current;
    previousSize.current = sizeState;
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
      // …and the reader-initiated resize is over: the page may compensate growth again. See `toggleReading` for why this
      // marker exists at all; the deadline in that handler is the backstop for the 动效-off path, where no animation runs.
      cardRoot()?.removeAttribute('data-reader-resizing');
      // …and if this resize was the reader OPENING the card, this is the moment its new height is real, so the bottom can be
      // lined up with the composer. See `alignCardBottom`.
      if (pendingAlign.current) { pendingAlign.current = false; alignCardBottom(); }
    };
    animation.onfinish = settle;
    const deadline = window.setTimeout(settle, 300 + 240);
    return () => { window.clearTimeout(deadline); };
  }, [expanded, folded, motion, selected]);
  useEffect(() => () => { window.cancelAnimationFrame(alignFrame.current); resize.current?.cancel(); }, []);

  /**
   * Bring this card's BOTTOM to the top of the composer — 「展开后底端对齐输入栏顶」.
   *
   * An expanded card is capped (`min(60vh, 560px)`), so on a short window the part below the fold is out of reach; aligning
   * its bottom puts the whole card in view. It is the reader's own move, so the page stops following here — without that the
   * follower would pull straight back to the tail.
   *
   * TWO conditions the reader asked for: it moves NOTHING when the card, where it already is, sits fully inside the visible
   * band — 「页面能装下原位置展开后的思考卡片就不用移动」 — and when it does move, it EASES there instead of jumping. The
   * easing starts once the size animation has settled, which is the slight ordering asked for: open first, then line up.
   */
  const alignCardBottom = (): void => {
    const root = cardRoot();
    const port = viewport.current;
    const scroller = port?.closest<HTMLElement>('[data-conversation-scroll]') ?? null;
    if (root === null || port === null || scroller === null) return;
    const seat = scroller.querySelector<HTMLElement>('[class*="_composerSeat"]');
    const band = scroller.getBoundingClientRect();
    /**
     * …stopping SHORT of the composer by the height of the fade band above it, which the reader reported covering the last
     * sliver of the card — 「那个对齐上移一些，因为底部有渐变，会挡一点」. The band's height is this plugin's own constant on
     * the seat (`--viewtune-wallpaper-fade-lift`, the lift its `::before` is drawn with), so it is READ rather than guessed:
     * a reader who tuned that fade gets an alignment that respects what they tuned.
     */
    const fade = seat === null ? Number.NaN : Number.parseFloat(getComputedStyle(seat).getPropertyValue('--viewtune-wallpaper-fade-lift'));
    const inset = Number.isFinite(fade) ? fade : 36;
    const limit = (seat !== null ? seat.getBoundingClientRect().top : band.bottom) - inset;
    const rect = root.getBoundingClientRect();
    if (rect.top >= band.top && rect.bottom <= limit) return;
    const delta = rect.bottom - limit;
    if (Math.abs(delta) < 1) return;
    onLeaveTail();
    cancelAnimationFrame(alignFrame.current);
    if (!motion) { scroller.scrollTop += delta; return; }
    const from = scroller.scrollTop;
    const started = performance.now();
    const DURATION = 280;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      // Cubic ease-out, the shape of the size animation beside it: away from the press quickly, settling at the end.
      const eased = 1 - (1 - t) ** 3;
      scroller.scrollTop = from + delta * eased;
      if (t < 1) alignFrame.current = requestAnimationFrame(step);
    };
    alignFrame.current = requestAnimationFrame(step);
  };
  const alignFrame = useRef(0);

  const toggleReading = () => {
    // Resize the same transcript without changing follow intent or position.
    // Wheel, selection and viewport focus still explicitly pause following.
    onRead();
    // A card that is tall because of the FOCUS has nothing to toggle in `expanded`: the focus is what holds it open, so the
    // press has to hand the focus back, or the button would do nothing at all. That is the reader's report — after taking a
    // focused card over by reading inside it, the toggle never came back and there was no way to close the card.
    if (focused && !expanded) {
      // …and leave the tail on the reader's behalf FIRST: handing the focus back on its own ends the follow's suspension,
      // and the follower then snapped the page to the newest line — the reader's 「点击收起似乎会立刻跳转到最新」. Closing
      // the card is a decision to stop following, so it releases the page exactly as a rail jump does.
      onLeaveTail();
      onFocusChange(focusKey, false);
      return;
    }
    /**
     * …and THIS resize is the reader's own doing, so the page must not drag itself to keep some other anchor still.
     *
     * The reading view compensates growth while the reader holds their own place (`motion.tsx`, the observer's compensation
     * branch), which keeps the element they are looking at fixed — and that is right for text arriving on its own. For a card
     * the reader just opened it produced the opposite of what they asked for: the card sits ABOVE that anchor, so
     * compensating the anchor's downward move pushed the card's top off screen and the card appeared to expand UPWARD, while
     * a card below the anchor appeared to expand downward — 「靠上就向上扩张，靠下就向下扩张，应该统一向下」.
     *
     * So the card publishes a marker for as long as this resize lasts, and the compensation stands down while it is set,
     * still re-capturing its anchor so later growth is measured from the new layout. Cleared both by the resize animation's
     * own settle and by a deadline, because with 动效 off there is no animation to settle (`settle` returns early then).
     */
    const root = cardRoot();
    if (root !== null) {
      root.setAttribute('data-reader-resizing', '');
      window.setTimeout(() => root.removeAttribute('data-reader-resizing'), 600);
    }
    setExpanded(value => !value);
    /**
     * …and opening the card also lines its bottom up with the composer, once the new height is really in place: the size
     * animation's own settle is what calls it (see the resize effect), and this deadline is the backstop for the path with
     * no animation to settle — 动效 off, where that effect returns before arming anything.
     */
    if (alignBottom && !expanded) {
      pendingAlign.current = true;
      window.setTimeout(() => { if (pendingAlign.current) { pendingAlign.current = false; alignCardBottom(); } }, 600);
    }
  };
  const pendingAlign = useRef(false);

  // …and the folded card is pinned to its FIRST line. `allowed` above stops the follower from driving it any further, but a
  // card that was already following sits at its old scroll offset, so the one visible line would still be a later one. A
  // folded card is clipped to a single line by the stylesheet, so all that is needed here is the offset it is clipped at —
  // AND the reference transform cleared, because the follower renders by translating the track, and a translate left behind
  // by the moment before the fold would put a different line in that one visible row.
  useLayoutEffect(() => {
    if (!folded) return;
    const port = viewport.current;
    if (port === null) return;
    stopFollow.current = () => {};
    port.scrollTop = 0;
    const line = track.current;
    if (line !== null) { line.style.transition = 'none'; line.style.transform = 'none'; }
  }, [folded]);

  return <div className={css.reasonCard} data-reader-reasoning-card data-reader-anchor data-expanded={expanded} data-focus={focused} data-following={allowed} data-overflow={overflow} data-folded={folded ? '' : undefined} data-ud-motion="reader-reasoning-size">
    <div className={css.reasonHeading} data-reader-reasoning-heading data-ud-check="reasoning-identity">
      {folded && <svg className={css.reasonFoldIcon} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M8 2.5a4 4 0 0 0-2.3 7.3v1.7h4.6v-1.7A4 4 0 0 0 8 2.5Z" /><path d="M6.4 13.5h3.2" /></svg>}
      <span className={css.reasonLabel} data-reader-reasoning-label>思考</span>
      {!folded && <span>步骤 {step}</span>}
    </div>
    <div ref={viewport} id={controls} className={css.reasonViewport} data-reader-reasoning-scroll data-edges={edges}
      data-ud-motion="reader-reasoning-scroll" role="region" aria-label={`步骤 ${step} 的思考${overflow ? '，可滚动阅读' : ''}`}
      tabIndex={overflow ? 0 : undefined} onPointerDown={pause} onFocus={pause}>
      <div ref={track} className={css.reasonTrack} data-reader-reasoning-track>
        <div ref={content} className={css.reasonText} data-reader-reasoning-text>{children}</div>
      </div>
    </div>
    {(overflow || expanded || folded) && <div className={css.reasonFooter} data-ud-check="reasoning-controls">
      {/* The control belongs to the FOLLOWING, not to the animation: pausing is just as meaningful when the card jumps to
          the newest line directly, which is what 动效 off does. Gating it on `motion` hid the button from exactly the
          readers who had turned animation off — the other half of the bug above. */}
      {folded ? null : active ? <button type="button" className={css.reasonAction} disabled={selected} aria-controls={controls}
        aria-label={following ? '暂停自动跟随思考' : '继续跟随最新思考'}
        title={selected ? '取消文字选择后可继续跟随' : undefined}
        onClick={() => { if (following) pause(); else { onRead(); setFollowing(true); } }}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">{following ? <path d="M5.5 4v8m5-8v8" /> : <path d="M8 3v10m-4-4 4 4 4-4" />}</svg>
        {following ? '暂停跟随' : '跟随最新'}
      </button> : <span className={css.reasonCaption}>{expanded ? '手动阅读' : '可滚动阅读'}</span>}
      {/* The toggle is offered whenever the card is TALL — because the reader opened it, or because the focus holds it open —
          and the label says which way that press goes. It is shown for a focused card too: hiding it there was the previous
          attempt, and it left a reader who had taken the card over with no way to close it at all. */}
      <button type="button" className={css.reasonAction} aria-expanded={expanded || focused} aria-controls={controls}
        aria-label={expanded || focused ? '收起完整思考' : '展开阅读完整思考'} onClick={toggleReading}>
        {expanded || focused ? '收起' : '展开阅读'}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">{expanded || focused ? <path d="m4 10 4-4 4 4" /> : <path d="m4 6 4 4 4-4" />}</svg>
      </button>
    </div>}
  </div>;
}
