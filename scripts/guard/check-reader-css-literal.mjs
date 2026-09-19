/**
 * Verify the Reader stylesheet is a valid, complete string constant in the bundle.
 *
 * The failure this exists for: the stylesheet is injected as one CSS-module literal, so a rule
 * that lands *outside* the literal is in the file but never reaches the page. Pulling the
 * literal out and evaluating it proves the constant is whole — quotes closed, braces balanced —
 * which no amount of reading `src/` can establish.
 *
 * It used to name the constant `css$4` and match rules by their hashed class names. Both are
 * emission artefacts: the ordinal moves when a CSS module is added or reordered, and
 * lightningcss re-hashes names on every build. The stylesheet is now located by the module it
 * came from, and its rules are checked for the declarations they carry.
 *
 * Usage: node check-reader-css-literal.mjs [bundlePath]
 */
import { readFileSync } from 'node:fs';
import { classSel, hasDecls, keyframeOf, moduleCssLiteral } from './bundle-anchors.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const BUNDLE = process.argv[2] ?? join(ROOT, 'lib/client.js');
const text = readFileSync(BUNDLE, 'utf8');

let value;
try {
  value = moduleCssLiteral(text, 'Reader.module.css');
} catch (err) {
  console.log(`FAIL ${err.message}`);
  process.exit(1);
}

const COLLAPSE = classSel(value, 'collapseControl');
const WRAP = classSel(value, 'collapseWrap');
const INTRO = keyframeOf(value, 'readerCollapseIn');
const EXIT = keyframeOf(value, 'readerCollapseOut');

let bad = 0;
const check = (label, pass) => {
  if (!pass) bad++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`);
};

check(`literal contains the collapse wrapper rule (${WRAP})`, value.includes(`${WRAP}{`));
check(`literal contains the collapse control rule (${COLLAPSE})`, value.includes(`${COLLAPSE}{`));
check(`literal contains the intro keyframes (${INTRO})`, value.includes(`@keyframes ${INTRO}{`));
check(`literal contains the exit keyframes (${EXIT})`, value.includes(`@keyframes ${EXIT}{`));
check(
  'lane shape in the literal: toolbar pins, status row does not, no height read',
  hasDecls(value, classSel(value, 'toolbar'), ['position:sticky', 'top:0'])
    && !hasDecls(value, classSel(value, 'disclosure'), ['position:sticky'])
    && !value.includes('reader-toolbar-height'),
);
// The rule set ends where intended: the literal must not have been cut short, which is what a
// stray raw quote inside it would do.
check(
  'rule set ends where intended',
  new RegExp(`@keyframes ${EXIT}\\{(?:from|0%)\\{opacity:1;transform:none\\}(?:to|100%)\\{opacity:0;transform:translateY\\(-6px\\)\\}\\}$`).test(value),
);

// A stray raw quote would have ended the literal early; balanced braces are a second signal.
const opens = (value.match(/\{/g) ?? []).length;
const closes = (value.match(/\}/g) ?? []).length;
check(`braces balanced: ${String(opens)} { vs ${String(closes)} }`, opens === closes);
console.log(`literal length ${String(value.length)}`);

console.log(`\n${bad === 0 ? 'CSS LITERAL OK' : `CSS LITERAL FAILED: ${String(bad)}`}`);
process.exit(bad === 0 ? 0 : 1);
