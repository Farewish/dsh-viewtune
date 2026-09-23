/**
 * The two rules the reading view's tail-follow turns on.
 *
 * Both were reported through their effects rather than as rules, which is why they are pinned here directly: at the
 * bottom of the page a downward wheel made the 「回到最新」 pill appear and vanish with every notch and the position
 * jitter by a pixel or two, and an idle transcript was still being pulled back to the bottom whenever anything grew.
 * The first is `wheelAtBottom` (the wheel that has nowhere to go is not a takeover), the second is `isNearTail` (how
 * close to the tail counts as being there at all, which `useReadingScroll` only acts on while a turn is running).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLLOW_TAIL_PX, isNearTail, wheelAtBottom, wheelClaimsScroll } from '../src/client/reading-scroll.ts';

test('a wheel takes scroll control unless it has nowhere to go', () => {
  // ANY direction, any size. The listener also sees wheels that bubbled out of the reasoning card, and treating a
  // downward one as "not a takeover" is what once made a streaming turn step instead of glide.
  assert.equal(wheelClaimsScroll(120), true);
  assert.equal(wheelClaimsScroll(-120), true);
  assert.equal(wheelClaimsScroll(0), false, 'a zero delta moves nothing, so it claims nothing');

  // …except the downward wheel that finds the scroller already at its tail, which is the reported bottom-of-page case.
  assert.equal(wheelAtBottom(120, 0), true, 'at the bottom, wheeling down has nowhere to go');
  assert.equal(wheelAtBottom(120, 0.5), true, 'a sub-pixel gap is the same case');
  assert.equal(wheelAtBottom(120, 40), false, 'further up it IS a takeover — parking short of the tail is allowed');
  assert.equal(wheelAtBottom(-120, 0), false, 'wheeling up at the bottom is unambiguously the reader taking over');
  assert.equal(wheelAtBottom(0, 0), false, 'and a wheel that moves nothing is not one either way');
});

test('the tail is a distance from the bottom, and it is a real one', () => {
  // 2000px of content in an 800px viewport: at 1150 the reader is 50px from the tail, at 1100 they are 100px away.
  assert.equal(isNearTail(1150, 2000, 800), true, 'inside the margin counts as being there');
  assert.equal(isNearTail(1100, 2000, 800), false, 'outside it does not');
  // Short content that does not fill the viewport is at the tail by definition — the arithmetic has to allow a
  // negative gap rather than require one, or a short conversation would never be followed.
  assert.equal(isNearTail(0, 400, 800), true, 'nothing to scroll is at the bottom');
  // The margin is the one number tuning this, so it has to be a number and not a typo.
  assert.ok(FOLLOW_TAIL_PX > 0 && FOLLOW_TAIL_PX < 400, `the margin is ${String(FOLLOW_TAIL_PX)}px`);
  // A caller can tighten it to nothing, and then only content that cannot scroll at all is "near the tail" — the
  // comparison is strict, so the exact bottom with a zero margin is not.
  assert.equal(isNearTail(1000, 2000, 800, 0), false, '200px away with no margin');
  assert.equal(isNearTail(2000, 2000, 800, 0), true, 'nothing to scroll is at the bottom whatever the margin');
});
