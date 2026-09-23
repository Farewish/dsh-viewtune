/**
 * How tall a focused reasoning card asks to be.
 *
 * The two things that matter are both invisible until the feature is in use: the growth must be quantised to whole
 * lines (a card that grew per publication would relayout everything below it per publication, and a height is not a
 * compositor property), and it must never make a short card SHORTER than the preview it already has.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusedHeight } from '../src/client/focus-expand.ts';

test('a focused card grows in whole lines and never shrinks below its preview', () => {
  // Exactly on a line: no extra line is asked for.
  assert.equal(focusedHeight(240, 224, 24), 240);
  // One pixel past it: one whole line more, never a partial one.
  assert.equal(focusedHeight(241, 224, 24), 264);
  assert.equal(focusedHeight(263, 224, 24), 264);
  assert.equal(focusedHeight(265, 224, 24), 288);
  // Content shorter than the preview keeps the preview: the focus grows a card, it does not trim one.
  assert.equal(focusedHeight(120, 224, 24), 224);
  assert.equal(focusedHeight(0, 192, 24), 192);
  // A narrow container has a shorter preview, and line heights are not always 24.
  assert.equal(focusedHeight(200, 192, 30), 210);
  assert.equal(focusedHeight(181, 192, 30), 210);
});

test('a nonsense measurement degrades instead of producing a nonsense height', () => {
  // No line box to quantise against: the content height itself, still never below the preview.
  assert.equal(focusedHeight(500, 224, 0), 500);
  assert.equal(focusedHeight(500, 224, Number.NaN), 500);
  assert.equal(focusedHeight(100, 224, 0), 224);
  // Negative or non-finite content is a measurement the card has not taken yet, not a negative height.
  assert.equal(focusedHeight(-40, 224, 24), 224);
  assert.equal(focusedHeight(Number.NaN, 224, 24), 224);
  assert.equal(focusedHeight(Number.POSITIVE_INFINITY, 224, 24), 224, 'a measurement the card has not taken yet is not a height');
  // And the floor is whatever the stylesheet said the preview is.
  assert.equal(focusedHeight(240, Number.NaN, 24), 240);
  assert.equal(focusedHeight(240, -10, 24), 240);
});
