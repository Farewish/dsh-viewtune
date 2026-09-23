/**
 * The wheel over the column handles still scrolls the transcript.
 *
 * The two vertical strips that set the reading column's width belong to the SHELL, and they sit beside the scroller
 * rather than inside it: a notch over one of them has no scroll container above it, so the gesture simply died there
 * — the reader's 「卡手」. Nothing has to be guarded here, only forwarded to the reading view's own scroller, found
 * through this plugin's root.
 *
 * WHY NOT THE OBVIOUS TWO ANSWERS.
 *
 * - `scrollTop = …`: a jump, and a wheel reports its delta in PIXELS, LINES or PAGES while every CSSOM scroll call
 *   means pixels — so a line-mode notch also moved a different distance from the transcript, not just a different way.
 * - `scrollBy({ behavior: 'smooth' })`: the compositor's own animation, but each notch RESTARTS its easing curve
 *   instead of accumulating, which the reader felt as a stutter.
 *
 * So the notch is added to a target and the scroller is carried toward it by a CRITICALLY DAMPED SPRING: it leaves
 * from rest, accelerates, and settles without overshooting. That is the shape the browser's own wheel animation has.
 *
 * WHY THE STIFFNESS IS NOT A CONSTANT. A single spring cannot serve both speeds, and the reader described exactly
 * that split: at a high stiffness a fast flick felt right while a slow single notch was slightly jerky, and at a low
 * one the slow notch felt right while a fast flick dragged. The browser's own animator is speed-dependent for the same
 * reason — repeated notches build velocity and a lone one gets a gentler glide — so the stiffness is derived from how
 * long it has been since the previous notch: back-to-back notches get the snappy spring, an isolated one the soft one.
 * Damping is always derived from whatever stiffness is in force (`2·√stiffness`), so neither end can drift into a
 * bounce.
 *
 * WHY A SLOW RUN NEEDS A TERM THE SPRING CANNOT PROVIDE. The reader's next report compared the strips against the
 * browser directly: with an even hand the transcript scrolls at an even speed, and the strips do not — 「尤其是在慢速
 * 状态下尤为明显」. The reason is structural, not a matter of tuning. A spring is CRITICALLY DAMPED, so it leaves
 * from rest and arrives at rest; that is right for one notch, and it is right for a fast run, where the target keeps
 * moving and the spring settles into tracking a ramp at a constant speed (steady-state lag `2·v/ω`) — which is exactly
 * why a fast flick never looked stepped. At a SLOW run the target jumps once and then stands still, and the spring
 * arrives long before the next notch: at a 0.3s interval the soft spring is done in about 0.22s, so every notch was
 * accelerate-then-wait, and the wait grows with the interval. No stiffness fixes that: soft enough to still be
 * travelling when the next notch lands means a lone notch that takes about two seconds to arrive, which was already
 * tried and rejected. So while notches keep coming the glide stops chasing the accumulated target and moves at the
 * STREAM'S OWN RATE — the distance per second the wheel is itself asking for, which is what the browser does. The
 * spring keeps the two jobs it is good at: a lone notch, and the landing.
 *
 * The rate is the notch's own pixels over the gap that preceded it, a stream is only carried once TWO consecutive
 * intervals agree that a pace exists — one interval is not a pace, and treating it as one turned every deliberate
 * second turn of the wheel into a drift (「两次滚动间有明显间隔还会变成匀速」) — and the estimate is smoothed, because a
 * hand's intervals are not metronomic. A stream that catches up to its own target therefore WAITS for the next notch
 * rather than landing between them, which is the tolerance that unevenness needs. Everything before a pace exists, and
 * everything after a pause, is the spring again.
 *
 * The handle is identified by its own PURPOSE — the resize cursor it shows — because its class name is a per-build
 * hash (`…_handle` in this build) and because that is exactly what the reader pointed at. Two further conditions keep
 * it to the right strip: the reading view has to be mounted at all, and the handle has to sit in the same column as
 * that scroller, so a resizer elsewhere in the shell — the sidebar's, say — is left alone.
 */
const HANDLE_CURSOR = 'col-resize';

/** The scroller the gesture is forwarded to: the reading view's own, reached through the plugin's root. */
const READER_ROOT = '[data-dsh-better-display]';
const SCROLLER = '[class*="_scrollBody"]';
/** The column both the handle and that scroller live in. */
const COLUMN = '[class*="_centerCol"]';

