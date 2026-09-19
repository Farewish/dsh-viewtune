/**
 * Behavioural test for the reasoning card's wheel handling.
 *
 * The card scrolls natively — the handler never writes its scroll position. Each
 * modelled event therefore runs the handler and then, unless the handler consumed
 * the event, applies the browser's own scroll for it.
 *
 * Invariants asserted per case:
 *   - mid-transcript the card moves natively, the conversation does not;
 *   - the notch that straddles the edge is split in that same event;
 *   - at the edge the handler stays out of the way and the browser chains the notch
 *     to the conversation itself, which is what keeps that motion animated;
 *   - a short (non-scrollable) transcript hands the notch over immediately;
 *   - nothing moves twice for one notch, and repeated dispatches count once;
 *   - a scroll event during a gesture does not touch React state.
 *
 * Usage: node test-wheel-handler.mjs [bundlePath]
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const bundlePath = process.argv[2] ?? join(ROOT, 'lib/client.js');
const bundle = readFileSync(bundlePath, 'utf8');

/** The scroll listener plus the wheel section, so both are in scope. */
function extractWheelSection() {
  const handlerStart = bundle.indexOf('const onWheel = (event) => {');
  if (handlerStart === -1) throw new Error('compiled onWheel not found');
  const scrollStart = bundle.lastIndexOf('const onScroll = () => {', handlerStart);
  const start = scrollStart === -1 ? handlerStart : scrollStart;
  const end = bundle.indexOf('\n\t\t\t\tconst onSelection = () =>', handlerStart);
  if (end === -1) throw new Error('the listener after onWheel was not found');
  return bundle.slice(start, end).replace(/^\t{4}/gmu, '');
}

/**
 * A top-level helper the handler calls. The edge test lives in its own declaration now, so the
 * sandbox has to be given it or the extracted handler runs with an undefined name.
 */
