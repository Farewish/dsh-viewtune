/**
 * The column handles' wheel forwarding.
 *
 * Three properties are pinned, each of which the reader felt the absence of: the notch is converted out of the wheel's
 * own units (a line-mode notch forwarded as pixels moved a different distance from the transcript); the spring never
 * overshoots and settles within a window they asked for; and the stiffness FOLLOWS THE GESTURE, because one spring
 * cannot serve both speeds — that was their last report exactly (fast felt right at a high stiffness, slow felt jerky;
 * slow felt right at a low one, fast dragged).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cruiseStep, handleTakesWheel, springStep, stiffnessForGap, streamCarries, streamHoldSeconds, streamSpeed, wheelPixels } from '../src/client/resizer-wheel.ts';

const FRAME = 1 / 60;

/** How many frames a 100px notch needs at this stiffness. */
function settleFrames(stiffness: number): number {
  let state = { at: 0, velocity: 0 };
  let frames = 0;
  while (frames < 240 && Math.abs(100 - state.at) >= 2) {
    state = springStep(state, 100, FRAME, stiffness);
    assert.ok(state.at <= 100.001, `overshot to ${state.at} on frame ${frames} at stiffness ${stiffness}`);
    frames++;
  }
  return frames;
}

test('only the reading column’s own resize cursor forwards the wheel', () => {
  assert.equal(handleTakesWheel('col-resize', true), true, 'the handle beside the transcript');
  assert.equal(handleTakesWheel('col-resize', false), false, 'a resizer elsewhere in the shell is left alone');
  assert.equal(handleTakesWheel('auto', true), false, 'the transcript itself scrolls natively');
  assert.equal(handleTakesWheel('pointer', true), false, 'and so does anything else in the column');
  assert.equal(handleTakesWheel('', false), false, 'nothing at all when both conditions fail');
});

test('a notch becomes pixels, whichever unit the wheel reported', () => {
  assert.equal(wheelPixels(100, 0, 24, 800), 100, 'pixels are already pixels');
  assert.equal(wheelPixels(3, 1, 24, 800), 72, 'lines are multiplied by the line height');
  assert.equal(wheelPixels(3, 1, Number.NaN, 800), 48, 'and fall back to a conventional one when unstated');
  assert.equal(wheelPixels(1, 2, 24, 800), 800, 'pages are multiplied by the viewport height');
});

test('the stiffness follows the gesture, continuously', () => {
  const flick = stiffnessForGap(0);
  const lone = stiffnessForGap(1);
  assert.ok(flick > lone, `a flick gets the stiffer spring: ${flick} vs ${lone}`);
  // A band rather than two exact anchors: these are the reader's own feel, and they have moved them several times. What
  // must hold is the ORDER (a flick gets the stiffer spring), a floor on the soft end (below this a lone notch stops
  // being a glide and starts being a drift that never lands) and a ceiling on the stiff one (past it the first frame
  // carries the whole notch). The reader has taken the soft end down twice, so the floor sits well under their value.
  assert.ok(lone >= 400, `the soft end fell back to ${lone}`);
  assert.ok(flick <= 4000, `the snappy end ran away to ${flick}`);
  // Continuous in between, and clamped at both ends: a step here would be felt as a change of character mid-scroll.
  const midway = stiffnessForGap(0.125);
  assert.ok(midway < flick && midway > lone, `midway ${midway} is between ${lone} and ${flick}`);
  assert.equal(stiffnessForGap(-5), flick, 'a negative gap (a clock quirk) is treated as back-to-back');
  assert.equal(stiffnessForGap(10), lone, 'and a very long gap as fully on its own');
});

test('both ends of the stiffness settle cleanly, and the flick is the quicker of the two', () => {
  const fast = settleFrames(stiffnessForGap(0));
  const slow = settleFrames(stiffnessForGap(1));
  // The window the reader asked for, from both ends: too long is the inertia they complained about, too short is a
  // jump rather than a glide. The flick end sits at the short side of it — that is the shape they called "almost
  // identical" while scrolling quickly.
  assert.ok(fast >= 4 && fast <= 9, `the flick settles in ${fast} frames`);
  // The slow ceiling is loose because the reader keeps asking for a softer lone notch: it is there to catch the
  // "inertia" verdict they gave once, not to hold their value in place.
  assert.ok(slow >= 6 && slow <= 20, `a lone notch settles in ${slow} frames`);
  assert.ok(fast < slow, `the flick must be the quicker one: ${fast} vs ${slow}`);
});

