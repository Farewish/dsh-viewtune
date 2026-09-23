/**
 * The listener's own end of the forwarding: what it does to a scroller that is NOT at the top.
 *
 * The pure helpers cannot see this, and the mistake pinned here was invisible to them: the glide seeds its position
 * from the element when a gesture BEGINS, and the first version of that seeding sat AFTER the target had already been
 * moved — so `target === null` was never true, the seed never ran, and the first frame integrated from the state's
 * initial zero. The scroller jumped to the very top and glided back down: reported as 「先瞬间到最顶上，再回来，上下抽动」
 * A test that only drives `springStep` cannot see an ordering mistake in the listener, so this one drives the listener.
 *
 * The DOM is a stub rather than jsdom, for the reason this suite is hand-rolled at all: the sandbox forbids the child
 * processes a real environment spawns. Only the handful of members `installResizerWheel` touches are provided, and the
 * member that matters is the WRITE — every `scrollTop` assignment is recorded, and reading it back returns the rounded
 * number a browser actually paints (which is what makes the "never read it back" rule meaningful rather than free).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installResizerWheel } from '../src/client/resizer-wheel.ts';

const READER_ROOT = '[data-dsh-better-display]';
const SCROLLER_SELECTOR = '_scrollBody';
const COLUMN_SELECTOR = '_centerCol';
/** What the scroller starts at: far enough from the top that a jump to zero cannot be mistaken for a small step. */
const START = 500;
/** One notch, in pixels. */
const NOTCH = 100;

/** A stand-in for the global the module announces the gesture with (`WheelEvent` is not a Node global). */
class FakeWheelEvent {
  constructor(readonly type: string, readonly init: { deltaY?: number; deltaMode?: number } = {}) {}
}
(globalThis as unknown as Record<string, unknown>).WheelEvent = FakeWheelEvent;

interface NotchEvent {
  prevented: number;
}

interface Harness {
  /** Every value written to `scrollTop`, in order, un-rounded — the positions the reader would see. */
  readonly writes: number[];
  /** The gestures announced to the scroller, which is how the reading view's auto-follow lets go. */
  readonly announced: unknown[];
  /** Frames the listener is still waiting for. */
  readonly pendingFrames: number;
  /** Where the scroller is now. */
  readonly position: number;
  /** Move the wall clock the listener reads when a notch arrives. */
  at(milliseconds: number): void;
  notch(deltaY: number): NotchEvent;
  /** Run the frame the listener asked for, at this timestamp in milliseconds. */
  frame(stamp: number): void;
  dispose(): void;
}

function harness(options: { cursor?: string; motion?: string } = {}): Harness {
  const writes: number[] = [];
  const announced: unknown[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const frames = new Map<number, (stamp: number) => void>();
  const clock = { milliseconds: 1000 };
  let nextFrame = 1;
  let position = START;

  const handle = { cursor: options.cursor ?? 'col-resize' };
  const column = { contains: (node: unknown): boolean => node === handle };
  const scroller = {
    clientHeight: 800,
    // The write is the record; the read is the browser's own rounding of it, and the two are deliberately different —
    // a glide that lost its progress to that rounding is the stutter the state-based integration exists to remove.
    set scrollTop(value: number) {
      writes.push(value);
      position = Math.round(value);
    },
    get scrollTop(): number {
      return position;
    },
    closest: (selector: string) => (selector.includes(COLUMN_SELECTOR) ? column : null),
    dispatchEvent: (event: unknown): boolean => {
      announced.push(event);
      return true;
    },
  };
  const root = {
    closest: (selector: string) => (selector.includes(SCROLLER_SELECTOR) ? scroller : null),
    getAttribute: (name: string) => (name === 'data-motion' ? (options.motion ?? 'on') : null),
  };
  const view = {
    Element: Object,
    performance: { now: () => clock.milliseconds },
    getComputedStyle: (node: unknown) =>
      node === handle ? { cursor: handle.cursor } : { cursor: 'auto', lineHeight: '16px' },
    requestAnimationFrame: (callback: (stamp: number) => void): number => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number): void => void frames.delete(id),
    addEventListener: (type: string, handler: (event: unknown) => void): void => {
      if (type === 'wheel') listeners.push(handler);
    },
    removeEventListener: (): void => undefined,
  };
  const doc = {
    defaultView: view,
    querySelector: (selector: string) => (selector === READER_ROOT ? root : null),
  };

  const dispose = installResizerWheel(doc as unknown as Document);
  assert.equal(listeners.length, 1, 'the installer registers exactly one wheel listener');
  return {
    writes,
    announced,
    get pendingFrames() {
      return frames.size;
    },
    get position() {
      return position;
    },
    at(milliseconds: number): void {
      clock.milliseconds = milliseconds;
    },
    notch(deltaY: number): NotchEvent {
      const event = {
        target: handle,
        deltaY,
        deltaMode: 0,
        prevented: 0,
        preventDefault(this: NotchEvent): void {
          this.prevented += 1;
        },
      };
      listeners[0](event);
      return event;
    },
    frame(stamp: number): void {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(stamp);
    },
    dispose,
  };
}

