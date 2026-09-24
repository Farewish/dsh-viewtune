/**
 * Every boolean setting's default and its DEFENSIVE READER have to agree.
 *
 * This is the failure this plugin has actually shipped: `glass` and `glassConversation` were flipped to ON while their
 * readers stayed `=== true`, so a record without the key resolved to the opposite of the documented default — and
 * `motion` had no defensive reader at all, which made a controlled `<Switch>` uncontrolled and turned movement off for
 * a record that predates the switch. Nothing could see either, because the store is a list of literals in one module
 * and the readers are expressions in another, and the client store cannot be imported by `npm test` at all (its
 * `@deepseek-ai/dsh-client-store` needs `zustand`, which a `link:`ed plugin does not resolve in the test process).
 *
 * So the check is textual, on the artifact, where both halves are present: the `init` literal and every
 * `state.<key>) === true` / `!== false` read. The rule is the one the store's own comments state — a default of `true`
 * means an ABSENT key is on (`!== false`), a default of `false` means absent is off (`=== true`) — and a boolean key
 * with no defensive reader at all is the `motion` bug.
 *
 * Two deliberate leniencies, so they are not mistaken for coverage: the defaults literal is brace-counted, so a string
 * default containing a brace would shift the scan; and only the boolean half is checked here, because the encoded keys
 * (`textCadence`, `followMode`, `reasoningFollow`, `collapseMode`, …) have per-key tests that already pin their
 * fallbacks.
 *
 * Usage: node scripts/guard/check-settings-fallbacks.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BUNDLE = join(ROOT, 'lib', 'client.js');

/** The `init` literal's body, from its opening brace to its matching close. */
function defaultsBody(bundle) {
  const at = bundle.indexOf('init: () => ({');
  if (at === -1) return undefined;
  const open = bundle.indexOf('{', at);
  let depth = 0;
  for (let index = open; index < bundle.length; index += 1) {
    const character = bundle[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return bundle.slice(open, index + 1);
    }
  }
  return undefined;
}

function depthAt(text, index) {
  let depth = 0;
  for (let at = 0; at < index; at += 1) {
    if (text[at] === '{') depth += 1;
    else if (text[at] === '}') depth -= 1;
  }
  return depth;
}

/** Every TOP-LEVEL boolean default, by key. */
export function booleanDefaultsOf(bundle) {
  const body = defaultsBody(bundle);
  if (body === undefined) return {};
  const found = {};
  for (const match of body.matchAll(/(?:^|[,{]\s*)(\w+): (true|false)(?=\s*[,}])/g)) {
    // Top level only: a boolean nested inside one of the defaults (`expanded`, `glassParts`, `shortcuts`) is that
    // key's value, not a setting of its own. The depth is taken AT THE KEY — the match may start on the delimiter
    // before it, and on the opening brace that delimiter sits one level above the key.
    const keyAt = match.index + match[0].indexOf(match[1]);
    if (depthAt(body, keyAt) !== 1) continue;
    found[match[1]] = match[2] === 'true';
  }
  return found;
}

/** Every defensive read in the artifact: `state.<key>) === true` / `!== false`. */
export function booleanReadsOf(bundle) {
  return [...bundle.matchAll(/state\.(\w+)\) (===|!==) (true|false)/g)]
    .map(match => ({ key: match[1], operator: match[2], literal: match[3] }));
}

/**
 * The keys whose reader deliberately does NOT follow their default, with the reason.
 *
 * Both are the skin. `init` says ON, because a fresh install should open the way this reader's plugin does; the readers
 * say `=== true`, so a record written BEFORE the skin existed resolves to OFF and keeps the look it had rather than
 * gaining one it never chose. That is a real second convention — "an absent key preserves what a record from before
 * that key looked like" — and it is the opposite of the one `focusExpand`, `revealWords` and `motion` follow, where
 * before the switch there was no way to turn the behaviour OFF, so absent means ON.
 *
 * Declared here rather than left as a disagreement, so that this list is the only place the two conventions can differ:
 * a THIRD key whose reader contradicts its default fails the guard until somebody writes down which convention it is
 * following and why.
 */
