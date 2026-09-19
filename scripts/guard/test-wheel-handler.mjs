/**
 * Behavioural test for the reasoning card's wheel handling.
 *
 * The card's scrolling belongs to the browser and only to the browser. This handler is not a
 * scroll handler at all: it exists to notice a gesture (release auto-follow, mark the gesture as
 * running so the scroll events it causes stay out of React state) and to do NOTHING else. Every
 * attempt to improve on the browser here has produced a step instead of a glide — either by
 * writing scrollTop on every notch, or by intercepting a notch and re-issuing it as scrollBy.
 *
 * A wheel over the card is latched to the card's scroll node, and how the browser then behaves was
 * measured in Edge: the notch goes to the card, the part the card cannot take is DROPPED, and the
 * whole notch is chained up to the conversation only once the card cannot move at all. Those are
 * the rules the model below applies.
 *
 * Invariants asserted per case:
 *   - the handler never consumes a notch and never writes any scroll position;
 *   - a notch the card can use moves the card by the notch, natively;
 *   - a notch that overshoots the card's end spends itself on the card; the leftover is dropped,
 *     and the conversation is left alone (the browser would not have chained it either);
 *   - once the card is on its edge the conversation takes the whole notch;
 *   - a short (non-scrollable) transcript behaves the same way;
 *   - a scroll event during a gesture does not touch React state, and measures once after it.
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

/** One wheel event: the handler first (which must do nothing to any scroll position), then the
 * browser's own scroll for the notch with the rules measured in Edge. */