test('the first frame glides from where the reader is, never from the top', () => {
  const h = harness();
  try {
    h.notch(NOTCH);
    h.frame(1000);
    assert.equal(h.writes.length, 1, 'one frame, one write');
    const first = h.writes[0];
    // The reported bug: this was a handful of pixels above zero, so the transcript flashed to the top of the
    // conversation and glided back. Anything near the journey's START is that jump, whatever the spring does after it.
    assert.ok(first > START - 1, `the first frame wrote ${String(first)} — the scroller jumped to the top`);
    assert.ok(first <= START + NOTCH + 0.001, `the first frame overshot the notch: ${String(first)}`);
  } finally {
    h.dispose();
  }
});

test('the glide never reverses, and lands exactly on the target', () => {
  const h = harness();
  try {
    h.notch(NOTCH);
    let stamp = 1000;
    while (h.pendingFrames > 0 && h.writes.length < 240) {
      h.frame(stamp);
      stamp += 1000 / 60;
    }
    assert.ok(h.writes.length > 3, `the glide finished in ${String(h.writes.length)} frame(s)`);
    for (const [index, value] of h.writes.entries()) {
      assert.ok(
        value >= START - 1 && value <= START + NOTCH + 0.001,
        `frame ${String(index)} wrote ${String(value)}, outside the notch's own travel`,
      );
      if (index > 0) {
        assert.ok(value >= h.writes[index - 1], `frame ${String(index)} went backwards: ${String(h.writes[index - 1])} → ${String(value)}`);
      }
    }
    assert.equal(h.writes.at(-1), START + NOTCH, 'the glide lands exactly on the target');
    assert.equal(h.pendingFrames, 0, 'and stops asking for frames');
  } finally {
    h.dispose();
  }
});

test('a notch over the transcript itself is left to the browser', () => {
  const h = harness({ cursor: 'auto' });
  try {
    const event = h.notch(NOTCH);
    assert.equal(event.prevented, 0, 'the browser keeps its notch');
    assert.equal(h.writes.length, 0, 'and nothing writes a scroll position');
    assert.equal(h.announced.length, 0);
    assert.equal(h.pendingFrames, 0);
  } finally {
    h.dispose();
  }
});

test('the gesture is announced to the scroller, so auto-follow lets go', () => {
  const h = harness();
  try {
    h.notch(NOTCH);
    assert.equal(h.announced.length, 1, 'one notch, one announcement');
    assert.equal((h.announced[0] as FakeWheelEvent).type, 'wheel');
    assert.equal((h.announced[0] as FakeWheelEvent).init.deltaY, NOTCH, 'the announcement carries the same delta');
  } finally {
    h.dispose();
  }
});

test('with motion off the notch lands at once', () => {
  const h = harness({ motion: 'off' });
  try {
    h.notch(NOTCH);
    assert.deepEqual(h.writes, [START + NOTCH], 'the notch is applied whole, with no glide to animate');
    assert.equal(h.pendingFrames, 0);
  } finally {
    h.dispose();
  }
});

