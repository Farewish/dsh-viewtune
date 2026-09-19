/**
 * Self-test for test-collapse-fade.mjs.
 *
 * A checker that has never failed is indistinguishable from one that never fails. This
 * feeds it the exact CSS that caused the reported symptom — the exit's `visibility: hidden`
 * sitting on the `[hidden]` rule, so the control is invisible on the animation's first
 * frame — and requires the checker to reject it.
 *
 * The broken bundle is written to a temp file; the real artifact is never touched.
 *
 * Usage: node selftest-collapse-fade.mjs
 *
 * Both child runs use `stdio: "ignore"`: only the exit status matters here, and the file
 * sandbox forbids the piped stdio that `{ stdio: "pipe" }` asks for. With pipes, both calls
 * failed with `spawn EPERM` — which reads as "the broken CSS was rejected" (true, but for
 * the wrong reason) and then "the healthy bundle was rejected too", a false alarm.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classSel, moduleCssLiteral } from './bundle-anchors.mjs';
import { fileURLToPath } from 'node:url';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const BUNDLE = process.argv[2] ?? join(ROOT, 'lib/client.js');
const CHECKER = join(ROOT, 'scripts', 'guard', 'test-collapse-fade.mjs');

const bundle = readFileSync(BUNDLE, 'utf8');
// The control's class is re-hashed on every build, so the broken variant is constructed from
// the class name this bundle actually carries rather than from the one it carried when this
// selftest was written. Same for the delay: its unit is the minifier's choice (`140ms`/`.14s`).
const COLLAPSE = classSel(moduleCssLiteral(bundle, 'Reader.module.css'), 'collapseControl');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const broken = bundle
  // The regression: hide on the [hidden] rule, which applies from the first frame.
  .replace(`${COLLAPSE}[hidden]{display:inline-flex}`, `${COLLAPSE}[hidden]{display:inline-flex;visibility:hidden}`)
  // ...and no delayed visibility transition on the idle state.
  .replace(new RegExp(`(${escapeRegExp(COLLAPSE)}\\[data-reader-collapse=idle\\]\\{[^}]*?);?transition:[^;}]*visibility[^;}]*`), '$1');

if (broken === bundle) {
  console.log('BAD  could not construct the broken variant — anchors moved');
  process.exit(1);
}
console.log('ok   built a broken variant (visibility hidden on [hidden], no delay)');

const temp = join(tmpdir(), 'selftest-collapse-fade-broken.js');
writeFileSync(temp, broken, 'utf8');

let verdict;
try {
  execFileSync(process.execPath, [CHECKER, temp], { stdio: 'ignore' });
  verdict = 0;
} catch (error) {
  verdict = error.status ?? 1;
}
rmSync(temp, { force: true });

if (verdict === 0) {
  console.log('BAD  the checker accepted the broken CSS — it cannot detect this regression');
  process.exit(1);
}
console.log(`ok   the checker rejected the broken CSS (exit ${verdict})`);

// The healthy bundle must still pass, so the checker is not merely always-failing.
try {
  execFileSync(process.execPath, [CHECKER, BUNDLE], { stdio: 'ignore' });
} catch (error) {
  console.log('BAD  the checker rejected the healthy bundle too');
  console.log(`     exit ${String(error.status ?? 1)} — if it is EPERM, the child never ran`);
  process.exit(1);
}
console.log('ok   the checker still accepts the healthy bundle');

console.log('\nCOLLAPSE FADE SELFTEST OK');
