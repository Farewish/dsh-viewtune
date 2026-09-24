/**
 * Does the 收起 control's fade actually get to play?
 *
 * Reporting "the fade does not happen" cannot be checked by grepping for an animation
 * declaration: the animation can be declared perfectly and still be invisible, which is
 * exactly what happened. The exit was made `visibility: hidden` on the `[hidden]` rule, so
 * the control was hidden on the first frame; an element that is not visible paints no
 * animation, so the user saw it vanish instead of fading.
 *
 * So this resolves the cascade for the control's two states, the way a browser would, and
 * asserts the property that decides visibility:
 *
 *   idle  - animation declared, and the final computed `visibility` is hidden (the state
 *           change happens), but reached through a transition whose delay equals the exit
 *           duration, so the element is still visible while the animation runs;
 *   open  - nothing makes it invisible.
 *
 * Usage: node test-collapse-fade.mjs [bundlePath]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { moduleCssLiteral } from './bundle-anchors.mjs';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const bundlePath = process.argv[2] ?? join(ROOT, 'lib/client.js');
const text = readFileSync(bundlePath, 'utf8');

/**
 * The Reader stylesheet, located by the stylesheet it CAME FROM — not by `const css$4 = `.
 *
 * The ordinal is an emission-order artefact: add or reorder a CSS module and this guard reads a different stylesheet
 * while still reporting a confident verdict about the fade. `moduleCssLiteral` pairs each literal with its owning
 * `tagId$N = "<package>/Reader.module.css"`, which is a fact about the file rather than about the build.
 */
function readReaderCss() {
  return moduleCssLiteral(text, 'Reader.module.css');
}

const css = readReaderCss();

/**
 * Every top-level flat rule as `{ selectors, decls }`.
 *
 * This walks braces rather than matching a regex per rule: a regex cannot tell a rule that
 * sits inside `@media (prefers-reduced-motion: reduce) { … }` from a top-level one, and
 * treating the former as unconditional makes the test evaluate a branch the page never
 * takes — which is exactly how it first reported a false failure here. At-rules are
 * reported separately as `conditions` so a caller can say which context it means.
 */
function parseRules(source) {
  const rules = [];
  const conditions = [];
  let depth = 0;
  let selectorStart = 0;
  let envelope = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      const head = source.slice(selectorStart, i).trim();
      if (depth === 0 && head.startsWith('@')) {
        envelope = head;
        conditions.push(head);
      } else if (head && !head.startsWith('@keyframes') && !envelope?.startsWith('@keyframes')) {
        const end = source.indexOf('}', i);
        const selectors = head.split(',').map(s => s.trim()).filter(Boolean);
        const decls = {};
        for (const part of source.slice(i + 1, end).split(';')) {
          const colon = part.indexOf(':');
          if (colon === -1) continue;
          decls[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
        if (!selectors.some(s => s.startsWith('@'))) {
          rules.push({ selectors, decls, conditions: conditions.slice(0, envelope ? 1 : 0) });
        }
      }
      depth++;
      selectorStart = i + 1;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) { envelope = null; conditions.length = 0; }
      selectorStart = i + 1;
    }
  }
  return rules;
}

const rules = parseRules(css);
/** Rules that apply unconditionally — no @media wrapper. */
const unconditional = rules.filter(rule => rule.conditions.length === 0);

/**
 * The control's class, resolved by its LOCAL name.
 *
 * lightningcss re-hashes the prefix on every build (`[hash]_[local]`), so spelling out
 * `g2GnNq_collapseControl` ties this checker to one build's artifact: it passes on the
 * committed bundle and reports a cascade it cannot find on an otherwise identical rebuild.
 * The local name is stable because it comes from the source `.module.css`.
 */
const COLLAPSE = (() => {
  const match = /\.([A-Za-z0-9_]+)_collapseControl(?![\w-])/.exec(css);
  if (match === null) throw new Error('class for local name "collapseControl" not found in the literal');
  return `.${match[1]}_collapseControl`;
})();

/** Escape a literal for use inside a RegExp source. */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does a selector apply to the control, given the attributes on it and on its ancestors?
 * The motion switch hangs off an ancestor (`[data-motion=off] .collapseControl…`), so
 * ignoring ancestors would let that branch win for every button and make the test lie.
 */