test('disposing leaves nothing running', () => {
  const h = harness();
  h.notch(NOTCH);
  assert.ok(h.pendingFrames > 0, 'a glide is in flight');
  h.frame(1000);
  const moved = h.writes.length;
  assert.ok(moved > 0, 'the glide has moved the scroller');
  h.dispose();
  assert.equal(h.pendingFrames, 0, 'the frame is cancelled with the listener');
  h.frame(1200);
  assert.equal(h.writes.length, moved, 'and the position is left where the reader was');
});

/**
 * A steady roll of the wheel: one notch every `gapFrames` frames, frames at 60Hz, with the wall clock kept in step so
 * the listener measures the intervals it is being given. Returns the distance the scroller moved on each frame, which
 * is exactly what the reader is judging when they say one scroll is even and another is not.
 */
function roll(h: Harness, options: { gapFrames: number; frames: number; pixels: number }): number[] {
  const frameMilliseconds = 1000 / 60;
  let clock = 1000;
  h.at(clock);
  const steps: number[] = [];
  let at = h.position;
  for (let frame = 0; frame < options.frames; frame++) {
    if (frame % options.gapFrames === 0) h.notch(options.pixels);
    clock += frameMilliseconds;
    h.at(clock);
    h.frame(clock);
    steps.push(h.position - at);
    at = h.position;
  }
  return steps;
}

test('a steady slow roll moves at an even speed, notch after notch', () => {
  const h = harness();
  try {
    // 183ms between notches — a deliberate slow roll at the slowest interval the ceiling still calls one run. A fast run
    // was never the complaint either: there the target keeps moving and the spring is already tracking a ramp.
    const steps = roll(h, { gapFrames: 11, frames: 11 * 12, pixels: NOTCH });
    // The run-up and the run's own END are both skipped: the first notch has no interval to measure and is carried by the
    // spring (the lone-notch feel, tuned by eye and deliberately untouched), and the last notch has no successor, so what
    // follows it is the spring's landing rather than the carried motion this test is about.
    const settled = steps.slice(11 * 3, 11 * 10);
    const slowest = Math.min(...settled);
    const fastest = Math.max(...settled);
    assert.ok(slowest > 0, `a live stream stood still for a frame (min ${String(slowest)}, max ${String(fastest)})`);
    // The reported shape was accelerate-then-wait: a spring that arrives well before the next notch, so the frame
    // steps swing between a full step and nothing at all — measured at 0 → 15px per frame on a roll like this before the
    // change, at the stiffness of that day. What is left is measured too: the run's body averages 9.05px a frame where
    // the wheel asks for 9.09 (half a percent over the window), stepping 8 → 11 because a 9.09px frame lands on a
    // different whole pixel each time, and the occasional slower frame is the last few pixels of an interval, which the
    // ramp hands to the spring to be decelerated — a per-notch touch of softness rather than the stop-and-go that was
    // reported. The bound is set above that and far below the swing it replaced.
    assert.ok(
      fastest <= slowest * 1.7,
      `the speed swings ${slowest.toFixed(2)} → ${fastest.toFixed(2)} px per frame, which is the stepping reported`,
    );
    // …and it is the WHEEL'S OWN speed, not merely a constant one: 100px every 183ms is 545px/s.
    const asked = NOTCH / (11 / 60) / 60;
    const average = settled.reduce((sum, step) => sum + step, 0) / settled.length;
    assert.ok(
      Math.abs(average - asked) / asked < 0.15,
      `the stream moves ${average.toFixed(2)} px per frame where the wheel asks for ${asked.toFixed(2)}`,
    );
  } finally {
    h.dispose();
  }
});

test('a lone notch is still the spring, at the pace it was tuned to', () => {
  const h = harness();
  try {
    h.at(1000);
    h.notch(NOTCH);
    let clock = 1000;
    let frames = 0;
    while (h.pendingFrames > 0 && frames < 240) {
      clock += 1000 / 60;
      h.at(clock);
      h.frame(clock);
      frames += 1;
    }
    const seconds = frames / 60;
    assert.ok(seconds > 0.15 && seconds < 0.35, `a lone notch took ${seconds.toFixed(2)}s, not the tuned glide`);
    assert.equal(h.position, START + NOTCH, 'and it lands exactly on the notch');
  } finally {
    h.dispose();
  }
});

