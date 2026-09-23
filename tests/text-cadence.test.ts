/**
 * The reveal cadence: how often a streaming message hands its text to React.
 *
 * Pinned here because the two things it can get wrong are both invisible until a reader complains: a stored value it
 * mis-reads would silently change the cadence for someone who never chose one, and an off-by-one in the deadline
 * comparison would halve the cadence on a display whose frame interval happens to equal the step.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TEXT_CADENCES, TEXT_CADENCE_STEP_MS, publishDue, textCadenceOf } from '../src/client/text-cadence.ts';

test('the steady cadence is the default, so only the exact string asks for the per-frame one', () => {
  // Per-frame publication makes the reveal's work follow the display's refresh rate, so it is the option a reader has
  // to ask for by name — a missing key (a record written before this setting existed), a number, a string from a newer
  // build, all resolve to the steadier cadence a fresh install opens with.
  assert.equal(textCadenceOf('frame'), 'frame');
  assert.equal(textCadenceOf('steady'), 'steady');
  for (const value of [undefined, null, '', 'FRAME', 'every-frame', 240, {}, []]) {
    assert.equal(textCadenceOf(value), 'steady', `unrecognised ${JSON.stringify(value)} is the steady cadence`);
  }
  // …and the two cadences the panel offers are exactly the two the reader can store, steadier one first.
  assert.deepEqual(TEXT_CADENCES.map(entry => entry.id), ['steady', 'frame']);
});

test('the per-frame cadence publishes every frame, whatever the clock says', () => {
  assert.equal(TEXT_CADENCE_STEP_MS.frame, 0, 'a zero step is what makes every frame due');
  assert.equal(publishDue(10, 10, 'frame'), true, 'the same timestamp is still due');
  assert.equal(publishDue(0, 1_000_000, 'frame'), true, 'and an out-of-order clock cannot starve it');
});

test('the steady cadence publishes once per step, and the boundary counts as due', () => {
  const step = TEXT_CADENCE_STEP_MS.steady;
  assert.ok(step > 15 && step < 17, `one frame at 60Hz is ${String(step)}ms`);
  assert.equal(publishDue(step, 0, 'steady'), true, 'exactly one step later is due — `>` would halve the cadence');
  assert.equal(publishDue(step - 0.01, 0, 'steady'), false, 'a hair earlier is not');
  assert.equal(publishDue(step * 4, 0, 'steady'), true, 'a long frame does not lose its publication');
  // The deadline is measured from the LAST publication, so a slow frame cannot let two through at once: the cadence
  // is a rate of work, and catching up would spend exactly the time the reader was trying to buy.
  assert.equal(publishDue(step * 2, step, 'steady'), true, 'the next step after a publication is due');
  assert.equal(publishDue(step * 1.5, step, 'steady'), false, 'and less than a step after it is not');
});