test('a stalled frame is clamped, and can never land past the target', () => {
  const stalled = springStep({ at: 0, velocity: 0 }, 100, 2, stiffnessForGap(0));
  const normal = springStep({ at: 0, velocity: 0 }, 100, FRAME, stiffnessForGap(0));
  // The gap is treated as one long frame rather than two seconds of motion, so it moves further than a normal frame…
  assert.ok(stalled.at > normal.at, `stalled ${stalled.at} vs normal ${normal.at}`);
  // …but it still may not pass the target. The closed form cannot overshoot from rest, so this is the belt rather than
  // the load-bearing part; it is what keeps an inconsistent state — or a future change to the integrator — honest.
  assert.ok(stalled.at <= 100.001, `a two-second gap moved ${stalled.at}`);
});

test('the step clamp catches a state that would otherwise land past the target', () => {
  // Not reachable from rest, which is why the belt exists rather than a guarantee the curve needs: a state already
  // moving faster than it needs to be. The step must land exactly on the target and drop the speed there.
  const caught = springStep({ at: 99, velocity: 5000 }, 100, FRAME, stiffnessForGap(0));
  assert.deepEqual(caught, { at: 100, velocity: 0 });
});

test('a default stiffness is the soft end, so a caller that omits it cannot be the snappy one by accident', () => {
  assert.deepEqual(springStep({ at: 0, velocity: 0 }, 100, FRAME), springStep({ at: 0, velocity: 0 }, 100, FRAME, stiffnessForGap(1)));
});

test('the stream speed is the wheel’s own distance per second', () => {
  // 100px every 300ms is 333px/s: the same distance per second the wheel is asking for, which is what makes a steady
  // hand produce a steady transcript instead of a spring that arrives early and waits.
  assert.ok(Math.abs(streamSpeed([0.3, 0.3], 100) - 100 / 0.3) < 0.001);
  // ONE interval is not a pace. This is the reader's second report on this change: two deliberate turns of the wheel
  // with a pause between them were carried at the pace of that pause, which reads as a drift.
  assert.equal(streamSpeed([], 100), 0, 'nothing to go on');
  assert.equal(streamSpeed([0.5], 100), 0, 'and one interval is still nothing: the arming needs two');
  assert.equal(streamSpeed([0, 0], 100), 0, 'a window that averages to nothing is not a speed either');
  // The tolerance the reader asked for, and the part that is easy to get wrong: the INTERVALS are averaged, not their
  // rates. Averaging rates pulls the mean toward the short ones — for a 250ms, 250ms, 400ms hand, rates give 350px/s
  // where the hand is actually going 333 — and that surplus drains the backlog over a long roll until the motion stops
  // dead. The mean interval inverted is the hand's own speed, so a periodic hand gets a constant one.
  assert.ok(Math.abs(streamSpeed([0.25, 0.25, 0.4], 100) - 100 / 0.3) < 0.001, 'the hand’s own average');
  assert.ok(streamSpeed([0.25, 0.25, 0.4], 100) < (100 / 0.25 + 100 / 0.25 + 100 / 0.4) / 3, 'not the mean of rates');
  // A line-mode notch is respected whatever the window says, and a chattering device is capped rather than obeyed.
  assert.ok(Math.abs(streamSpeed([0.3, 0.3], 48) - 160) < 0.001, 'a shorter notch is a shorter distance');
  assert.equal(streamSpeed([0.001, 0.001], 100), 6000, 'the cap guards a chattering device, not a feel');
  // Unsigned: the direction rides the accumulated target, so a reversal needs no second piece of state.
  assert.equal(streamSpeed([0.3, 0.3], -100), streamSpeed([0.3, 0.3], 100));
});

