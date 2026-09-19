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
  // The wheel implementation is verified behaviourally by test-wheel-handler.mjs (it extracts
  // the compiled handler and runs 22 cases) and test-follow-rules.mjs (27 cases, including how
  // one notch is split); these markers only assert the shape is still there, so they match
  // expressions rather than the minifier's choice of local name and spacing.
  ['wheel-native-scroll', () => /Math\.min\(maxOffset[^;]*scrollTop \+ delta/.test(bundle)],
  // Handoff must be decided by PROJECTING the notch, not by asking whether the card is already on
  // its edge: the wheel event is dispatched before the browser applies the scroll, so an
  // already-at-edge test sees the pixels still left, spends the notch on the card, and only hands
  // over on the next one — the gesture sticks and then jumps.
  ['wheel-projects-the-notch', () => /splitNotch\(port\.scrollTop, delta, maxOffset\)/.test(bundle)],
  ['wheel-handoff-on-overshoot', () => {
    const start = bundle.indexOf('const onWheel = (event) => {');
    if (start === -1) return false;
    const end = bundle.indexOf('const onSelection', start);
    const handler = bundle.slice(start, end === -1 ? start + 2000 : end);
    // Hands over when the notch leaves something, and walks only that remainder up.
    return /Math\.abs\(remainder\) < \.5/.test(handler) && /host\.scrollBy\(0, remainder\)/.test(handler);
  }],
  // The card is placed exactly on its edge at the handoff (one write, at the handoff only — a
  // write on every notch is what made the card step), and never scrolls past a limit.
  ['wheel-cards-the-remainder', () => {
    const start = bundle.indexOf('const onWheel = (event) => {');
    const end = bundle.indexOf('const onSelection', start);
    const handler = bundle.slice(start, end === -1 ? start + 2000 : end);
    return /port\.scrollTop \+= consumed/.test(handler);
  }],
  // The card keeps the notch natively whenever it fits, and is written ONLY on the handoff, to
  // land it on its edge. A write on every notch is what made the card step instead of glide, so
  // this pins the count: exactly one write in the handler, and it uses the consumed amount.
  ['wheel-writes-the-card-once-at-handoff', () => {
    const start = bundle.indexOf('const onWheel = (event) => {');
    if (start === -1) return false;
    const end = bundle.indexOf('const onSelection', start);
    const handler = bundle.slice(start, end === -1 ? start + 2000 : end);
    const writes = handler.match(/port\.scrollTop\s*(\+=|=)/g) ?? [];
    return writes.length === 1 && /port\.scrollTop \+= consumed/.test(handler);
  }],
  ['wheel-gesture-guard', 'if (Date.now() < wheelUntil) return;'],
  // `overflow` decides whether this card can scroll at all, so the handler reads it; a stale
  // closure here means the card never hands off after it grows past its preview height.
  ['wheel-effect-tracks-overflow', () => /\[[^\]]*\ballowed\b[^\]]*\bpause\b[^\]]*\boverflow\b[^\]]*\]/.test(bundle)],
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
