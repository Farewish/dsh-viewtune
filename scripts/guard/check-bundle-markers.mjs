/**
 * Reports which bundle patch markers are present on disk and asserts the invariants the
 * reasoning card, the collapse control and the loader registration must keep.
 *
 * Markers that name CSS rules go through the anchor helpers, because lightningcss re-hashes
 * class and keyframe names and reorders declarations on every build: a marker written as one
 * verbatim rule string verifies a single build rather than the rule being present.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classSel, hasDecls, moduleCssLiteral, pillBoundaryClass } from './bundle-anchors.mjs';
import { fileURLToPath } from 'node:url';

/** The checkout this guard lives in (see the note in run.mjs). */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/**
 * In the repository the plugin *is* the checkout, so the lookups these guards used to make
 * against an installed profile (`plugin-location.mjs`) reduce to the root and its manifest.
 */
const installedPluginDir = () => ROOT;
const pluginPackageName = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;

// The bundle the profile actually installs, not a hardcoded package name.
const bundle = readFileSync(join(installedPluginDir(), 'lib', 'client.js'), 'utf8');

/**
 * The compiled reasoning-card wheel handler: the region every wheel invariant below lives in.
 *
 * TWO components declare `const onWheel = (event) => {` in this bundle — the reasoning card and the
 * reader's scroll follower in motion.tsx — and which the bundler emits first is its business, not
 * this guard's: measured today at 1063990 (card, 147 chars) and 1084073 (follower). So the handler
 * is claimed by its END rather than by its position: the card's is the occurrence the card's effect
 * closes with `const onSelection`, while the follower's runs on into more scroll code.
 *
 * If no occurrence has that terminator this returns '' and every wheel marker fails loudly, which
 * is the point: a marker that silently asserted against a truncated slice of the WRONG function
 * would be worse than no marker. (Checked: the follower's slice does contain a scrollTop write, so
 * a mis-claim fails rather than passes — but that is luck, not design.)
 */
const wheelHandler = (() => {
  const needle = 'const onWheel = (event) => {';
  // A handler is a handful of statements; a terminator thousands of characters away belongs to
  // something else in the file.
  const MAX_HANDLER = 4000;
  for (let at = bundle.indexOf(needle); at !== -1; at = bundle.indexOf(needle, at + 1)) {
    const end = bundle.indexOf('const onSelection', at);
    if (end !== -1 && end - at < MAX_HANDLER) return bundle.slice(at, end);
  }
  return '';
})();

// The Host derives the client row id from the installed manifest's package name,
// and the browser loader refuses a bundle that registers anything else — the
// failure mode is the whole page reporting "Failed to load plugins", so assert
// it here rather than discovering it in the browser.
const packageName = pluginPackageName();
const registered = /__ModuleLoader__\.load\(\{\s*\n\s*id: "([^"]+)"/u.exec(bundle)?.[1];

const registration = [
  ['bundle registers the package name', registered === packageName],
  ['no stale upstream registration id', !bundle.includes('id: "dsh-better-display"')],
];

/**
 * CSS rules are matched through the anchor helpers: lightningcss re-hashes class names and
 * keyframe names and reorders declarations on every build, so a marker written as one verbatim
 * rule string asserts a single build's output. Those markers are predicates over the resolved
 * stylesheet; everything that is genuinely a fixed string stays a string.
 */
const readerCss = (() => {
  try {
    return moduleCssLiteral(bundle, 'Reader.module.css');
  } catch {
    return '';
  }
})();
const sel = (local) => classSel(readerCss, local);
const cssDecls = (selector, declarations) => readerCss !== '' && hasDecls(readerCss, selector, declarations);

