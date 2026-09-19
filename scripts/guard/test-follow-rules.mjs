/**
 * Behavioural test for the two rules that decide whether the reader keeps auto-following.
 *
 * These are the rules behind a real bug: a downward wheel over a long reasoning card left
 * auto-follow enabled, and because the card keeps growing while the model streams, the follow
 * animation re-armed on every growth and dragged the viewport back to the bottom each frame. The
 * reader's own scroll fought the wheel and the page stepped instead of gliding, until the pointer
 * left the card. A string assertion cannot express that; these two predicates can.
 *
 * Invariants asserted:
 *   - any wheel takes scroll control, in either direction (the bug was "only upward");
 *   - a wheel that moves nothing is not a takeover;
 *   - "at the tail" is inclusive of the threshold and is false one pixel past it.
 *
 * The functions are lifted out of the compiled artifact, so this tests what ships.
 *
 * Usage: node test-follow-rules.mjs [bundlePath]
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const bundlePath = process.argv[2] ?? join(ROOT, 'lib/client.js');
const bundle = readFileSync(bundlePath, 'utf8');

/** Lift a top-level function declaration out of the bundle by name. */
function extractFn(name) {
  const start = bundle.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`compiled ${name} not found`);
  let depth = 0;
  let i = bundle.indexOf('{', start);
  for (; i < bundle.length; i++) {
    if (bundle[i] === '{') depth++;
    else if (bundle[i] === '}') { depth--; if (depth === 0) break; }
  }
  return bundle.slice(start, i + 1);
}

const context = createContext({ console });
runInContext(
  `${extractFn('isNearTail')}\n${extractFn('wheelClaimsScroll')}\n${extractFn('atScrollEdge')}\n`
  + 'this.isNearTail = isNearTail; this.wheelClaimsScroll = wheelClaimsScroll; this.atScrollEdge = atScrollEdge;',
  context,
);

const tests = [];
const check = (name, pass, detail = '') => tests.push([name, pass, detail]);

// --- a wheel in either direction takes control
check('downward wheel claims the scroll', context.wheelClaimsScroll(120) === true);
check('upward wheel claims the scroll', context.wheelClaimsScroll(-120) === true);
check('a wheel that moves nothing does not', context.wheelClaimsScroll(0) === false);
check('line-mode deltas count', context.wheelClaimsScroll(3) === true);

// The regression this test exists for is "only upward wheels count". A broken extractor would
// make every case above pass while testing nothing, so prove the check can see that shape: a
// function that only accepts negative deltas must fail the downward case.
{
  const broken = createContext({ console });
  runInContext('this.wheelClaimsScroll = (deltaY) => deltaY < 0;', broken);
  check('the check can see an upward-only rule', broken.wheelClaimsScroll(120) === false && broken.wheelClaimsScroll(-120) === true);
  check('the real rule differs from that shape', context.wheelClaimsScroll(120) !== broken.wheelClaimsScroll(120));
}

// --- the tail rule
const VIEW = 224;
const CONTENT = 1200;
// Exactly at the bottom.
check('exactly at the tail counts', context.isNearTail(CONTENT - VIEW, CONTENT, VIEW) === true);
// Just inside the 72px window.
check('within the tail window counts', context.isNearTail(CONTENT - VIEW - 71, CONTENT, VIEW) === true);
// Just outside it — this is the case that must not follow.
check('beyond the tail window does not count', context.isNearTail(CONTENT - VIEW - 73, CONTENT, VIEW) === false);
// --- a card that does not overflow at all is always at its tail.
check('a non-overflowing card is at its tail', context.isNearTail(0, VIEW, VIEW) === true);

// --- the edge tolerance: this is what decides where the gesture stops being the card's
const MAX = CONTENT - VIEW;   // the largest scrollTop the card can reach
const NOTCH = 120;

// Mid-transcript: the notch moves the card, so the card keeps it.
check('mid-card is not at an edge', context.atScrollEdge(100, NOTCH, MAX) === false);

// Sitting exactly on the bottom: the conversation takes this notch.
check('exactly on the bottom edge counts', context.atScrollEdge(MAX, NOTCH, MAX) === true);

// The subpixel case the slack exists for: a fraction short of the limit still counts as there,
// so the notch that reaches the edge is not wasted on a card that cannot move.
check('a subpixel short of the edge counts', context.atScrollEdge(MAX - 0.4, NOTCH, MAX) === true);
check('one pixel short still counts', context.atScrollEdge(MAX - 1, NOTCH, MAX) === true);

// Past the slack it must NOT count, or the card would hand off before it has scrolled — that is
// the opposite failure, and the reason the number has to stay small.
check('two pixels short does not count', context.atScrollEdge(MAX - 2, NOTCH, MAX) === false);
check('half a notch short does not count', context.atScrollEdge(MAX - NOTCH / 2, NOTCH, MAX) === false);

// The top edge works through the same expression.
check('exactly on the top edge counts', context.atScrollEdge(0, -NOTCH, MAX) === true);
check('a pixel below the top counts', context.atScrollEdge(1, -NOTCH, MAX) === true);
check('mid-card upward is not at an edge', context.atScrollEdge(MAX, -NOTCH, MAX) === false);

// A short card can scroll nowhere, so every notch belongs to the conversation.
check('a non-scrollable card is always at its edge', context.atScrollEdge(0, NOTCH, 0) === true);

// Prove this check can see the shape that caused the bug: zero slack. A card a fraction short of
// the limit would then be judged "not at the edge" and swallow the notch.
{
  const zeroSlack = createContext({ console });
  runInContext('this.atScrollEdge = (scrollTop, delta, maxOffset) => Math.min(maxOffset, Math.max(0, scrollTop + delta)) === scrollTop;', zeroSlack);
  check('the check can see a zero-slack rule', zeroSlack.atScrollEdge(MAX - 0.4, NOTCH, MAX) === false);
  check('the real rule differs from zero slack', context.atScrollEdge(MAX - 0.4, NOTCH, MAX) !== zeroSlack.atScrollEdge(MAX - 0.4, NOTCH, MAX));
}

let ok = true;
for (const [name, pass, detail] of tests) {
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${name}${pass || detail === '' ? '' : `   (${detail})`}`);
}
console.log(`\n${String(tests.filter(([, pass]) => pass).length)}/${String(tests.length)} passed against ${bundlePath}`);
process.exit(ok ? 0 : 1);