function extractHelper(name) {
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

let clock = 1_000_000;
/** Wheel events the browser has already applied, so a duplicate delivery is not applied twice. */
const appliedEvents = new Set();
const sandbox = {
  WheelEvent: { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  getComputedStyle: () => ({ lineHeight: '24px' }),
  Date: { now: () => clock },
  WHEEL_IDLE_MS: 140,
  console,
};
const context = createContext(sandbox);
runInContext(`${extractHelper('splitNotch')}\n${extractWheelSection()}\nthis.onWheel = onWheel;`, context);

const clampIn = (value, min, max) => Math.max(min, Math.min(max, value));

/** Fake scroll viewport with real write accounting. */
function makePort({ clientHeight, scrollHeight, scrollTop }) {
  const port = { clientHeight, scrollHeight, writes: 0 };
  Object.defineProperty(port, 'scrollTop', {
    get: () => port._top ?? 0,
    set: (value) => { port.writes += 1; port._top = value; },
    configurable: true,
  });
  port._top = scrollTop;
  return port;
}

function makeConversation(scrollTop = 500) {
  const talk = { clientHeight: 600, scrollHeight: 4000, scrollTop, writes: 0 };
  talk.host = {
    hasAttribute: (name) => name === 'data-conversation-scroll',
    scrollBy(_x, delta) { talk.writes += 1; talk.scrollTop = clampIn(talk.scrollTop + delta, 0, talk.scrollHeight - talk.clientHeight); },
    parentElement: null,
  };
  return talk;
}

/** One wheel event: handler first, then the browser default if it was allowed. */
function wheel({ port, talk, deltaY, deltaMode = 0, cancelable = true, timeStamp }) {
  const events = [];
  sandbox.port = port;
  sandbox.text = { offsetHeight: port.scrollHeight };
  sandbox.automatic = false;
  sandbox.overflow = true;
  sandbox.pause = () => events.push('pause');
  sandbox.measure = () => events.push('measure');
  port.parentElement = talk.host;
  const stamp = timeStamp ?? (clock += 1);
  sandbox.__event = { deltaY, deltaMode, cancelable, timeStamp: stamp, preventDefault: () => events.push('preventDefault') };
  const cardBefore = port.scrollTop;
  const talkBefore = talk.scrollTop;
  runInContext('this.onWheel(__event)', context);
  const prevented = events.includes('preventDefault');
  // The browser applies each wheel event it was allowed to keep exactly once, and how it applies it
  // was measured in a real browser: the notch goes to the card under the pointer and any leftover
  // is DROPPED — the browser does not chain it — unless the card cannot move at all in that
  // direction, in which case the whole notch goes to the conversation. A duplicate delivery of one
  // event is therefore applied by the browser once, not twice.
  const delivered = `${String(stamp)}:${String(deltaY)}`;
  const firstDelivery = !appliedEvents.has(delivered);
  appliedEvents.add(delivered);
  if (!prevented && firstDelivery) {
    // The browser scrolls by the notch in PIXELS: a line-mode event means lines, not pixels.
    const native = deltaY * (deltaMode === 1 ? 24 : deltaMode === 2 ? port.clientHeight : 1);
    const maxOffset = Math.max(0, port.scrollHeight - port.clientHeight);
    const room = native > 0 ? maxOffset - port.scrollTop : port.scrollTop;
    if (room <= 0) talk.host.scrollBy(0, native);
    else port.scrollTop = clampIn(port.scrollTop + native, 0, maxOffset);
  }
  return { cardMoved: port.scrollTop - cardBefore, talkMoved: talk.scrollTop - talkBefore, prevented, events, port, talk };
}

/** A scroll event on the card, as the browser delivers it during a gesture. */
function scrollCard(port, talk) {
  const events = [];
  sandbox.port = port;
  sandbox.text = { offsetHeight: port.scrollHeight };
  sandbox.automatic = false;
  sandbox.measure = () => events.push('measure');
  sandbox.pause = () => events.push('pause');
  port.parentElement = talk.host;
  runInContext('onScroll()', context);
  return events;
}

const longCard = { clientHeight: 224, scrollHeight: 1200 };
const tests = [];
const check = (name, pass, detail = '') => tests.push([name, pass, detail]);

// 1. Mid-transcript: the card moves natively and the conversation stays put.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 100 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('mid-card: card moves by the delta', result.cardMoved === 120, `moved ${String(result.cardMoved)}`);
  check('mid-card: conversation untouched', result.talkMoved === 0, `moved ${String(result.talkMoved)}`);
  check('mid-card: the handler never writes the card', port.writes === 1, `${String(port.writes)} writes`);
}

// 2. Bottom edge: the conversation takes the notch, once.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('bottom edge: conversation takes the notch', result.talkMoved === 120, `moved ${String(result.talkMoved)}`);
  check('bottom edge: card does not move', result.cardMoved === 0, `moved ${String(result.cardMoved)}`);
  check('bottom edge: conversation written once', talk.writes === 1, `${String(talk.writes)} writes`);
}

// 3. One notch never moves the page twice.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 100 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('one notch moves exactly one surface', result.cardMoved + result.talkMoved === 120,
    `card ${String(result.cardMoved)} + talk ${String(result.talkMoved)}`);
}

// 4. A short transcript hands the whole notch over.
{
  const talk = makeConversation();
  const port = makePort({ clientHeight: 224, scrollHeight: 90, scrollTop: 0 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('short card: conversation takes the notch', result.talkMoved === 120, `moved ${String(result.talkMoved)}`);
  check('short card: card stays put', result.cardMoved === 0, `moved ${String(result.cardMoved)}`);
}

// 4b. The notch that would overshoot hands off IN THAT SAME EVENT. This is the case that made a
// long transcript need an extra notch: the wheel event is dispatched before the browser applies
// the scroll, so asking "is the card on its edge right now" sees 5px left, releases the notch to
// the card, and only the next notch hands over. The projection answers it correctly: the card
// takes the 5px it can still consume, is placed on its edge, and the remaining 115 goes over.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 - 5 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('near the bottom: the overshooting notch hands off at once', result.talkMoved === 115,
    `talk moved ${String(result.talkMoved)}`);
  check('near the bottom: the card lands exactly on the edge', port.scrollTop === 1200 - 224,
    `card at ${String(port.scrollTop)}`);
  check('near the bottom: nothing is lost', result.cardMoved + result.talkMoved === 120,
    `card ${String(result.cardMoved)} + talk ${String(result.talkMoved)}`);
}

