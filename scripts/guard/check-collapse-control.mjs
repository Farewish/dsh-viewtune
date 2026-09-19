// Verify the "收起" control in the bundle: markup, styles, class map, and absence of the
// retired toolbar note. Structural checks only — no fabricated observations.
//
// The style assertions go through the anchor helpers because lightningcss re-hashes class and
// keyframe names and reorders declarations on every build; a verbatim rule string checks one
// build's output rather than the control.
import { readFileSync } from 'node:fs';
import { classOf, classSel, hasDecls, keyframeOf, moduleCssLiteral, ruleDecls } from './bundle-anchors.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const text = readFileSync(process.argv[2] ?? join(ROOT, 'lib/client.js'), 'utf8');
const bundleCss = moduleCssLiteral(text, 'Reader.module.css');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let bad = 0;

function count(needle) { return text.split(needle).length - 1; }

function want(label, needle, expected) {
  const got = count(needle);
  const ok = got === expected;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got} (want ${expected})`);
}

function absent(label, needle) {
  const got = count(needle);
  const ok = got === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got} (want 0)`);
}

function present(label, needle) {
  const got = count(needle);
  const ok = got > 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got} (want >0)`);
  return got;
}

console.log('--- markup');
absent('retired toolbar note', '阅读 · 原始记录完整保留');
absent('retired note title', '基于真实消息类型和轮次边界整理');
want('collapse wrapper', 'className: Reader_module_css_default.collapseWrap', 1);
want('collapse control', 'className: Reader_module_css_default.collapseControl', 1);
want('collapse state hook', '"data-reader-collapse": currentTurnOpen ? "open" : "idle"', 1);
want('hidden gate', 'hidden: !currentTurnOpen', 1);
// The handlers run through a wrapper that records where focus was before the button disappears.
want('current-turn handler', 'collapseCurrentTurn();', 2);
want('collapse-all state hook', '"data-reader-collapse-all": otherTurnsOpen ? "open" : "idle"', 1);
want('collapse-all gate', 'hidden: !otherTurnsOpen', 1);
want('collapse-all handler', 'collapseEveryTurn()', 2);
want('toolbar wrap hook', '"data-ud-check": "collapse-wrap"', 1);
want('control label', '"收起 "', 1);
want('chevron', 'children: "˄"', 1);
want('tooltip names the scope', '收起当前这一轮的过程', 1);
want('motion toggle kept', '"aria-pressed": motionPreference', 1);
// B2: a keyboard path for both actions, and a focus handoff so collapsing never drops the reader to
// <body> when the button that was just used goes away.
want('alt+c shortcut', 'event.code !== "KeyC"', 1);
want('shortcut requires alt', 'if (!event.altKey', 1);
want('focus handoff', 'focusWasInCollapseWrap', 4);
// The shortcut is advertised to assistive tech, not only written into a tooltip. JSX compiles a
// hyphenated attribute to a quoted key, so the assertion spells it that way.
want('shortcut advertised via aria-keyshortcuts', '"aria-keyshortcuts": "Alt+C"', 1);
want('the advertised collapse-all shortcut', '"aria-keyshortcuts": "Alt+Shift+C"', 1);
present('collapse-all label', '全部收起');
present('shortcut is documented in a tooltip', 'Alt+Shift+C');

console.log('\n--- state');
/**
 * Assert the bundle carries the SAME number of occurrences as the source mirror.
 *
 * Two rows here were pinned to the artifact's own count (`processChoiceKey` twice, the boundary
 * read once) and the rebuild restored what the source actually says — the hand-edited artifact
 * had lost a call site. A literal expected count cannot tell "the artifact is right" from "the
 * artifact is stale", so these compare against the source instead of a number.
 */
const readerSource = readFileSync(join(ROOT, 'src/client/Reader.tsx'), 'utf8');
function wantAsSource(label, needle) {
  const inSource = readerSource.split(needle).length - 1;
  const inBundle = count(needle);
  const ok = inSource === inBundle && inSource > 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: bundle ${inBundle} vs source ${inSource}`);
}
want('current turn state', 'const [currentTurn, setCurrentTurn] = (0, react.useState)(null);', 1);
want('open set memo', 'const openTurnKeys = (0, react.useMemo)', 1);
want('expansion read', 'state.expanded);', 1);
/**
 * Assert the bundle carries AT LEAST as many occurrences as the decision needs.
 *
 * Exact source/bundle counts are not usable for everything: the compiler inlines a `const turn`
 * that is used once, and duplicates a call while inlining, so `boundaryOf(` reads 3 in the source
 * and 4 in the bundle. What the decision actually requires is that the call sites still exist —
 * the definition plus the turns that compute a boundary.
 */
