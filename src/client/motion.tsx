import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import css from './Reader.module.css';
import { StreamMotionContext } from './streaming.js';

const EASING = 'cubic-bezier(.22,1,.36,1)';

/**
 * The follower's policy lives in its own module (see `reading-scroll.ts`), imported here because the follower uses it
 * and re-exported because this is where every reader of these names looks for them.
 */
import { firstRowPastIndex, isNearTail, wheelAtBottom, wheelClaimsScroll } from './reading-scroll.js';
import type { FollowMode } from './reading-scroll.js';
export { FOLLOW_TAIL_PX, FOLLOW_MODES, WHEEL_EPSILON_PX, firstRowPastIndex, followModeOf, isNearTail, wheelAtBottom, wheelClaimsScroll } from './reading-scroll.js';

export function useMotionAllowed(enabled: boolean): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return enabled && !reduced;
}

export function usePinnedSelection(root: RefObject<HTMLElement>, selector = '[data-reader-answer], [data-reader-process]'): readonly string[] {
  const [keys, setKeys] = useState<readonly string[]>([]);
  useEffect(() => {
    const update = () => {
      const selection = document.getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
      const next = range && root.current
        ? [...new Set(Array.from(root.current.querySelectorAll<HTMLElement>(selector))
          .filter(element => range.intersectsNode(element))
          .map(element => element.dataset.readerKey ?? element.dataset.readerProcessKey!).filter(Boolean))]
        : [];
      setKeys(previous => previous.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next);
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [root, selector]);
  return keys;
}

export function StatusText({ text, motion, shimmer = false }: { text: string; motion: boolean; shimmer?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [forcedColors, setForcedColors] = useState(() => window.matchMedia('(forced-colors: active)').matches);
  const allowed = motion && visible && !forcedColors;
  const [frame, setFrame] = useState<{
    text: string; id: number; phase: 'idle' | 'start' | 'running';
    outgoing: { text: string; id: number } | null;
  }>({ text, id: 0, phase: 'idle', outgoing: null });
  // Adjust before commit, so a new label cannot paint once before its entry state.
  // Reuse the previous incoming key: a rapid change exits from its current pose.
  if (frame.text !== text) setFrame({
    text, id: frame.id + 1, phase: allowed ? 'start' : 'idle',
    outgoing: allowed ? { text: frame.text, id: frame.id } : null,
  });
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    const query = window.matchMedia('(forced-colors: active)');
    const colors = () => setForcedColors(query.matches);
    document.addEventListener('visibilitychange', update);
    query.addEventListener('change', colors);
    return () => { document.removeEventListener('visibilitychange', update); query.removeEventListener('change', colors); };
  }, []);
  useLayoutEffect(() => {
    const id = frame.id;
    const settle = () => setFrame(current => current.id === id && current.outgoing
      ? { ...current, phase: 'idle', outgoing: null } : current);
    if (!allowed) { settle(); return; }
    if (!frame.outgoing || !ref.current) return;
    // Commit the supplied .is-enter-start pose before releasing CSS transitions.
    ref.current.getBoundingClientRect();
    let timer = 0;
    const tick = requestAnimationFrame(() => {
      setFrame(current => current.id === id ? { ...current, phase: 'running' } : current);
      timer = window.setTimeout(settle, 200); // 150ms swap + 50ms incoming gap.
    });
    return () => { cancelAnimationFrame(tick); window.clearTimeout(timer); };
  }, [frame.id, allowed]);
  const active = shimmer && allowed;
  const swapping = allowed && frame.outgoing !== null;
  return <span className={css.statusText} data-reader-status data-reader-busy={shimmer} data-ud-check="reader-status">
    <span className={css.think} aria-hidden="true" data-active={active} data-reader-status-phase={swapping ? frame.phase : 'idle'} data-ud-motion="reader-thinking-state">
      <span className={css.thinkSizer}>{text}</span>
      {swapping && <span key={frame.outgoing!.id} className={`${css.thinkText} ${frame.phase === 'running' ? css.isExit : ''}`}
        data-reader-status-copy="outgoing" data-text={frame.outgoing!.text}>{frame.outgoing!.text}</span>}
      <span key={frame.id} ref={ref} className={`${css.thinkText} ${swapping && frame.phase === 'start' ? css.isEnterStart : ''}`}
        data-reader-status-copy="current" data-reader-shimmer={active || undefined} data-text={text}>{text}</span>
    </span>
    <span className={css.srOnly} role="status" aria-live="polite" aria-atomic="true">{text}</span>
  </span>;
}

export function Disclosure({ open, onChange, label, status, controls, buttonRef }: {
  open: boolean; onChange: (value: boolean) => void; label: ReactNode;
  status?: string; controls: string; buttonRef: RefObject<HTMLButtonElement>;
}) {
  return <div className={css.disclosure} data-reader-disclosure data-expanded={open}>
    <button ref={buttonRef} type="button" className={css.disclosureButton} aria-label={`${open ? '收起' : '展开'}思考与过程`} aria-expanded={open} aria-controls={controls} onClick={() => onChange(!open)}>
      {label}
      <svg className={css.chevron} data-open={open} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
    </button>
    <div className={css.processMeta} data-reader-process-meta data-open={open} aria-hidden={!open}>
      <div className={css.processMetaInner}><div className={css.processMetaLine}>
        <span>思考与过程</span>{status && <span className={css.meta}>{status}</span>}
      </div></div>
    </div>
  </div>;
}

/** Supplemental details stay in source order beside their own narration. */
export function ProcessFragment({ open, motion, onRead, returnFocusTo, nodeKey, children, framed = false }: {
  open: boolean; motion: boolean; onRead: () => void; nodeKey: string;
  returnFocusTo: RefObject<HTMLElement>; children: ReactNode; framed?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const watcher = useRef<ResizeObserver | null>(null);
  const previous = useRef(open);
  const [present, setPresent] = useState(open);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    watcher.current?.disconnect();
    watcher.current = null;
    const animating = running.current !== null;
    const from = animating ? element.getBoundingClientRect().height : previous.current ? element.scrollHeight : 0;
    // What a frame occupies is not only its height. The flow is a flex column with a `row-gap`, and
    // a frame that has shrunk to nothing still owns the gap that sits beside it; that gap leaves the
    // layout only when the frame unmounts. So a collapse that animated the height to 0 and stopped
    // there left one gap of blank space per collapsed step, and the answer below jumped up by
    // exactly that much the moment `present` went false. The gap has to leave with the height, and
    // the frame's own margin is what can pull it out: one gap of negative margin on either side of
    // the frame's box removes exactly the one gap that its removal will remove, wherever the frame
    // sits in the flow. A frame alone in its container owns no gap, hence 0. `.disclosureBody`
    // carries no margin of its own, so cancelling the parent's gap is the whole of it.
    const parent = element.parentElement;
    const alone = element.nextElementSibling === null && element.previousElementSibling === null;
    // Only a flex/grid parent spaces its items with a gap; a block parent can carry the property
    // without it doing anything, and then there is no space to cancel.
    const box = parent === null ? null : getComputedStyle(parent);
    const spaced = box !== null && (box.display.includes('flex') || box.display.includes('grid'));
    const measured = box === null || !spaced || alone ? 0 : parseFloat(box.rowGap);
    const gap = Number.isFinite(measured) ? measured : 0;
    // Resuming an interrupted animation starts from wherever the margin actually is.
    const marginFrom = animating ? parseFloat(getComputedStyle(element).marginTop) || 0 : open ? -gap : 0;
    running.current?.cancel();
    running.current = null;
    const changed = previous.current !== open;
    previous.current = open;
    if (open) setPresent(true);
    if (!open && element.contains(document.activeElement)) returnFocusTo.current?.focus();
    element.style.height = open ? 'auto' : '0px';
    // The frame after the animation has to find the layout the animation ended on, or it snaps: a
    // collapsed frame keeps its gap out of the layout until it unmounts, an open one must not
    // carry the compensation.
    element.style.marginTop = open || gap === 0 ? '' : `-${gap}px`;
    // `scrollHeight` is the content's own height — the height the reveal has to end on. It is read
    // here, but on the way open the subtree is still settling: the reasoning card only learns that
    // it overflows once it has been laid out, and the reading row that update renders
    // ("可滚动阅读 / 展开阅读", ~38px) reaches the DOM only after this effect — child effects run
    // first, and the state they set is flushed after this one. An end keyframe frozen to the height
    // read here therefore leaves that row outside the reveal: it stays clipped for the whole
    // animation, and `height: auto` snaps it into view at the end. So the end keyframe follows the
    // content for as long as the animation runs.
    let end = open ? element.scrollHeight : 0;
    if (!motion || !changed || Math.abs(from - end) < 1) {
      setPresent(open);
      return;
    }
    const marginTo = open ? 0 : -gap;
    const frames = (height: number) => [
      { height: `${from}px`, marginTop: `${marginFrom}px` },
      { height: `${height}px`, marginTop: `${marginTo}px` },
    ];
    const animation = element.animate(frames(end), { duration: 260, easing: EASING, fill: 'both' });
    running.current = animation;
    if (open) {
      // Watch the content box, not the body: the body's own height changes on every animated
      // frame, while the content changes only when the subtree actually grows.
      const content = element.firstElementChild;
      if (content !== null && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => {
          if (running.current !== animation) return;
          const settled = element.scrollHeight;
          if (Math.abs(settled - end) < 1) return;
          end = settled;
          const effect = animation.effect;
          if (effect instanceof KeyframeEffect) effect.setKeyframes(frames(settled));
        });
        observer.observe(content);
        watcher.current = observer;
      }
    }
    // `fill: 'both'` pins the opening keyframe — height 0, and the margin compensation with it —
    // so while this animation runs the body is invisible no matter what its own style says. An
    // animation that never reaches `onfinish` (cancelled by a re-run, skipped by the compositor,
    // never started because the view was hidden) would leave the row looking like it refused to
    // open; that is the symptom upstream reported as "clicking it looked like nothing happened".
    // Cancelling is only safe once the state change has been committed, so the deadline does both:
    // it sets `present` and takes the fill away. The 240ms of slack past the animation's own
    // duration is upstream 0.2.0's.
    let settled = false;
    const settle = () => {
      if (settled || running.current !== animation) return;
      settled = true;
      watcher.current?.disconnect();
      watcher.current = null;
      running.current = null;
      animation.cancel();
      setPresent(open);
    };
    animation.onfinish = settle;
    const deadline = window.setTimeout(settle, 260 + 240);
    return () => { window.clearTimeout(deadline); };
  }, [open, motion, returnFocusTo]);
  useEffect(() => () => {
    watcher.current?.disconnect();
    watcher.current = null;
    running.current?.cancel();
  }, []);
  if (!open && !present) return null;
  return <div ref={body} className={css.disclosureBody} data-reader-process data-reader-process-key={nodeKey} data-ud-motion="reader-process-size"
    aria-hidden={!open} onPointerDown={() => { if (open) onRead(); }} onFocusCapture={() => { if (open) onRead(); }} {...(!open ? { inert: '' } : {})}>
    <div className={framed ? css.processFrame : css.processContents}>{children}</div>
  </div>;
}