const markers = [
  ['short-thinking-frame', () => cssDecls(`${sel('reasonCard')}[data-overflow=false][data-expanded=false]`, ['background:var(--dsw-alias-bg-module-platform)', 'border-color:var(--dsw-alias-border-l2)', 'border-radius:12px'])],
  ['short-thinking-heading-padding', () => cssDecls(`${sel('reasonCard')}[data-overflow=false][data-expanded=false] ${sel('reasonHeading')}`, ['padding:10px 16px 0'])],
  ['short-thinking-text-padding', () => cssDecls(`${sel('reasonCard')}[data-overflow=false][data-expanded=false] ${sel('reasonText')}`, ['padding:8px 16px 16px'])],
  // The wheel implementation is verified behaviourally by test-wheel-handler.mjs (it extracts the
  // compiled handler and drives every notch shape through it). What is left to assert here is the
  // one rule that survived four attempts at "improving" on the browser:
  //
  //   the wheel over the card is the browser's. This handler notices the gesture and does nothing
  //   else — it never consumes a notch and never writes a scroll position.
  //
  // Every previous version broke that rule somewhere and each break was felt as stepping instead of
  // gliding: writing scrollTop on every notch, then intercepting the notch that overshoots and
  // re-issuing its leftover as scrollBy, then intercepting every notch once the card was on its
  // edge. Splitting the overshooting notch by hand does recover those last pixels, but the leftover
  // is at most one notch and a programmatic write lands in a single frame, so the trade is not
  // worth it. Keeping the handler empty is the invariant; a marker for any particular division
  // would only pin one build's spelling of it.
  ['wheel-leaves-scrolling-to-the-browser', () => wheelHandler !== ''
    && !/preventDefault|scrollBy|scrollTop\s*[-+]?=/.test(wheelHandler)],
  ['wheel-gesture-guard', 'if (Date.now() < wheelUntil) return;'],
  // The handler still has to RUN before the browser applies the notch, or the scroll events that
  // notch causes are measured before wheelUntil is set and re-render the card mid-gesture.
  ['wheel-handler-runs-before-the-scroll', () => /addEventListener\("wheel", onWheel, \{\s*passive: false\s*\}\)/.test(bundle)],
  ['all user/steering nodes collected', 'group.keys.filter((key) => {\n\t\t\t\tconst kind = snapshot.nodes.get(key)?.kind;'],
  ['every user message rendered in the leading slot', 'turnUserKeys.map((userKey) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BlockBoundary, {'],
  ['user nodes excluded from the flow', 'const mainKeys = group.keys.filter((key) => !turnUserKeys.includes(key));'],
  ['disclosure label still shows the duration', '用时 ${elapsed}'],
  ['reader column keeps the chat-flow hook (composer stays visible)', '"data-chat-flow": ""'],
  ['system-prompt detail has its own scrollport', 'Reader_module_css_default.systemPrompt'],
  ['command input renders as a labelled bubble', 'node.kind === "command-input"'],
  ['steps pill is wrapped in an error boundary', () => pillBoundaryClass(bundle) !== undefined],
  // Collapse control. Its CSS lives inside the injected literal, so the check reads the
  // literal rather than the file: a rule outside it never reaches the page.
  ['collapse control appears only while the turn in view is open', '"data-reader-collapse": currentTurnOpen ? "open" : "idle"'],
  ['collapse control folds the turn in view', 'for (const key of openTurnKeys) props.actions.setExpanded(key, false);'],
  ['collapse control is scoped to one turn', 'if (group.turn === null || group.turn !== currentTurn) continue;'],
  ['collapse exit is delayed past its animation', () => cssDecls(`${sel('collapseControl')}[hidden]`, ['display:inline-flex'])],
  ['collapse exit waits for the animation to finish', () => /transition:[^;}]*visibility\s+0s[^;}]*[\d.]+m?s/.test(readerCss)],
  // The toolbar is the one lane that pins, so both switches stay reachable.
  ['toolbar pins to the top', () => cssDecls(sel('toolbar'), ['position:sticky', 'top:0', 'z-index:9'])],
  // Two calls the product renders with its own keyed cards are rendered here instead of collapsing
  // into a generic row: a question set (what was asked, what was answered) and a delivery (which
  // files were handed over). Asserted by the data attribute they render with, matched with either
  // spelling of a valueless JSX attribute so a restyle of that markup is not a false failure.
  ['question set renders its own card', () => /"data-reader-tool-question":\s*(?:""|true)/.test(bundle)],
  ['delivery renders its own list', () => /"data-reader-tool-present":\s*(?:""|true)/.test(bundle)],
];

const forbidden = [
  ['no standalone duration row', '"data-reader-turn-duration"'],
  // Any rule for these locals at all is the violation, so match the generated name by suffix.
  ['no standalone duration style', () => /_turnDuration\{/.test(readerCss)],
  ['reasoning viewport must not claim the conversation scroller', '"data-reader-reasoning-scroll": true,\n\t\t\t\t\t\t"data-conversation-scroll": true,'],
  ['no extra metrics pill at turn level', 'turn.start && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TurnMetrics, {'],
  ['no leftover startsWithUser assumption', 'startsWithUser'],
  ['no overscroll containment under the handoff', 'overscroll-behavior-y:contain'],
  ['the card does not write its own scroll position', 'pendingDelta'],
  // The history backfill is gone for good: it trips a host defect on every page load, so
  // its return would be a regression rather than a feature. See the repo README.
  ['no history backfill (trips a host defect)', 'fillHistory'],
  ['no backfill paging loop', 'backfill.current'],
  // The status row's lane was reverted: it pinned below the toolbar and, to sit there, needed
  // the toolbar's measured height. Both are gone; only the toolbar lane remains.
  ['no sticky status lane', () => /_disclosure\{[^}]*position:sticky/.test(readerCss)],
  ['no measured toolbar height', 'reader-toolbar-height'],
];

let ok = true;
/** A marker is a fixed string, or a predicate for anything the build may re-spell. */
const matches = (needle) => (typeof needle === 'function' ? needle() === true : bundle.includes(needle));
for (const [name, needle] of markers) {
  const present = matches(needle);
  if (!present) ok = false;
  console.log(`${present ? 'ok  ' : 'MISS'} ${name}`);
}
for (const [name, needle] of forbidden) {
  const present = matches(needle);
  if (present) ok = false;
  console.log(`${present ? 'BAD ' : 'ok  '} ${name}`);
}
for (const [name, pass] of registration) {
  if (!pass) ok = false;
  console.log(`${pass ? 'ok  ' : 'BAD '} ${name}${name === 'bundle registers the package name' ? ` (${String(registered)})` : ''}`);
}
console.log(`bundle chars: ${String(bundle.length)}`);
console.log(ok ? 'BUNDLE STATE OK' : 'BUNDLE STATE WRONG');
process.exit(ok ? 0 : 1);
