/**
 * Behavioural test for the reasoning card's wheel handling.
 *
 * The card scrolls natively — the handler never writes its scroll position. Each
 * modelled event therefore runs the handler and then lets the browser scroll the
 * card by the delta, unless the handler consumed the event to hand it off.
 *
 * Invariants asserted per case:
 *   - mid-transcript the card moves natively, the conversation does not;
 *   - at the edge the notch is consumed and the conversation moves instead, once;
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

let clock = 1_000_000;
const sandbox = {
  WheelEvent: { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  getComputedStyle: () => ({ lineHeight: '24px' }),
  Date: { now: () => clock },
  WHEEL_IDLE_MS: 140,
  console,
};
const context = createContext(sandbox);
runInContext(`${extractWheelSection()}\nthis.onWheel = onWheel;`, context);

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
  sandbox.__event = { deltaY, deltaMode, cancelable, timeStamp: timeStamp ?? (clock += 1), preventDefault: () => events.push('preventDefault') };
  const cardBefore = port.scrollTop;
  const talkBefore = talk.scrollTop;
  runInContext('this.onWheel(__event)', context);
  const prevented = events.includes('preventDefault');
  if (!prevented) {
    port.scrollTop = clampIn(port.scrollTop + deltaY, 0, Math.max(0, port.scrollHeight - port.clientHeight));
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

// 2. Bottom edge: the notch is consumed and the conversation takes it, once.
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

// 4b. A notch that would overshoot hands off in the same event, absorbing what is left.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 - 5 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('near the bottom: the overshooting notch hands off at once', result.talkMoved === 115,
    `talk moved ${String(result.talkMoved)}`);
  check('near the bottom: the card lands exactly on the edge', port.scrollTop === 1200 - 224,
    `card at ${String(port.scrollTop)}`);
}

// 4c. A sub-pixel gap is absorbed the same way, without stalling.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 - 0.5 });
  const result = wheel({ port, talk, deltaY: 120 });
  check('sub-pixel gap: the notch hands off at once', result.talkMoved === 119.5,
    `talk moved ${String(result.talkMoved)}`);
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