/** Retire only narration that was actually visible; historical rows stay folded. */
export function RetiringContent({ visible, children }: { visible: boolean; children: ReactNode }) {
  const { enabled } = useContext(StreamMotionContext);
  const root = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const [present, setPresent] = useState(visible);
  const [focusHeld, setFocusHeld] = useState(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (visible) {
      animation.current?.cancel(); animation.current = null;
      setPresent(true);
      return;
    }
    if (!element) return;
    if (element.contains(document.activeElement)) { setFocusHeld(true); return; }
    if (focusHeld) return;
    const from = element.getBoundingClientRect().height;
    animation.current?.cancel(); animation.current = null;
    if (!enabled || from < 1) { setPresent(false); return; }
    const next = element.animate([{ height: `${from}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 220, easing: EASING, fill: 'both' });
    animation.current = next;
    // The same hazard as the disclosure above, at the one site upstream did not cover: `fill:
    // 'both'` holds this collapse's endpoint, so an animation that never finishes leaves retired
    // narration on screen at full height with `present` still true — it never retires. The
    // deadline retires it either way.
    let settled = false;
    const settle = () => {
      if (settled || animation.current !== next) return;
      settled = true;
      animation.current = null;
      next.cancel();
      setPresent(false);
    };
    next.onfinish = settle;
    const deadline = window.setTimeout(settle, 220 + 240);
    return () => { window.clearTimeout(deadline); };
  }, [visible, enabled, focusHeld]);
  useEffect(() => () => animation.current?.cancel(), []);
  if (!visible && !present) return null;
  return <div ref={root} className={css.retiringContent} data-reader-retiring={visible ? 'visible' : 'retiring'} data-ud-motion="reader-progress-retire"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusHeld(false); }}>
    {children}
  </div>;
}