const INVERTED_ON_PURPOSE = new Map([
  ['glass', 'pre-skin records keep no skin, rather than gaining one they never chose'],
  ['glassConversation', 'the same, for the skin reaching the conversation page'],
]);

/** What is wrong with this artifact, as sentences. Empty means the two halves agree. */
export function violationsOf(bundle) {
  const defaults = booleanDefaultsOf(bundle);
  const reads = booleanReadsOf(bundle);
  const findings = [];
  for (const [key, value] of Object.entries(defaults)) {
    const sites = reads.filter(read => read.key === key);
    if (sites.length === 0) {
      findings.push(`${key}: default ${String(value)} with no defensive reader at all`);
      continue;
    }
    if (INVERTED_ON_PURPOSE.has(key)) continue;
    // ON by default means absent is on: `!== false`. OFF by default means absent is off: `=== true`.
    const want = value ? ['!==', 'false'] : ['===', 'true'];
    if (!sites.some(site => site.operator === want[0] && site.literal === want[1])) {
      findings.push(`${key}: default ${String(value)} but read as ${sites.map(site => `state.${key}) ${site.operator} ${site.literal}`).join(', ')}`);
    }
  }
  for (const read of reads) {
    if (!(read.key in defaults)) findings.push(`${read.key}: read defensively but is not a boolean default`);
  }
  return findings;
}

function selfTest() {
  const bad = [
    'const store = defineStore({ init: () => ({ on: true, off: false, unread: true, nested: { inner: true } }),',
    '  actions: {} });',
    'const a = useStore(state => state.on) === true;',   // wrong: true must be !== false
    'const b = useStore(state => state.off) === true;',  // right
    'const c = useStore(state => state.gone) !== false;', // not a default at all
  ].join('\n');
  const findings = violationsOf(bad);
  const keys = findings.map(finding => finding.split(':')[0]).sort().join(',');
  if (findings.length !== 3 || keys !== 'gone,on,unread') {
    console.error(`SELFTEST FAILED — expected gone,on,unread; got ${JSON.stringify(findings)}`);
    process.exit(1);
  }
  const good = 'init: () => ({ on: true, off: false }) });\nstate.on) !== false\nstate.off) === true';
  if (violationsOf(good).length !== 0) {
    console.error(`SELFTEST FAILED — a conforming pair was reported: ${JSON.stringify(violationsOf(good))}`);
    process.exit(1);
  }
  // …and the declared inversion is exempt while a NEW one is not: same shape, one key on the list and one not.
  const declared = 'init: () => ({ glass: true, other: true }) });\nstate.glass) === true\nstate.other) === true';
  const remaining = violationsOf(declared);
  if (remaining.length !== 1 || !remaining[0].startsWith('other:')) {
    console.error(`SELFTEST FAILED — expected only the undeclared inversion, got ${JSON.stringify(remaining)}`);
    process.exit(1);
  }
  console.log('ok   selftest — a wrong direction, a key with no reader, a stray read, and only UNDECLARED inversions are reported');
}

// Always, not behind a flag: a checker nobody has seen fail is a checker nobody can trust.
selfTest();

const bundle = readFileSync(BUNDLE, 'utf8');
const defaults = booleanDefaultsOf(bundle);
const reads = booleanReadsOf(bundle);
const findings = violationsOf(bundle);

if (findings.length > 0) {
  console.error(`SETTINGS FALLBACKS DISAGREE — ${String(findings.length)}`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error('\nA default of true means an ABSENT key is on, so its reader must be `!== false`; false means absent is off, so `=== true`.');
  process.exit(1);
}
console.log(`ok   ${String(Object.keys(defaults).length)} boolean default(s) and ${String(reads.length)} defensive read(s) agree`);