/**
 * The two ends of the stiffness, and the gap that separates them.
 *
 * `FAST` is what a flick needs — the shape the reader called "almost identical" while scrolling quickly — and `SLOW` is
 * what a lone notch needs. Their history, because it is the only record of what these numbers mean: the soft end was
 * asked DOWN twice (1200 → 900 → 600) while the spring was carrying everything, and then asked back UP a step, to 720,
 * with 「整体减小一点阻力，就是更干脆一点，一点就行」 — the ramp now owns the steady rolls, so what is left of the spring
 * is the lone notch and the landing, and both were the part still reading as resistance: 0.24s of glide became 0.216s,
 * and the landing after a slow run comes to rest in the same. The fast end moved with it, by the same step, because
 * the report was about the whole feel rather than one end of it. `FLICK_WINDOW` is the gap at which a notch stops
 * counting as part of a run. These are the numbers to move.
 */
const STIFFNESS_FAST = 3600;
const STIFFNESS_SLOW = 720;
const FLICK_WINDOW_SECONDS = 0.25;

/** Below this the spring has arrived, and the last fraction is applied exactly (see the reason in the landing check). */
const GLIDE_EPSILON = 2;
/** A frame longer than this is a stall (a hidden tab, a heavy paint), not a step: clamping keeps one gap from flinging. */
const MAX_STEP_SECONDS = 0.032;
/** Fallbacks for the two non-pixel delta modes when the element does not state a line height. */
const FALLBACK_LINE = 16;

/**
 * The stream: its own speed, how long a pause still counts as the same one, and the tolerance a hand needs.
 *
 * The rate is the notch's own pixels over the gap that preceded it — the wheel's own distance per second, so a steady
 * hand gives a steady transcript, which is the whole point (see the header). A hand is not metronomic, though, and that
 * is the reader's own note on it: 「人滑动滚轮不可能完全匀速，所以要加一点容错」. The tolerance is the WINDOW: the pace is the
 * current notch over the AVERAGE of the last few intervals, so one interval that is long or short by a hand's usual
 * margin is averaged against its neighbours instead of driving the speed on its own. Measured on a deliberately uneven
 * roll — 250ms, 250ms, 400ms repeating, one notch of 100px each — the frame-by-frame motion swung 2.0 → 7.0px while
 * the estimate followed single intervals, and settles to the hand's own distance per second once it is averaged.
 *
 * Averaging the INTERVALS rather than their rates is the part that matters: rates are not linear in the interval, so
 * their mean is pulled toward the short ones and the run is carried faster than the hand is actually going — which
 * shows up as a backlog that drains away over a long roll and stops the motion dead. The mean interval inverted is the
 * hand's own distance per second, and a periodic hand gets a constant speed out of it.
 *
 * The window is therefore the knob for tolerance itself: longer is steadier and slower to follow a deliberate change of
 * tempo. The speed is then taken up with a time constant rather than applied at once: a step in speed is a shove, which
 * is the verdict that removed the earlier exponential glide.
 */
const STREAM_WINDOW = 3;
const MAX_STREAM_SPEED = 6000;
const CRUISE_LAG_SECONDS = 0.04;
/**
 * The ramp hands back to the spring while this much stopping distance is left.
 *
 * The belt in `springStep` and the landing check are dead stops — an exact write of the target — so the ramp must
 * never press into the target and have them fire; it has to leave itself room to be decelerated. An eighth of a
 * second of the current speed is a little more than the spring needs to arrive from that speed, so the handover is
 * smooth and the ramp's own hard clamp stays unreachable in normal motion.
 */
const BRAKE_LOOKAHEAD_SECONDS = 0.08;
/**
 * The notch interval from which the ramp takes over from the spring.
 *
 * MEASURED, not derived. Driving a steady roll through the listener and recording the distance each frame covers shows
 * the spring's own swing growing with the interval — 24.7…38.5px per frame at a 50ms interval (1.6×, which is the
 * painted position's rounding), 13.3…34.2 at 67ms (2.6×), 7.3…31.8 at 83ms (4.4×), 4.1…30.2 at 100ms (7.3×) and
 * 2.4…28.8 at 117ms (11.8×) — while the ramp holds 1.1…1.6× at every interval it owns. An earlier version of this file
 * put the boundary at 130ms and justified it from the spring's arrival time, which the same measurement refutes: at
 * 117ms the spring is only a few pixels short of its target when the next notch lands, so it LOOKS settled while the
 * frame it is on moves two pixels and the one before it moved twenty-nine. The swings are quoted from the stiffnesses
 * above; moving them re-measures this table, because both ends of it are the spring's own numbers. So the ramp owns
 * every interval that is no longer a flick, and the spring keeps the very fast run the reader approved (1.6× there)
 * plus the two jobs only it can do: a lone notch, and the landing.
 */