// DOM-only behavior: the native Session remains the sole source of business data.
/**
 * The reading view's scroll follower.
 *
 * `live` says whether a turn is still RUNNING, and tail-follow belongs to a live turn and nothing else: with nothing
 * arriving there is nothing to keep up with, and a snap that keeps pulling the reader back to the bottom is only a
 * fight with their own scrolling — 「在没有进行中的轮次的情况下，不应有自动吸附」. While idle the observer below still keeps
 * the reader's PLACE (the anchor compensation), which is not a snap: it moves them by exactly what changed above them,
 * so a growing tool row no longer shifts the line they are reading.
 *
 * The frame loop and the observer read it through a ref: putting it in the effect's dependency list would tear down and
 * re-register every listener on each stream tick.
 *
 * `followMode` is the reader's choice between the glide and writing the tail directly. The direct one is not merely a
 * different look: the glide writes `scrollTop` on every frame, and every one of those writes fires a scroll event —
 * which is what wakes the scroll spy, the anchor compensation and every measurement in this file. Snapping writes once
 * per growth instead, so those paths go quiet. It IS in the dependency list, unlike `live`: it changes when a reader
 * changes a setting, not on every stream tick, and re-registering then is exactly what should happen.
 */
/**
 * How long after a turn's status flips a layout change still counts as that turn's output.
 *
 * Short, and now for a REASON rather than as a guess about host latency: upstream publishes the turn's `turn-tail`
 * node on `turn/end`, so the rows that belong to a turn — its metrics, its action row, the deliverable chips — are
 * laid out in the same commit as the status flip, or in the frame after it. What this covers is that commit reaching
 * the layout and the observer, which is milliseconds; the value is generous without being a guess.
 */