function wantAtLeast(label, needle, minimum) {
  const inSource = readerSource.split(needle).length - 1;
  const inBundle = count(needle);
  const ok = inSource >= minimum && inBundle >= minimum;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: bundle ${inBundle}, source ${inSource} (want >= ${minimum})`);
}
wantAsSource('choice key', 'processChoiceKey(group.key, boundary)');
wantAtLeast('boundary read', 'boundaryOf(', 3);
// The scope itself: the loop must skip every turn but the one in view.
want('open set is narrowed to one turn', 'if (group.turn === null || group.turn !== currentTurn) continue;', 1);
want('collapse loop', 'for (const key of openTurnKeys) props.actions.setExpanded(key, false);', 1);
want('gate flag', 'const currentTurnOpen = openTurnKeys.size > 0;', 1);
present('action proxy exists', 'actions.setExpanded(key, false)');

console.log('\n--- which turn is "current" (viewport-driven)');
want('the predicate is a named function', 'function currentTurnOf(content, viewportTop) {', 1);
want('it walks the turn list', 'for (const element of content.querySelectorAll("[data-reader-turn]")) {', 1);
// Same predicate the reading scroll uses for its anchor, so the two agree on what is current.
want('first turn whose bottom passed the top edge', 'if (element.getBoundingClientRect().bottom > viewportTop + 8) return turnNumber;', 1);
want('skips groups without a turn number', 'if (!Number.isInteger(turnNumber)) continue;', 1);
want('nothing visible yields no turn', '\t\t\treturn null;\n\t\t}\n\t\tfunction Reader(props) {', 1);
want('the effect calls it', 'const next = currentTurnOf(content, scroller.getBoundingClientRect().top);', 1);
// Resolving the scroller this way is deliberate: useReadingScroll does exactly the same, so
// "the viewport" means one container in both places. Hence 2 occurrences, not 1.
want('uses the same scrollport as the reading scroll', 'content.closest("[data-conversation-scroll]") ?? content;', 2);
want('and listens to that scroller itself', 'scroller.addEventListener("scroll", schedule, { passive: true });', 1);
want('re-measures on scroll', 'scroller.addEventListener("scroll", schedule, { passive: true });', 1);
want('throttled to one read per frame', 'frame = requestAnimationFrame(read);', 1);
want('state only changes on a real move', 'setCurrentTurn((previous) => previous === next ? previous : next);', 1);
want('cleans up its listeners', 'scroller.removeEventListener("scroll", schedule);', 1);

console.log('\n--- styles');
// Asserted by the declarations each rule carries, through the anchor helpers: class names and
// keyframe names are re-hashed per build and the minifier chooses its own property order, so a
// verbatim rule string verifies one build's output rather than the control's behaviour.
const collapse = classSel(bundleCss, 'collapseControl');
const wrap = classSel(bundleCss, 'collapseWrap');
const intro = keyframeOf(bundleCss, 'readerCollapseIn');
const exit = keyframeOf(bundleCss, 'readerCollapseOut');
const styleChecks = [
  ['wrap lays the control out', ruleDecls(bundleCss, wrap).size > 0],
  ['control is a pill', hasDecls(bundleCss, collapse, ['display:inline-flex'])],
  ['hidden only forces display', hasDecls(bundleCss, `${collapse}[hidden]`, ['display:inline-flex'])],
  ['opening plays the intro animation', new RegExp(`${escapeRegExp(collapse)}\\[data-reader-collapse=open\\]\\{[^}]*animation:[^;}]*${escapeRegExp(intro)}`).test(bundleCss)],
  // The exit has to keep the box visible until the animation is over, or it is never seen.
  // Declarations are checked as a set: the minifier orders the shorthand and the visibility
  // change either way round, and that order is not part of the contract.
  [
    'exiting stays visible until the animation ends',
    hasDecls(bundleCss, `${collapse}[data-reader-collapse=idle]`, ['pointer-events:none', 'visibility:hidden'])
      && new RegExp(`${escapeRegExp(collapse)}\\[data-reader-collapse=idle\\]\\{[^}]*animation:[^;}]*${escapeRegExp(exit)}`).test(bundleCss)
      && new RegExp(`${escapeRegExp(collapse)}\\[data-reader-collapse=idle\\]\\{[^}]*transition:[^;}]*visibility\\s+0s[^;}]*[\\d.]+m?s`).test(bundleCss),
  ],
  ['intro keyframes shipped', bundleCss.includes(`@keyframes ${intro}{`)],
  ['exit keyframes shipped', bundleCss.includes(`@keyframes ${exit}{`)],
];
for (const [label, pass] of styleChecks) {
  if (!pass) bad++;
  console.log(`${pass ? 'ok  ' : 'MISS'} ${label}`);
}

console.log('\n--- class map');
want('map collapseControl', `"collapseControl": "${classOf(bundleCss, 'collapseControl')}"`, 1);
want('map collapseWrap', `"collapseWrap": "${classOf(bundleCss, 'collapseWrap')}"`, 1);

console.log('\n--- lane shape (the toolbar lane is what keeps this control reachable)');
if (hasDecls(bundleCss, classSel(bundleCss, 'disclosure'), ['position:sticky'])) {
  bad++;
  console.log('MISS no sticky status lane rule');
} else {
  console.log('ok   no sticky status lane rule');
}
absent('no measured toolbar height', 'reader-toolbar-height');
if (hasDecls(bundleCss, classSel(bundleCss, 'toolbar'), ['position:sticky', 'top:0', 'z-index:9'])) {
  console.log('ok   toolbar lane rule present');
} else {
  bad++;
  console.log('MISS toolbar lane rule present');
}

console.log(`\n${bad === 0 ? 'BUNDLE COLLAPSE OK' : 'BUNDLE COLLAPSE FAILED: ' + bad}`);
process.exit(bad === 0 ? 0 : 1);