/**
 * The reader's second report on the ramp, and the trap the first version of this test fell into.
 *
 * The interval that matters is between NOTCH ARRIVALS, not between the ends of the glides: adding a pause after the
 * first notch has come to rest makes the real interval the glide's own fifth of a second PLUS the pause, so every
 * case in that version was above the hold ceiling and the test could not fail whatever the arming rule said. Here the
 * second notch is delivered at the moment one interval after the first, mid-glide where an interval is that short —
 * which is exactly the case that used to be carried at the pause's own pace.
 *
 * Both rules are covered. 220ms and up are past the ceiling — five notches a second is where a run stops being one — so
 * there the gap itself ends the run and each notch gets the discrete glide. The ARMING case (an interval inside the hold
 * that is nonetheless two separate turns of the wheel) can no longer be staged here: the ceiling has come down to within
 * a lone notch's own glide, so any interval short enough to stay inside it arrives while the first notch is still
 * moving, and the two are not comparable frame for frame. That rule is pinned where it lives instead, by the unit test
 * of `streamSpeed` returning 0 for a single interval. The ceiling needs a run before the pause to show itself at all —
 * with only two notches the arming rule has already answered — so it gets its own case below.
 */
test('two notches are two notches, however close together they are', () => {
  for (const gapMilliseconds of [240, 300, 600, 900]) {
    const h = harness();
    try {
      const clock = { at: 1000 };
      const run = (): number => {
        let frames = 0;
        while (h.pendingFrames > 0 && frames < 240) {
          clock.at += 1000 / 60;
          h.at(clock.at);
          h.frame(clock.at);
          frames += 1;
        }
        return frames;
      };
      h.at(clock.at);
      const notchAt = clock.at;
      h.notch(NOTCH);
      const first = run();
      const before = h.position;
      // A deliberate second turn of the wheel, one interval after the first — 「两次滚动间有明显间隔」
      clock.at = notchAt + gapMilliseconds;
      h.at(clock.at);
      h.notch(NOTCH);
      const second = run();
      assert.ok(
        Math.abs(second - first) <= 2,
        `a notch ${String(gapMilliseconds)}ms after the previous one took ${String(second)} frames against the first one's ${String(first)}`,
      );
      assert.equal(h.position, before + NOTCH, 'and it still lands exactly on its own notch');
    } finally {
      h.dispose();
    }
  }
});

test('an uneven hand still gets an even glide', () => {
  const h = harness();
  try {
    // The reader's own note on the tolerance this needs: 「人滑动滚轮不可能完全匀速，所以要加一点容错」 Two intervals at the
    // pace, then one noticeably longer — a hand hesitating, which is what a real roll is. The long one has to stay
    // inside the hold ceiling, because past that the model deliberately treats the notches as two turns of the wheel
    // rather than one run, so the jitter here is 167ms / 167ms / 183ms and the averaged pace is the hand's own 581px/s.
    const frameMilliseconds = 1000 / 60;
    const pattern = [10, 10, 11];
    let nextNotchAt = 0;
    let notch = 0;
    let clock = 1000;
    h.at(clock);
    const steps: number[] = [];
    let previous = h.position;
    for (let frame = 0; frame < 15 * 40; frame += 1) {
      if (frame === nextNotchAt) {
        h.notch(NOTCH);
        nextNotchAt += pattern[notch % pattern.length];
        notch += 1;
      }
      clock += frameMilliseconds;
      h.at(clock);
      h.frame(clock);
      steps.push(h.position - previous);
      previous = h.position;
    }
    const swing = steps.slice(60);
    const slowest = Math.min(...swing);
    const fastest = Math.max(...swing);
    assert.ok(slowest > 0, `an uneven hand stood still for a frame (min ${String(slowest)}, max ${String(fastest)})`);
    // Measured at 8.0 → 12.0px per frame, where the hand's own 581px/s is 9.7px a frame: most of that spread is the
    // painted position's whole-pixel rounding at a pace this high, and the rest is the per-notch handover to the spring
    // — against 2.0 → 7.0px while the speed followed single intervals.
    assert.ok(fastest <= slowest * 1.6, `the speed swings ${slowest.toFixed(1)} → ${fastest.toFixed(1)} px per frame`);
  } finally {
    h.dispose();
  }
});