const OUTPUT_TAIL_MS = 400;

export function useReadingScroll(root: RefObject<HTMLElement>, motion: boolean, live = true, followMode: FollowMode = 'glide', suspended = false): {
  detached: boolean;
  jump: () => void;
  /** Stop tail-follow so a rail landing is not pulled back to the live bottom. */
  release: () => void;
  /**
   * Re-arm tail-follow after something suspended it — for a caller that knows the suspension is over.
   *
   * The follower resumes on its own when content grows, but that path runs through guards that are allowed to swallow
   * it (a focus inside the reading view, a live text selection, a glide already in flight), so a caller that suspended
   * the follow deliberately has to be able to hand it back deliberately. Does nothing unless the reader is at the tail:
   * re-arming from anywhere else would be the "fight the reader's scrolling" this hook exists to avoid.
   */
  resume: () => void;
} {
  const port = useRef<HTMLElement | null>(null);
  const following = useRef(true);
  const liveRef = useRef(live);
  /**
   * Is the follow suspended by the CALLER — not by the reader?
   *
   * A suspension is not a takeover, and the difference is the whole of this ref. While a card holds the focus the page
   * deliberately does not follow, and content that arrives BESIDE that card — a narration below it, or the answer —
   * keeps growing the transcript, so the distance to the tail opens with nobody closing it. Judged by the ordinary
   * rule that gap reads as "the reader scrolled away": the follow was switched off, the 「回到最新」 pill went up, and
   * nothing ever switched it back — the only thing that re-arms the follow is a scroll event, and a follower that is
   * off writes none. Reported as "a card with a scrollbar stops following when it folds", with no reader input at all.
   */
  const suspendedRef = useRef(suspended);
  /**
   * Is the turn still PRODUCING output? — asked of the turn's status, plus the breath it takes for that status's own
   * layout to reach the observer.
   *
   * Upstream publishes the turn's `turn-tail` node on `turn/end`, so the rows that belong to a turn are laid out in
   * the same commit as the status flip — the status alone would be right if the follower could read it at that
   * instant. It cannot, and that was the bug: this state used to be set in a PASSIVE effect, while the growth arrives
   * through a ResizeObserver, and the observer can run before the passive effect does. The one growth carrying the
   * rows was therefore sometimes seen while the tail window was still off, which is exactly the reported "sometimes it
   * stops at the answer's last line". The refs below are written in LAYOUT effects, which run synchronously at the
   * end of the commit and before the browser's rendering steps — so when the observer fires, the state it reads is the
   * state of the commit that caused the growth.
   */
  const producingRef = useRef(false);
  const endedAt = useRef(0);
  const anchor = useRef<{ element: HTMLElement; top: number } | null>(null);
  const cancelFollow = useRef<() => void>(() => {});
  const [detached, setDetached] = useState(false);
  useLayoutEffect(() => {
    liveRef.current = live;
    // The instant a turn stops producing — read by the observer, so it has to be current for the commit that flipped
    // it rather than one paint later (see the producingRef note).
    if (!live) endedAt.current = performance.now();
  }, [live]);
  /**
   * The suspension, written here for the same reason as the two above — and it was the one that got left behind.
   *
   * The observer reads it (line below), and a passive effect can run after the observer has already seen the growth,
   * so a card TAKING the focus could have its first layout change judged against "nothing is suspended" and the tail
   * pulled down while the card grows. The glide path got away with it by luck: the observer only schedules a frame and
   * `follow` re-tests this on the way in, by which time the passive effect has run. The direct write in the observer
   * has no such second chance, which is why 「直接贴底」 and 动效关 could still step the page once there.
   *
   * Deliberately its own effect rather than folded into the one above: sharing a dependency list would re-stamp
   * `endedAt` every time a focus is taken or released, which would hand a turn that ended long ago another tail window.
   */
  useLayoutEffect(() => { suspendedRef.current = suspended; }, [suspended]);
  useLayoutEffect(() => {
    const content = root.current;
    if (!content) return;
    const scroll = content.closest<HTMLElement>('[data-conversation-scroll]') ?? content;
    port.current = scroll;
    let followFrame = 0;
    let lastFrameAt = 0;
    let lastWrittenTop: number | null = null;
    /** The last position seen while suspended, so a scroll that did not move BACKWARDS can be told from a takeover. */
    let lastSuspendedTop = 0;
    cancelFollow.current = () => {
      cancelAnimationFrame(followFrame);
      followFrame = 0;
      lastWrittenTop = null;
    };
    const selected = () => {
      const selection = document.getSelection();
      return selection && !selection.isCollapsed && selection.anchorNode && content.contains(selection.anchorNode);
    };
    const capture = () => {
      const top = scroll.getBoundingClientRect().top;
      // Bisection, not a walk over every anchor: this runs on every scroll event and on every growth while the reader
      // holds their own place, and the two scans in this file were measured together at 10k–16k rect reads per second.
      // The NodeList is measured directly — the walk's `Array.from` was another whole-list allocation per call.
      const anchors = content.querySelectorAll<HTMLElement>('[data-reader-anchor]');
      const index = firstRowPastIndex(anchors, top, 8);
      const candidate = index < anchors.length ? anchors[index]! : undefined;
      anchor.current = candidate ? { element: candidate, top: candidate.getBoundingClientRect().top } : null;
    };
    const onScroll = () => {
      // While a follow animation is actively driving scroll, do not cancel following midway.
      if (followFrame !== 0) return;
      // Our easing frames must not be mistaken for a user leaving the bottom.
      if (lastWrittenTop !== null && Math.abs(scroll.scrollTop - lastWrittenTop) < 1) return;
      /**
       * A suspension is not a takeover: while the caller has the follow suspended, what opens the gap is content
       * arriving below the reader — not the reader leaving. Only a scroll that moves UP can be the reader, and
       * everything this hook or a focused card writes moves DOWN. So while suspended, a position that did not move
       * backwards leaves `following` alone, and the suspension's end resumes the follow on its own.
       */
      if (suspendedRef.current && scroll.scrollTop >= lastSuspendedTop) {
        lastSuspendedTop = scroll.scrollTop;
        return;
      }
      lastSuspendedTop = scroll.scrollTop;
      const atBottom = isNearTail(scroll.scrollTop, scroll.scrollHeight, scroll.clientHeight);
      following.current = atBottom;
      setDetached(!atBottom);
      if (!atBottom) { cancelAnimationFrame(followFrame); followFrame = 0; }
      // The anchor is only ever READ while the reader holds their own place — see the observer below, whose
      // compensation branch is the only consumer. This handler runs once per streamed chunk (the follow loop
      // writes `scrollTop`, which fires a scroll event), so capturing here while following was a
      // whole-transcript `querySelectorAll` plus a rect per anchor, for a value nothing was going to look at.
      if (!following.current) capture();
    };
    const onWheel = (event: WheelEvent) => {
      cancelAnimationFrame(followFrame); followFrame = 0; lastWrittenTop = null;
      // Any wheel takes over, not only an upward one — see wheelClaimsScroll for why that
      // distinction is the difference between gliding and stepping on a long transcript — except
      // the downward one that finds the scroller already at its tail: nothing can move, so it is
      // not a takeover, and treating it as one is what made the pill flicker here (see wheelAtBottom).
      const gap = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
      if (!wheelAtBottom(event.deltaY, gap) && wheelClaimsScroll(event.deltaY)) { following.current = false; setDetached(true); capture(); }
    };
    const onTouch = () => {
      cancelAnimationFrame(followFrame); followFrame = 0; lastWrittenTop = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('textarea,input,[contenteditable=true]')) return;
      if (['PageUp', 'Home', 'ArrowUp'].includes(event.key)) {
        cancelAnimationFrame(followFrame); followFrame = 0; lastWrittenTop = null;
        following.current = false; setDetached(true); capture();
      }
    };
    /**
     * Write a scroll position and remember what the element will actually hold.
     *
     * That remembered value is what the `onScroll` guard compares against to tell our own easing frames apart from the
     * reader moving, and it used to be read back off the element — a read after a write, which forces a layout on every
     * single frame of the follow. The clamp is applied here instead, so the recorded number is the number the browser
     * will report. Every call site passes a limit: the follow loop already has its gap, and the two writes straight to
     * the tail — the first frame, and the observer's direct mode — pass the scroller's own ceiling. Those two did not,
     * for a while, and the guard below was dead in exactly that path: the recorded number was larger than any position
     * the element can hold, so the follower's own write could never be recognised as its own.
     */
    const writeTop = (top: number, limit: number) => {
      const value = Math.max(0, Math.min(top, limit));
      scroll.scrollTop = value;
      lastWrittenTop = value;
    };
    /**
     * Is the reader typing INSIDE THIS VIEW's transcript — as opposed to in the composer?
     *
     * The follower must not move the page under someone who is typing into the transcript… and there is no such thing
     * here: the composer is the only text target inside the reading view, and it is the host's own pinned element at
     * the bottom, so scrolling the transcript cannot disturb it. Treating it as a reason to freeze was the old "any
     * focus in the view" rule surviving in narrower clothes, and it froze the follow for the most ordinary situation
     * there is — a reader who has clicked into the composer while an answer is still arriving, and then watches the
     * answer finish while the deliverables and the action row appear below it with nobody taking them up. Reported as
     * "it stops at the answer's last line". The wheel, touch, keyboard and selection rules are untouched: those are
     * the reader reading, and they still take over.
     */
    const typingInside = () => {
      const active = document.activeElement;
      return active instanceof HTMLElement && content.contains(active)
        && active.closest('[data-composer-seat]') === null
        && active.closest('textarea,input,[contenteditable=true]') !== null;
    };
    const follow = (now: number) => {
      followFrame = 0;
      // A follower with nothing to follow: see the `producingRef` note on this hook.
      if (!producingRef.current || suspendedRef.current || !following.current || selected() || typingInside()) return;
      const gap = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
      const limit = scroll.scrollTop + gap;
      const delta = Math.min(48, Math.max(1, now - lastFrameAt));
      lastFrameAt = now;
      // No anchor capture on this line. The function returns above unless the reader IS following, and the
      // anchor is read only in the branch that runs when they are not — so this measured the whole transcript
      // on every frame of a follower that had already caught up, which is the branch that becomes common as
      // soon as the frames stop being starved. The capture was pure cost, and an expensive one: a
      // querySelectorAll over every anchor plus a rect for each, per frame, for a value nothing looked at.
      if (!motion || followMode === 'snap' || Math.abs(gap) < 1.5) { writeTop(scroll.scrollHeight, limit); return; }
      writeTop(scroll.scrollTop + gap * (1 - Math.exp(-delta / 52)), limit);
      followFrame = requestAnimationFrame(follow);
    };
    const firstFrame = requestAnimationFrame(() => {
      if (following.current && !selected()) writeTop(scroll.scrollHeight, scroll.scrollHeight - scroll.clientHeight);
      // The reader may already have detached before this effect installed; then the anchor is what holds
      // their place and it has to be captured now. While following it is never read.
      if (!following.current) capture();
    });
    const observer = new ResizeObserver(() => {
      if (selected()) return;
      // The turn's own status, plus the breath its closing commit needs to reach the layout (see producingRef). The
      // refs are written in layout effects, so this reads the state of the commit that caused this growth.
      const now = performance.now();
      producingRef.current = liveRef.current || now - endedAt.current < OUTPUT_TAIL_MS;
      if (producingRef.current && !suspendedRef.current && following.current && !typingInside()) {
        if (!motion || followMode === 'snap') writeTop(scroll.scrollHeight, scroll.scrollHeight - scroll.clientHeight);
        else if (!followFrame) { lastFrameAt = performance.now(); followFrame = requestAnimationFrame(follow); }
      } else if (!following.current && anchor.current?.element.isConnected) {
        const delta = anchor.current.element.getBoundingClientRect().top - anchor.current.top;
        // The metrics are read here, before the write: reading them after would be the same forced layout this branch
        // used to pay for nothing.
        if (Math.abs(delta) > .5) writeTop(scroll.scrollTop + delta, scroll.scrollHeight - scroll.clientHeight);
      }
      // Only worth capturing when the anchor is what holds the reader's place. While following, the anchor is not
      // read at all — and this fires once per streamed chunk, so the scan was pure cost on the one path where the
      // reader is already complaining about jank.
      if (!following.current) capture();
    });
    observer.observe(content);
    if (scroll !== content) observer.observe(scroll);
    scroll.addEventListener('scroll', onScroll, { passive: true });
    scroll.addEventListener('wheel', onWheel, { passive: true });
    scroll.addEventListener('touchstart', onTouch, { passive: true });
    scroll.addEventListener('touchmove', onTouch, { passive: true });
    scroll.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(followFrame); observer.disconnect();
      scroll.removeEventListener('scroll', onScroll); scroll.removeEventListener('wheel', onWheel);
      scroll.removeEventListener('touchstart', onTouch); scroll.removeEventListener('touchmove', onTouch);
      scroll.removeEventListener('keydown', onKey);
    };
  }, [root, motion, followMode]);
  const jump = useCallback(() => {
    cancelFollow.current();
    anchor.current = null;
    following.current = true;
    setDetached(false);
    if (port.current) {
      port.current.scrollTop = port.current.scrollHeight;
    }
  }, []);
  const release = useCallback(() => {
    cancelFollow.current();
    following.current = false;
    anchor.current = null;
    setDetached(true);
  }, []);
  const resume = useCallback(() => {
    const scroll = port.current;
    if (scroll === null) return;
    /**
     * Only for a reader who never took over.
     *
     * `following` is the reader's own intent, and a suspension no longer clears it (see `suspendedRef`), so this is
     * exactly the test for "the follow was handed back because the suspension ended" rather than "the reader scrolled
     * away earlier". That is also why the old tail-margin requirement is gone: a suspension is what opens a large gap
     * (content kept arriving beside the focused card), and refusing to close it was the reported dead end.
     */
    if (!following.current) return;
    cancelFollow.current();
    anchor.current = null;
    setDetached(false);
    scroll.scrollTop = scroll.scrollHeight;
  }, []);
  return { detached, jump, release, resume };
}