function wheel({ port, talk, deltaY, deltaMode = 0, cancelable = true, timeStamp, automatic = false, handler = 'onWheel' }) {
  const events = [];
  sandbox.port = port;
  sandbox.text = { offsetHeight: port.scrollHeight };
  sandbox.automatic = automatic;
  sandbox.pause = () => events.push('pause');
  sandbox.measure = () => events.push('measure');
  port.parentElement = talk.host;
  const stamp = timeStamp ?? (clock += 1);
  sandbox.__event = { deltaY, deltaMode, cancelable, timeStamp: stamp, preventDefault: () => events.push('preventDefault') };
  const cardBefore = port.scrollTop;
  const talkBefore = talk.scrollTop;
  const cardWritesBefore = port.writes;
  const talkWritesBefore = talk.writes;
  // The sandbox provides only what noticing a gesture needs: the port, the event, pause(). A
  // handler that has gone back to steering the scroll reaches for something that is not there
  // (splitNotch, a scroll helper, a host), so catching here turns "this handler does too much"
  // into a named failure instead of a stack trace.
  let threw = '';
  try { runInContext(`this.${handler}(__event)`, context); } catch (error) { threw = String(error && error.message || error); }
  // Everything the handler is allowed to touch, counted as a delta for THIS event — the counters
  // are cumulative, so a later event would otherwise inherit the browser's earlier writes.
  const handlerCardWrites = port.writes - cardWritesBefore;
  const handlerTalkWrites = talk.writes - talkWritesBefore;
  const prevented = events.includes('preventDefault');
  // The browser applies each wheel event it was allowed to keep exactly once, and how it applies it
  // was measured in a real browser: the notch goes to the card under the pointer and any leftover
  // is DROPPED — the browser does not chain it — unless the card cannot move at all in that
  // direction, in which case the whole notch goes to the conversation.
  const delivered = `${String(stamp)}:${String(deltaY)}`;
  const firstDelivery = !appliedEvents.has(delivered);
  appliedEvents.add(delivered);
  if (firstDelivery) {
    // The browser scrolls by the notch in PIXELS: a line-mode event means lines, not pixels.
    const native = deltaY * (deltaMode === 1 ? 24 : deltaMode === 2 ? port.clientHeight : 1);
    const maxOffset = Math.max(0, port.scrollHeight - port.clientHeight);
    const room = native > 0 ? maxOffset - port.scrollTop : port.scrollTop;
    if (room <= 0) talk.host.scrollBy(0, native);
    else port.scrollTop = clampIn(port.scrollTop + native, 0, maxOffset);
  }
  return {
    cardMoved: port.scrollTop - cardBefore,
    talkMoved: talk.scrollTop - talkBefore,
    prevented,
    threw,
    handlerCardWrites,
    handlerTalkWrites,
    events,
    port,
    talk,
  };
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

/** Every shape of notch, run through the same "the handler touched nothing" assertions. */
const shapes = [];
const record = (label, setup, deltaY, deltaMode = 0, handler = 'onWheel') => {
  const talk = makeConversation();
  const port = makePort({ ...longCard, ...setup });
  const result = wheel({ port, talk, deltaY, deltaMode, handler });
  shapes.push({ label, result });
  return result;
};

// 1. Mid-transcript: the card moves natively and the conversation stays put.
{
  const result = record('mid-card', { scrollTop: 100 }, 120, 0);
  check('mid-card: card moves by the delta', result.cardMoved === 120, `moved ${String(result.cardMoved)}`);
  check('mid-card: conversation untouched', result.talkMoved === 0, `moved ${String(result.talkMoved)}`);
}

// 2. The last notch the card can use: it spends itself on the card, and what the card cannot take
// is dropped — by the browser, which is the whole point. Handing those last pixels to the
// conversation instead means a programmatic scrollBy, and that lands in one frame where the
// browser's own scroll glides: a visible step for at most one notch of travel.
{
  const result = record('last notch', { scrollTop: 1200 - 224 - 5 }, 120, 0);
  check('last notch: the card takes what it can', result.cardMoved === 5, `card moved ${String(result.cardMoved)}`);
  check('last notch: the card lands exactly on its edge', result.port.scrollTop === 1200 - 224,
    `card at ${String(result.port.scrollTop)}`);
  check('last notch: the conversation is not scrolled for the leftover', result.talkMoved === 0,
    `talk moved ${String(result.talkMoved)}`);
}

// 3. Once the card is on its edge the conversation takes the whole notch, and the browser is what
// scrolls it there — chaining, animated, exactly as if the pointer were over the conversation.
{
  const result = record('on the edge', { scrollTop: 1200 - 224 }, 120, 0);
  check('on the edge: the conversation takes the whole notch', result.talkMoved === 120,
    `talk moved ${String(result.talkMoved)}`);
  check('on the edge: the card does not move', result.cardMoved === 0, `card moved ${String(result.cardMoved)}`);
}

// 4. Every notch after that is the same case: while the pointer rests on a card that has finished
// scrolling, three notches in a row must all be the browser's.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 1200 - 224 });
  const results = [1, 2, 3].map(() => wheel({ port, talk, deltaY: 120 }));
  check('staying on the edge: the conversation keeps moving', results.every((r) => r.talkMoved === 120),
    `moved ${results.map((r) => String(r.talkMoved)).join(' ')}`);
  check('staying on the edge: the handler writes nothing', results.every((r) => r.handlerCardWrites === 0 && r.handlerTalkWrites === 0),
    `writes ${results.map((r) => `${String(r.handlerCardWrites)}/${String(r.handlerTalkWrites)}`).join(' ')}`);
}

// 5. A short transcript: the card cannot move, so the browser sends every notch up.
{
  const result = record('short card', { clientHeight: 224, scrollHeight: 90, scrollTop: 0 }, 120, 0);
  check('short card: conversation takes the notch', result.talkMoved === 120, `moved ${String(result.talkMoved)}`);
  check('short card: card stays put', result.cardMoved === 0, `moved ${String(result.cardMoved)}`);
}

// 6. Upward from the top edge.
{
  const result = record('top edge', { scrollTop: 0 }, -120, 0);
  check('top edge: conversation takes the notch upward', result.talkMoved === -120, `moved ${String(result.talkMoved)}`);
}

// 7. Line-mode deltas are the browser's business too: three lines is 72px, and with the card unable
// to move upward it all goes to the conversation.
{
  const result = record('line mode', { scrollTop: 0 }, -3, 1);
  check('line-mode deltas are converted by the browser', result.talkMoved === -72, `moved ${String(result.talkMoved)}`);
}

// The invariant that covers all of the above at once, and the one every previous attempt broke:
// this handler is not a scroll handler. It must not consume a notch and must not write any scroll
// position, whatever shape the notch has.
check('no shape is consumed by the handler', shapes.every(({ result }) => !result.prevented),
  `prevented ${shapes.map(({ label, result }) => `${label}=${String(result.prevented)}`).join(' ')}`);