const SLOW_STREAM_GAP_SECONDS = 0.06;

/**
 * How long after a notch the stream is still considered alive: long enough to bridge the interval it is derived from,
 * because an interval that outlives its own hold is a stream that has stopped.
 *
 * A multiple of the interval rather than a constant, so the bridge spans a slow roll and a moderate one alike. The
 * floor covers the fast end (where the spring is doing the work anyway).
 *
 * The CEILING is the reader's own verdict on this, and it has been moved five times — 0.9s, 0.45s, 0.35s, 0.28s, 0.25s,
 * now 0.2s. At 0.9s a deliberate second turn of the wheel half a second after the first still counted as the same
 * stream, and carrying that notch at the pace of the interval it followed — 「两次滚动间有明显间隔还会变成匀速」 — read as a
 * drift rather than a scroll. Each step down since has handed the slower rolls back to the spring, and the reason has
 * been the same each time: the reader compares the strips against the browser and wants them to agree. At 0.2s the ramp
 * is confined to rolls of five notches a second and up, and everything slower steps from notch to notch — which is what
 * the browser does at that speed.
 *
 * The FLOOR comes down with it, because a floor above the ceiling is not a floor: `clamp` would return the ceiling for
 * every interval and the middle number would quietly stop meaning anything. At 0.12s it still does its own job — a very
 * fast run keeps a hold long enough not to fall out of its own stream between notches — and the band between them is
 * where the multiple applies.
 */
const STREAM_HOLD_FACTOR = 1.6;
const STREAM_HOLD_MIN_SECONDS = 0.12;
const STREAM_HOLD_MAX_SECONDS = 0.2;

/**
 * Whether a wheel belongs to the column handles.
 *
 * Pure, and the whole judgement the listener makes: the pointer has to be showing the handle's own resize cursor AND
 * be inside the column the reading view's scroller lives in. Split out so the rule can be tested without a DOM.
 */
export function handleTakesWheel(cursor: string, insideColumn: boolean): boolean {
  return insideColumn && cursor === HANDLE_CURSOR;
}

/**
 * A notch in pixels.
 *
 * `deltaMode` 0 is already pixels; 1 is lines and 2 is pages, and both have to be multiplied — by the scroller's own
 * line height and by its viewport height respectively, which is what the browser's own scrolling does with them.
 */
export function wheelPixels(deltaY: number, deltaMode: number, lineHeight: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * (lineHeight > 0 ? lineHeight : FALLBACK_LINE);
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}

/**
 * The stiffness for a notch that follows the previous one by `gapSeconds`.
 *
 * Back-to-back notches (a flick) get the snappy end; one separated by a quarter of a second or more is on its own and
 * gets the soft end. Linear in between, so there is no threshold to step across — a step would be felt as a change of
 * character mid-scroll, which is the very thing this is here to remove.
 */
export function stiffnessForGap(gapSeconds: number): number {
  if (gapSeconds >= FLICK_WINDOW_SECONDS) return STIFFNESS_SLOW;
  if (gapSeconds <= 0) return STIFFNESS_FAST;
  const t = gapSeconds / FLICK_WINDOW_SECONDS;
  return STIFFNESS_FAST + (STIFFNESS_SLOW - STIFFNESS_FAST) * t;
}

/** The glide's state: where it is and how fast it is going, in pixels and pixels per second. */
export interface GlideState {
  readonly at: number;
  readonly velocity: number;
}

/**
 * The stream's speed, in pixels per second, unsigned: this notch over the average of the intervals behind it.
 *
 * Zero while there are fewer than two intervals, which is the arming the reader's second report asked for — two notches
 * an interval apart are not yet a stream, and carrying the second of them at the pace of the gap that happened to
 * precede it turned a deliberate second turn of the wheel into a drift (「两次滚动间有明显间隔还会变成匀速」, measured at
 * 26 frames to arrive against a lone notch's 14).
 *
 * Unsigned because the DIRECTION is already carried by the accumulated target: the ramp follows the sign of what is
 * left to travel, so a reversal mid-run is the target's business rather than a second state to keep in step.
 */
