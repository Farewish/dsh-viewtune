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
import { FOLLOW_TAIL_PX, firstRowPastIndex, firstRowWhere, isNearTail, wheelAtBottom, wheelClaimsScroll } from '../src/client/reading-scroll.ts';

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

interface Row { getBoundingClientRect(): { bottom: number } }

/** Rows in document order, with an optional counter so a test can see how many were actually measured. */
function rowsOf(bottoms: readonly number[], measured?: { count: number }): Row[] {
  return bottoms.map(bottom => ({
    getBoundingClientRect: () => {
      if (measured) measured.count += 1;
      return { bottom };
    },
  }));
}

/** The walk both call sites used before the bisection, kept as the yardstick the bisection has to match. */
function walked(rows: readonly Row[], line: number): number {
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]!.getBoundingClientRect().bottom > line) return index;
  }
  return rows.length;
}

test('the first row past the reading line is found by bisection, and agrees with the walk it replaced', () => {
  // Non-overlapping block rows have increasing bottom edges, which is what makes the bisection valid. The lines
  // include both edges of a row and both sides of the list, because an off-by-one here picks the wrong anchor or
  // names the wrong turn.
  const bottoms = [0, 96, 192, 288, 384, 480, 576, 672, 768, 864, 960];
  for (const line of [-10, 0, 1, 95, 96, 97, 288, 480, 959, 960, 961, 5000]) {
    assert.equal(
      firstRowPastIndex(rowsOf(bottoms), line, 0),
      walked(rowsOf(bottoms), line),
      `line at ${String(line)}`,
    );
  }
  // The slack the two call sites use is part of the rule, not a detail of the search. The comparison is strict, so a
  // row whose bottom edge sits exactly ON the line has not been passed by it.
  assert.equal(firstRowPastIndex(rowsOf(bottoms), 87, 8), 1, 'a line 1px above a bottom has passed that row');
  assert.equal(firstRowPastIndex(rowsOf(bottoms), 88, 8), 2, 'a line exactly on a bottom has not passed it');
  assert.equal(firstRowPastIndex(rowsOf([]), 0, 8), 0, 'no rows: no index to return');
  assert.equal(firstRowPastIndex(rowsOf(bottoms), 10_000, 8), bottoms.length, 'past every row');
});

test('a monotone question is answered by the same bisection, for either end of a row', () => {
  // The rail's reading asks the other question of the same list — has this row's TOP passed the line — so what has to
  // hold is that the search agrees with a walk for any monotone predicate. Both callers hand it a predicate, so both
  // are covered by checking the search itself against a walk.
  const rows = rowsOf([0, 96, 192, 288, 384, 480, 576, 672, 768, 864, 960]);
  for (const line of [-10, 0, 1, 96, 287, 288, 289, 960, 961, 5000]) {
    const walked = rows.findIndex(row => row.getBoundingClientRect().bottom > line);
    assert.equal(
      firstRowWhere(rows, row => row.getBoundingClientRect().bottom > line),
      walked === -1 ? rows.length : walked,
      `line at ${String(line)}`,
    );
  }
  assert.equal(firstRowWhere([], () => true), 0, 'no rows: no index to return');
  assert.equal(firstRowWhere(rows, () => false), rows.length, 'a question no row answers yes to');
  assert.equal(firstRowWhere(rows, () => true), 0, 'a question every row answers yes to');
});

test('and it measures a logarithmic number of rows, not all of them', () => {
  // This is the change, so it is asserted directly: the measured build showed the two scans together issuing
  // 10k–16k rect reads per second, and while a message streams every one of those can force a layout.
  const measured = { count: 0 };
  const rows = rowsOf(Array.from({ length: 512 }, (_, index) => index * 100), measured);
  assert.equal(firstRowPastIndex(rows, 50, 0), 1);
  assert.ok(measured.count <= 10, `512 rows were measured ${String(measured.count)} times`);
  assert.equal(measured.count <= 10 && walked(rows, 50) === 1, true, 'and the walk agrees about the row');
});
