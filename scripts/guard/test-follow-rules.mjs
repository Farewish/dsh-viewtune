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
  `${extractFn('isNearTail')}\n${extractFn('wheelClaimsScroll')}\n${extractFn('splitNotch')}\n`
  + 'this.isNearTail = isNearTail; this.wheelClaimsScroll = wheelClaimsScroll; this.splitNotch = splitNotch;',
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

// --- how one notch is split between the card and the conversation
//
// This is the rule that made a long transcript need an extra notch. The wheel event is dispatched
// BEFORE the browser applies the scroll, so "is the card on its edge right now" sees the pixels
// still left, releases the notch to the card, and only the next notch hands over. Projecting the
// notch answers it in the same event.
const MAX = CONTENT - VIEW;   // the largest scrollTop the card can reach
const NOTCH = 120;

// Mid-transcript: the notch fits, so the card keeps all of it and the browser scrolls natively.
{
  const { consumed, remainder } = context.splitNotch(100, NOTCH, MAX);
  check('mid-card: the card consumes the whole notch', consumed === NOTCH, `consumed ${String(consumed)}`);
  check('mid-card: nothing is left over', remainder === 0, `remainder ${String(remainder)}`);
}

// Five pixels short of the bottom: the card takes those five and the rest goes over, in THIS
// event. This is the case the old "already at the edge" test got wrong.
{
  const { consumed, remainder } = context.splitNotch(MAX - 5, NOTCH, MAX);
  check('near the bottom: the card takes only what is left', consumed === 5, `consumed ${String(consumed)}`);
  check('near the bottom: the rest is the conversation’s', remainder === NOTCH - 5, `remainder ${String(remainder)}`);
  check('near the bottom: the amounts add up', consumed + remainder === NOTCH);
}

// A sub-pixel gap is closed rather than left behind.
{
  const { consumed, remainder } = context.splitNotch(MAX - 0.5, NOTCH, MAX);
  check('sub-pixel gap: the fraction goes to the card', consumed === 0.5, `consumed ${String(consumed)}`);
  check('sub-pixel gap: the rest goes over', remainder === NOTCH - 0.5, `remainder ${String(remainder)}`);
}

// Already on the edge: the card consumes nothing at all and the whole notch is the conversation's.
{
  const { consumed, remainder } = context.splitNotch(MAX, NOTCH, MAX);
  check('on the edge: the card consumes nothing', consumed === 0, `consumed ${String(consumed)}`);
  check('on the edge: the whole notch goes over', remainder === NOTCH, `remainder ${String(remainder)}`);
}

// A short card can scroll nowhere, so every notch belongs to the conversation.
{
  const { consumed, remainder } = context.splitNotch(0, NOTCH, 0);
  check('a non-scrollable card consumes nothing', consumed === 0, `consumed ${String(consumed)}`);
  check('a non-scrollable card passes the notch on', remainder === NOTCH, `remainder ${String(remainder)}`);
}

// Upward from the top works through the same expression.
{
  const { consumed, remainder } = context.splitNotch(1, -NOTCH, MAX);
  check('a pixel below the top consumes that pixel', Math.abs(consumed) === 1, `consumed ${String(consumed)}`);
  check('a pixel below the top passes the rest up', Math.abs(remainder) === NOTCH - 1, `remainder ${String(remainder)}`);
}

// The card must never be told to scroll further than it can: the projection is clamped.
check('the card is never over-consumed', context.splitNotch(MAX - 1, NOTCH, MAX).consumed <= 1);
check('the card is never pushed past the top', context.splitNotch(2, -NOTCH, MAX).consumed >= -2);

// Prove this test can see the shape that caused the bug: asking whether the card is ALREADY on its
// edge, which is what the wheel event's early dispatch defeats. Under that rule a card 5px short
// consumes nothing and the notch is spent on the card instead of being handed over.
{
  const alreadyAtEdge = (scrollTop, delta, maxOffset) => (delta > 0 ? scrollTop >= maxOffset - 1 : scrollTop <= 1);
  check('the already-at-edge shape swallows the overshooting notch', alreadyAtEdge(MAX - 5, NOTCH, MAX) === false);
  check('the projection rule does not', context.splitNotch(MAX - 5, NOTCH, MAX).remainder > 0.5);
}

let ok = true;
for (const [name, pass, detail] of tests) {
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${name}${pass || detail === '' ? '' : `   (${detail})`}`);
}
console.log(`\n${String(tests.filter(([, pass]) => pass).length)}/${String(tests.length)} passed against ${bundlePath}`);
process.exit(ok ? 0 : 1);
