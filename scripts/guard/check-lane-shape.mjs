// Verify the sticky lanes are gone from both the source mirror and the bundle, and that
// the toolbar/status row are back in normal flow with nothing left dangling.
//
// The bundle-side rules are asserted through the anchor helpers: class and keyframe names are
// re-hashed by lightningcss on every build, and property order is the minifier's, so a guard
// that spells `.g2GnNq_toolbar{position:sticky;…` verifies one build rather than the lane shape.
import { readFileSync } from 'node:fs';
import { classSel, hasDecls, keyframeOf, moduleCssLiteral, ruleDecls } from './bundle-anchors.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const files = {
  bundle: join(ROOT, 'lib/client.js'),
  source: join(ROOT, 'src/client/Reader.tsx'),
  css: join(ROOT, 'src/client/Reader.module.css'),
};
const text = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
const bundleCss = moduleCssLiteral(text.bundle, 'Reader.module.css');
const COLLAPSE = classSel(bundleCss, 'collapseControl');
const EXIT = keyframeOf(bundleCss, 'readerCollapseOut');
let bad = 0;

function gone(label, needle) {
  const hits = Object.entries(text).filter(([, t]) => t.includes(needle)).map(([k]) => k);
  const pass = hits.length === 0;
  if (!pass) bad++;
  console.log(`${pass ? 'ok  ' : 'LEFT'} ${label}${pass ? '' : ' — still in ' + hits.join(', ')}`);
}

function here(label, needle, where) {
  const pass = text[where].includes(needle);
  if (!pass) bad++;
  console.log(`${pass ? 'ok  ' : 'MISS'} ${label} (${where})`);
}

function assert(label, pass, detail = '') {
  if (!pass) bad++;
  console.log(`${pass ? 'ok  ' : 'MISS'} ${label}${pass || detail === '' ? '' : ` — ${detail}`}`);
}

console.log('--- lane shape: toolbar pins, nothing else does');
here('toolbar is a sticky lane', '.toolbar { position: sticky; top: 0; z-index: 9; background: var(--dsw-alias-bg-base); }', 'css');
assert(
  'bundle serves the same rule',
  hasDecls(bundleCss, classSel(bundleCss, 'toolbar'), ['position:sticky', 'top:0', 'z-index:9', 'background:var(--dsw-alias-bg-base)']),
  JSON.stringify([...ruleDecls(bundleCss, classSel(bundleCss, 'toolbar'))]),
);
assert(
  'no sticky status lane rule',
  !hasDecls(bundleCss, classSel(bundleCss, 'disclosure'), ['position:sticky']),
);
// The toolbar's height fed only the status lane's offset, so with that lane gone nothing
// may measure it. Both lanes' stale leftovers are covered by this one assertion.
gone('no measured toolbar height', 'reader-toolbar-height');
gone('no height measurement effect', 'getBoundingClientRect().height) + "px"');
gone('no toolbar ref wiring', 'toolbarRef');
// The status lane was the reason these were overridden; the toolbar sticks without them.
gone('no overflow override on .root', '.root { overflow: visible; }');
gone('no overflow override on .turn', '.turn { overflow: visible; }');
gone('no position:relative override on .mainFlow', '.mainFlow { position: relative; overflow: visible; }');
console.log(`ok   pre-existing sticky kept: .jumpDock ${text.css.includes('.jumpDock { position: sticky') ? 'present' : 'MISSING'}`);
if (!text.css.includes('.jumpDock { position: sticky')) bad++;

console.log('\n--- collapse control intact');
here('control markup', '"data-reader-collapse": currentTurnOpen ? "open" : "idle"', 'bundle');
here('control folds the turn in view', 'for (const key of openTurnKeys) props.actions.setExpanded(key, false);', 'bundle');
here('control is scoped to one turn', 'if (group.turn === null || group.turn !== currentTurn) continue;', 'bundle');
assert('control styles', hasDecls(bundleCss, COLLAPSE, ['display:inline-flex']));
assert(
  'exit keeps the box until the animation ends',
  hasDecls(bundleCss, `${COLLAPSE}[data-reader-collapse=idle]`, ['pointer-events:none', 'visibility:hidden'])
    && bundleCss.includes(EXIT)
    && new RegExp(`transition:[^;}]*visibility\\s+0s[^;}]*[\\d.]+m?s`).test(bundleCss),
);
here('toolbar still carries its hook', '"data-ud-check": "reader-toolbar"', 'bundle');
here('settings panel wired to the motion preference', 'preference: motionPreference', 'bundle');

console.log('\n--- compiler-shaped output (the swap artifact is gone)');
gone('no doubled @__PURE__ marker', '/* @__PURE__ */ \t\t\t\t\t\t\t\t/* @__PURE__ */', 'bundle');

console.log(`\n${bad === 0 ? 'STICKY LANES REVERTED' : 'REVERT INCOMPLETE: ' + bad}`);
process.exit(bad === 0 ? 0 : 1);