function matches(selector, attrs, ancestorAttrs) {
  const classAt = selector.indexOf(COLLAPSE);
  if (classAt === -1) return false;
  // Any ancestor-scoped part of the selector has to be satisfied by the ancestor's state.
  const ancestorPart = selector.slice(0, classAt);
  for (const m of ancestorPart.matchAll(/\[([a-z-]+)(?:=([^\]]+))?\]/g)) {
    if (!(m[1] in ancestorAttrs)) return false;
    if (m[2] !== undefined && ancestorAttrs[m[1]] !== m[2]) return false;
  }
  const suffix = selector.slice(classAt + COLLAPSE.length);
  const pattern = /\[([a-z-]+)(?:=([^\]]+))?\]/g;
  let consumed = 0;
  for (const m of suffix.matchAll(pattern)) {
    consumed += m[0].length;
    if (!(m[1] in attrs)) return false;
    if (m[2] !== undefined && attrs[m[1]] !== m[2]) return false;
  }
  return suffix.slice(consumed).trim() === '';
}

/** The effective declaration for one property in one state, from unconditional rules. */
function computed(property, attrs, ancestorAttrs = {}) {
  let value;
  for (const rule of unconditional) {
    if (!rule.selectors.some(selector => matches(selector, attrs, ancestorAttrs))) continue;
    if (property in rule.decls) value = rule.decls[property];
  }
  return value;
}

/** The effective value inside one @media condition, ignoring everything outside it. */
function computedWithin(condition, property, attrs, ancestorAttrs = {}) {
  let value;
  for (const rule of rules) {
    if (!rule.conditions.some(c => c.includes(condition))) continue;
    if (!rule.selectors.some(selector => matches(selector, attrs, ancestorAttrs))) continue;
    if (property in rule.decls) value = rule.decls[property];
  }
  return value;
}

/** The `.root` element carries data-motion; the shell decides its value. */
function rootMotion() {
  const at = text.indexOf('"data-dsh-better-display"');
  const behind = text.slice(at - 200, at + 200);
  return /"data-motion":\s*motion\s*\?\s*"on"\s*:\s*"off"/.test(behind)
    || /"data-motion":\s*"([a-z]+)"/.exec(behind)?.[1];
}

