/**
 * The reveal's blur, as a choice.
 *
 * Pinned here because the decision is not "does the animation differ" — it is whether a `filter` appears in the
 * keyframes AT ALL. A no-op `blur(0px)` would still keep the animated word off the compositor's own path, which is
 * the whole cost the switch exists to remove.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revealFrames } from '../src/client/reveal-frames.ts';
import { WORD_MOTION } from '../src/client/word-timeline.ts';

test('the blur frames resolve from the recipe value to sharp', () => {
  const [from, to] = revealFrames(true);
  assert.equal(from.opacity, 0, 'a revealed word starts invisible');
  assert.equal(to.opacity, 1);
  assert.equal(from.filter, `blur(${String(WORD_MOTION.blur)}px)`);
  assert.equal(to.filter, 'blur(0px)');
});

test('and with the blur off there is no filter in either frame', () => {
  // This is the change, so it is asserted directly: one `filter` anywhere in the keyframes is what makes the browser
  // repaint the word on every frame of its reveal, and about a dozen of those reveals overlap while a message streams.
  const frames = revealFrames(false);
  assert.equal(frames.length, 2, 'still a fade, in two poses');
  assert.deepEqual(frames, [{ opacity: 0 }, { opacity: 1 }]);
  for (const frame of frames) {
    assert.equal(Object.hasOwn(frame, 'filter'), false, 'the property must be absent, not merely a no-op');
  }
});