export function streamSpeed(gaps: readonly number[], pixels: number): number {
  if (gaps.length < 2) return 0;
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  if (!(total > 0)) return 0;
  return Math.min(Math.abs(pixels) / (total / gaps.length), MAX_STREAM_SPEED);
}

/**
 * How long a stream is still alive after a notch that followed its predecessor by `gapSeconds`.
 *
 * The property that matters, and the one the test pins: the hold is LONGER than the interval it is derived from, so a
 * steady roll never falls out of its own stream between notches.
 */
export function streamHoldSeconds(gapSeconds: number): number {
  if (!Number.isFinite(gapSeconds)) return STREAM_HOLD_MIN_SECONDS;
  const scaled = gapSeconds * STREAM_HOLD_FACTOR;
  return Math.min(Math.max(scaled, STREAM_HOLD_MIN_SECONDS), STREAM_HOLD_MAX_SECONDS);
}

/**
 * One integration step of the ramp: hold the stream's own speed, and never pass the target that carries it.
 *
 * The speed is approached with a time constant instead of being adopted, which is what makes the start of a run
 * smooth rather than a shove, and the clamp is the same belt the spring has — the accumulated notches are the
 * distance, exactly, so a ramp that reached the target early would be a scroll the reader never asked for.
 */
export function cruiseStep(state: GlideState, target: number, dtSeconds: number, speed: number): GlideState {
  const dt = Math.min(Math.max(dtSeconds, 0), MAX_STEP_SECONDS);
  const remaining = target - state.at;
  const wanted = remaining >= 0 ? speed : -speed;
  const share = 1 - Math.exp(-dt / CRUISE_LAG_SECONDS);
  const velocity = state.velocity + (wanted - state.velocity) * share;
  const next = state.at + velocity * dt;
  if (remaining !== 0 && (target - next) * remaining <= 0) return { at: target, velocity: 0 };
  return { at: next, velocity };
}

/**
 * Whether the ramp is the right law for this frame, or the spring is.
 *
 * Both conditions are load-bearing. The stream has to be alive AND slow enough to be stepping in the first place (a
 * fast run is already uniform on the spring, and that is the feel the reader approved, so it is left alone), and the
 * target has to be further away than the distance it takes to stop — once it is not, the spring owns the landing.
 * `speed > 0` because a gesture whose rate is not known yet has nothing to ramp at: that is the first notch, and the
 * spring is what the reader tuned for it.
 */
export function streamCarries(
  remaining: number,
  velocity: number,
  speed: number,
  streamSecondsLeft: number,
  gapSeconds: number,
): boolean {
  return streamSecondsLeft > 0
    && speed > 0
    && gapSeconds >= SLOW_STREAM_GAP_SECONDS
    && Math.abs(remaining) > Math.abs(velocity) * BRAKE_LOOKAHEAD_SECONDS;
}

/**
 * One integration step of the spring, in closed form.
 *
 * Time-based (`dt` in seconds) rather than per-frame, so the feel does not change with the display's refresh rate, and
 * the clamp above keeps a stalled frame from becoming a jump. The stiffness is a parameter because it follows the
 * gesture (see above), and the damping is derived from it here rather than stored, so no caller can pair a stiffness
 * with a damping that bounces.
 *
 * CLOSED FORM, not a per-frame step. Stepping the acceleration by hand is only accurate while `ω·dt` is small, and at
 * the flick end of the stiffness range `ω·dt` reaches 0.85 at 60Hz — close enough to the stability limit that the
 * position overshot and came back, which showed up as a bounce and as a "settling" that crossed the threshold early.
 * The critically damped solution is exact at ANY `dt`, so the curve is the ideal one no matter the refresh rate.
 */
export function springStep(state: GlideState, target: number, dtSeconds: number, stiffness: number = STIFFNESS_SLOW): GlideState {
  const dt = Math.min(Math.max(dtSeconds, 0), MAX_STEP_SECONDS);
  const omega = Math.sqrt(stiffness);
  const offset = state.at - target;
  const slope = state.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  const next = target + (offset + slope * dt) * decay;
  const velocity = (slope - omega * (offset + slope * dt)) * decay;
  // Belt on top of the exact solution, for the clamped `dt` above: a step may never land past the target.
  if (state.at !== target && (target - state.at) * (target - next) <= 0) return { at: target, velocity: 0 };
  return { at: next, velocity };
}