check('no shape writes the card', shapes.every(({ result }) => result.handlerCardWrites === 0),
  `writes ${shapes.map(({ label, result }) => `${label}=${String(result.handlerCardWrites)}`).join(' ')}`);
check('no shape writes the conversation', shapes.every(({ result }) => result.handlerTalkWrites === 0),
  `writes ${shapes.map(({ label, result }) => `${label}=${String(result.handlerTalkWrites)}`).join(' ')}`);
check('the handler needs nothing but the gesture', shapes.every(({ result }) => result.threw === ''),
  `threw ${shapes.filter(({ result }) => result.threw !== '').map(({ label, result }) => `${label}: ${result.threw}`).join(' | ')}`);

// 8. What the handler IS for: releasing auto-follow, and marking the gesture so the scroll events it
// causes stay out of React state. Without the first, a streaming card re-arms its follow animation
// under the reader's wheel; without the second, every notch re-renders mid-gesture.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 100 });
  const result = wheel({ port, talk, deltaY: 60, automatic: true });
  check('a wheel releases automatic following', result.events.includes('pause'), `events ${JSON.stringify(result.events)}`);
  const during = scrollCard(port, talk);
  check('scroll during a gesture stays off React state', during.length === 0, `events ${JSON.stringify(during)}`);
  clock += 1_000;
  const after = scrollCard(port, talk);
  check('scroll after the gesture measures once', after.includes('measure'), `events ${JSON.stringify(after)}`);
}

// 9. A wheel that moves nothing is not a gesture.
{
  const talk = makeConversation();
  const port = makePort({ ...longCard, scrollTop: 100 });
  const before = port.scrollTop;
  const result = wheel({ port, talk, deltaY: 0 });
  check('a zero-delta event moves nothing', port.scrollTop === before && result.talkMoved === 0,
    `card ${String(port.scrollTop)}, talk ${String(result.talkMoved)}`);
}

// 10. Prove the three aggregate checks above can fail. A handler that takes the overshooting notch
// over — the shape this test exists to reject, and the shape that was shipped for four attempts — is
// run through the very same shapes. If it came back clean, the checks would be proving nothing.
{
  runInContext(`
    this.onWheelIntercepting = (event) => {
      if (!event.deltaY) return;
      if (automatic) pause();
      wheelUntil = Date.now() + WHEEL_IDLE_MS;
      const maxOffset = Math.max(0, port.scrollHeight - port.clientHeight);
      const projected = Math.min(maxOffset, Math.max(0, port.scrollTop + event.deltaY));
      const consumed = projected - port.scrollTop;
      const remainder = event.deltaY - consumed;
      if (consumed === 0 && remainder === 0) return;
      let host = port.parentElement;
      while (host && !host.hasAttribute('data-conversation-scroll')) host = host.parentElement;
      if (!host) return;
      event.preventDefault();
      if (consumed !== 0) port.scrollTop += consumed;
      host.scrollBy(0, remainder);
    };
  `, context);
  const broken = [
    record('broken mid-card', { scrollTop: 100 }, 120, 0, 'onWheelIntercepting'),
    record('broken last notch', { scrollTop: 1200 - 224 - 5 }, 120, 0, 'onWheelIntercepting'),
  ];
  check('the checks can see an intercepting handler', broken.some((r) => r.prevented),
    `prevented ${broken.map((r) => String(r.prevented)).join(' ')}`);
  check('the checks can see a handler that writes the card', broken.some((r) => r.handlerCardWrites > 0),
    `card writes ${broken.map((r) => String(r.handlerCardWrites)).join(' ')}`);
  check('the checks can see a handler that writes the conversation', broken.some((r) => r.handlerTalkWrites > 0),
    `talk writes ${broken.map((r) => String(r.handlerTalkWrites)).join(' ')}`);
}

let ok = true;
for (const [name, pass, detail] of tests) {
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${name}${pass || detail === '' ? '' : `   (${detail})`}`);
}
console.log(`\n${String(tests.filter(([, pass]) => pass).length)}/${String(tests.length)} passed against ${bundlePath}`);
process.exit(ok ? 0 : 1);
