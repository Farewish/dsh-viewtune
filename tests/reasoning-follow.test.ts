/**
 * How the reasoning card keeps up with what is written into it.
 *
 * Three things are pinned here, all of them invisible until a reader complains: that the standard pace still takes
 * exactly the two-line step this card has always taken (so the new setting changes nothing by default), that a pace is
 * realised in WHOLE lines on the fixed cadence, and that only the two exact stored strings leave `auto` behind.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REASON_HOLD, REASONING_FOLLOW_MODES, REASONING_RATES, reasoningFollowModeOf, reasoningRateOf, reasoningTarget, stepLines } from '../src/client/reasoning-follow.js';

test('reasoning follows ordinary growth in two-line steps without passing the tail', () => {
  assert.equal(reasoningTarget(0, 284, 224, 24), 48);
  assert.equal(reasoningTarget(48, 284, 224, 24), 60);
  assert.equal(reasoningTarget(0, 100, 224, 24), 0);
  assert.equal(reasoningTarget(999, 284, 224, 24), 60);
});

test('a large reasoning burst still advances exactly two lines without skipping the middle', () => {
  let top = 0;
  for (const content of [400, 1200, 1500, 1500]) {
    const target = reasoningTarget(top, content, 224, 24);
    assert.equal(target - top, 48, 'a transport burst must not change the reference step distance');
    assert.ok(target <= content - 224);
    top = target;
  }
  while (top < 1500 - 224) {
    const target = reasoningTarget(top, 1500, 224, 24);
    assert.ok(target > top && target - top <= 48);
    top = target;
  }
  assert.equal(top, 1500 - 224);
  assert.equal(reasoningTarget(top, 1500, 224, 24), top, 'reaching the end must not replay the transcript');
});

test('two-line movement follows actual typography and clamps a resized viewport', () => {
  assert.equal(reasoningTarget(28, 900, 192, 30), 88);
  assert.equal(reasoningTarget(-50, 900, 192, 30), 60);
  assert.equal(reasoningTarget(708, 900, 400, 30), 500);
  assert.equal(reasoningTarget(0, 900, 192, 0), 2);
});

test('the standard pace is still exactly the two-line step this card always took', () => {
  // This is what makes the setting safe to ship: the default VALUE has to reproduce the default BEHAVIOUR, or every
  // reader's reasoning card would move differently the moment this build arrives.
  assert.equal(stepLines(2), 2, 'two lines per second on the 840ms cadence is the two-line step');
  assert.equal(reasoningTarget(0, 1500, 224, 24, stepLines(2)), 48);
  // A pace is quantised by the cadence, never applied by shortening it, and can never round down to nothing.
  assert.equal(stepLines(1), 1);
  assert.equal(stepLines(3), 3);
  assert.equal(stepLines(5), 4);
  assert.equal(stepLines(0), 1, 'no pace at all is still one line per step');
  assert.equal(stepLines(2, REASON_HOLD), stepLines(2), 'the cadence defaults to the one the card uses');
  // And the pace reaches the target as a step size, not as a different clamp.
  assert.equal(reasoningTarget(0, 2000, 224, 24, 4), 96);
  assert.equal(reasoningTarget(0, 2000, 224, 24, 0), 24, 'a nonsensical step is still one line');
});

test('the follow mode and the pace are read defensively', () => {
  assert.equal(reasoningFollowModeOf('latest'), 'latest');
  assert.equal(reasoningFollowModeOf('manual'), 'manual');
  assert.equal(reasoningFollowModeOf('auto'), 'auto');
  for (const value of [undefined, null, '', 'AUTO', 'scroll', 1, {}, []]) {
    assert.equal(reasoningFollowModeOf(value), 'latest', `unrecognised ${JSON.stringify(value)} is the default mode`);
  }
  assert.equal(reasoningRateOf(1), 1);
  assert.equal(reasoningRateOf(3), 3);
  for (const value of [undefined, null, 0, 2.5, 99, '2', NaN, {}]) {
    assert.equal(reasoningRateOf(value), 2, `unrecognised ${JSON.stringify(value)} is the standard pace`);
  }
  // The panel offers exactly what can be stored, in the order it offers them.
  assert.deepEqual(REASONING_FOLLOW_MODES.map(entry => entry.id), ['auto', 'latest', 'manual']);
  assert.deepEqual(REASONING_RATES.map(entry => entry.id), [1, 2, 3, 5]);
});