const failures = [];
function check(name, pass, detail) {
  if (!pass) failures.push(`${name} — ${detail}`);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const pad = (value) => String(value ?? '—').padEnd(34);

// The motion switch lives on an ancestor, so the states are evaluated with it ON; its own contract
// (both halves ended, not removed) is asserted separately below.
const ancestor = { 'data-motion': 'on' };

// --- the idle state: it has to end up hidden, but not before the animation is over
/**
 * The two collapse keyframes, resolved by their LOCAL names.
 *
 * lightningcss scopes `@keyframes` names in a CSS module just as it hashes class names, so a
 * rebuild emits `_qbxEq_readerCollapseOut` where the committed bundle has bare
 * `readerCollapseOut`. It also rewrites the shorthand: `readerCollapseOut 140ms ease-in both`
 * becomes `.14s ease-in both _qbxEq_readerCollapseOut`. Asserting the literal name and the
 * `ms` unit therefore tests one build's formatting rather than the animation contract, so
 * both are resolved here — the name by local suffix, the duration by unit.
 */
function keyframeOf(local) {
  const scoped = new RegExp(`([\\w-]+_${local})(?![\\w-])`).exec(css);
  return scoped === null ? local : scoped[1];
}
const INTRO_KEYFRAME = keyframeOf('readerCollapseIn');
const EXIT_KEYFRAME = keyframeOf('readerCollapseOut');

/** The first time value in an `animation` shorthand, in milliseconds. */
function durationMs(shorthand) {
  const match = /(\d*\.?\d+)(ms|s)\b/.exec(shorthand ?? '');
  if (match === null) return 0;
  return match[2] === 's' ? Number.parseFloat(match[1]) * 1000 : Number.parseFloat(match[1]);
}

const idle = { 'data-reader-collapse': 'idle', hidden: '' };
const idleAnim = computed('animation', idle, ancestor);
const idleVisibility = computed('visibility', idle, ancestor);
const idleTransition = computed('transition', idle, ancestor);

check('idle state declares the exit animation', (idleAnim ?? '').includes(EXIT_KEYFRAME), `animation ${idleAnim}`);
check('idle state does end up hidden', idleVisibility === 'hidden', `visibility ${idleVisibility}`);

const exitMs = durationMs(idleAnim);
// The delay is written in whichever unit the minifier chose (`.14s` or `140ms`), so parse the
// time value rather than its spelling.
const delayMs = (() => {
  const match = /visibility\s+0s(?:\s+linear)?\s+([\d.]+m?s)/.exec(idleTransition ?? '');
  return match === null ? -1 : durationMs(match[1]);
})();
check(
  'the visibility change waits for the animation',
  delayMs === exitMs && exitMs > 0,
  `delay ${delayMs}ms vs exit ${exitMs}ms`,
);
check(
  'nothing makes the idle transition immediate',
  !/transition[^;]*visibility\s+0s(\s+linear)?\s*(;|$)/.test(css.slice(css.indexOf(`${COLLAPSE}[data-reader-collapse=idle]`))),
  'no zero-delay visibility transition on the idle rule',
);

// The specific regression: a rule that hides the control for every state, including a
// visible one. `[hidden]` may force display, but must not carry visibility.
const hiddenRule = unconditional.find(rule => rule.selectors.some(s => matches(s, { hidden: '' }, ancestor)));
const hiddenVisibility = hiddenRule?.decls.visibility;
check(
  'the [hidden] rule does not hide every state',
  hiddenVisibility === undefined,
  `[hidden] visibility ${hiddenVisibility ?? '(unset)'}`,
);

// --- the visible state must be visible for the whole intro
const open = { 'data-reader-collapse': 'open' };
const openVisibility = computed('visibility', open, ancestor);
const openAnim = computed('animation', open, ancestor);
check('open state is visible', openVisibility === undefined || openVisibility === 'visible', `visibility ${openVisibility ?? '(visible by default)'}`);
check('open state declares the intro animation', (openAnim ?? '').includes(INTRO_KEYFRAME), `animation ${openAnim}`);

// The motion switch is an ancestor attribute; if its contract changed, this whole test
// would be evaluating the wrong branch, so assert it explicitly.
check(
  'motion is published on an ancestor as data-motion',
  rootMotion() !== undefined && rootMotion() !== false,
  `data-motion ${JSON.stringify(rootMotion())}`,
);
// The motion preference governs both halves, and it does so with a zero duration rather than
// `animation: none`: removing an animation and putting it back REPLAYS it, which is what made
// turning the setting on replay the entrance of a control that was already on screen.
const mutedOpenAnim = computed('animation', open, { 'data-motion': 'off' });
check(
  'motion off ends the intro instead of removing it',
  mutedOpenAnim !== undefined && mutedOpenAnim !== 'none' && durationMs(mutedOpenAnim) === 0,
  `animation ${mutedOpenAnim}`,
);
const mutedIdleAnim = computed('animation', idle, { 'data-motion': 'off' });
check(
  'motion off ends the exit too',
  mutedIdleAnim !== undefined && durationMs(mutedIdleAnim) === 0,
  `animation ${mutedIdleAnim}`,
);
// A zero-duration exit has nothing to wait for, so the delay that keeps the control painted until
// the animation finishes would only leave a ghost behind.
const mutedIdleTransition = computed('transition', idle, { 'data-motion': 'off' }) ?? '';
check(
  'and an instant exit waits for nothing',
  !mutedIdleTransition.includes('visibility'),
  `transition ${mutedIdleTransition}`,
);

// A reduced-motion user must still get a working exit. The media query is expected to
// suppress only the INTRO; the exit is what actually hides the control, so no media query
// may override it (an override would leave the control in the accessibility tree, hidden
// only by a transition that reduced motion may also drop).
const reducedIdleAnim = computedWithin('prefers-reduced-motion', 'animation', idle, ancestor);
check(
  'reduced motion does not override the exit animation',
  reducedIdleAnim === undefined,
  `animation inside the media query ${reducedIdleAnim ?? '(not overridden)'}`,
);
check(
  'the reduced-motion rule targets the intro only',
  new RegExp(`prefers-reduced-motion:\\s*reduce\\)\\s*\\{\\s*${escapeRegExp(COLLAPSE)}\\[data-reader-collapse=open\\]`).test(css),
  'media query target',
);

// --- both keyframe sets must exist, or the animations referenced above do nothing
check('intro keyframes exist', css.includes(`@keyframes ${INTRO_KEYFRAME}{`), INTRO_KEYFRAME);
check('exit keyframes exist', css.includes(`@keyframes ${EXIT_KEYFRAME}{`), EXIT_KEYFRAME);

console.log('\n--- resolved values');
console.log(`  idle  animation  ${pad(idleAnim)}`);
console.log(`  idle  visibility ${pad(idleVisibility)}`);
console.log(`  idle  transition ${pad(idleTransition)}`);
console.log(`  open  visibility ${pad(openVisibility ?? '(visible by default)')}`);

console.log(`\n${failures.length === 0 ? 'COLLAPSE FADE OK' : 'COLLAPSE FADE BROKEN'}`);
for (const failure of failures) console.log(`  - ${failure}`);
if (failures.length) process.exit(1);
