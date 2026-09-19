/**
 * Behavioural test for "which turn is the current one" — the scope of the 收起 control.
 *
 * A conversation is one turn (question + answer), so the control folds the turn the reader
 * is looking at. That turn is picked by the compiled `currentTurnOf`, which this test runs
 * against a fake DOM: the predicate is asserted directly rather than inferred from strings.
 *
 * Invariants asserted:
 *   - the uppermost turn still visible wins;
 *   - a viewport straddling two turns resolves to the UPPER one;
 *   - turns entirely above the viewport are skipped;
 *   - a group the snapshot cannot place ('unresolved') is never the current turn;
 *   - nothing visible (scrolled past the end) yields no current turn.
 *
 * Usage: node test-current-turn.mjs [bundlePath]
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

/** Lift the compiled predicate out of the bundle. */
function extractFn() {
  // Match the signature by its name and first parameters rather than the whole parameter list:
  // the predicate gained an optional rows argument so one scroll pass can reuse its query, and a
  // guard pinned to the old exact spelling would have failed for that rather than for behaviour.
  const start = bundle.indexOf('function currentTurnOf(content, viewportTop');
  if (start === -1) throw new Error('compiled currentTurnOf not found');
  // Walk to the matching closing brace of the function body.
  let depth = 0;
  let i = bundle.indexOf('{', start);
  for (; i < bundle.length; i++) {
    if (bundle[i] === '{') depth++;
    else if (bundle[i] === '}') { depth--; if (depth === 0) break; }
  }
  return bundle.slice(start, i + 1);
}

const context = createContext({ console });
runInContext(`${extractFn()}\nthis.currentTurnOf = currentTurnOf;`, context);
const currentTurnOf = context.currentTurnOf;

/** A turn element: bottom edge in viewport coordinates, plus its data attribute. */
const turn = (label, bottom) => ({ dataset: { readerTurn: label }, getBoundingClientRect: () => ({ bottom }) });
const content = (...turns) => ({ querySelectorAll: () => turns });

const cases = [
  {
    name: 'one long turn fills the viewport',
    turns: [turn('1', 4000)],
    viewportTop: 100,
    want: 1,
  },
  {
    name: 'scrolled inside the second turn',
    turns: [turn('1', 40), turn('2', 3000)],
    viewportTop: 100,
    want: 2,
  },
  {
    name: 'straddling two turns resolves to the upper one',
    // Turn 1 still has content on screen (its bottom is 300px below the top edge) while
    // turn 2 has begun. The spec says the upper conversation wins.
    turns: [turn('1', 400), turn('2', 3600)],
    viewportTop: 100,
    want: 1,
  },
  {
    name: 'a turn that has just left the viewport is skipped',
    turns: [turn('1', 108), turn('2', 3000)],
    viewportTop: 100,
    want: 2,
  },
  {
    name: 'the scroller content edge doubles as the viewport',
    turns: [turn('1', 0), turn('2', 2400)],
    viewportTop: 0,
    want: 2,
  },
  {
    name: 'an unresolved group is never current',
    turns: [turn('unresolved', 3600), turn('7', 7200)],
    viewportTop: 100,
    want: 7,
  },
  {
    name: 'no turn is visible below the end of the list',
    turns: [turn('1', 12), turn('2', 60)],
    viewportTop: 100,
    want: null,
  },
  {
    name: 'empty transcript has no current turn',
    turns: [],
    viewportTop: 100,
    want: null,
  },
];

let passed = 0;
const failures = [];
for (const test of cases) {
  const got = currentTurnOf(content(...test.turns), test.viewportTop);
  const ok = got === test.want;
  if (ok) passed++;
  else failures.push(`${test.name}: got ${JSON.stringify(got)}, want ${JSON.stringify(test.want)}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${test.name}${ok ? ` -> ${JSON.stringify(got)}` : ` -> got ${JSON.stringify(got)}, want ${JSON.stringify(test.want)}`}`);
}

console.log(`\n${passed}/${cases.length} passed against ${bundlePath}`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