test('a pause inside a run ends it, and the notch after it is a lone notch again', () => {
  const frameMilliseconds = 1000 / 60;
  /** Frames a notch takes to come to rest, driven on the frame grid from the moment it arrives. */
  const glideFrames = (h: Harness, start: number): { frames: number; clock: number } => {
    let clock = start;
    let frames = 0;
    while (h.pendingFrames > 0 && frames < 240) {
      clock += frameMilliseconds;
      h.at(clock);
      h.frame(clock);
      frames += 1;
    }
    return { frames, clock };
  };
  // The baseline, measured rather than assumed: a lone notch is the feel that was tuned by eye.
  const baseline = harness();
  let lone = 0;
  try {
    baseline.at(1000);
    baseline.notch(NOTCH);
    lone = glideFrames(baseline, 1000).frames;
  } finally {
    baseline.dispose();
  }
  const h = harness();
  try {
    // Four notches 200ms apart: a steady roll, so by the fourth the ramp owns it and a pace is established.
    roll(h, { gapFrames: 12, frames: 12 * 4, pixels: NOTCH });
    const lastNotchAt = 1000 + 12 * 3 * frameMilliseconds;
    // Frames keep running between two turns of the wheel: the run's own tail is delivered and the glide comes to rest,
    // which is what makes the next notch a NEW gesture rather than the continuation of a glide still in flight. Jumping
    // the clock over this instead — as the first version of this test did — leaves the tail's speed to be carried into
    // the notch after the pause, and measures an artifact of the test rather than of the listener.
    glideFrames(h, 1000 + 12 * 4 * frameMilliseconds);
    // …then a 600ms pause, which is past the hold ceiling: an interval that long is two turns of the wheel, not one
    // stream, and the pause must not be read as a pace either. With the ceiling at the 0.9s it started on, this notch
    // was carried at a pace averaged from the run's 200ms and this 600ms and took 26 frames to arrive — 0.43s of drift
    // for one notch, against the baseline's fourteen — which is the reader's report one notch further along: a notch
    // that should be the tuned glide becomes whatever the arithmetic between two unrelated intervals happens to say.
    const arrival = lastNotchAt + 600;
    h.at(arrival);
    h.notch(NOTCH);
    const after = glideFrames(h, arrival);
    assert.ok(
      Math.abs(after.frames - lone) <= 2,
      `the notch after the pause took ${String(after.frames)} frames against a lone notch's ${String(lone)}`,
    );
  } finally {
    h.dispose();
  }
});

test('a pause ends the stream: a later notch is not carried at the old speed', () => {
  const h = harness();
  try {
    // 50ms apart — a fast run, whose rate is many times a single notch's.
    const steps = roll(h, { gapFrames: 3, frames: 3 * 8, pixels: NOTCH });
    assert.ok(Math.max(...steps) > 5, 'the fast run really was fast');
    let clock = 1000 + 24 * (1000 / 60);
    h.at(clock + 1000);
    h.notch(NOTCH);
    let frames = 0;
    while (h.pendingFrames > 0 && frames < 240) {
      clock += 1000 / 60;
      h.at(clock);
      h.frame(clock);
      frames += 1;
    }
    const seconds = frames / 60;
    // Carried at the fast run's own rate this would be over in a couple of frames; dragged at the second-long gap's
    // own rate it would take a whole second. Either way it is not the glide a single notch is supposed to get.
    assert.ok(seconds > 0.15 && seconds < 0.5, `the notch after a pause took ${seconds.toFixed(2)}s`);
  } finally {
    h.dispose();
  }
});
