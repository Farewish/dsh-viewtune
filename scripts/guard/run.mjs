/**
 * Runs the artifact-level guards against this repository's own `lib/client.js`.
 *
 * These are not unit tests. `npm test` exercises the sources through Node's test runner; these
 * assert the *compiled* bundle the Host actually serves — the module-table registration, the
 * injected CSS literals, the turn order the reader renders, and the correspondence between
 * `src/` and the committed artifact. They exist because most of this plugin's history was spent
 * editing the built file directly, where a mistake is invisible to any source-level check.
 *
 * Split from `npm test` on purpose:
 *   - `npm test` needs no build and should stay fast;
 *   - these need `lib/client.js`, so they come after `npm run build`, and a failure here means the
 *     artifact and the sources disagree rather than "a function returned the wrong value".
 *
 * Usage: npm run guard [-- <name fragment>]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const filter = process.argv[2];

/** Each entry: the guard, and what a failure would mean. */
const GUARDS = [
  ['check-bundle-markers.mjs', 'the bundle registers this package and keeps every fork invariant'],
  ['check-turn-order.mjs', 'a turn renders user messages, then the disclosure, then the flow'],
  ['outline-turn.mjs', 'the disclosure still shows its duration and the metrics pill stays in the actions'],
  ['check-collapse-control.mjs', 'the collapse control exists, scoped to the current turn, and still fades'],
  ['check-lane-shape.mjs', 'only the toolbar pins; the status lane and its height measurement stay gone'],
  ['check-reader-css-literal.mjs', 'the Reader stylesheet is one whole, evaluable literal'],
  ['verify-reader-css-string.mjs', 'every rule this fork added is inside that literal'],
  ['check-pill-scope.mjs', 'the steps pill uses no identifier it does not declare'],
  ['selftest-pill-scope.mjs', 'that checker is able to fail (it is fed a known-bad bundle)'],
  ['check-stylesheet-classes.mjs', 'every CSS-module class the sources use has a rule, and the checker is able to fail'],
  ['verify-session-changes.mjs', 'the reading-view changes survive compilation'],
  ['compare-source-and-bundle.mjs', 'source and artifact agree on every decision this fork made'],
  ['audit-source-edits.mjs', 'no dead branches, leftovers, or drift between the two'],
  ['test-wheel-handler.mjs', 'the wheel leaves every notch to the browser, in every notch shape'],
  ['test-follow-rules.mjs', 'what keeps auto-follow running, and what takes it over'],
  ['test-current-turn.mjs', 'which turn is "current" when the viewport spans two'],
  ['test-toolbar-geometry.mjs', 'toolbar and pill geometry computed from the compiled CSS'],
  ['test-collapse-fade.mjs', 'the exit fade is actually able to play'],
  ['selftest-collapse-fade.mjs', 'that checker is able to fail (it is fed the CSS that caused the bug)'],
  ['verify-build.mjs', 'rebuilding from src/ still reproduces the shipped shape'],
];

if (!existsSync(join(ROOT, 'lib', 'client.js'))) {
  console.error('lib/client.js is missing — run `npm run build` first.');
  process.exit(1);
}

const selected = GUARDS.filter(([name]) => filter === undefined || name.includes(filter));
if (selected.length === 0) {
  console.error(`no guard matches "${String(filter)}"`);
  process.exit(1);
}

console.log(`guarding ${String(selected.length)} invariant(s) against ${join(ROOT, 'lib', 'client.js')}\n`);
const failed = [];
for (const [name, meaning] of selected) {
  console.log(`${'='.repeat(72)}\n${name} — ${meaning}\n`);
  const result = spawnSync(process.execPath, [join(HERE, name)], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) failed.push(name);
}

console.log(`${'='.repeat(72)}`);
if (failed.length === 0) {
  console.log(`GUARD OK — ${String(selected.length)} invariant(s) hold`);
  process.exit(0);
}
console.log(`GUARD FAILED — ${String(failed.length)}/${String(selected.length)}: ${failed.join(', ')}`);
console.log('A failure here means the artifact and the sources disagree, or a decision was reverted.');
process.exit(1);