/**
 * Install the forwarding listener.
 *
 * Capture phase and non-passive, so it runs before anything else and its `preventDefault` keeps the notch from also
 * being taken as a page gesture.
 */
export function installResizerWheel(doc: Document): () => void {
  const view = doc.defaultView;
  if (view === null) return () => undefined;
  let target: number | null = null;
  let state: GlideState = { at: 0, velocity: 0 };
  let stiffness = STIFFNESS_SLOW;
  let lastNotch = Number.NEGATIVE_INFINITY;
  let frame = 0;
  let last = 0;
  /** The speed the current stream is asking for (see `streamSpeed`), 0 when there is no stream to speak of. */
  let stream = 0;
  /** The intervals behind the last notch, newest last: the window the pace is averaged over, empty when the run broke. */
  let pace: number[] = [];
  /** The clock second until which that stream counts as alive. */
  let streamUntil = 0;
  /** The interval that preceded the last notch: the ramp's own criterion for taking over. */
  let lastGap = Number.POSITIVE_INFINITY;

  /** The reading view's scroller, or null when the reader is not the mounted view. */
  const readerScroller = (): Element | null =>
    doc.querySelector(READER_ROOT)?.closest(SCROLLER) ?? null;

  const glide = (stamp: number): void => {
    frame = 0;
    const scroller = readerScroller();
    // Dropping the glide discards the position with it: leaving `state` behind would have the NEXT gesture integrate
    // from a stale `at`, which is the same kind of jump the seeding above exists to prevent. `last` goes too, so the
    // first frame of that gesture is a nominal step rather than the gap since the abandoned one.
    if (target === null || scroller === null) {
      target = null;
      state = { at: 0, velocity: 0 };
      last = 0;
      return;
    }
    const dt = last === 0 ? 1 / 60 : (stamp - last) / 1000;
    last = stamp;
    // The step is integrated from OUR position, never from `scroller.scrollTop`: reading the scroll position back is
    // rounded to whole pixels, so a glide whose frames move a fraction of a pixel loses its progress at every frame —
    // a 1px jitter per frame that is invisible while scrolling fast (7–15px frames) and is exactly the "stutter" the
    // reader reported on a single slow notch, where softening the curve could not help because the curve was fine.
    //
    // WHICH LAW. A live, slow stream is carried at its own speed (see the header); everything else — the first notch
    // of a gesture, a fast run, and every landing — stays on the spring the reader tuned by eye. The choice is taken
    // per frame from the state rather than latched, so a run that speeds up, slows down or stops mid-flight changes
    // law without a seam: both laws read and write the same position and velocity.
    //
    // A LIVE STREAM THAT HAS CAUGHT ITS TARGET WAITS THERE INSTEAD OF LANDING.
    //
    // This is NOT where the unevenness of a hand was felt, and the measurement is what says so: a position that has
    // reached the target is at the wheel's own position, so the motion stops there whether the glide lands or waits —
    // measured identical on a deliberately uneven roll. What it buys is the state: landing drops the target and stops
    // asking for frames, so the next notch re-reads `scroller.scrollTop` and starts again from the painted (rounded)
    // number, while waiting keeps the exact float and lets the next notch continue from it. Sub-pixel, but it is the
    // same rounding the integration above exists to avoid, and a long slow roll crosses this point often.
    if (stamp / 1000 < streamUntil && Math.abs(target - state.at) < GLIDE_EPSILON) {
      state = { at: target, velocity: 0 };
      scroller.scrollTop = target;
      frame = view.requestAnimationFrame(glide);
      return;
    }
    state = streamCarries(target - state.at, state.velocity, stream, streamUntil - stamp / 1000, lastGap)
      ? cruiseStep(state, target, dt, stream)
      : springStep(state, target, dt, stiffness);
    // Landing is on the target itself, and the threshold is deliberately not sub-pixel: a main-thread `scrollTop` is
    // PAINTED at whole pixels, so a tail that creeps by a fraction of one renders as 0/1/0/1 — a stutter at the end of
    // every notch, which is what is left once the velocity profile is right. Two pixels is under the eye's notice.
    // Distance alone decides it: a velocity gate here was a second knob that went out of step with the stiffness.
    if (Math.abs(target - state.at) < GLIDE_EPSILON) {
      scroller.scrollTop = target;
      target = null;
      state = { at: 0, velocity: 0 };
      last = 0;
      return;
    }
    scroller.scrollTop = state.at;
    frame = view.requestAnimationFrame(glide);
  };

  const onWheel = (event: WheelEvent): void => {
    const element = event.target;
    if (!(element instanceof view.Element)) return;
    const scroller = readerScroller();
    if (scroller === null) return;
    const column = scroller.closest(COLUMN);
    if (column === null) return;
    const style = view.getComputedStyle(element);
    if (!handleTakesWheel(style.cursor, column.contains(element))) return;
    const lineHeight = Number.parseFloat(view.getComputedStyle(scroller).lineHeight);
    const pixels = wheelPixels(event.deltaY, event.deltaMode, lineHeight, scroller.clientHeight);
    event.preventDefault();
    // A wheel reaching the scroller is what tells the reading view the reader has taken over; ours never lands there
    // on its own, so the same gesture is announced — otherwise auto-follow would pull the glide back.
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: event.deltaY, deltaMode: event.deltaMode, bubbles: true }));
    const now = view.performance.now() / 1000;
    const gap = now - lastNotch;
    stiffness = stiffnessForGap(gap);
    lastNotch = now;
    // A pause longer than the hold this gap would itself grant is a stream that has ENDED, not one continuing, and
    // that notch is the FIRST of a new gesture: it is left to the spring, exactly like the tuned lone notch it is.
    // Two things would otherwise go wrong — a stale rate surviving a pause (a lone notch after a fast run carried at
    // the fast run's speed, leaping at the target's clamp), and a long pause being read as a rate at all (a single
    // notch after a second of nothing dragged 100px over a whole second at 100px/s, instead of the 0.22s glide the
    // reader asked for).
    //
    // `pace` is the interval before the previous notch, and it only advances on a notch that continued a run: the
    // pause itself is not a pace, so a gesture that follows one has to build its evidence again from the two intervals
    // after it. That is what makes the arming in `streamSpeed` survive a pause rather than leak through it. A gap that
    // cannot be a pace at all — a chattering device reporting two notches inside one millisecond — CLEARS the window
    // instead of joining it, since one zero in the average would drag the whole run's speed down with it.
    if (gap > streamHoldSeconds(gap)) {
      stream = 0;
      pace.length = 0;
      streamUntil = now;
    } else {
      if (gap > 0 && Number.isFinite(gap)) {
        pace.push(gap);
        if (pace.length > STREAM_WINDOW) pace.shift();
      } else {
        pace.length = 0;
      }
      stream = streamSpeed(pace, pixels);
      streamUntil = now + streamHoldSeconds(gap);
    }
    lastGap = gap;
    // Seed the position from the element only when NO glide is running — the start of a gesture — and this has to sit
    // BEFORE the target moves. It used to sit after it, so `target === null` was never true, the seed never ran, and
    // the first frame integrated from the state's initial zero: the scroller jumped to the very top and glided back
    // down, which is the oscillation the reader reported. Mid-glide our own state is the truth, and reading `scrollTop`
    // back would re-introduce exactly the whole-pixel rounding this avoids; keeping it also lets the velocity
    // accumulate across notches, which is what makes a flick continuous. Velocity starts at rest: a gesture begins
    // from the element, not from whatever the previous glide happened to be carrying.
    if (target === null) state = { at: scroller.scrollTop, velocity: 0 };
    target = (target ?? scroller.scrollTop) + pixels;
    // The reader's own motion switch decides whether there is a glide at all: with it off the notch lands at once.
    if (doc.querySelector(READER_ROOT)?.getAttribute('data-motion') === 'off') {
      scroller.scrollTop = target;
      target = null;
      state = { at: 0, velocity: 0 };
      last = 0;
      return;
    }
    // One animation frame drives every notch in the run: a notch that arrives mid-glide only moves the target.
    if (frame === 0) frame = view.requestAnimationFrame(glide);
  };
  view.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => {
    view.removeEventListener('wheel', onWheel, { capture: true });
    if (frame !== 0) view.cancelAnimationFrame(frame);
    target = null;
    state = { at: 0, velocity: 0 };
    lastNotch = Number.NEGATIVE_INFINITY;
    last = 0;
    frame = 0;
    stream = 0;
    pace.length = 0;
    streamUntil = 0;
    lastGap = Number.POSITIVE_INFINITY;
  };
}
