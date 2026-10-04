/**
 * 「自动折叠更早的轮次」: the count, the window it decides, and the limit of what it can free.
 *
 * Two things are worth pinning here. The first is that an unusable value means OFF — the behaviour every record
 * written before this setting existed already had, so nothing a reader already has can start hiding their history
 * because of an upgrade. The second is that the distance is measured from the TAIL and that the window is COMMITTED:
 * `renderedTurnsOf` is the number the view renders between two new turns, and `revealStepOf` only ever adds to it, so
 * a reader can never be shown FEWER turns than they asked for.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TURN_FOLD_MAX, insideWindow, loadOlderOutcome, renderedTurnsOf, revealForTurn, revealStepOf, turnFoldOf } from '../src/client/turn-fold.ts';

test('a jump into a folded turn grows the window enough to render it', () => {
  // The rail can navigate anywhere, and the LOAD succeeds — but a turn the window hides has no row, so the landing could
  // never happen however often it retried. This is by how much the window must grow; it counts from the TAIL.
  assert.equal(revealForTurn(9, 10, 0, 0), 0, 'the setting is off — nothing to reveal');
  assert.equal(revealForTurn(9, 10, 3, 0), 0, 'the newest turn is inside a window of three');
  assert.equal(revealForTurn(7, 10, 3, 0), 0, 'index 7 is the third from the tail — still inside');
  assert.equal(revealForTurn(6, 10, 3, 0), 1, 'the fourth from the tail needs one revealed');
  assert.equal(revealForTurn(0, 10, 3, 0), 7, 'the oldest needs seven');
  // …and it never HIDES what the reader opened by hand: the answer is a floor, not a replacement.
  assert.equal(revealForTurn(6, 10, 3, 5), 5);
  assert.equal(revealForTurn(0, 10, 3, 5), 7);
  // Out-of-range or nonsensical input leaves the reader exactly where they were.
  assert.equal(revealForTurn(-1, 10, 3, 2), 2);
  assert.equal(revealForTurn(10, 10, 3, 2), 2);
});

test('what a load of older history achieved, when the failure mode is silence', () => {
  // The host's loader resolves WITHOUT doing anything when its `hasMore` is false, when its re-entrancy flag is still set,
  // or when a generation moved on and the page was dropped. Before this the reader saw a button that looked broken and
  // nothing else, so the outcome is now named: more turns is progress; nothing more is either the earliest record or a
  // load that did not arrive, and only the host's own `hasMore` can tell those two apart.
  assert.equal(loadOlderOutcome(12, 14, true), 'progress');
  assert.equal(loadOlderOutcome(12, 12, false), 'exhausted', 'nothing more, and the host agrees there is nothing');
  assert.equal(loadOlderOutcome(12, 12, true), 'stuck', 'nothing more while the host still claims more — the reported silence');
  // …and a window that somehow shrank (a reload, a new session) is not progress either.
  assert.equal(loadOlderOutcome(12, 3, true), 'stuck');
  assert.equal(loadOlderOutcome(0, 0, false), 'exhausted');
});

test('an absent or unusable count is OFF, and a real one is clamped to the ceiling', () => {
  assert.equal(turnFoldOf(0), 0);
  assert.equal(turnFoldOf(4), 4);
  assert.equal(turnFoldOf(4.4), 4);
  assert.equal(turnFoldOf(-3), 0);
  assert.equal(turnFoldOf(TURN_FOLD_MAX + 100), TURN_FOLD_MAX);
  // A record written before this setting existed has no key at all, and a hand-edited one can carry anything.
  assert.equal(turnFoldOf(undefined), 0);
  assert.equal(turnFoldOf(null), 0);
  assert.equal(turnFoldOf(''), 0);
  assert.equal(turnFoldOf('5'), 0);
  assert.equal(turnFoldOf(Number.NaN), 0);
  assert.equal(turnFoldOf(Number.POSITIVE_INFINITY), 0);
});

test('OFF renders everything, and a window renders the newest turns plus whatever was revealed', () => {
  // OFF is an unreachable window rather than a special case at every call site.
  assert.equal(renderedTurnsOf(0, 0), Number.POSITIVE_INFINITY);
  assert.equal(renderedTurnsOf(0, 7), Number.POSITIVE_INFINITY);
  // Nothing revealed yet: exactly the setting.
  assert.equal(renderedTurnsOf(5, 0), 5);
  // …and each press of the control adds one more band, never fewer turns than the setting promised.
  assert.equal(renderedTurnsOf(5, revealStepOf(5)), 10);
  assert.equal(renderedTurnsOf(5, revealStepOf(5) * 2), 15);
  // A negative revealed count cannot shrink the window, whatever a caller passes.
  assert.equal(renderedTurnsOf(5, -3), 5);
  // OFF has no step to take: the control falls straight through to reading older turns from disk.
  assert.equal(revealStepOf(0), 0);
});

test('the window counts from the tail, so the same turn drifts out of it as the conversation grows', () => {
  const total = 6;
  // OFF: everything is inside, at any index.
  for (let index = 0; index < total; index += 1) {
    assert.equal(insideWindow(index, total, Number.POSITIVE_INFINITY), true);
  }
  // Keep the newest two: indexes 0..3 are out, 4 and 5 are in.
  assert.deepEqual(
    Array.from({ length: total }, (_, index) => insideWindow(index, total, 2)),
    [false, false, false, false, true, true],
  );
  // The same turn (the last one) is inside while the window is the whole conversation, and behind it afterwards.
  assert.equal(insideWindow(total - 1, total, 1), true);
  assert.equal(insideWindow(total - 1, total + 1, 1), false, 'a newer turn pushes it behind the threshold');
  // A window larger than the conversation keeps everything — the clamp exists so a typo cannot hide the lot.
  for (let index = 0; index < total; index += 1) {
    assert.equal(insideWindow(index, total, TURN_FOLD_MAX), true);
  }
});