// 4c. A sub-pixel gap is closed the same way rather than left for a later notch.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 - 0.5 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('sub-pixel gap: hands off at once', result.talkMoved === 119.5,
    `talk moved ${String(result.talkMoved)}`);
  check('sub-pixel gap: the card lands on the edge', port.scrollTop === 1200 - 224,
    `card at ${String(port.scrollTop)}`);
}

// 4d. Already on the edge: the whole notch belongs to the conversation, and the browser is left to
// move it there itself. Intercepting this notch is what made a long transcript jump: every notch
// was re-issued as a programmatic scrollBy, which lands in one frame, and it kept doing that for as
// long as the pointer stayed over the card. Letting it through instead runs the browser's own
// (animated) chaining, exactly as if the pointer were over the conversation.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('on the edge: the conversation takes the whole notch', result.talkMoved === 120,
    `talk moved ${String(result.talkMoved)}`);
  check('on the edge: the card does not move', result.cardMoved === 0, `card moved ${String(result.cardMoved)}`);
  check('on the edge: the card is not written', port.writes === 0, `${String(port.writes)} writes`);
  check('on the edge: the handler does not consume the event', !result.prevented,
    `prevented ${String(result.prevented)}`);
  check('on the edge: the conversation is scrolled by the browser, not by the handler', talk.writes === 1,
    `${String(talk.writes)} scroll writes`);
}

// 4e. Every notch after that is the same case: while the pointer rests on a card that has finished
// scrolling, nothing may be intercepted, or the gesture jumps for as long as the pointer stays.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 });
  const results = [1, 2, 3].map(() => wheel({ port, talk, deltaY: 120 }));
  check('staying on the edge: no notch is consumed', results.every((r) => !r.prevented),
    `prevented ${results.map((r) => String(r.prevented)).join(' ')}`);
  check('staying on the edge: the conversation keeps moving', results.every((r) => r.talkMoved === 120),
    `moved ${results.map((r) => String(r.talkMoved)).join(' ')}`);
}

// 5. Upward from the top edge.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 0 });
  const result = wheel({ port, talk, deltaY: -120 });
  check('top edge: conversation takes the notch upward', result.talkMoved === -120, `moved ${String(result.talkMoved)}`);
}

// 6. Line-mode deltas are converted before they are handed over.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 0 });
  const result = wheel({ port, talk, deltaY: -3, deltaMode: 1 });
  check('line-mode deltas use the line height', result.talkMoved === -72, `moved ${String(result.talkMoved)}`);
}

// 7. During a gesture the card's scroll events must not touch React state.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 100 });
  wheel({ port, talk, deltaY: 60 });
  const during = scrollCard(port, talk);
  check('scroll during a gesture stays off React state', during.length === 0, `events ${JSON.stringify(during)}`);
  clock += 1_000;
  const after = scrollCard(port, talk);
  check('scroll after the gesture measures once', after.includes('measure'), `events ${JSON.stringify(after)}`);
}

// 8. A repeated dispatch of one wheel event hands off only once.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 });
  const stamp = clock += 1;
  wheel({ port, talk, deltaY: 60, timeStamp: stamp });
  const second = wheel({ port, talk, deltaY: 60, timeStamp: stamp });
  check('a duplicated event hands off once', second.talkMoved === 0 && talk.writes === 1,
    `moved ${String(second.talkMoved)}, ${String(talk.writes)} writes`);
}

let ok = true;
for (const [name, pass, detail] of tests) {
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${name}${pass || detail === '' ? '' : `   (${detail})`}`);
}
console.log(`\n${String(tests.filter(([, pass]) => pass).length)}/${String(tests.length)} passed against ${bundlePath}`);
process.exit(ok ? 0 : 1);