test('a stream outlives the interval it is derived from, up to the ceiling', () => {
  // The property the bridge rests on: within the bridging band the hold is longer than the interval, or a steady roll
  // would fall out of its own stream between notches and the stepping would come straight back. The band ends at the
  // ceiling — five notches a second — which is the reader's own comparison against the browser: at one hand speed the
  // STRIPS were the even ones, so only a roll that is plainly a run is carried.
  for (const gap of [0.1, 0.15, 0.18]) {
    assert.ok(streamHoldSeconds(gap) > gap, `a ${gap}s interval gets only ${streamHoldSeconds(gap)}s of hold`);
  }
  // Above the ceiling the opposite is true, and deliberately: an interval longer than this is not one stream, it is
  // two turns of the wheel, and the reader asked for those to stay discrete rather than be bridged into a drift.
  for (const gap of [0.22, 0.3, 0.4, 0.9, 3]) {
    assert.ok(streamHoldSeconds(gap) < gap, `a ${gap}s interval must not be bridged`);
  }
  assert.equal(streamHoldSeconds(0.02), 0.12, 'a fast roll is floored, not scaled away');
  assert.equal(streamHoldSeconds(3), 0.2, 'and the ceiling holds');
  assert.equal(streamHoldSeconds(Number.POSITIVE_INFINITY), 0.12, 'a first notch still gets a hold');
});

test('the ramp holds the stream’s speed and never passes the target', () => {
  // It reaches the speed with a lag rather than at once — a step in speed is the shove that removed the earlier
  // exponential glide — and then holds it, frame after frame, which is the evenness itself.
  let state = { at: 0, velocity: 0 };
  for (let frame = 0; frame < 30; frame++) state = cruiseStep(state, 10_000, FRAME, 400);
  assert.ok(Math.abs(state.velocity - 400) < 1, `the ramp settled at ${state.velocity}px/s`);
  const before = state.at;
  state = cruiseStep(state, 10_000, FRAME, 400);
  assert.ok(Math.abs(state.at - before - 400 * FRAME) < 0.01, 'a steady frame moves exactly speed × dt');
  // A target it cannot reach this frame is the belt: the accumulated notches are the distance, exactly.
  assert.deepEqual(cruiseStep({ at: 99, velocity: 0 }, 100, FRAME, 4000), { at: 100, velocity: 0 });
  // …and a reversal follows the remaining distance, with no state of its own to fall out of step — through the lag,
  // so the first frame is still finishing the old direction rather than snapping to the new one.
  let reversing = { at: 50, velocity: 300 };
  for (let frame = 0; frame < 12; frame++) reversing = cruiseStep(reversing, 0, FRAME, 300);
  assert.ok(reversing.velocity < 0 && reversing.at < 50, `a target behind the position turns it around: ${reversing.at}`);
});

test('only a live, slow stream is carried at its own rate', () => {
  const carrying = (remaining: number, velocity: number, speed: number, left: number, gap: number) =>
    streamCarries(remaining, velocity, speed, left, gap);
  assert.equal(carrying(100, 0, 300, 0.3, 0.3), true, 'a live slow stream with room to travel');
  assert.equal(carrying(100, 0, 300, -0.1, 0.3), false, 'a stream that has ended hands back to the spring');
  assert.equal(carrying(100, 0, 0, 0.3, 0.3), false, 'a gesture with no rate yet is the spring’s (the first notch)');
  // A fast run keeps the spring: that is the feel the reader approved, and a spring tracking a moving target is
  // already even at those intervals (measured 1.5× per-frame swing at 50ms, against 5.8× at 100ms — which is where
  // the ramp has to take over).
  assert.equal(carrying(100, 0, 300, 0.3, 0.05), false, 'a flick is not the ramp’s business');
  assert.equal(carrying(100, 0, 300, 0.3, 0.067), true, 'one notch past a flick, it is');
  // The landing is the spring’s, from whatever speed the ramp handed over: this is the distance it takes to stop.
  assert.equal(carrying(20, 300, 300, 0.3, 0.3), false, 'inside the stopping distance the spring lands it');
  assert.equal(carrying(-20, -300, 300, 0.3, 0.3), false, 'and the same on the way back up');
});
