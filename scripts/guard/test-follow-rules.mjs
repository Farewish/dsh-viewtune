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
  `${extractFn('isNearTail')}\n${extractFn('wheelClaimsScroll')}\n`
  + 'this.isNearTail = isNearTail; this.wheelClaimsScroll = wheelClaimsScroll;',
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

// --- how one notch is divided between the card and the conversation
//
// There is nothing to test here any more, and that is the point. This file used to pin a
// splitNotch() projection that divided a notch between the card and the conversation. Every way of
// dividing one by hand turned out to be a step instead of a glide — writing scrollTop per notch, or
// intercepting an overshooting notch to re-issue the leftover as scrollBy — so the division was
// removed and the browser does all of it. What replaced these cases is in test-wheel-handler.mjs:
// the handler must not consume a notch or write a scroll position in ANY shape, which is a stronger
// statement than any particular division was.

let ok = true;
for (const [name, pass, detail] of tests) {
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${name}${pass || detail === '' ? '' : `   (${detail})`}`);
}
console.log(`\n${String(tests.filter(([, pass]) => pass).length)}/${String(tests.length)} passed against ${bundlePath}`);
process.exit(ok ? 0 : 1);
