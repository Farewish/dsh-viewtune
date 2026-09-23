/**
 * The composer's wheel guard.
 *
 * The decision is the whole guard, and it is a pure function: a notch is taken by a scroll container only while it
 * has room in that direction, so the listener swallows the gesture exactly when nothing inside the composer can move.
 * That is what the implementation rests on, so that is what is tested — the surrounding listener needs a live DOM
 * (event targets, computed styles) and would only be testing jsdom, not this decision.
 *
 * A NOTE ON WHAT IS *NOT* HERE. The declarative half — `overscroll-behavior: contain` on the composer's elements —
 * was shipped and removed again: the element that actually scrolls the composer's text is `.uV2eYG_scroll`, a
 * CSS-module name with a per-build hash and no "composer" in it, so there was nothing stable to select. The listener
 * needs no name, which is why it is the one that stayed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canTakeNotch } from '../src/client/composer-wheel.ts';

test('a field takes the notch while it has anywhere to go, and not one notch past its end', () => {
  // Scrolled up, a notch down can be taken; at the bottom it cannot — that is the moment the transcript used to
  // start moving, and the reason the listener exists.
  assert.equal(canTakeNotch(120, 0, 200, 600), true, 'middle of a long field, scrolling down');
  assert.equal(canTakeNotch(120, 400, 200, 600), false, 'at the end, scrolling down');
  assert.equal(canTakeNotch(-120, 400, 200, 600), true, 'middle, scrolling up');
  assert.equal(canTakeNotch(-120, 0, 200, 600), false, 'at the top, scrolling up');
  // A field with nothing to scroll never takes the notch, in either direction.
  assert.equal(canTakeNotch(120, 0, 200, 200), false, 'no overflow at all');
  // The one-pixel slack: a fractional scrollHeight at the end of a list must read as "no room left", or the gesture
  // would slip through exactly when it should be swallowed.
  assert.equal(canTakeNotch(120, 399.4, 200, 600), false, 'sub-pixel end');
  // A horizontal-only wheel is not this listener's business.
  assert.equal(canTakeNotch(0, 0, 200, 600), false, 'no vertical delta');
});
