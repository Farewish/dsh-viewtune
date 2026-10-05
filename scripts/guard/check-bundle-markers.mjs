/**
 * Reports which bundle patch markers are present on disk and asserts the invariants the
 * reasoning card, the collapse control and the loader registration must keep.
 *
 * Markers that name CSS rules go through the anchor helpers, because lightningcss re-hashes
 * class and keyframe names and reorders declarations on every build: a marker written as one
 * verbatim rule string verifies a single build rather than the rule being present.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classSel, hasDecls, keyframeOf, moduleCssLiteral, pillBoundaryClass, ruleDecls } from './bundle-anchors.mjs';
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

/**
 * The body of one property, claimed by brace matching from `<needle>` to its closing brace.
 *
 * Needed wherever a claim is about WHERE a statement sits rather than whether it exists at all. The
 * bundle contains every one of these strings somewhere, so "the sidebar is looked up inside the
 * click" cannot be asked of the file as a whole: the previous, broken version had the same lookup
 * text sitting at activation instead. Returns '' when the needle is absent, which fails the marker
 * loudly rather than asserting against a slice of something else.
 */
function handlerBody(needle) {
  const at = bundle.indexOf(needle);
  if (at === -1) return '';
  const open = bundle.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < bundle.length; i++) {
    const ch = bundle[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return bundle.slice(open, i);
    }
  }
  return '';
}

// The Host derives the client row id from the installed manifest's package name,
// and the browser loader refuses a bundle that registers anything else — the
// failure mode is the whole page reporting "Failed to load plugins", so assert
// it here rather than discovering it in the browser.
const packageName = pluginPackageName();
const packageVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const registered = /__ModuleLoader__\.load\(\{\s*\n\s*id: "([^"]+)"/u.exec(bundle)?.[1];

const registration = [
  ['bundle registers the package name', registered === packageName],
  ['no stale upstream registration id', !bundle.includes('id: "dsh-better-display"')],
  /**
   * The version the reading view publishes on its own root, against the version in `package.json`.
   *
   * The attribute is what a marker-based check outside this repository can identify a build by, and it was a literal in
   * the JSX: correct on the day it was written, and silently one release behind from the first version bump onward. Read
   * from the manifest here, so bumping `package.json` without the attribute fails this guard instead of shipping.
   */
  ['the version published on the reader root is the package version',
    bundle.includes(`"data-dsh-better-display": "${String(packageVersion)}"`)],
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
/**
 * The body of one at-rule, by its prelude — braces counted, because the rules inside it are braced too.
 *
 * Needed wherever a marker has to say not only WHICH rule but WHERE it sits: the no-preference gate on the eased height
 * is the rule that makes the easing opt-in, so a marker that finds the declaration anywhere in the stylesheet would pass
 * with the media query removed.
 */
function atRuleBody(css, prelude) {
  const at = css.indexOf(`${prelude}{`);
  if (at === -1) return '';
  let depth = 0;
  for (let index = at; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(at, index + 1);
    }
  }
  return '';
}

const markers = [
  // The plate only exists with the glass OFF, and that exclusion is a bug fix: at (0,4,0) it used to beat the glass card rule
  // at (0,3,0), so a focused card in its preview state — not open, nothing to scroll — showed an opaque plate, leaving the
  // frost nothing to show through until the expansion started. Scoped to the root without the glass attribute, the two are
  // mutually exclusive instead of competing.
  ['short-thinking-frame', () => cssDecls(`${sel('root')}:not([data-reader-glass]) ${sel('reasonCard')}[data-overflow=false][data-expanded=false]:not([data-folded])`, ['background:var(--dsw-alias-bg-module-platform)', 'border-color:var(--dsw-alias-border-l2)', 'border-radius:12px'])],
  ['short-thinking-heading-padding', () => cssDecls(`${sel('root')}:not([data-reader-glass]) ${sel('reasonCard')}[data-overflow=false][data-expanded=false]:not([data-folded]) ${sel('reasonHeading')}`, ['padding:10px 16px 0'])],
  ['short-thinking-text-padding', () => cssDecls(`${sel('root')}:not([data-reader-glass]) ${sel('reasonCard')}[data-overflow=false][data-expanded=false]:not([data-folded]) ${sel('reasonText')}`, ['padding:8px 16px 16px'])],
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
  // The whitespace between two revealed words has to be a KEYED child in both reveal paths. As a bare string it was
  // matched by position, so each word folding into the settled prefix rebuilt the live window's strings — measured at
  // 8,492 new text nodes under the reasoning container in two seconds. Each marker carries the `inline` expression of
  // its own path, so a fix applied to one and forgotten in the other fails here.
  ['the whitespace after a revealed think word is a keyed child', 'inline: true,\n\t\t\t\t\t\tchildren: word.text\n\t\t\t\t\t}, word.key) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MotionGap, { children: word.text }, word.key)'],
  ['…and the whitespace in the answer body is one too', 'inline: inline || /^\\p{P}+$/u.test(word.text),\n\t\t\t\t\tchildren: word.text\n\t\t\t\t}, word.key) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MotionGap, { children: word.text }, word.key)'],
  ['that keyed child is a plain inline span, so line breaking is unchanged', 'function MotionGap({ children }) {\n\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children });\n\t\t}'],
  ['every user message rendered in the leading slot', 'turnUserKeys.map((userKey) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BlockBoundary, {'],
  ['user nodes excluded from the flow, through a memoized key list', 'const mainKeys = (0, react.useMemo)(() => group.keys.filter((key) => !turnUserKeys.includes(key)), [group, turnUserKeys]);'],
  ['disclosure label still shows the duration', '用时 ${elapsed}'],
  ['reader column keeps the chat-flow hook (composer stays visible)', '"data-chat-flow": ""'],
  ['system-prompt detail has its own scrollport', 'Reader_module_css_default.systemPrompt'],
  ['command input renders as a labelled bubble', 'node.kind === "command-input"'],
  ['steps pill is wrapped in an error boundary', () => pillBoundaryClass(bundle) !== undefined],
  // Collapse control. Its CSS lives inside the injected literal, so the check reads the
  // literal rather than the file: a rule outside it never reaches the page.
  // The MERGED control (see CollapseControl.tsx) keeps the pair's conditions and the pair's animation
  // contract: `open`/`idle` on `data-reader-collapse` is what the stylesheet animates, and WHICH action the
  // button stands for rides a second attribute. The caret exists only when both actions apply, so a reader
  // is never offered a menu with one item in it.
  ['the collapse control appears while either action applies, and animates as it did', () =>
    bundle.includes('"data-reader-collapse": on ? "open" : "idle"')
    && bundle.includes('"data-reader-collapse-action": primary')
    && bundle.includes('const on = showCurrent || showAll')
    && bundle.includes('const both = on && primary === "current" && showAll')],
  // Both optical shifts the reader tuned by eye are ONE NUMBER each in the stylesheet — the left half's
  // centring and the appendage's chevrons — so either can be nudged again without touching the arithmetic
  // around it. Both are whole pixels on purpose: a fractional translate leaves CJK glyphs on a half pixel.
  ['the collapse control\'s two optical shifts are single numbers', () =>
    bundle.includes('var(--reader-collapse-split-shift,3px)')
    && bundle.includes('var(--reader-collapse-more-shift,-1px)')],
  // …and the word 全部 is the LEFT HALF OF A RIGID PAIR with 收起, which is how the reader wanted it to move ("并排
  // 移动"): the slots already differ by exactly 全部's own width, so giving both the same transform keeps them
  // adjacent at every instant and makes the crossing structurally impossible. Its own timing is then only about
  // the fade, which is quick. (Four earlier attempts gave 全部 a timing of its own to dodge an overlap that only
  // existed because the two moved independently.) As emitted (`.16s`, and `.` prefixed class names).
  ['the word 全部 rides 收起\'s transform instead of crossing it', () =>
    bundle.includes('var(--reader-collapse-word-fade,.16s)')
    && bundle.includes('transition:opacity 80ms linear')
    // The RESTING transform: `translateX(-1em)`, which the minifier emits as `translate(-1em)`. It is the SAME value
    // for 全部 and 收起, which is the whole point of the marker — otherwise 全部 would slide relative to 收起 while it
    // fades in. Back to the plain em after the reader watched both nudges (and both were artefacts of the button's
    // width being 2px larger for one round).
    && /_collapseAllWord\{[^}]*transform:translate\(-1em\)/.test(bundle)
    && /_collapseKeeping\{[^}]*transform:translate\(-1em\)/.test(bundle)],
  // Ending the split, the right half goes FIRST and upward — the reader asked for it (「叠˄先向上淡出一半再后续
  // 动画」). The stack's exit is therefore an ANIMATION, not the entry reversed: a transition can only retrace its
  // own path, and the entry comes from below. Changing the animation-name is what starts it (the pill's own exit
  // uses the same contract) and the split state turns it off again. The appendage, its divider and the label's
  // arrival are then tied to one number, `--reader-collapse-more-exit`: the first two leave in it, the label waits
  // it. Patterns, not spellings, because the minifier reorders declarations and hashes the keyframe name.
  ['the right half leaves first, upward, when the split ends', () =>
    /_readerChevronsOut var\(--reader-collapse-more-exit/.test(bundle)
    && /split=true\]\s*\.\w+_collapseChevrons\{[^}]*animation:none/.test(bundle)
    && /transition-delay:0s,\s*var\(--reader-collapse-more-exit/.test(bundle)],
  // The composer is the host's, so its wheel guard ships as an injected stylesheet rather than as one of our module
  // classes. It has to cover EVERY name the host's composer is built from, because `overscroll-behavior` is a no-op
  // on anything that is not a scroll container — and in particular the editor's name has a CAPITAL C
  // (`_ComposerContentEditable`), which is why the first attempt, written with the lowercase substring the rest of
  // the plugin uses, matched nothing and did nothing. Without the guard a notch over the input chains into the
  // transcript, which is the reported bug.
  // The composer is the host's, and the element that scrolls it carries a hash-only class name (`.uV2eYG_scroll`,
  // measured out of the host's own stylesheet), so there is nothing stable to write a CSS selector against — the
  // declarative `overscroll-behavior` attempt was shipped, did nothing, and was removed again. The guard is a
  // capture-phase wheel listener on WINDOW instead: the outermost capture there is, non-passive so it can cancel the
  // browser's own scroll, with `stopPropagation` for a host handler that scrolls in script, and gated on the geometry
  // test so a field that still has somewhere to go keeps scrolling normally.
  ['the composer wheel is judged in script, because no selector can name its scroller', () =>
    !bundle.includes('overscroll-behavior: contain')
    && bundle.includes('"wheel", onWheel')
    && /capture: true,\s*passive: false/.test(bundle)
    && bundle.includes('stopPropagation();')
    && bundle.includes('canTakeNotch(')],
  // …and the column handles FORWARD the wheel instead of guarding it: they sit beside the reading scroller, not inside
  // it, so a notch over them had no scroll container to reach and the gesture died (「卡手」). The handle is identified
  // by its own resize cursor rather than by its hashed class name, and the two refusals — a resize cursor elsewhere,
  // an ordinary cursor here — are what keep the forwarding to the strip the reader actually pointed at.
  // …and the step is integrated from the glide's OWN position, never read back from `scroller.scrollTop`: that read is
  // rounded to whole pixels, so a glide moving a fraction of a pixel per frame loses its progress every frame — a 1px
  // jitter invisible while scrolling fast and exactly the stutter the reader reported for one slow notch (softening
  // the curve could not help, because the curve was never the problem). Position is seeded from the element only when
  // no glide is running, and keeping the state also lets the velocity accumulate across notches.
  ['the glide integrates its own position instead of reading it back', () =>
    // The step is taken from OUR state by whichever law the frame calls for, so the claim is about what is passed TO
    // it as much as about the call existing: both laws take `state`, and no step is ever built out of a fresh read of
    // the element's rounded `scrollTop` (which is what the earlier `springStep({ at: scroller.scrollTop … })` did, and
    // why this marker is no longer satisfied by a single `state = springStep(`).
    bundle.includes('cruiseStep(state, target, dt, stream)')
    && bundle.includes('springStep(state, target, dt, stiffness)')
    && !bundle.includes('springStep({ at: scroller.scrollTop')
    && !bundle.includes('cruiseStep({ at: scroller.scrollTop')],
  // …and that seed has to run BEFORE the target is moved, which is a claim about ORDER and so cannot be made by
  // asking whether the text exists: the first version of this seeding sat after the assignment, `target === null`
  // was therefore never true, the seed never ran, and the first frame integrated from the state's initial zero —
  // the scroller jumped to the very top and glided back down (reported as 「先瞬间到最顶上，再回来，上下抽动」).
  // Each lookup is checked for absence explicitly: a missing needle would otherwise compare as `-1 < n` and pass
  // exactly when the code is gone, which is the "check that cannot fail" this guard exists to refuse.
  ['the glide is seeded from the element before the target moves, or it jumps to the top', () => {
    const seed = /if \(target === null\) state = \{\s*at: scroller\.scrollTop/.exec(bundle);
    const move = /target = \(target \?\? scroller\.scrollTop\) \+ pixels/.exec(bundle);
    return seed !== null && move !== null && seed.index < move.index;
  }],
  // The forwarding is a SPRING, not one CSSOM call, for reasons that were each measured: a wheel's delta is in pixels,
  // LINES or PAGES while every scroll call means pixels; `behavior: 'smooth'` restarts its easing per notch instead of
  // accumulating; and an exponential approach starts at its top speed, which reads as a shove at every notch. So the
  // notch is added to a target and a critically damped spring carries the scroller toward it, integrated by frame time
  // so the feel does not follow the display's refresh rate. Its STIFFNESS follows the gesture — back-to-back notches
  // get the snappy spring, a lone one the soft one — because one spring cannot serve both speeds, which is exactly the
  // split the reader reported (fast right and slow jerky at one stiffness, the reverse at another). Damping is derived
  // from whichever stiffness is in force, so neither end can bounce. The gesture is also announced to the scroller, so
  // the reading view's auto-follow lets go of it, and the reader's own motion switch skips the glide entirely.
  // …and WHOSE NOTCH IT IS, which changed with the platform. DSH 0.2.0's conversation panel forwards a wheel over the
  // strips itself, with an instant `scrollport.scrollBy`, and its listener is a React one on that very element — so a
  // notch the plugin takes has to be kept from it (`stopPropagation`), or both writers move the scroller on every
  // notch. The reader's switch therefore chooses between our glide and the App's own jump, not between scrolling and
  // silence, and the OFF branch must not consume the notch at all. The strip is identified by the attribute its owner
  // publishes (`data-width-handle`, which 0.1.5 publishes too) rather than by the `col-resize` cursor, because the
  // frame's two handles and the trajectory panel's details handle show that same cursor and are not ours.
  ['the width strips hand the wheel to the transcript, and keep it', () =>
    bundle.includes('handleTakesWheel(')
    // Unquoted on purpose: the constant's own quotes are the bundler's business, and what has to survive is the
    // attribute the rule is keyed on.
    && bundle.includes('data-width-handle')
    && bundle.includes('stopPropagation(')
    && bundle.includes('wheelPixels(')
    && bundle.includes('springStep(')
    && bundle.includes('stiffnessForGap(')
    && bundle.includes('Math.sqrt(stiffness)')
    && bundle.includes('requestAnimationFrame(')
    && bundle.includes('dispatchEvent(new WheelEvent("wheel"')
    && bundle.includes('data-motion')
    && bundle.includes('"wheel", onWheel')],
  // …and a SLOW RUN is carried at the wheel's own rate instead of being chased by the spring, which is the reader's
  // 「均匀滚动」 report: a critically damped spring arrives at rest, so at a 0.3s interval it was finished in 0.24s and
  // every notch became accelerate-then-wait — measured at 0 → 15px per frame on a simulated 300ms roll, against 5 → 6px
  // once the ramp carries it. Four claims, because each is separately load-bearing: the rate is measured from the
  // notch's pixels over its own gap, the speed is taken up with a time constant rather than at once (a step in speed
  // is the shove that removed the earlier exponential glide), the ramp refuses to pass the target (the accumulated
  // notches ARE the distance), and it only takes over from a live, slow stream — a first notch, a fast run and every
  // landing stay on the spring the reader tuned by eye. The gate is asserted through the predicate it lives in rather
  // than by a loosened copy of its arithmetic.
  ['a slow run is carried at the wheel\'s own rate, not chased by the spring', () =>
    bundle.includes('streamSpeed(')
    && bundle.includes('streamHoldSeconds(')
    && bundle.includes('cruiseStep(')
    && bundle.includes('streamCarries(')
    && bundle.includes('Math.exp(-dt / CRUISE_LAG_SECONDS)')
    && bundle.includes('SLOW_STREAM_GAP_SECONDS')
    && bundle.includes('BRAKE_LOOKAHEAD_SECONDS')
    // The notch has to MEASURE the interval it arrived after, and the gap it gets is the one that preceded it — a rate
    // taken from the time since the notch itself would always be zero.
    && /const gap = now - lastNotch;/.test(bundle)
    // …and a pause longer than that gap's own hold is a new gesture, which is what stops a stale rate from surviving it.
    && bundle.includes('gap > streamHoldSeconds(gap)')
    // …and TWO intervals are what make a stream: the second notch of a gesture is still the spring's, which is the
    // reader's 「两次滚动间有明显间隔还会变成匀速」 — carrying it at the pace of the pause that happened to precede it
    // turned a deliberate second turn of the wheel into a drift (measured: 26 frames to arrive against a lone notch's
    // 14). Asserted as the arming itself — no pace below two intervals — plus the broken-run reset it depends on, since
    // a pause that left the window behind would arm the notch after it anyway.
    //
    // …and the pace is the current notch over the AVERAGE OF THE INTERVALS, which is the tolerance a hand needs
    // (「人滑动滚轮不可能完全匀速，所以要加一点容错」): averaging their RATES instead pulls the mean toward the short ones
    // and carries the run faster than the hand is going, which drains the backlog until the motion stops. Measured on a
    // 167ms/167ms/183ms roll — inside the hold ceiling, since past it the notches are two turns of the wheel by design —
    // 2.0 → 7.0px per frame before, 8.0 → 12.0 after, where the hand's own pace is 9.7.
    && bundle.includes('streamSpeed(pace, pixels)')
    && bundle.includes('STREAM_WINDOW')
    && bundle.includes('if (gaps.length < 2) return 0;')
    && bundle.includes('pace.length = 0;')
    && bundle.includes('pace.push(gap)')],
  // The settings panel's TABS are pinned above its scroller: the panel hides its overflow, the page body below the tabs
  // is the scroll container, and the tabs refuse to shrink. Either half alone leaves the tabs inside the scroller —
  // which is what the reader saw, with the page's scrollbar running up past them. Asserted as the relation between the
  // three rules, on the minified literal, because that is what the artifact contains.
  ['the settings panel pins its tabs above its own scroller', () =>
    /_settingsPanel\{[^}]*overflow:hidden/.test(bundle)
    && /_settingsBody\{[^}]*overflow-y:auto/.test(bundle)
    && /_settingsTabs\{[^}]*flex:none/.test(bundle)],
  // The host's input box joins the skin. Three measured facts, each of which the rule would silently stop working
  // without: the plate is a THEME TOKEN (so the override is a token redefinition), the override is inherited from the
  // composer's seat (so no other user of that token changes), and the seat's own opaque lift band is withdrawn (a
  // translucent plate over an opaque band shows the band, not the wallpaper). It follows the skin's master gate
  // rather than the conversation page's, because the composer is on screen in both views.
  ['the input box takes the skin, without leaking the token override', () =>
    bundle.includes('--viewtune-input-plate: var(--dsw-specific-input-major)')
    && bundle.includes('--dsw-specific-input-major: color-mix(in srgb,')
    // Its two round buttons share one class and one token between them, and ride the input's dial so the card and the
    // buttons are one surface (asked for by name: 「添加附件」 and 「指令」).
    && bundle.includes('--viewtune-selector-plate: var(--dsw-specific-selector);')
    && bundle.includes('--dsw-specific-selector: color-mix(in srgb, var(--viewtune-selector-plate) var(--glass-input, 25%), transparent);')
    && bundle.includes('data-viewtune-glass')
    && bundle.includes('composerGlassCss')
    // The plate rule is gated on the skin alone; the LIFT BAND is withdrawn only under a SECOND attribute (the
    // wallpaper's), because that is where our own band replaces it. Without that gate, the skin with no wallpaper
    // dropped the host's band and left no fade at all — the one combination this used to break. Asserted as the
    // two-attribute shape rather than by the alias's spelling, which the bundler is free to change.
    && bundle.includes('[${GLASS_ATTRIBUTE}] ${COMPOSER}')
    && bundle.includes('[${GLASS_ATTRIBUTE}][${WINDOW_SCOPE_ATTRIBUTE}]')
    // …and the NO-WALLPAPER branch: with no wallpaper to reveal, the host's band is dropped too and a lifted
    // stand-in is painted in the theme's base colour, because the host's ramp runs inside the seat's own box and left
    // the transcript drawn right up against the input (reported). Spelled `WINDOW_SCOPE_ATTRIBUTE` because that is
    // what the artifact says: the source aliases the import, and the bundler inlines the original name.
    && bundle.includes('html[${GLASS_ATTRIBUTE}]:not([${WINDOW_SCOPE_ATTRIBUTE}]) ${COMPOSER}::before')
    && bundle.includes('background-color: var(--dsw-alias-bg-base);')
    // …but the trajectory page gets its OWN colour in that branch: its band paints `bg-layer-1`, the surface that page
    // is made of, and a stand-in in the base colour would put a bar of another shade at the bottom of it.
    && bundle.includes('[data-trajectory-scroll]) ${COMPOSER}::before')
    && bundle.includes('background-color: var(--dsw-alias-bg-layer-1);')],
  // The dial name has to be visible in the artifact for the cross-check above ("every adjustable surface reads its own
  // dial") to be able to see it: that check collects `var(--glass-*)` out of the bundle and compares the set against
  // the settings rows. Interpolating the name here — as the first version of this file did — hides it from that check
  // and makes the surface invisible to the guard, which is how it was caught.
  ['the input box spells its dial out, so the cross-check can see it', () =>
    bundle.includes('var(--glass-input, 25%)')],
  // …and the way back in is that SEQUENCE reversed: the label goes first (240ms), then the right half rises into
  // place from BELOW over the same 120ms the exit used. Timing is mirrored, space is not — the exit goes up, the
  // entry comes up. The exit animation carries no fill-forward so the property falls back to the resting `+.35em`
  // below while the element is invisible, which is what lets the next entry start from underneath.
  ['the right half arrives last, from below, when the split begins', () =>
    /split=true\]\s*\.\w+_collapseChevrons\{[^}]*transform:translate\([^)]*\), 0\)/.test(bundle)
    && /split=true\]\s*\.\w+_collapseChevrons\{[^}]*transition:opacity var\(--reader-collapse-more-exit[^}]*var\(--reader-collapse-anim/.test(bundle)
    && /split=true\]\s*\.\w+_collapseMore:before\{[^}]*var\(--reader-collapse-anim/.test(bundle)
    // The resting transform is BELOW, and the exit animation's own end is ABOVE: the two paths, stated separately.
    // `0%` rather than `from`, because that is what the minifier leaves in the keyframes.
    && /_collapseChevrons\{[^}]*transform:translate\([^)]*\), \.35em\)/.test(bundle)
    && /_readerChevronsOut\{0%\{[^}]*\}[^}]*to\{[^}]*-\.5em/.test(bundle)
    && !/animation:[^;}]*readerChevronsOut[^;}]*\bboth\b/.test(bundle)],
  ['collapse control folds the turn in view', 'for (const key of openTurnKeys) props.actions.setExpanded(key, false);'],
  ['collapse control is scoped to one turn', 'if (group.turn === null || group.turn !== currentTurn) continue;'],
  ['collapse exit is delayed past its animation', () => cssDecls(`${sel('collapseControl')}[hidden]`, ['display:inline-flex'])],
  ['collapse exit waits for the animation to finish', () => /transition:[^;}]*visibility\s+0s[^;}]*[\d.]+m?s/.test(readerCss)],
  // Every animation whose settle commits state also arms a wall-clock deadline, because one that
  // never reaches `onfinish` strands the pose it was holding — a disclosure pinned to its opening
  // keyframe by `fill: 'both'`, or a closing diff panel left mounted forever. Three of those sites
  // pin a pose with `fill: 'both'` (the disclosures); the diff panel's reveal has no fill but commits
  // state the same way, which is why the counts differ by design. Both numbers are pinned so that a
  // new animated surface is a conscious edit to this line rather than a silent omission — and the
  // equality is what fails when a deadline is dropped from an existing one.
  ['every state-committing animation arms a wall-clock deadline', () => {
    const filled = (bundle.match(/fill: "both"/g) ?? []).length;
    const settles = (bundle.match(/let settled = false;/g) ?? []).length;
    const deadlines = (bundle.match(/clearTimeout\(deadline\)/g) ?? []).length;
    // FOUR filled sites and FIVE settles now: the reasoning card's RELEASE animation joined them, so a focused card that
    // loses the focus slides back to its preview height instead of giving up that room in one frame — the frame the reader
    // saw as the page jumping upward by a fixed distance once the pin ended. It arms the same `300 + 240` deadline and
    // settles through the same `settled` guard, but it does NOT clear a `deadline` variable: it sits in a branch of a layout
    // effect whose other path returns no cleanup, and returning a cleanup from one path only is a React warning, while the
    // early `settled` guard already makes a late fire a no-op. Hence `settles === deadlines + 1`, pinned so the next animated
    // surface has to make that decision consciously too.
    return filled === 4 && settles === deadlines + 1 && deadlines === 4;
  }],
  // The toolbar pins UNDER THE TOP BAR and spans the view: it cancels the reading column's centring
  // offset plus the view's inline padding and adds the same amount back as its own padding, so it reads
  // as one band with the shell's header rule while 收起 and the gear stay exactly where the text
  // starts. "Fixed under the top bar" is chrome; a lane that scrolls away is not what was asked.
  // A folded card's clipping window is EXACTLY one line tall, so any offset that is not a multiple of the line height leaves a
  // half-drawn line in it — 「让每次移动都是一行的宽度，这样才能保障每一行都完全显示，而不是被截断」. The height is read from the
  // text (`line-height` is the stylesheet's to change), with the passive listener snapping after the fact because React attaches
  // wheel handlers passively at the root, so `preventDefault` there would do nothing.
  ['the folded line only ever sits on a whole line, so nothing is left half shown', () =>
    hasDecls(readerCss, `${sel('reasonCard')}[data-folded] ${sel('reasonViewport')}`, ['height:24px'])
    && bundle.includes('const snapped = Math.round(port.scrollTop / line) * line;')
    // …and the card at REST, in every state, snaps the same way: after 140ms of quiet, so the follower's glide stays smooth
    // and the resting position still shows complete lines at both edges.
    && bundle.includes('window.setTimeout(settle, 140)')],
  // The bar is a full-width sticky lane, so it used to swallow every click and wheel event on the strip of transcript it covers,
  // and text under it could not be selected. `pointer-events: none` on the bar with `auto` on the interactive ELEMENTS is the
  // whole of it — the plate, the border and the frosted background keep painting, only the controls take input. Scoped to the
  // elements rather than the two groups, because a group's own empty space is as inert as the bar's.
  ['the toolbar lets a click through, and only its controls take one', () =>
    hasDecls(readerCss, sel('toolbar'), ['pointer-events:none'])
    && readerCss.includes(`${sel('toolbar')} :is(button,a,select`)],
  ['the toolbar pins under the top bar', () =>
    hasDecls(readerCss, sel('toolbar'), ['position:sticky', 'top:0'])],
  ['the toolbar spans the view, pins both its controls and sits flush when pinned', () => {
    const decls = [...ruleDecls(readerCss, sel('toolbar'))];
    const margin = decls.find(decl => decl.startsWith('margin-inline:')) ?? '';
    // Both halves of the relation are pinned, not just the variable: the escape IS the centring offset
    // (`50%` is half the reading column, `50cqw` half the view's content box), so dropping either term
    // would leave a lane that no longer reaches the edges. The first cut of this marker only asked for
    // the variable and passed with the offset terms replaced by zero — a check that could not fail.
    const terms = ['var(--reader-inline-pad)', '50cqw', '50%'];
    // Flush at scroll-top too: a sticky lane rests at its natural position until the scroll passes its
    // offset, so the view's top padding has to be cancelled or it shows as a gap until then.
    const top = decls.find(decl => decl.startsWith('margin-top:')) ?? '';
    // The outward shift is part of the shape, not a detail: without it the LEFT end sits at the reading
    // column's edge again, which is what the reader asked to change. It lives on that side's padding
    // (there is no `padding-inline` any more — that is the point of the shift). The RIGHT end is a
    // different shape now and deliberately so: the viewtune button is pinned to the LANE's end less the
    // gap, which the reader asked for after the outward shift had been pushed as far as it went.
    const left = decls.find(decl => decl.startsWith('padding-left:')) ?? '';
    const right = decls.find(decl => decl.startsWith('padding-right:')) ?? '';
    return terms.every(term => margin.includes(term)) && terms.every(term => left.includes(term))
      && top.includes('var(--reader-top-pad)')
      && left.includes('var(--reader-toolbar-shift-left)')
      && right.includes('var(--reader-toolbar-gap-right')
      // And the lane's OWN right end: the margin comes in by this much, so the strip and its divider stop
      // short of the window edge without moving the button inside it.
      && (decls.find(decl => decl.startsWith('margin-right:')) ?? '').includes('var(--reader-toolbar-end-right)');
  }],
  // The settings panel hangs inside the TOOLBAR's stacking context, so its own z-index can only order it
  // within that context: whether it covers the turn rail is decided by the toolbar's z-index against the
  // rail's slot (10). At 9 the whole lane — panel included — painted under the rail, which is what the
  // reader reported. Pinned as a RELATION between the two numbers, so neither can be retuned alone.
  ['the toolbar outranks the turn rail, so its panel is not covered', () => {
    const zIndexOf = (css, selector) => {
      const at = css.indexOf(selector + '{');
      if (at === -1) return Number.NaN;
      const match = /z-index:(\d+)/.exec(css.slice(at, css.indexOf('}', at)));
      return match === null ? Number.NaN : Number(match[1]);
    };
    const railCss = moduleCssLiteral(bundle, 'TimelineRail.module.css');
    const toolbar = zIndexOf(readerCss, classSel(readerCss, 'toolbar'));
    const rail = zIndexOf(railCss, classSel(railCss, 'slot'));
    return Number.isFinite(toolbar) && Number.isFinite(rail) && toolbar > rail;
  }],
  // The reading view's preferences live behind one toolbar button: the lane keeps its geometry and
  // a preference becomes a row in this panel instead of another control in the lane.
  ['settings panel holds the preferences', '"data-ud-check": "reader-settings"'],
  // The panel's COPY is written for a reader, not for this repository. The reader asked for exactly this: as a user of
  // the plugin they do not need to know how an option is implemented or why it is implemented that way, and the rows
  // that said the most were the ones carrying a paragraph of rationale — the collapse mode's, which argued for merging
  // two buttons, was the worst of them. Read from the SOURCE rather than from the bundle, because the strings live in
  // three modules and exporting them to be inspected would be the copy defining an API; this script runs in the
  // checkout, where the sources are.
  //
  // The vocabulary is what a reader has — which surface a dial moves — and never the machinery: custom properties,
  // token plumbing, selectors, or this repository's own word for a dial. A length cap catches the paragraph that a
  // well-meaning explanation turns into even when it avoids every forbidden word.
  ['the settings copy describes what an option does, not how it works', () => {
    const files = ['SettingsMenu.tsx', 'WallpaperSection.tsx', 'glass.ts'];
    const forbidden = /--[a-z-]|color-mix|backdrop-filter|token|伪元素|选择器|样式表|属性|旋钮|闸|宿主|默认关闭|默认不设/g;
    const hints = [];
    for (const file of files) {
      const source = readFileSync(join(ROOT, 'src', 'client', file), 'utf8');
      for (const match of source.matchAll(/const [A-Z_]+_HINT = '([^'\n]*)'/g)) hints.push([file, match[1]]);
      for (const match of source.matchAll(/^\s*hint: '([^'\n]*)'/gm)) hints.push([file, match[1]]);
    }
    // A check that found nothing would pass forever: these three files hold more than a dozen boxes between them.
    if (hints.length < 8) return false;
    // Every offender is printed rather than the first, so one pass of the guard is one pass of the copy edit.
    const offenders = hints.filter(([, hint]) => forbidden.test(hint) || hint.length > 28);
    for (const [file, hint] of offenders) console.log(`     ${file}: ${String(hint.length)} chars — ${hint}`);
    return offenders.length === 0;
  }],
  // The panel's subjects are pages: a tablist rather than a longer scroll of rows. Three of them now, and the ORDER
  // is the claim — a reader looking for what this plugin DOES rather than what it looks like expects the page between
  // the two that were there before, not appended after the keys. Pinned as the array itself rather than as three
  // separate strings, so an insertion in the wrong place cannot pass by being present.
  ['and offers its pages as tabs', '"data-ud-check": "reader-settings-tabs"'],
  ['the features page sits between the visual and the shortcut pages', () =>
    /\[\s*"visual",\s*"视效"\s*\],\s*\[\s*"features",\s*"功能"\s*\],\s*\[\s*"shortcuts",\s*"快捷键"\s*\]/.test(bundle)],
  // …and the bar under them is one page wide. It was written for two, as half the row; adding a page without touching
  // it would have left a bar that never reaches the third tab, so the declaration is pinned where it is emitted —
  // lightningcss folds the arithmetic, hence the two decimals.
  ['the page bar is a third wide, with a stop per page', () =>
    bundle.includes('width:calc(33.3333% - 1.33333px)')
    && bundle.includes('[data-settings-page=features]:after')
    && bundle.includes('[data-settings-page=shortcuts]:after')],
  // The 功能 page's THREE rows now: the handles' wheel, which is one piece of BEHAVIOUR this plugin adds on top of
  // the host, the delivered file's destination, moved here from the visual page because it is not a matter of taste
  // about pixels either, and the reveal's cadence — the one row that trades a little smoothness for work.
  ['the features page holds the strip wheel, the deliverable destination, the cadence, the blur, the per-word reveal, the follow mode, the auto-collapse and the reasoning card’s own mode and pace', () =>
    bundle.includes('"data-ud-check": "reader-settings-strip-wheel"')
    && bundle.includes('"data-ud-check": "reader-settings-openmode"')
    && bundle.includes('"data-ud-check": "reader-settings-cadence"')
    && bundle.includes('"data-ud-check": "reader-settings-reveal-blur"')
    && bundle.includes('"data-ud-check": "reader-settings-reveal-words"')
    && bundle.includes('"data-ud-check": "reader-settings-follow-mode"')
    && bundle.includes('"data-ud-check": "reader-settings-auto-collapse"')
    && bundle.includes('"data-ud-check": "reader-settings-reasoning-follow"')
    && bundle.includes('"data-ud-check": "reader-settings-reasoning-rate"')
    && bundle.includes('"data-ud-check": "reader-settings-focus-expand"')],
  // The reasoning card's own movement, pinned at each end that could silently change the DEFAULT behaviour: the three
  // modes, the pace realised as a whole-line step on the fixed cadence, the standard pace coming out as exactly the
  // two lines this card has always taken, 手动滚动 never moving on its own, 跟随最新 aiming at the newest line, both
  // values read defensively, and a change to either reaching the follower that is already running.
  // The 功能 page is grouped by what a setting AFFECTS, and the two settings that only mean something under another one
  // are gated by it. Pinned as a shape rather than as a row count: the three captions in this order (a heading is a
  // divider plus a caption, and the order is the claim), the two sub-rows carrying the gate they belong to, and the
  // hairline that makes the grouping visible at all.
  ['the features page is grouped by subject, in this order', () => {
    let at = -1;
    for (const caption of ['小功能', '正文显示', '流程展示设置']) {
      const next = bundle.indexOf(`caption: "${caption}"`, at + 1);
      if (next <= at) return false;
      at = next;
    }
    return true;
  }],
  ['…and a setting that only applies under another one is gated by it', () =>
    bundle.includes('"data-inactive": !revealWords') && bundle.includes('"data-inactive": reasoningFollow !== "auto"')],
  ['…with the hairline that makes the grouping visible', () =>
    cssDecls(sel('settingsGroup'), ['border-top:.5px solid var(--dsw-alias-border-l2)'])],
  // The 视效 page is divided the same way but WITHOUT captions: 磨砂玻璃 and 壁纸 each open with the switch that names them,
  // so the two hairlines are the whole of it — and there are exactly two, before the skin and before the wallpaper.
  ['the visual page is divided by the same hairline, without captions', () =>
    (bundle.match(/react_jsx_runtime\.jsx\)\(Group, \{\}\)/g) ?? []).length === 2],
  ['the reasoning card’s follow mode offers three, and only the two exact strings leave the reading pace', 'const REASONING_FOLLOW_MODES = [\n\t\t\t{\n\t\t\t\tid: "auto",\n\t\t\t\tlabel: "自动滚动"\n\t\t\t},\n\t\t\t{\n\t\t\t\tid: "latest",\n\t\t\t\tlabel: "跟随最新"\n\t\t\t},\n\t\t\t{\n\t\t\t\tid: "manual",\n\t\t\t\tlabel: "手动滚动"\n\t\t\t}\n\t\t];'],
  // 「焦点思考展开」, pinned at each end: the height is quantised to whole lines in script, the CEILING stays in the
  // stylesheet (where the viewport is known) and is excluded while the reader has asked for 展开阅读 themselves, the card
  // publishes only the content-side number, the focus is requested by the card and granted by the reader (newest
  // request wins, which is what makes it singular), and — rule 1 — the page stops following the tail while a card
  // holds it, so two auto-scrollers never pull at once. The motion switch and reduced motion both drop the transition.
  ['a focused card grows in whole lines', 'const lines = Math.max(1, Math.ceil(content / line));'],
  ['…asking for a whole-line height, and taking the growth the CARD applied out of the space ABOVE it', () =>
    bundle.includes('port.style.height = `${String(wanted)}px`')
    // The measured thing is the CARD, not the viewport whose height is written: the reading row under the viewport is
    // part of the card, appears the moment the card overflows, and pushing that down uncompensated left the card's own
    // bottom below the visible area (the page's tail-follow is suspended while a card holds the focus).
    && bundle.includes('const rendered = card?.getBoundingClientRect().height ?? 0;')
    && bundle.includes('const grew = rendered - focusRendered.current;')
    && bundle.includes('if (!focusedRef.current || grew <= 0) return;')
    // …and ONLY while the reader is still at the page's tail. The focus is deliberately kept when they scroll up (the
    // card must not shrink under them), so without this gate the compensation keeps writing on every line of reasoning
    // while they read somewhere else — reported as 「只有在卡片变高的时候」 the page being pulled back under an otherwise
    // fine upward scroll. The state cannot be worked out inside the card: its own `following` tracks ITS inner
    // scroller, which a wheel over the transcript never reaches, so it arrives as the `pageAtTail` prop and is read
    // through a ref (the compensation runs from closures the prop cannot re-create).
    && bundle.includes('if (!pageAtTailRef.current) return;')
    && bundle.includes('pageAtTailRef.current = pageAtTail;')
    && bundle.includes('scroller.scrollTop += grew')],
  ['…recording it on every measure, so growth from a LATER commit is taken too', () =>
    // The reading row is React state set from `measure`, so it lands one commit after the height write; and the focus
    // grant changes the ceiling in an earlier commit. Both are caught by the call that sits right before the overflow
    // read. Pinned as CODE, not as the comment beside it: the build drops comments in this region.
    bundle.includes('compensateHeight();\n\t\t\t\t\tconst overflowing = text.offsetHeight')],
  ['…and the focus that frame loop reads is written in a LAYOUT effect, with the pre-grant height recorded before the request', () =>
    bundle.includes('(0, react.useLayoutEffect)(() => {\n\t\t\t\tfocusedRef.current = focused;')
    && bundle.includes('focusRendered.current = viewport.current?.closest("[data-reader-reasoning-card]")?.offsetHeight ?? 0;')],
  ['…under a ceiling that stays in the stylesheet, with the growth eased only when the reader asked for 滑行', () =>
    // The ceiling is CSS, and the focused rule still turns transitions off by default: the easing is a SEPARATE rule
    // with three gates on it, because the reader's 逐帧滑行 is what asks for it, 动效关 must still stop it, and so must the
    // system's reduced-motion request. Both are spelled in the selector (`:not([data-motion=off])`) or in the media
    // query's `no-preference` because this rule is MORE specific than the gates further down, which would otherwise lose.
    //
    // Every class name here comes from `sel()`, which reads the hash out of the artifact's own stylesheet. The verbatim
    // `.WGoHxG_…` spellings these replaced passed only while the checkout lived at one path: lightningcss derives that
    // hash from the CSS file's ABSOLUTE path, so a clone in another directory that ran the documented `npm run build`
    // would have failed four markers for a reason that has nothing to do with the decision they guard.
    cssDecls(`${sel('reasonCard')}[data-focus=true]:not([data-expanded=true]) ${sel('reasonViewport')}`, ['max-height:min(60vh,560px)', 'transition:none'])
    && hasDecls(
      atRuleBody(readerCss, '@media (prefers-reduced-motion:no-preference)'),
      `[data-reader-follow-mode=glide]:not([data-motion=off]) ${sel('reasonCard')}[data-focus=true]:not([data-expanded=true]) ${sel('reasonViewport')}`,
      ['transition:height .16s var(--reason-ease,ease-out)'],
    )
    && cssDecls(`${sel('reasonCard')}:not([data-focus=true]) ${sel('reasonViewport')}`, ['transition:max-height .3s var(--reason-ease,ease-out)'])],
  ['…and the compensation chases that easing frame by frame, ending on the target, on a still layout, or on a deadline', () =>
    // A transitioned height has not moved yet at the moment of the write, so a single read would see no growth at all;
    // charging the whole request instead would lead the box and wobble its bottom edge. The chase ends on the target
    // (with no transition in flight the first read IS the target, which is why 贴底 and 动效关 are untouched), on a layout
    // that has stopped moving (a target the stylesheet's ceiling clamps NEVER arrives, and waiting out the 400ms deadline
    // there is 400ms of per-frame layout reads for a box that stopped on the first frame), or on that deadline.
    bundle.includes('"data-reader-follow-mode": followMode,')
    && bundle.includes('heightChase = 0;\n\t\t\t\t\tcompensateHeight();\n\t\t\t\t\tif (port.offsetHeight === target) return;')
    && bundle.includes('if (++still >= CHASE_STILL_FRAMES) return;')
    && bundle.includes('if (performance.now() > deadline) return;\n\t\t\t\t\t\theightChase = requestAnimationFrame(step);')],
  ['…with the motion switch dropping those transitions', () =>
    // Hash-agnostic like the rule above: the selector is built from the artifact's own class names, and the
    // reduced-motion half matches on the LOCAL name (`[^}]*reasonCard`), which no build rewrites.
    readerCss.includes(`[data-motion=off] ${sel('reasonCard')}[data-focus=true] ${sel('reasonViewport')},`)
    && /prefers-reduced-motion[^}]*reasonCard\[data-focus=true\][^{]*\{transition:none\}/.test(readerCss)],
  ['the card requests the focus when it is the one being written into at the bottom of the transcript', () => bundle.includes('onFocusChange(focusKey, true)') && bundle.includes('isNearTail(scroller.scrollTop')],
  ['…and hands it back when it stops being written into, on 展开阅读, and on unmount — but NOT when the reader takes the CARD over', () => (bundle.match(/onFocusChange\(focusKey, false\)/g) ?? []).length === 4],
  // FOUR places now, not three: the toggle hands the focus back as well. A card held open by the FOCUS has nothing to toggle
  // in `expanded`, so its 收起 press releases the focus instead — without that it would do nothing at all, which is what the
  // reader found after taking a card over: no toggle ever came back, and the card could not be closed. The takeover itself
  // still must NOT be a release; reading inside a card is reading it, which the pin below pins down.
  ['…with the newest request winning unless a card is pinned, so exactly one card can hold the focus', 'pinRef.current === null ? key : current'],
  // The reader's own rule for 「焦点思考展开」, settled after the card's takeover turned out to be the wrong release: scrolling
  // INSIDE a card is READING it, so the card stays open under them, no newer card's request takes the focus away, and the
  // idle beat cannot end it either (that effect returns early while the card is not following). The card publishes the pin,
  // the Reader refuses grants while one is held, and the release below clears it with the focus.
  ['…and reading INSIDE a card pins the focus it holds, where no newer card and no idle beat can take it', () =>
    bundle.includes('const pin = focused && !following;')
    && bundle.includes('onFocusPin(focusKey, pin)')
    // …which is why the card's own takeover is no longer a release: this one now needs the card to still be following.
    && bundle.includes('if (following && !active) onFocusChange(focusKey, false);')],
  // …and only the reader ends a pin: coming back to the bottom of the page by hand, or the 「回到最新」 pill, which scrolls
  // there. An EDGE rather than a level, because while the reader is inside the card the page is already at the bottom — a
  // level test would end the pin the instant it was set. The focus goes only when there WAS a pin: without one, returning
  // to the tail is the ordinary read-and-return, and releasing would fold the card shut for one commit before it asked
  // again.
  ['…and a pin ends when the reader comes back to the bottom of the page', () =>
    bundle.includes('const returned = wasDetached.current && !scroll.detached;')
    && bundle.includes('if (!returned || pinnedCard === null) return;')],
  ['…and the page stops following the tail while a card holds it, told apart from a reader takeover', 'useReadingScroll(root, motion, live, followMode, focusedCard !== null)'],
  ['…because a suspension only yields to a scroll that moved BACKWARDS, which is what a reader taking over does', 'if (suspendedRef.current && scroll.scrollTop >= lastSuspendedTop) {'],
  ['…with the expansion ON unless a record says otherwise', 'focusExpand: true'],
  ['…and that record read the defensive way', 'state.focusExpand) !== false'],
  ['手动滚动 never lets the card move on its own', 'reasoningMode !== "manual"'],
  ['跟随最新 aims at the newest line rather than at a step', 'reasoningMode === "latest"'],
  ['and 自动滚动 realises the pace as a whole-line step', 'reasoningTarget(from, text.offsetHeight, port.clientHeight, lineHeight, stepLines(rate))'],
  ['a pace is rounded to whole lines and never to zero', 'return Math.max(1, Math.round(rate * holdMs / 1e3));'],
  ['…with the defaults being the reader’s own mode at the pace they chose', () => bundle.includes('reasoningFollow: "latest"') && bundle.includes('reasoningRate: 3')],
  ['…both read defensively', () => bundle.includes('reasoningFollowModeOf(state.reasoningFollow)') && bundle.includes('reasoningRateOf(state.reasoningRate)')],
  ['…and a change to either reaches the follower that is already running', () => /reasoningMode,\s*rate\s*\]\)/.test(bundle)],
  // The two folding settings, pinned at every end that has to agree — and kept clearly apart, because they fold
  // DIFFERENT things and confusing them is the mistake this pair is here to prevent.
  //
  // 自动收起更早流程 (the boolean) folds a turn's PROCESS, and only WHILE a turn streams: the fold itself (only a turn
  // with `status === "open"` stays open), the two places the rule is asked — the reader's rendering and the toolbar's
  // own "what is open" pass, which would otherwise disagree with what is on screen — the default, the defensive read,
  // and the clear that makes a new turn put the earlier processes away.
  ['自动收起更早流程 folds every turn but the growing one', 'if (foldEarlier && boundary.status !== "open") return false;'],
  ['…and the toolbar asks the same rule, so it agrees with the screen', () => (bundle.match(/processExpanded\(choice, boundary, foldEarlier\)/g) ?? []).length === 2],
  ['…with the switch ON unless a record says otherwise', 'autoCollapseEarlier: true'],
  ['…and that record read the defensive way', 'state.autoCollapseEarlier) !== false'],
  // 自动折叠更早的轮次 (the count) folds whole TURNS — reader's message, process and answer together — by not rendering
  // them at all, and its window is COMMITTED: it is re-read when a NEW turn starts and at no other time, so an edit in
  // the panel waits for the next turn instead of folding the page under a reader mid-sentence.
  ['…and the turn window, OFF unless a record says otherwise', () => bundle.includes('collapseBefore: 0')
    && bundle.includes('turnFoldOf(state.collapseBefore)')],
  ['…measured from the tail, and the reveal serves what is in hand before anything is read from disk', () => bundle.includes('renderedTurnsOf(foldWindow, revealed)')
    && bundle.includes('insideWindow(index, turns.length, renderedTurns)')
    && bundle.includes('hiddenTurnKeys.has(group.key)')
    // One name for the control, in both cases: the reader asked for that (「那个按钮也命名为加载更早记录即可」), so the
    // reveal is only ever the click handler's arithmetic and the label is the same string the disk path uses.
    //
    // The count is `>= 1` rather than `=== 1` since the load path grew a second call to the same arithmetic: what it
    // fetches arrives OLDER than the window and would otherwise land hidden, so the press now reveals one band too. The
    // name and the single control are what this line is about, and both still hold — pinned by the label assertions below.
    && (bundle.match(/revealStepOf\(foldWindow\)/g) ?? []).length >= 1
    && bundle.includes('hiddenTurnKeys.size > 0')
    && bundle.includes('加载更早记录')
    && !bundle.includes('显示更早的')],
  ['…and re-read only when a NEW turn starts, so nothing is pulled out from under a reader', 'committedTurn.current === liveTurn'],
  ['…with a ceiling a typo cannot argue with, and a text field in the panel', () => bundle.includes('Math.min(50, Math.max(0, Math.round(value)))')
    && bundle.includes('"data-ud-check": "reader-settings-collapse-before"')],
  // …and the field commits on the panel CLOSING as well, which is the only exit that can: a panel dismissed by an
  // outside pointer removes the field before any `blur` could fire, so a number typed and then abandoned by clicking
  // elsewhere was lost (the reader's report). `commitFoldDraft()` appears exactly once — the close effect — because the
  // two event handlers pass the function itself.
  ['…and a panel closed by clicking outside still applies what was typed', () => bundle.includes('foldDraft !== String(collapseBefore)')
    && (bundle.match(/commitFoldDraft\(\)/g) ?? []).length === 1],
  ['…and a new turn clearing the stored choices, so the earlier ones fold by themselves', () => {
    const gated = (bundle.match(/autoCollapseEarlier && liveTurn !== null/g) ?? []).length;
    return gated === 2 && bundle.includes('clearExpanded');
  }],
  // The follow mode, gated in BOTH places the follower can move the tail: the frame loop and the resize observer. One
  // gate would leave the other path gliding, which is exactly the kind of half-fix this switch cannot afford — the
  // whole point of the direct write is that it produces no scroll event for the spy and the anchor to react to.
  ['the direct tail write is gated in the frame loop and in the resize observer', () =>
    (bundle.match(/followMode === "snap"/g) ?? []).length === 2
    && bundle.includes('const FOLLOW_MODES = [{\n\t\t\tid: "glide",\n\t\t\tlabel: "逐帧滑行"\n\t\t}, {\n\t\t\tid: "snap",\n\t\t\tlabel: "直接贴底"\n\t\t}];')],
  // The INIT is the reader's own setting (snap); the READER's own fallback stays the glide, which is what a record
  // carrying an unusable value keeps — the two are deliberately different numbers, so both halves are pinned.
  ['…with the direct write unless a record says otherwise', () => bundle.includes('followMode: "snap"') && bundle.includes('? "snap" : "glide"')],
  ['…and that record read the defensive way', 'followModeOf(state.followMode)'],
  // The per-word reveal switch, pinned at the point where the work is: with it off the timeline is not STARTED in
  // either path (two `begin` calls become two gates), and the reasoning text renders as the plain string it is while
  // the markdown path drops the reveal hooks altogether. The default and the defensive read are the other two ends:
  // a record written before this switch existed keeps the per-word reveal.
  ['the per-word reveal can be turned off, and then the timeline is not started at all', () => {
    const gated = (bundle.match(/if \(perWord\) timeline\.current\.begin/g) ?? []).length;
    return gated === 2 && bundle.includes('perWord && current.hasLiveText') && bundle.includes('perWord ? ');
  }],
  ['…with the per-word reveal on unless a record says otherwise', 'revealWords: true'],
  ['…and that record read the defensive way', 'state.revealWords) !== false'],
  // The blur switch, pinned where the cost actually is: with it OFF there must be no `filter` in the keyframes at all,
  // because a no-op `blur(0px)` would still keep the animated word off the compositor's own path. The other two ends
  // are the animation asking for the choice, and the defensive read plus the default that make an older record keep
  // the blur every card showed before the switch existed.
  ['the reveal\'s blur can be turned off, and then no keyframe names a filter', 'if (!blur) return [{ opacity: 0 }, { opacity: 1 }];'],
  ['…and the word animation is what asks for it', 'target.animate(revealFrames(blur), {'],
  ['…with the blur OFF unless a record says otherwise', 'revealBlur: false'],
  ['…and that record read the defensive way', 'state.revealBlur) === true'],
  // The cadence itself, pinned at all three ends: the two options the panel offers (as the array, so one cannot be
  // dropped or renamed out from under the stored values), the defensive read that makes an older record mean the
  // per-frame cadence, and the gate in the publish loop — where a hidden page still flushes rather than pacing, which
  // is what keeps a backgrounded stream from returning with a backlog.
  ['the reveal cadence offers exactly two options', 'const TEXT_CADENCES = [{\n\t\t\tid: "steady",\n\t\t\tlabel: "固定 60 次/秒"\n\t\t}, {\n\t\t\tid: "frame",\n\t\t\tlabel: "跟随屏幕刷新"\n\t\t}];'],
  ['and an unrecognised record keeps the steadier cadence', 'return value === "frame" ? "frame" : "steady";'],
  // The cadence a fresh install opens with, pinned on its own: the steady one, because per-frame publication is what
  // makes the reveal's work follow the display's refresh rate — the option the panel labels as a cost.
  ['…which is the cadence a fresh install opens with', 'textCadence: "steady"'],
  // …and the clock it asks about is a REF held across effect runs, not a local seeded at the top of one. The effect
  // re-runs per streamed delta, so a local measures the time since the last ARRIVAL: deltas closer together than the
  // step keep re-seeding it, `publishDue` never answers yes, `advance` is never called and the reveal stops until a
  // pause or the backlog guard. That was the shape shipped with the cadence, and it is a stall, so the absence of the
  // local is asserted as loudly as the presence of the ref.
  ['the publication gate asks the cadence, and a hidden page still flushes', () =>
    bundle.includes('const publishedAt = (0, react.useRef)(0);')
    && !bundle.includes('let publishedAt = performance.now();')
    && bundle.includes('if (document.hidden) {\n\t\t\t\t\t\tcurrent.flush();\n\t\t\t\t\t\tpublish();\n\t\t\t\t\t\tpublishedAt.current = now;\n\t\t\t\t\t} else if (publishDue(now, publishedAt.current, cadence)) {\n\t\t\t\t\t\tcurrent.advance(now);\n\t\t\t\t\t\tpublish();\n\t\t\t\t\t\tpublishedAt.current = now;\n\t\t\t\t\t}')],
  // …and the switch is real in both directions: the reading view publishes it on its own root (one occurrence) and the
  // listener reads it there (the other) — two spellings of one string, which is why the count is asserted rather than
  // the presence of either. The gate is asserted as the LINE it compiles to, because where it sits is the property
  // that matters: before the notch is consumed, so a wheel with the switch off leaves the event exactly as it found it
  // — neither `preventDefault` nor `stopPropagation` — which is what hands the App's own instant `scrollBy` its notch.
  // The last clause is the other half of that: when ours DOES take the notch it must claim it outright, because the
  // panel's `onWheel` is a React listener on that same element and would otherwise write the position too.
  ['the strip wheel switch reaches the listener, which stops before consuming the notch', () => {
    const attribute = (bundle.match(/data-reader-strip-wheel/g) ?? []).length;
    const gate = bundle.indexOf('if (!stripWheelEnabled(root.getAttribute(STRIP_WHEEL_ATTRIBUTE))) return;');
    return attribute === 2
      && gate !== -1
      && gate < bundle.indexOf('handleTakesWheel(element.closest(WIDTH_HANDLE)', gate)
      && bundle.indexOf('event.stopPropagation();', gate) !== -1;
  }],
  // The shortcut page is where a reader changes the two bindings; it holds the recorder.
  ['the shortcut page records new bindings', '"data-ud-check": "reader-settings-shortcuts"'],
  // The selected page's bar is ONE element on the row, translated between equal-width tabs — a bar
  // per tab can only appear and disappear, never slide.
  ['the page indicator is one sliding bar', 'data-settings-page=shortcuts'],
  // The wait clock: the readout itself, the badge a long wait earns, and the fact that its anchor
  // is the last HANDOVER rather than the start of the turn. The third is checked by shape because
  // the anchor walks the group's own keys — a wake-up that counted from the turn start would show
  // the minutes the tools already spent, which is the bug this replaced.
  ['the status line carries a wait clock', '"data-reader-wait-clock"'],
  // The tail-follow belongs to a LIVE turn, and the downward wheel that cannot move is not a takeover. Both were
  // reported through their effects — a 「回到最新」 pill that appeared and vanished with every notch at the bottom of the
  // page, and a transcript still pulled to the bottom with nothing running (「在没有进行中的轮次的情况下，不应有自动吸附」) —
  // so this pins the shapes that produce them rather than restating the rule, which lives in `reading-scroll.ts` and is
  // tested directly there. Two things are load-bearing: the follower consults that one question in the FRAME LOOP and in the
  // RESIZE OBSERVER (gating one leaves the other path still following), and the wheel handler asks `wheelAtBottom`
  // before it treats the gesture as a takeover.
  //
  // …and since a long session opened at the TOP, the question is a NAMED predicate rather than the bare `producingRef`
  // test: `mayFollow` is "a live turn, OR a reader who has not acted yet", because until the reader acts the session's own
  // history is still arriving and that growth has to be followed (see `scrollTakeover`). Pinning the name is deliberate —
  // the two call sites must keep asking the SAME question, and a pin on their text could be satisfied by changing one.
  ['the tail-follow asks one question in both paths, and a wheel at the bottom is not a takeover', () =>
    bundle.includes('mayFollow')
    && bundle.includes('!mayFollow() || suspendedRef.current ||')
    && bundle.includes('mayFollow() && !suspendedRef.current && following.current')
    && bundle.includes('motion, live')
    && bundle.includes('producingRef.current = liveRef.current || now - endedAt.current < OUTPUT_TAIL_MS;')
    // …and the state it reads is written in a LAYOUT effect, so it is current for the commit that caused the growth
    // rather than one paint later. That ordering was the bug: a passive effect let the observer run first. BOTH refs
    // are pinned, because the first pass at this fixed `live` and left `suspended` on a passive effect one line below —
    // the same race, in the same reader, with only the glide's second look inside `follow` hiding it.
    && bundle.includes('(0, react.useLayoutEffect)(() => {\n\t\t\t\tliveRef.current = live;')
    && bundle.includes('(0, react.useLayoutEffect)(() => {\n\t\t\t\tsuspendedRef.current = suspended;')
    && bundle.includes('function wheelAtBottom(deltaY, gap)')
    && bundle.includes('if (!wheelAtBottom(event.deltaY, gap) && wheelClaimsScroll(event.deltaY))')],
  // The follower compares the scroller's position against the last number it WROTE, to tell its own frames apart from
  // the reader moving. That only works while the number written is one the element can actually hold: `scrollHeight`
  // is not, so the two writes straight to the tail have to clamp it to the ceiling like the frame loop does with its
  // gap. Both sites are counted, because fixing one and forgetting the other is exactly the shape of the mistake.
  ['every write to the tail records a position the scroller can hold, so the guard can recognise our own frame', () =>
    (bundle.match(/writeTop\(scroll\.scrollHeight, scroll\.scrollHeight - scroll\.clientHeight\)/g) ?? []).length === 2
    && bundle.includes('const writeTop = (top, limit) => {')],
  ['the host record carries the preferences, never the per-turn expansion choices', () =>
    // Both directions are pinned. Outward: the whole state minus `expanded` is what goes to the host, or the map grows
    // without bound inside a record the host refuses WHOLE past 64 KiB — silently, which is how every setting would
    // stop persisting. Inward: the copy the reader gets is never allowed to take `expanded` from that record, whose
    // keys are bare turn numbers that another session is free to mean something else by.
    (bundle.match(/settingsWriter\.push\(hostRecordOf\(readerState\)\)/g) ?? []).length === 2
    && (bundle.match(/if \(key === "expanded"\) continue;/g) ?? []).length === 2],
  ['a settings read that FAILED is not a record that is empty, and nothing is written on that path', () => {
    // The order is the assertion: the failure branch has to come BEFORE the writer is armed, or a session that could
    // not read the record would still push its own state (the defaults, on a fresh port) over the record it failed to
    // fetch — the destructive half of collapsing the two cases into `undefined`.
    const failed = bundle.indexOf('if (read.kind === "unavailable")');
    const armed = bundle.indexOf('settingsLoaded.current = true');
    return failed !== -1 && armed !== -1 && failed < armed
      && bundle.includes('if (read.kind === "stored") {')
      && bundle.includes('settingsWriter.push(hostRecordOf(readerState))');
  }],
  ['the two looping indicators are gated for a reader who asked for less movement', () =>
    // The rail's busy tick and the running-tool dot in the MCP frame. `Reader.module.css` gates every animation it owns
    // on this query; these two stylesheets shipped with an endless one and no gate at all. Both halves are pinned,
    // because the gate is only worth having for an animation that never ends — and both are matched by SHAPE: neither
    // the shorthand's member ORDER nor the timing VALUES are asserted, because those are the minifier's business and
    // the scratch rebuild inside `verify-build` produces slightly different bytes run to run. Pinning them is what
    // made this marker flake once (it went red inside a full guard run while passing three times standalone); what
    // must hold is the SEMANTICS — an endlessly looping animation whose keyframes belong to that module, plus a
    // reduced-motion block that stops it.
    // SHAPE, and nothing else: neither the shorthand's member order, the timing values, nor the position of the
    // keyframe name relative to the closing brace are asserted — all three are the minifier's business, and the scratch
    // rebuild inside `verify-build` produces slightly different bytes run to run (which is what made this marker flake
    // twice: first on the values, then on `\w+_markBusyPulse\}`). What must hold is the SEMANTICS: an endlessly looping
    // animation whose keyframes belong to that stylesheet, plus a reduced-motion block that stops it.
    /animation:[^;}]*infinite[^;}]*_markBusyPulse/.test(bundle)
    && /@media \(prefers-reduced-motion:reduce\)\{\.\w+_markBusy \.\w+_tick\{animation:none\}\}/.test(bundle)
    && /animation:[^;}]*infinite[^;}]*_pulse/.test(bundle)
    && /@media \(prefers-reduced-motion:reduce\)\{\.\w+_pulseDot\{animation:none\}\}/.test(bundle)],
  ['the steps pill never claims a denominator it does not have', '`${answer} 步`'],
  ['…and the 动效 switch is read the defensive way, like every other switch that is on unless a record says otherwise', 'state.motion) !== false'],
  ['the running turn is worked out when the TURN MAP changes, not once per streamed delta', () =>
    // `useChat` runs its selector on every notification and text arrives one per delta, so a scan of every turn inside
    // the selector cost work proportional to the history on every chunk, for an answer that only changes at a boundary.
    bundle.includes('for (const turn of timeline.turns.values())')
    && !bundle.includes('for (const turn of snapshot.timeline.turns.values())')],
  ['the process disclosure toggles from the reader’s decision, not from the state it is holding behind that decision', () =>
    // The 150ms hold exists so the collapsing element was mounted open; deriving the next state from the held value
    // made the button dead for exactly that window (a second click folded it again instead of reopening).
    bundle.includes('onToggle: () => setExpanded(!wantsProcess),')],
  ['a jump that had to load history lands from the commit that rendered the rows, not from a guessed delay', () =>
    // The rows arrive with the commit that follows the load and nothing announces it, so the request is remembered and
    // retried from the layout effect — which is why BOTH the retry and the "did it land" answer are pinned. The old
    // shape waited 50ms and called a reveal that returned nothing, so a slower commit left the reader where they were,
    // silently.
    bundle.includes('if (revealTurn(pendingReveal)) {')
    && bundle.includes('setPendingReveal(item.turn);')
    && bundle.includes('if (!targetRow) return false;')],
  ['…and a jump that never lands is dropped instead of retrying for the rest of the session', () =>
    // Unbounded, the retry was a whole-transcript query on every later commit AND a jump the reader had long stopped
    // asking for, fired by whichever unrelated render eventually produced the row. Past the window the request is
    // dropped and logged: the reading view has no transient-notice surface, and the reader can see they did not move.
    bundle.includes('if (performance.now() > pendingRevealUntil.current) {')
    && bundle.includes('pendingRevealUntil.current = performance.now() + REVEAL_RETRY_MS;')
    && bundle.includes('"[dsh-better-display] jump target never rendered:"')],
  ['…and a rejected history load is caught rather than left as an unhandled rejection', () =>
    // This runs as a click handler, so a rejection had nothing to attach to. The 加载更早记录 button in the same file has
    // always caught its own; the timeline rail's path had not.
    bundle.includes('"[dsh-better-display] jump load failed:"')],
  ['nothing in this view scrolls by walking ancestor boxes', () =>
    // `conversation-scroll.ts` bans `Element.scrollIntoView` by name: it walks ancestor scrollers and can lift the
    // sticky composer off the bottom of the viewport. The one call site that survived the ban lived in DiffPanel's
    // fallback, behind a test for "nearest ancestor whose content is taller than its box" — which an `overflow: visible`
    // ancestor passes while being unable to scroll. Both are gone; this keeps them gone.
    !bundle.includes('scrollIntoView({')
    && bundle.includes('landTurn(element, port);')],
  ['the tool table names the cordis verbs this host actually registers', () =>
    // A table of wire names cannot check itself against the host, which is how it carried two names this host does not
    // register for a long time while the three real inspect verbs fell to the generic row. The absent half is asserted
    // as ENTRY SHAPES, not as substrings: the comment above the table names the old ones deliberately, as the history
    // of the mistake, and a substring check would forbid saying what was wrong.
    bundle.includes('cordis_inspect_list: "read",')
    && bundle.includes('cordis_inspect_query: "read",')
    && bundle.includes('cordis_inspect_self: "read",')
    && bundle.includes('cordis_define: "Define Cordis Plugin",')
    && !bundle.includes('cordis_package_inspect: "read",')
    && !bundle.includes('cordis_runtime_inspect: "Inspect",')],
  ['a tool row re-renders when the file vocabulary changes, which is what makes a mention clickable', () =>
    // `Blocks` hands `fileMentions` to the markdown renderer, and the hand-written memo comparator did not compare it:
    // a file produced later in the turn left the mention that names it inert in every already-rendered tool row.
    bundle.includes('previous.fileMentions === next.fileMentions')],
  ['the wallpaper column is looked up once, and re-found only when it leaves the document', () =>
    // `measure` runs once per frame while a divider is dragged or the window resizes; the whole-document
    // attribute-substring scan used to live inside it, for an element that does not move. Re-finding it on
    // `isConnected` is what keeps the reason the query was there: a detached box measures as zeros.
    bundle.includes('if (column !== null && !column.isConnected) column = document.querySelector')
    && !bundle.includes('const box = document.querySelector(')],
  ['a document with <html> but no <head> still gets the theme bridge and the height reporter', () =>
    // Such a document is legal HTML — the browser infers a head — and returning it verbatim, which is what it did, skipped
    // both of the things this function exists for. What is pinned is the INJECTION: reverting to `return trimmed;` takes
    // this call out of the artifact and fails here.
    bundle.includes('trimmed.replace(/<html([^>]*)>/i,')],
  ['…and the grant closes the tail gap before paint', () =>
    // The reader's report pins this one: while a card holds the focus the page's follow is suspended, so the slack
    // `isNearTail` allows (72px) was never closed and the card's bottom — reading row included — sat behind the
    // composer's edge; clicking 回到最新, which writes the maximum, made it "just exactly complete". That is why the tail
    // gap is closed in a layout effect, before paint.
    //
    // NOT pinned any more, on purpose: the compensation of that same commit's ceiling jump. Holding the card's bottom in
    // place meant a card that grew when the focus was granted grew UPWARD — the reader's 「有时会向上展开而不是向下展开，应该
    // 统一向下」. It is gone from this effect. It cannot be pinned as an ABSENCE either, because `compensateNow.current()`
    // still exists and must: the observer calls it for the per-line growth during streaming, which grows downward already.
    bundle.includes('scroller.scrollTop = scroller.scrollHeight;')
    && bundle.includes('compensateNow.current = compensateHeight;')
    && bundle.includes('compensateNow.current();')],
    // The `compensateNow.current()` in this effect was removed once and is BACK: that attempt was aimed at the reader's
    // report about expanding a COMPLETED card in the current flow (which grows up when it sits above the reading position and
    // down when below it — the page's own scroll anchoring, not this jump). Left out of the marker on purpose is any claim
    // about a focused card's growth direction; that question belongs to the fix for the completed-card case.
  ['a long wait earns its badge', '"data-reader-wait-badge"'],
  // The readout renders nothing at all until the wait is worth a number, and carries a width floor so
  // the seconds counting up cannot push the chevron that sits after the label. Pinned by the emitted
  // BEHAVIOUR rather than by a name: `WAIT_COUNT_FROM_MS` is read in exactly one place, so the build
  // inlines it and the constant never reaches the artifact — a marker looking for that name would
  // have passed on the previous build and failed on this one with nothing having changed.
  ['the readout waits three seconds before it counts', () =>
    /if \(waited < 3e3\) return null;/.test(bundle)
    && /min-width:calc\(2ch \+ 1em\)/.test(bundle)],
  ['the wait is anchored to the last handover', () => /waitingAnchor\(\s*group\.keys/.test(bundle)],
  // Where a delivered file opens. Four claims: the settings row exists; the sidebar opener is LOOKED
  // UP on the Cordis context rather than required (a host without it must still boot); the address a
  // file is opened by is the official session-file scheme the product's own tab actions build; and a
  // missing opener falls back to the system app with a warning rather than doing nothing at all.
  ['the settings panel offers the sidebar preview', '"data-ud-check": "reader-settings-openmode"'],
  ['the sidebar opener is looked up, not required', 'get?.("sidebarRight")'],
  ['deliverable addresses use the official session-file scheme', 'dsh-resource://file/session/'],
  ['a missing sidebar opener falls back with a warning', 'sidebarRight.openResource is not available; falling back to system app'],
  // The two halves of the bug that made that switch a no-op, both pinned where nothing else looks.
  // `open-file.test.ts` starts after the decision has been made, so it can only prove that a given
  // mode is obeyed; the layer that decides the mode is this bundle, and it compiled happily while
  // being wrong (an `as unknown as` cast hid that the store handle carries no snapshot, so the mode
  // was `undefined` on every click and every click went to the system app).
  ['the click hands the subscribed preference down as the mode', () => /mode: openInSidebar \? "sidebar" : "external"/.test(bundle)],
  // And the lookup has to be INSIDE the click. Service resolution only answers for a provider whose
  // fiber is already active, so the hoisted version answers "no sidebar" for the whole session when
  // this plugin happens to mount first — the same symptom from the other end.
  ['the sidebar opener is looked up inside the click, not once at activation', () => {
    const body = handlerBody('openFile: async (path');
    return body.includes('sidebarRightFace()') && body.includes('deliverableOpenModeOf(options');
  }],
  // The wallpaper. Four claims: the row exists; the backdrop is painted on the reading view's own
  // root; it is a VIEWPORT-anchored backdrop whose scrim is mixed from the theme's own background —
  // `cover` against this element's box would stretch one photograph over a whole long conversation,
  // and a scrim hardcoded to black would be a legibility bug in the light theme; and the thumbnails
  // come from the plugin's own route, keyed by the file's mtime so a re-dropped image is not served
  // from the browser's cache. The folder itself never reaches the browser — see the forbidden list.
  ['the settings panel offers a wallpaper', '"data-ud-check": "reader-settings-wallpaper"'],
  // The wallpaper a FRESH install opens with. Its name lives in three places — the client's default, the host's constant
  // and the asset path resolved off the host module — in two bundles that cannot import each other, so the RELATION is
  // what is asserted rather than any one spelling: a rename that misses one of them leaves every new reader with a
  // default naming a file nobody has, which is the one failure this arrangement exists to prevent. The FILE is checked
  // too, because a name and a constant agreeing about nothing is still nothing.
  ['the shipped wallpaper is one name in three places, and the file is there', () => {
    const host = readFileSync(join(installedPluginDir(), 'lib', 'dsh-viewtune.js'), 'utf8');
    const name = 'sample-gradient.png';
    return bundle.includes(`const DEFAULT_WALLPAPER = "${name}"`)
      && host.includes(`const DEFAULT_WALLPAPER_NAME = "${name}"`)
      && host.includes(`"../assets/${name}"`)
      && existsSync(join(installedPluginDir(), 'assets', name))
      // …and something actually puts it where the client will ask for it, at activation rather than on first listing.
      && host.includes('seedDefaultWallpaper(WALLPAPER_DIR, WALLPAPER_ASSET)')
      && host.includes('"dsh-viewtune: shipped wallpaper"');
  }],
  ['the wallpaper is painted on the reading view root from the chosen name', () =>
    /"data-reader-wallpaper"/.test(bundle) && bundle.includes('wallpaperProperties(')],
  ['the wallpaper is a viewport-anchored backdrop with a theme-mixed scrim', () => {
    const rule = new RegExp(`${classSel(readerCss, 'root')}\\[data-reader-wallpaper\\]\\{([^}]*)\\}`).exec(readerCss);
    if (rule === null) return false;
    const body = rule[1];
    return body.includes('background-attachment:fixed')
      && body.includes('var(--wallpaper-image)')
      && body.includes('--wallpaper-dim')
      && body.includes('color-mix(in srgb, var(--dsw-alias-bg-base');
  }],
  ['wallpaper thumbnails come from the plugin route, keyed by the file', () =>
    bundle.includes('better-display/wallpaper/') && bundle.includes('?v=${')],
  // The whole-window scope, whose mechanism the runtime probes established. Five claims: the settings rows
  // exist; the stylesheet is GATED on an attribute, so nothing applies until the reader opts in; every copy of
  // the IMAGE rides a viewport-anchored rule (that is what lets several copies be safe — they line up as one
  // image instead of layering scrims, which is what made one region visibly darker than its neighbour in the
  // first probe); the chrome carries a scrim per surface and no second copy; and the reading view steps aside
  // while the scope is the window, for the same reason. The gate is pinned through the `SCOPED` interpolations
  // rather than a spelled-out selector, because the selector is built from the attribute constant at runtime.
  ['the settings panel offers the window-wide wallpaper', '"data-ud-check": "reader-settings-wallpaper-scope"'],
  // The chrome's scrim has a dial PER SURFACE since the reader asked the sidebar and the top bar to move apart.
  // The host's GOAL BAR, which is one ellipsised line with no affordance of its own (measured in
  // `@deepseek-ai/dsh-client-ui-goal`: `.objective { white-space: nowrap; text-overflow: ellipsis; overflow: hidden }`
  // inside a bar pinned to `height: 36px`, and no `title` anywhere). This plugin expands it WITHOUT inserting a node
  // into the host's tree — the next render would drop that — so the whole feature is one attribute on `<html>`, one
  // delegated capture-phase click, and a stylesheet. The interactive exclusion is pinned as a CALL, not as the list's
  // name: a marker that only saw `GOAL_BAR_INTERACTIVE` would pass with the list declared and never consulted, which is
  // the regression where the edit and pause buttons fold the bar instead of doing their job.
  ['the goal bar expands and collapses without touching the host’s tree', () => bundle.includes('data-viewtune-goal-expanded')
    && bundle.includes('data-goal-bar')
    && bundle.includes('installGoalBar(document)')
    && bundle.includes('addEventListener("click"')
    && bundle.includes('selection.isCollapsed')
    && bundle.includes('GOAL_BAR_INTERACTIVE.some((selector) => target.closest(selector) !== null)')
    // THE TARGET IS THE CHILD, not the element the hook is on. `data-goal-bar` is the OUTER dock
    // (`div.dock[data-goal-bar] > div.bar`) and the 36px the reader complained about lives on that child, so aiming the
    // geometry at the hook leaves the bar one line high while the objective still wraps — the reported symptom, and the
    // bug this shipped twice before the DOM was measured.
    && bundle.includes('> [class*="_bar"]')
    && bundle.includes('height: auto !important')
    && bundle.includes('max-height: 40vh')
    // …and a fixed height ANYWHERE above it is released too: the bar renders into `conversation.input.dock`, whose
    // wrapper belongs to the composer, and a height up that chain would clip the growth while the objective wrapped.
    && bundle.includes('max-height: none')
    && bundle.includes('dsh-viewtune-goal-bar')],
  // 「产物展示」: the three ways this view can show a turn's files, and the two lists told apart inside the detailed
  // ones. The reader asked for exactly this — 简略气泡 left as it was, and 编辑 kept apart from 产物 in the other two,
  // because the fallback that builds the first list used to arrive under the second list's label (see deliverables.ts).
  ['the deliverable row has three modes, and the detailed two tell 编辑 from 产物', () => bundle.includes('deliverableDisplayOf(state.deliverableDisplay)')
    && bundle.includes('reader-settings-deliverable-display')
    && bundle.includes('产物展示')
    // The two regions and their hook: one for what the turn EDITED, one for what it DELIVERED.
    && bundle.includes('data-region')
    && bundle.includes('data-display')
    // …the one control that folds the detailed modes away (they show every file, so they need one)…
    && bundle.includes('deliverablesToggle')
    // …the card look of the detailed mode, and the split reader that feeds both.
    && bundle.includes('data-style')
    && bundle.includes('getTurnDeliverableGroups')
    // …and 平衡 's own shape, which came from the reader's spec: one rounded box per region, its first line carrying
    // 「共 N 项编辑 / 新增」 and then chips to the end of that line, later lines aligned under the first chip (label and
    // chips are two columns of one grid), the switch holding a column of its own, and TWO ROWS by default — 28px chip
    // plus a 6px gap is 62px exactly, so a third row is clipped whole rather than half-shown — until it is opened.
    && bundle.includes('deliverablesBoxes')
    && bundle.includes('max-height:62px')
    && bundle.includes('data-open')
    // …and the switch appears only when something IS hidden: the lane is measured (its content height against the same
    // 62px) and the button renders only for a lane that overflows. The reader's 「无需展开的时候展开不用出现」.
    && bundle.includes('function needsExpand(contentHeight, cap = 62)')
    && bundle.includes('scrollHeight')
    // …and the heading button is content-wide, not stretched over its whole grid column: a stretched grid item made the
    // entire first row read as clickable (the reader's report).
    && bundle.includes('justify-self:start')
    // …and the hover window plus the heading's click, copied from the conversation page: the primitives' own `HoverCard`
    // in its preview variant with the host's 500ms delay and the width anchored to the box, its content the changed files
    // with their ± counts (the same `diffTotals` the tool rows use), and a heading that hands the call to the host's
    // inspector. `inspectCall` is the closest published surface to the host's review click: the slot catalog shows a View
    // receives only inspectCall/viewRequest/openView/completeViewRequest, so the review entry point is not reachable.
    // …and the total-diff panel, which is what the heading's click reveals: the reader's replacement for the host's review
    // click, and the only way in — the hover window was dropped on request (an earlier build anchored the primitives'
    // `HoverCard` here with the host's 500ms delay). Its ± counts are the FLOW's own button (`DiffStatButton`), pinned so
    // the two cannot drift apart — pressing one unfolds that file's diff through the flow's own `DiffBlock`.
    && bundle.includes('deliverablesChanges')
    && bundle.includes('deliverablesBoxPanel')
    && bundle.includes('DiffStatButton')
    // …and the small window the 编辑 heading shows on hover: the plain `title` the settings rows already use, pinned in its
    // RENDERED form so the pin cannot be satisfied by a comment that happens to mention the words.
    && bundle.includes('title: "点击查看差异"')
    && bundle.includes('turnChanges')
    // …and the commits are read from the calls, with the global options a real command carries: every commit in the
    // reader's instance is `git -C <dir> commit …`, and a pattern demanding `git` immediately before `commit` matched
    // none of them, so 「提交」 never appeared at all.
    && bundle.includes('turnCommits')
    && bundle.includes('-C|-c|--git-dir|--work-tree')
    // …and that the row claims the WHOLE row. `width:100%` is the stable half of it; `grid-column:1/-1` is the half that
    // saves it from a grid parent's `max-content` column (and is inert in a flex one). NOTE for whoever reads the built
    // file next: lightningcss folds `align-self` + `justify-self` into `place-self: stretch stretch`, so searching for the
    // longhand names in the artifact finds nothing even when the rule is right there.
    && bundle.includes('width:100%')
    && bundle.includes('grid-column:1/-1')
    // …and the fallback that decides what an unrecognised stored value means: the MIDDLE mode, which is what a fresh
    // install opens with.
    && bundle.includes('value === "brief" || value === "cards" ? value : "balanced"')],
  // The conversation page's 「已编辑 N 个文件」 card, rebuilt in the reading view's 详细卡片 mode: ONE rounded card holding a
  // list (a header button with a 40px tile and the turn's totals, one clickable row per file with its own ±, and a control
  // that unfolds the rest) — the host's CHANGED-files shape, which is not the same as its presented-file tile grid that
  // this plugin uses for 交付.
  ['the 详细卡片 mode draws the host’s changed-files LIST card, not a tile grid', () => bundle.includes('ChangedFilesCard')
    && bundle.includes('changedCardHeader')
    && bundle.includes('changedCardRow')
    && bundle.includes('changedCardToggle')
    // …with the host's own disclosure chevron: `IconChevronDownOutlineRegular`, the icon its own disclosures use, turning
    // over when the list is open (the reader asked for the same arrow on 全部 N 个文件 and on 收起).
    && bundle.includes('IconChevronDownOutlineRegular')
    && bundle.includes('changedCardChevronOpen')
    // …and the DELIVERED card keeps the host's shape too: one card per delivery, the assistant's own description as the
    // second line (the host's `cardDescription(file.description, metadata)` falls back to the type caption, which the same
    // element does), and the layout driven WITHOUT selector matching — three rounds of attribute selectors silently did
    // nothing here, so the column count is an inline style and the card's own shape is a CLASS, which never fails.
    && bundle.includes('deliveredCard')
    && bundle.includes('gridTemplateColumns')
    && bundle.includes('deliverableDescription')],
  // The HOST'S changes review, opened by resource: the one route a View has to the card the conversation page shows. The
  // card itself cannot be imported (the packages export only `apply`/`inject`, and its slot occupant needs that package's
  // own stores), but its address can be handed to `ctx.sidebarRight.openResource` and then the host draws it, unmodified.
  // The address is spelled exactly as the deliverables package spells it, since that is what its `canOpen` parses.
  ['the host’s changes review is reachable by its own resource address, behind the reader’s switch', () => bundle.includes('dsh-resource://changes-review/session/')
    && bundle.includes('changesReviewAddress')
    && bundle.includes('openChangesReview')
    && bundle.includes('reader-settings-review-in-sidebar')
    && bundle.includes('reviewInSidebar')],
  // 「产物栏」 (the reader's rename of 「产物标签」) owns the 编辑栏 and the 交付栏 wherever they appear: the reading view's
  // boxes and cards, and the conversation page's two product cards. Both halves are pinned — the label the settings panel
  // shows, and the dial reaching the conversation page's two product attributes — because either could be lost by a
  // tidy-up that looks unrelated.
  ['the 产物栏 dial governs both product rows, in the reading view and on the conversation page', () => bundle.includes('产物栏')
    && bundle.includes('--glass-chip')
    && bundle.includes('--glass-blur-chip')
    && bundle.includes('data-changed-files')
    && bundle.includes('data-presented-file')
    // …and the host's OWN card colours are defined for the reading view, values and dark-theme override alike, exactly as
    // the deliverables package defines them for its own root. Without these the boxes and cards had no colour while the
    // conversation page's did — the reader's report — because `--deliverable-fill` only ever existed inside that root.
    && bundle.includes('--deliverable-fill:var(--dsw-static-neutral-50)')
    && bundle.includes('--deliverable-fill:var(--dsw-static-neutral-850)')
    && bundle.includes('--changes-fill:var(--dsw-static-neutral-50)')
    // …and the three things the reader asked for on top of that wiring, each one a fact that could be lost alone:
    // the changed-files card's header is its OWN colour (`--changes-fill`, the host's own split from the card body's layer
    // token), and every highlight this plugin paints follows a dial with a `100%` fallback rather than an opaque token —
    // which is what made hovering an option turn it into a solid plate under the frosted skin.
    && bundle.includes('background:var(--changes-fill')
    && bundle.includes('--glass-chip,100%')],
  // A commit's NAME is its message, and the message is read from git's own output when the command has no `-m` — which is
  // the reader's own shape: their commits are `git commit -F <file>` and the tool result keeps only the last line, a
  // `git log --oneline -1` line. Pinned as the one component all three modes render plus the honest placeholder constant,
  // because the failure they reported was silent: a bubble labelled 「一次提交」 looks like a message.
  ['a commit bubble is labelled with the commit’s message, and a click copies its hash', () => bundle.includes('CommitBubble')
    && bundle.includes('UNKNOWN_COMMIT')
    && bundle.includes('[0-9a-f]{7,40}')
    // …and the reader's chosen shape (option B): the label is the message, clamped to one line, the tooltip carries both
    // halves, and a click copies the hash — the half that can be pasted into `git show`, an editor or a web UI.
    && bundle.includes('commitLabel')
    && bundle.includes('commitClipboard')
    && bundle.includes('deliverableCommitText')
    // …and the three refinements the reader asked for after seeing it: the confirmation is an OVERLAY (so the bubble's
    // width — and therefore every bubble after it — cannot move when it appears), and the highlight follows the dial
    // instead of an opaque fill.
    && bundle.includes('deliverableCommitCopied')
    && bundle.includes('复制提交')],
  // 新会话默认视图: a session that has recorded NO view opens on the reading view (the shipped behaviour, so the setting can
  // only turn it OFF) or on the host's conversation view, as the reader chose. Both halves are pinned — the settings row
  // itself, and the compiled rule that consults the setting — because the entry slot reads it from the HOST record rather
  // than from the reader's own store, and that is the half that could silently stop working.
  ['a brand new session opens on the page the reader chose', () => bundle.includes('新会话默认视图')
    && bundle.includes('entryViewOf')
    && bundle.includes('reader-settings-entry-view')
    && bundle.includes('defaultView === "reader"')],
  // The reader's own bubble is the host's bubble: the same cap (which follows the host's chat-content width instead of a
  // frozen 525px), the same font size and line height, the same radius, and the same break rule. Pinned on the variable the
  // cap reads — that is the half the conversation page had and this view did not, and a fixed cap only looked right at the
  // default content width.
  ['the user bubble is sized and set like the host’s own', () => bundle.includes('--dsh-chat-content-width')
    && bundle.includes('--dsh-content-font-delta')
    && bundle.includes('word-break:break-word')],
  // The tail-follow's own rule, in the module that states it: a scroll POSITION is not a takeover until the READER has
  // acted — an upward move counts, a downward one never does. Without it a long session opens at the TOP, because its
  // history arrives after the first paint and the mount's own position was read as the reader leaving the tail.
  ['a scroll position is not a takeover before the reader has acted', () => bundle.includes('scrollTakeover')
    && bundle.includes('isNearTail')],
  // 「跟随最新」 must not be gated on 动效. `motion` decides HOW the card follows (glide, or a direct jump when the reader
  // turns animation off); it is not "the feature is off". The reader found this by switching 动效 off to test scroll jank:
  // the follow silently stopped, and the pause/resume button disappeared with it. The assertion is the gate itself, whose
  // negated form is exactly the bug.
  ['the reasoning card follows whether or not animation is on', () =>
    bundle.includes('const allowed = following && active && !selected && reasoningMode !== "manual"')
    && !bundle.includes('const allowed = following && active && motion &&')],
  // The reading page's own message goes through this plugin's renderer, not the host's component. The host's `MarkdownText`
  // separates block children with newline text nodes, which is invisible where whitespace collapses and an anonymous LINE BOX
  // inside the user's bubble, whose CSS is `white-space: pre-wrap` (kept so the reader's own line breaks show). That is the
  // empty line the reader reported between their opening paragraph and their numbered list, and the `source === 'user'`
  // branch is what put the host's renderer on that path.
  ['the reader’s own message is rendered by this plugin’s renderer, not the host component', () =>
    bundle.includes('case "text": return ')
    && !bundle.includes('source === "user" ?')],
  // 「展开后底端对齐输入栏顶」: opening a card brings its bottom to the composer, ON by default. The write happens on the size
  // animation's own settle (the deadline covers the no-animation path), and it releases the page first — the reader's own move
  // must not be undone by the follower pulling back to the tail. The composer's seat is found by the host's own class
  // fragment, which is how the stylesheet names it too.
  ['opening a card lines its bottom up with the composer, once its new height is real', () =>
    bundle.includes('scroller.scrollTop += delta;')
    && bundle.includes('onLeaveTail();\n')
    && bundle.includes('"[class*=\\"_composerSeat\\"]"')
    // …and the two conditions the reader added afterwards: NOTHING moves when the card already fits where it is, and a move
    // that does happen is EASED (cubic ease-out over `DURATION`, from the scroller's own offset) instead of jumping. The
    // easing also gives the ordering asked for — open first, then line up — because it starts from the size animation's
    // settle rather than from the press.
    && bundle.includes('rect.top >= band.top && rect.bottom <= limit')
    && bundle.includes('scroller.scrollTop = from + delta * eased;')],
  // Reading INSIDE a card holds that place, so the PAGE stops following too — otherwise every change to the card's height
  // was absorbed by snapping the page to its bottom, and when the pin ended (returning to the bottom is what ends it) the
  // card gave up its focused height and the content was carried upward by that much. The reader: 「应该滑到哪里就是哪里，
  // 而不是还要被动上移一段」. The close button takes the same release, and both are pinned here.
  ['a card the reader reads inside releases the page, so no later resize drags them', () =>
    bundle.includes('if (pin) onLeaveTail();')
    && bundle.includes('onLeaveTail();\n')],
  // The fold to one line is a size change like opening the card, so it has to animate like one. The resize animation's ref
  // used to hold `expanded` alone, which meant a card folding when the focus ended switched to its one-line row in a single
  // frame — 「由大卡片变为一行折叠没有动画」. Both halves are pinned: the combined state, and the effect depending on `folded`.
  ['the fold to one line animates, because it is tracked as a size change beside the card being opened', () =>
    bundle.includes('const previousSize = (0, react.useRef)(`${String(expanded)}:${String(folded)}`)')
    && bundle.includes('const sizeState = `${String(expanded)}:${String(folded)}`;')],
  // A folded card is never the one the process shows as its NEWEST step, and that exclusion is what keeps 「焦点思考展开」 alive:
  // the fold requires `!focused`, so gating the focus REQUEST on `folded` means a folded card can never claim the focus — the
  // expansion silently stopped working the moment the fold switch was on, which the reader reported. Excluding `active`
  // settles both ends: the card being written into is never folded (so it takes the focus as before), and the COMPLETED cards
  // of the same process fold and take no part in the focus machinery — which is also what stopped the folded line flickering.
  ['a folded card is never the step the process shows as newest, which keeps 焦点思考展开 alive', () =>
    bundle.includes('const folded = fold && !expanded && !focused && !active;')
    && bundle.includes('if (expanded || !focusExpand) return;')],
  // Closing the card the reader is reading must not throw them to the newest line. The page's follow is only SUSPENDED while
  // a card holds the focus, so handing that focus back resumed it and the follower snapped the page down the instant 收起 was
  // pressed — the reader's 「点击收起似乎会立刻跳转到最新」. Closing is a decision to stop following, so it takes the same
  // release a rail jump takes, and it has to happen BEFORE the focus is handed back.
  ['closing the focused card releases the page instead of snapping it to the tail', () =>
    bundle.includes('onLeaveTail();')
    && bundle.includes('onLeaveTail,')
    // The JSX compiles to a props object, so the release is pinned there rather than as an attribute.
    && bundle.includes('onLeaveTail: scroll.release')],
  // A card the READER resizes must not have that growth compensated by the page. The reading view keeps the element the
  // reader is looking at fixed while text arrives on its own, which is right — but for a card the reader just opened it did
  // the opposite of what they asked: a card ABOVE that anchor was pushed off the top (it looked like it expanded upward)
  // while one below stayed put — 「靠上就向上扩张，靠下就向下扩张，应该统一向下」. The card publishes this marker for the length
  // of its own resize, and the compensation branch stands down while it is set, still re-capturing its anchor.
  ['a card the reader resizes stops the page from compensating that growth', () =>
    bundle.includes('root.setAttribute("data-reader-resizing", "")')
    // …and only for GROWTH: a negative delta is content above the anchor getting shorter, and compensating that pulled the page
    // UP under the reader — their own armed log showed `writeTop 1826 -> 1727 d=-99` coming from this very observer. What
    // shrinks while nothing streams is a skipped turn's placeholder swapping for its real height, which lands right after they
    // stop scrolling. 「应该滑到哪里就是哪里」 is the rule read literally: the scroll position they chose stands, and the content
    // may shift a little instead.
    && bundle.includes('!(content.querySelector("[data-reader-resizing]") !== null) && delta > .5) writeTop(')],
  // A markdown newline text node is invisible where whitespace collapses and a REAL line in the user's own bubble, whose
  // CSS is `white-space: pre-wrap`. The reader's report: ordered-list items gained a blank line between them in the reading
  // page and not on the conversation page. The renderer used to interleave `'\n'` between list items, after a trailing
  // non-paragraph, around block children, and after every `<br>` — all four are gone, and the two shapes here are the ones
  // that survive compilation as recognisable text.
  ['no markdown text node prints a newline where the bubble shows whitespace', () =>
    bundle.includes('case "break": return ')
    && !bundle.includes('jsx)("br", {}), "\\n"')
    && !bundle.includes('parts.push("\\n")')],
  // The reading view renders only what is near the viewport. The reader's evidence put the scroll cost on RENDERED volume
  // (folding off and everything drawn scrolls badly; folding on and little drawn is smooth), and the folding window cannot
  // cover the worst case — it hides OLDER turns, while a reader near the front is under pressure from the NEWER turns behind
  // them, which are never folded. `content-visibility: auto` skips layout and paint off screen in BOTH directions, and
  // `contain-intrinsic-size` keeps the scrollbar honest while a turn is skipped.
  ['the reading view renders only what is near the viewport', () =>
    // BLOCK axis only, and the shorthand is denied on purpose: `contain-intrinsic-size: auto 320px` takes one value and
    // applies it to BOTH axes, which gave every skipped turn an intrinsic WIDTH of 320px. Its contents laid out at that
    // width and the process toggle's header squeezed its title to nothing — the reader's "the toggle is truncated".
    // …and the turn carries 6px of CLIP TOLERANCE on the inline-start edge. Paint containment clips a descendant to the
    // PADDING box, and two rows inside every turn deliberately start 6px to the left (`.answerActions`, and the
    // `.disclosureButton` whose `margin-left: -6px` the reader asked to keep) so their hover plates line up with the body
    // text — the reader's report that the leftmost copy button's plate came out cut, which arrived with the viewport change
    // above. The padding moves the clip boundary out; the negative margin keeps every child exactly where it was.
    bundle.includes('content-visibility:auto;contain-intrinsic-block-size:auto 320px;margin-left:-6px;padding-left:6px}')
    && !bundle.includes('contain-intrinsic-size:auto 320px')
    // …with the LIVE turn exempt. `content-visibility` implies `contain: layout paint`, and the reasoning card follows
    // itself from INSIDE that subtree — it measures its own height, writes its inner scroller and drives a transform. The
    // reader reported 「跟随最新」 breaking right after the viewport change went in, and this exemption is the fix. The live
    // turn is on screen while it is written, so it was never a candidate for skipping.
    && bundle.includes('[data-live]{content-visibility:visible;contain-intrinsic-block-size:auto}')],
  // When the platform's prepend failure blocks the ordinary step, the view must SAY so and offer the one route the reader
  // found that gets past it — a jump at the far end of the log — with its cost named in the label. Kept separate from the
  // ordinary press on purpose: it fetches the whole history.
  ['a blocked history load is named, with the earliermost jump offered beside it', () =>
    bundle.includes('更早的记录暂时读不出来')
    && bundle.includes('一次性加载到最早')
    && bundle.includes('[dsh-better-display] load to earliest')],
  // …and when it runs, it must ask `loadThrough` BEFORE `loadOlder`. Measured from the reader's console: the platform's
  // "system-message withdrew materialized target" failure comes from `loadOlder`'s page shape and takes the event feed
  // subscriber with it, after which even `loadThrough` lands nothing. Calling `loadOlder` first is therefore self-poisoning,
  // and the order is the whole point — `loadThrough` pages at 200 messages, the shape the reader found working by hand.
  // Asserted on the FIRST occurrence of each prop name, which is the order in the click handler.
  ['the history step asks the jump loader before the paging one, so it cannot poison its own feed', () =>
    bundle.includes('[dsh-better-display] history step')
    && bundle.includes('olderHistoryState')
    && bundle.includes('已经是最早的记录')
    && bundle.indexOf('props.loadThrough') >= 0
    && bundle.indexOf('props.loadThrough') < bundle.indexOf('props.loadOlder')],
  // Pressing 「加载更早记录」 must REVEAL unconditionally, and claim only what the host STATES. The host's loader has silent
  // no-op paths (`hasMore` false, its re-entrancy flag, a generation that moved on) and the platform offers no window edge
  // to tell "landed" from "dropped": `SessionSnapshot` carries `hasMore`, `loadingOlder` and `openState` and nothing more.
  // Two progress proxies were tried and BOTH lied — a count of loaded turns (the host's turn navigation is windowed, so a
  // successful load left it unchanged) and `baseSeq` (not on the snapshot at all) — and the first version therefore told
  // the reader 「没能读到更早的记录」 while skipping the reveal, which is the reported 「卡住」. So the press reveals
  // regardless (a fetched page lands OUTSIDE the folding window and would otherwise stay hidden), only 「已经是最早」 is
  // ever said on screen, and the observable facts go to the console for the next report.
  ['older history is revealed on every press, and only the certain case is claimed', () => bundle.includes('olderHistoryState')
    && bundle.includes('已经是最早的记录')
    && bundle.includes('revealStepOf(foldWindow)')],
  // The rail's reading of "which turn am I on" must re-run when the RENDERED WINDOW changes, not only when a turn is added.
  // 自动折叠 hides and reveals rows without adding a turn, so the effect's cached row list went stale and the rail stopped
  // at the folded window's oldest turn — the reader's report, in their own numbers (a threshold of 3 leaves it on 倒数第 3).
  // Pinned on the dependency list itself, which is the invariant: these two are together the only things that can change
  // which rows exist.
  ['the rail’s turn spy re-runs when the folded window changes', () => bundle.includes('[turnSignature, renderedTurns]')
    && bundle.includes('observe(content)')],
  // A rail jump into a FOLDED turn must grow the window before it can land. The load succeeds — `loadThrough` brings the
  // records in — but landing means finding the row, and a turn the window hides has none, so the jump silently timed out.
  // That is the reader's "只能跳到已加载的地方", next to the conversation page's rail working: the host has no folding.
  ['a jump into a folded turn grows the window instead of timing out', () => bundle.includes('revealForTurn')
    && bundle.includes('hiddenTurnKeys.has(groups[targetIndex]')],
  // 「开始」 in the sidebar: when a deliverable opens into the column and the ONLY page there is the shipped guide, it is
  // REPLACED rather than left beside it — via `openResource(address, { replaceTab })`, the host's own "take this tab's
  // place and close it in the same step". The guide is identified by the identity the sidebar package publishes
  // (`GUIDE_ID`), and `close()` is deliberately not used: a sole guide is documented to stay open.
  ['the sidebar opening replaces a lone 「开始」 guide, by the kind its tab actually carries', () => bundle.includes('kind === "guide"')
    && bundle.includes('replaceableGuide')
    && bundle.includes('replaceTab')],
  // The host's `turn-trigger` record — the notification that woke the turn up (a goal continuing, a webhook, a job…).
  // The conversation page renders it as `TurnTriggerNodeView`; the reading view answered 「此记录类型暂未接入阅读页」.
  // The component is not exported, so the reading view mirrors it, and what it mirrors is pinned here: the row's own
  // hook, the dispatch, the title table (one string the reader's screenshot named) and two of the ten icons that come
  // from the same primitives package the host imports them from.
  ['the reading view renders the host’s turn-trigger record instead of a “not connected” notice', () => bundle.includes('data-reader-turn-trigger')
    && bundle.includes('isNode(node, "turn-trigger")')
    && bundle.includes('turnTriggerReading(data.source)')
    && bundle.includes('继续执行目标')
    && bundle.includes('IconGoalOutlineRegular')
    && bundle.includes('IconCordisPluginOutlineRegular')],
  // Which rule reads which variable is pinned rule by rule in `wallpaper-scope.test.ts` (a regex over a minified
  // bundle cannot say it reliably); what is asserted here is that both dials and both variables survive.
  ['the chrome scrim has one dial per surface', () => {
    // The top bar's own rules, cut out of the SOURCE FORM the bundle carries (every line of `windowScopeCss` is a
    // template literal, and the declaration `background-image: ${scrim(…)}` has a `}` of its own — so a `{…}`-shaped
    // regex cannot span these rules). The slice runs from the `${SCOPED} *:has(…)` line to the line that closes the
    // rule; the comment that explains this hook higher up spells the selector WITHOUT the `${SCOPED} ` prefix, so this
    // anchor is unambiguous.
    const sliceFrom = (anchor) => {
      const start = bundle.indexOf(anchor);
      const end = start === -1 ? -1 : bundle.indexOf('`}`,', start);
      return start === -1 || end === -1 ? '' : bundle.slice(start, end);
    };
    const bar = sliceFrom('${SCOPED} *:has(> [data-conversation-header-leading]),');
    const frost = sliceFrom('${SCOPED} *:has(> [data-conversation-header-leading])::before,');
    return bundle.includes('"data-ud-check": "reader-settings-wallpaper-chrome-sidebar"')
      && bundle.includes('"data-ud-check": "reader-settings-wallpaper-chrome-header"')
      && bundle.includes('--viewtune-wallpaper-chrome-sidebar')
      && bundle.includes('--viewtune-wallpaper-chrome-header')
      // The bar itself must NOT be a backdrop root or a stacking context of its own: the host mounts its own INLINE
      // popovers here (the 「后台任务」 panel anchors to its own `.QsffPG_root{position:relative}` and carries
      // `z-index:100`, plate `--dsw-specific-menu` + `backdrop-filter: var(--dsw-menu-backdrop-filter)` — the same
      // plate as 「子智能体」, which escapes all of this only by being PORTALED). A `backdrop-filter` on the bar killed
      // that panel's own blur (text overlapping what showed through) and confined its `z-index:100`, so the reading
      // view's sticky lane (`z-index:11`) covered and blurred it. So: `isolation` + `z-index: 12` on the bar, the frost
      // on a `::before` behind the bar's content, and no filter on the bar.
      && bar.includes('isolation: isolate;')
      && bar.includes('z-index: 12;')
      && !bar.includes('backdrop-filter')
      && frost.includes('z-index: -1;')
      && frost.includes('backdrop-filter: blur(var(${CHROME_HEADER_BLUR_VARIABLE}));');
  }],
  ['the window backdrop is gated, and every copy of the IMAGE is viewport-anchored', () => {
    const images = (bundle.match(/var\(--viewtune-wallpaper-image\)/g) ?? []).length;
    const anchored = (bundle.match(/\$\{FIXED\}/g) ?? []).length;
    return bundle.includes('"data-viewtune-wallpaper"')
      && bundle.includes('="window"]')
      // Every anchored rule carries a copy — and the chrome's scrim-only rule is deliberately NOT anchored:
      // attachment:fixed only ever lines an image up with the viewport, and on a flat colour it buys nothing
      // while putting the paint in the compositor, which is where the reader's missing-scrim bug lived. A
      // relation, not a count: adding a carrier must not be able to pass by quietly adjusting two numbers.
      // (A fixed-position ELEMENT carrying a copy briefly lived here; it is gone again — see the note its rule left
      // behind in wallpaper-scope.ts.)
      && images === anchored
      // The token's name lives in a constant and is interpolated into its rule, so the bundle has the
      // declaration rather than a spelled-out declaration line.
      && bundle.includes('const SIDEBAR_FILL = "--dsw-specific-sidebar-fill"')
      // The chrome is named in BOTH platform generations. 0.1.5's direct-child test is kept (harmless, and it
      // holds there); 0.2.0 needs the published hook, because it moved the title row behind the
      // `conversation.session.header` slot — which is exactly how the top bar lost its scrim silently.
      && bundle.includes('[class*="_header"]:has(> [class*="_titleRow"])')
      && bundle.includes('*:has(> [data-conversation-header-leading])')
      // …and the Windows title-bar strip, which the layout paints above the frame from the token this file makes
      // transparent: chrome, so it carries the chrome scrim.
      && bundle.includes('[data-windows-titlebar] *:has(> [class*="_sidebarCol"])::before');
  }],
  // The conversation column BELOW the header belongs to the reading view in either scope. Gating the
  // scroller, the gutter or the composer's fade band on the window scope is exactly what left two black
  // blocks around the input box while the whole-window switch was off, so the gate they use is pinned.
  ['the column below the header follows the wallpaper in either scope', () =>
    // The declaration is pinned WITH its template opening, because `const SCOPED_ANY` is a substring of
    // `const SCOPED_ANYX` — the first cut of this line passed after that rename, which is the same
    // substring trap a marker of mine fell into once before.
    bundle.includes('const SCOPED_ANY = `html[')
    && bundle.includes('${SCOPED_ANY} [class*="_scrollBody"]')
    && bundle.includes('${SCOPED_ANY} [class*="_composerSeat"]')
    ],
  // The image's size and place are MEASURED (view scope fits the reading page by the min ratio, never
  // enlarging) and published, so every copy has to read the same conversion. A regression to a bare
  // `cover` re-crops the picture on a page-shaped area — which the reader reported at once as "the
  // wallpaper is not all there" — and a copy that stops reading the measured values stops lining up
  // with the others.
  ['the image copies read the measured size and place', () =>
    bundle.includes('background-size: cover, var(--viewtune-wallpaper-size, cover) !important;')
    && bundle.includes('background-position: center, var(--viewtune-wallpaper-position, center) !important;')
    && bundle.includes('wallpaperGeometry(')
    && bundle.includes('--viewtune-wallpaper-size')],
  ['the trajectory page keeps its own single-number fade', () =>
    bundle.includes(`[class*="_scrollBody"]:has([data-trajectory-scroll]) [class*="_composerSeat"]::before`)
    && bundle.includes('mask-image: linear-gradient(180deg, transparent 0px, #000 var(--viewtune-trajectory-fade-lift, 36px)) !important;')],
  // The composer's fade band: the host's opaque gradient is dropped, and the fade becomes a mask over a
  // pseudo-element's copy of the backdrop — LIFTED over the seat's box by the same one number the conversation and
  // trajectory bands use, so all three pages ramp over the same strip above the composer. Pinned because every part
  // of it was wrong once on screen: a mask on the SEAT masks its subtree and hid the composer card inside it, a copy
  // without `!important` geometry lost to the host's shorthand and tiled as small wallpapers, and this band alone
  // started at `inset: 0`, which sat the reading view's fade a full lift lower than the other two pages' (reported).
  ['the composer fade is a lifted mask on a pseudo-element, not a slab', () =>
    bundle.includes('[class*="_composerSeat"] { background-image: none !important;')
    && bundle.includes('--viewtune-wallpaper-fade-lift: 36px;')
    && bundle.includes('--viewtune-wallpaper-fade-ramp: 20px;')
    && bundle.includes('[class*="_composerSeat"]::before')
    && bundle.includes('inset: calc(-1 * var(--viewtune-wallpaper-fade-lift, 36px)) 0 0 0 !important;')
    // The ramp ENDS at the lift and its length is the second number, so "fade faster" is one value and the point
    // where the text is gone cannot move with it.
    && bundle.includes('mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-wallpaper-fade-lift, 36px) - var(--viewtune-wallpaper-fade-ramp, 20px)), #000 var(--viewtune-wallpaper-fade-lift, 36px))')
    && bundle.includes('background-repeat: no-repeat !important')],
  // The token must be overridden on `body`, not only inherited from the root: the theme defines it in
  // its own `body{…}` block, and a definition on an element beats an inherited value. Overriding only
  // the root left the whole left column opaque — the first thing the reader reported.
  ['the left column token is overridden on body too', () =>
    bundle.includes('${SCOPED} body { ${SIDEBAR_FILL}: transparent !important; }')],
  // The theme leaves the scrollbar track transparent, so over a wallpaper the gutter read as a hole of
  // a different colour beside everything else. It now carries the same backdrop.
  ['the scrollbar gutter carries the backdrop instead of a hole', () =>
    bundle.includes('::-webkit-scrollbar-track') && bundle.includes('::-webkit-scrollbar-corner')],
  // …and the composer's own slot is the one that gets ROUNDED ends: a short strip beside the field reads as another
  // widget when it ends square next to the host's pill-shaped thumb. Scoped through the composer, so the transcript's
  // lane keeps the square edges that let it meet the surfaces it sits between, and the thumb stays the host's own pill.
  ['the composer\'s scroll slot has rounded ends, and only its', () =>
    bundle.includes('[class*="composer" i] [class*="_scroll"]::-webkit-scrollbar-track { border-radius: 999px !important; }')],
  // The tool cards' payload boxes — the 「输入」/「结构」/「原始数据」 panes under Edit, Pwsh, Search and Read — are OUR
  // markup, and they were the one code-shaped surface the skin never reached (opaque `bg-module-platform`, no glass
  // rule). They ride the CODE dial, like the fenced blocks, because that is what the reader calls them: 代码框.
  ['the tool cards\' payload boxes take the skin too', () =>
    /_toolRaw\{background:color-mix\(in srgb,\s*var\(--dsw-alias-bg-module-platform[^}]*var\(--glass-code/.test(bundle)],
  // …and so do the HOST's primitive blocks, which is what the 「结构」/「Pwsh」/Edit's 「输入」 panes really are: five
  // hashed classes that all paint `--dsw-alias-markdown-code-block` (header rows `…-banner`), plus JsonTree, which
  // paints the core layer colour. Naming a class is impossible, so the dial goes on the TOKENS — scoped to this
  // view's root, the same technique the conversation page uses on its own column. One probe per fact: the first fix
  // here targeted `.toolRaw` alone, which is only the 「原始数据」 box, and the reader saw no change in the other five.
  ['the host primitive code blocks take the code dial', () =>
    /\[data-reader-glass\]\{--dsw-alias-markdown-code-block:color-mix\(in srgb,\s*var\(--viewtune-code-plate/.test(bundle)
    && /--dsw-alias-markdown-code-block-banner:color-mix\(in srgb,\s*var\(--viewtune-code-banner/.test(bundle)],
  ['…and the JSON pane\'s layer colour, scoped to the tool content', () =>
    // `[^}]*` because this rule now also carries the code tokens' snapshots — same element, same reason, more values.
    /body\{--viewtune-layer-plate:var\(--dsw-alias-bg-layer-1\)[^}]*\}/.test(bundle)
    && /--dsw-alias-bg-layer-1:color-mix\(in srgb,\s*var\(--viewtune-layer-plate/.test(bundle)],
  // …and the code plate's base is snapshotted on that same body rule. The reader reported one code card in two different
  // colours across the two views; the reading view read `--viewtune-code-plate` in its redefinition but never defined it,
  // so every rule fell through to a hard-coded, theme-independent fallback. The snapshot must sit on a DIFFERENT element
  // from the redefinition, or the definition would refer to itself — hence body. The `body{…}` anchor is what makes this
  // probe specific to this view: the conversation page snapshots the same pair onto its own column, not onto body.
  ['…and the code plate’s base is snapshotted there too', () =>
    /body\{[^}]*--viewtune-code-plate:var\(--dsw-alias-markdown-code-block\)/.test(bundle)
    && /body\{[^}]*--viewtune-code-banner:var\(--dsw-alias-markdown-code-block-banner\)/.test(bundle)],
  // The transcript's own lane carries the same radius now, so the groove is one shape wherever it appears: with the
  // host's 2px inset gone, the radius is what makes it a bar instead of a strip stopping dead at the surfaces above
  // and below it. Its `margin: 0` is part of the same rule and asserted with it.
  ['the transcript lane\'s scroll slot is rounded like the short ones', () =>
    bundle.includes('[class*="_scrollBody"]::-webkit-scrollbar-track { margin: 0 !important; border-radius: 999px !important; }')],
  // …and the settings panel's slot, which is the other short strip in the reader: same radius, same reason. It is the
  // panel's BODY that scrolls (the tabs are pinned above it), so that is the element the rule names.
  ['the settings panel\'s scroll slot has rounded ends too', () =>
    /_settingsBody::-webkit-scrollbar-track\{border-radius:999px!important\}/.test(bundle)],
  ['the reading view steps aside while the scope is the window', () =>
    bundle.includes('"data-reader-wallpaper": wallpaperName === "" || windowScope')],
  // The compaction divider arrives rather than appearing: three animations, on the line (whose rules
  // sweep with it), the pill and the dial. Names go through the keyframe helper because lightningcss
  // re-hashes them; the selectors go through the class helper for the same reason.
  //
  // The gate is the part worth pinning. It must keep the SAME animation and shorten it to nothing —
  // `animation: none` would start the arrival the moment the gate lifted, replaying a divider that
  // had been on screen for a minute. The emitted shorthand drops the `0s` (it is the default), so
  // "zeroed" looks like an animation shorthand with no duration, and `none` is what must not appear.
  ['the compaction divider arrives, and the motion switch zeroes it rather than canceling it', () => {
    const line = classSel(readerCss, 'compactionLine');
    const pill = classSel(readerCss, 'compactionPill');
    const dial = classSel(readerCss, 'compactionIcon');
    const names = ['compactionLineIn', 'compactionPillIn', 'compactionDial'].map(name => keyframeOf(readerCss, name));
    if (names.some(name => name === '')) return false;
    // The arrival rule itself, not the gated copy of it: the gate carries the same class and keyframe
    // name, so a looser match would be satisfied by the gate alone — which is how a first cut of this
    // marker passed with the arrival deleted. Between the previous rule's `}` and the selector there
    // must be no brackets, which is exactly what the `[data-motion=off]` prefix is made of.
    const arrives = (selector, name) =>
      new RegExp(`(?:^|[;}])[^{}\\[\\]]*${selector}\\{animation:[^}]*${name}`).test(readerCss);
    const arrivals = arrives(line, names[0]) && arrives(pill, names[1]) && arrives(dial, names[2]);
    const zeroed = new RegExp(`\\[data-motion=off\\][^{}]*${line}\\{animation:(?!none)[^}]*${names[0]}`).test(readerCss);
    const system = new RegExp(`@media \\(prefers-reduced-motion:reduce\\)\\{[^@]*${line}[^@]*\\{animation:none`).test(readerCss);
    return arrivals && zeroed && system;
  }],
  // The changed-line counts a tool row carries, and the two rules that keep them honest: only a tool
  // that mutates a file may read its own arguments as a diff (several unrelated tools carry a field
  // named `content`, and counting those would invent additions for calls that changed nothing), and a
  // parent call reports what its children changed rather than what its own arguments contain. The
  // whitelist is pinned as the emitted set literal because it IS the rule — a name dropped from it
  // silently re-enables the invented counts.
  ['a changed call carries its line counts', '"diffStatButton"'],
  ['only file-mutating tools may count their own arguments', () =>
    /DIFF_MUTATION_TOOLS = \/\* @__PURE__ \*\/ new Set\(\[\s*"write",\s*"edit",\s*"str_replace_editor"/.test(bundle)],
  ['a parent call folds its children’s changed files in', 'callDiffHunks(child, identity.name, inputFields(identity.raw))'],
  ['the counts open a per-file diff surface', () => /"diffScrollArea"/.test(bundle) && /"diffTab"/.test(bundle)],
  // The frosted-glass skin: a root attribute the settings panel sets, and the two declarations that
  // make it a skin rather than a recolour — the sticky lane paints no plate of its own, and the
  // reader's own bubble becomes translucent with a real blur behind it. A "glass mode" that only
  // changed colours would pass a screenshot and fail these.
  ['the glass skin is a root attribute', '"data-reader-glass": glassPreference'],
  ['the settings panel offers the skin', '"data-ud-check": "reader-settings-glass"'],
  ['the skin takes the chrome away instead of recolouring it', () =>
    // The lane mixes its own colour against transparency through the reader's dial — not a recolour,
    // and not the minifier's `background:0 0` either, now that the opacity is a variable.
    /\[data-reader-glass\][^{]*_toolbar\{[^}]*background:color-mix\(in srgb,\s*var\(--dsw-alias-bg-base\)\s*var\(--glass-lane/.test(readerCss)
    && /\[data-reader-glass\][^{]*_user\{[^}]*backdrop-filter/.test(readerCss)],
  // Every surface the skin touches reads its own dial, and every dial is one the settings panel can
  // move: the property names in the stylesheet and in the part table are the same six strings, so a
  // surface wired to a property no row writes (or a row writing one no surface reads) fails here.
  ['every adjustable surface reads its own dial', () => {
    // Searched across the WHOLE bundle, not the reading view's literal: the gutter's groove lives in
    // its own always-installed stylesheet, because the element it styles is not inside this view.
    // The FROST family is excluded here and has its own marker below: these nine are the TINTS, while a frost
    // property is spelled `--glass-blur-<part>` — which this regex reads as the single name `--glass-blur`.
    const props = [...bundle.matchAll(/var\((--glass-(?!blur)[a-z]+)/g)].map(match => match[1]);
    return new Set(props).size === 9
      && ['--glass-lane', '--glass-user', '--glass-card', '--glass-code', '--glass-diff', '--glass-chip', '--glass-scrollbar', '--glass-pill', '--glass-input']
        .every(name => props.includes(name) && bundle.includes(`"${name}"`));
  }],
  // …and the same coupling for the FROST: one property per surface that can carry a `backdrop-filter`, read by a
  // stylesheet and written by the part table, so a surface whose frost no row can move (or a row whose property no
  // stylesheet reads) fails here. Two deliberate absences, both asserted rather than assumed: 「滚动条槽位」 has no
  // frost at all (a scrollbar pseudo-element cannot carry the property, and a row that moved nothing would be worse
  // than no row), and the two SCRIMS are not glass parts — they are named for their surface and live in
  // wallpaper-scope.ts, so they are checked by name here instead of by the table.
  ['every surface that can be frosted has its own blur dial', () => {
    const props = [...bundle.matchAll(/var\((--glass-blur-[a-z]+)/g)].map(match => match[1]);
    const frosted = ['lane', 'user', 'card', 'code', 'diff', 'chip', 'pill', 'input'];
    return new Set(props).size === frosted.length
      && frosted.every(id => props.includes(`--glass-blur-${id}`) && bundle.includes(`"--glass-blur-${id}"`))
      && !bundle.includes('--glass-blur-scrollbar')
      // …and the frost is read with NO fallback, which is what makes an unwritten property mean `none` rather than a
      // blur nobody asked for — the whole reason a dial at 0 is left out instead of written as `0px`.
      && /blur\(var\(--glass-blur-card\)\)/.test(bundle)
      && bundle.includes('--viewtune-wallpaper-chrome-sidebar-blur')
      && bundle.includes('--viewtune-wallpaper-chrome-header-blur')
      // …and every scrim rule reads it through `var(…)`. Pinned because getting it wrong is invisible in the source
      // and fatal in the artifact: `blur(${VAR})` interpolates to `blur(--viewtune-…)`, which is not a length, so the
      // declaration is dropped and the dial moves nothing — which is exactly how the two scrim frosts shipped dead.
      && bundle.includes('blur(var(${CHROME_SIDEBAR_BLUR_VARIABLE}))')
      && bundle.includes('blur(var(${CHROME_HEADER_BLUR_VARIABLE}))')
      && !bundle.includes('blur(${CHROME_SIDEBAR_BLUR_VARIABLE})')
      && !bundle.includes('blur(${CHROME_HEADER_BLUR_VARIABLE})');
  }],
  // The frost's declaration ORDER in the reading view's stylesheet is a correctness property, not a style one: the
  // build's CSS pipeline de-duplicates `backdrop-filter` against its `-webkit-` twin and keeps the LAST declaration,
  // so the standard property has to be written second or the shipped rule carries only the prefixed one — which is
  // the state in which the reader saw frosted conversation cards and a dead reading view. Pinned by shape, per
  // surface, against the MINIFIED stylesheet the view actually loads.
  ['the reading view ships the STANDARD backdrop-filter, not a lone -webkit- prefix', () => {
    // The surfaces whose rule lives in this view's own stylesheet…
    const surfaces = ['lane', 'user', 'card', 'code', 'diff', 'chip'];
    return surfaces.every(id => new RegExp(`backdrop-filter:blur\\(var\\(--glass-blur-${id}\\)\\)`).test(readerCss))
      // …and the pill, whose rule ships from TurnMetrics.module.css — a different module, so a different stylesheet,
      // and the same order rule applies to it (it is not in `readerCss` at all).
      && /backdrop-filter:blur\(var\(--glass-blur-pill\)\)/.test(bundle)
      // …and the prefixed twin is what the pipeline dropped, so it is absent rather than merely later.
      && !/-webkit-backdrop-filter:blur\(var\(--glass-blur-card\)\)/.test(readerCss)
      // …while the plain sheets, which the pipeline never sees, still carry both spellings.
      && /-webkit-backdrop-filter: blur\(var\(--glass-blur-card\)\)/.test(bundle);
  }],
  // Three surfaces the skin shipped without, each on the dial it was decided to belong to. They are one
  // marker because they are one mistake — a plate that kept its base look through the skin — and each
  // half is asserted separately so a fix that covers two of them still fails here.
  //   - the code block's HEADER ROW: the block was already on 代码块, but its banner is a plate of its
  //     own, so a translucent block still wore an opaque bar across its top;
  //   - the JSON record cards (see JsonRecord): the host primitive's plates wear hashed names, so the
  //     wrapper this view adds is the ONLY handle, and it rides 卡片与面板;
  //   - the two counting pills (用量 / … 个步骤): they carry a plate in the base look, and now carry a
  //     dial of their own rather than sharing 产物标签 with the per-turn deliverable chips.
  ['the skin reaches every code surface, the JSON cards and the counting pills', () =>
    // The code block's header row, next to the block's own rule in the reading view's stylesheet. It is
    // TWO plates there — an opaque sticky wrap and the banner inside it — so the assertion is on both:
    // the wrap must stop painting the theme's background, and the banner's OWN token must be re-stated
    // through the code dial. Painting only the wrap is the version that shipped and changed nothing.
    // …and both spellings of a cleared background are accepted: lightningcss writes `transparent` as
    // `#0000`, and pinning the minifier's choice here would fail on a version bump for no reason.
    /\.md-code-block>:first-child\{background-color:(?:transparent|#0000)\}/.test(readerCss)
    // The block's BODY plate too. A fence with no language renders its body as a `<pre>` that paints
    // `--dsl-code-block-background` itself (`.shiki` does it with `!important`), so clearing only the
    // outer div left that fence a solid slab with the dialled plate hidden behind it.
    // Three spellings of the same clearing are accepted (`transparent`, `#0000`, and the `0 0` the
    // minifier puts in a `background` shorthand): pinning one of them only makes a version bump look
    // like a regression.
    && /\.md-code-block pre\{background:(?:transparent|#0000|0 0)\s*!important\}/.test(readerCss)
    // The banner's own token, from the SNAPSHOT — the same correction the block's plate needed: this token has already been
    // dialled once by the redefinition, and mixing it again would leave the base at a fraction of the intended tint (that
    // is what made this view's code card lighter than the conversation page's).
    && /--dsl-code-block-banner-background-color:color-mix\(in srgb,\s*var\(--viewtune-code-banner[^}]*var\(--glass-code/.test(readerCss)
    // The JSON record cards: our wrapper, and both of the primitive's plates inside it.
    && /_jsonCard (?:button|pre)\{background:color-mix\(in srgb,\s*var\(--dsw-alias-(?:bg-module-platform|markdown-code-block)/.test(readerCss)
    && bundle.includes('"jsonCard"')
    // The counting pills live in THEIR OWN module, so this one is asserted against the whole bundle.
    && /_pillButton\{background:color-mix\(in srgb,\s*var\(--dsw-alias-bg-module-platform\)\s*var\(--glass-pill/.test(bundle)
    // …and inline code, which is the same KIND of paper as a fenced block even though the theme gives it
    // its own token and its own module. It rides the code dial for the reason the diff dial covers every
    // piece of diff paper: one kind of surface, one control.
    && /:not\(pre\)>code\{background-color:color-mix\(in srgb,\s*var\(--dsw-alias-markdown-inline-code\)\s*var\(--glass-code/.test(bundle)],
  // The gutter's groove: it reads the dial, falls back to the host's own transparent track, and keeps
  // the wallpaper's scrim and image in ONE stack with it — the gutter is the only surface where the
  // groove and the wallpaper have to compose rather than sit in separate rules.
  ['the scrollbar groove is dialled and still follows the wallpaper', () =>
    // The groove layer reads the DIAL itself, with the host's transparent track as its floor, and the
    // wallpaper's two layers ride in the same stack — the fallbacks (0% and none) are what keep a
    // gutter with no wallpaper identical to the host's own.
    bundle.includes('var(--glass-scrollbar, 0%)')
    // The lane fills the host's whole column. The host insets this track by 2px on ALL FOUR sides, and
    // that inset is exactly the gap a reader reported: 2px of backdrop above the groove (before the top
    // bar's bottom border), beside it (before the toolbar's right edge) and inside the window's own right
    // edge. Measured off a screenshot of the running app, then reproduced in a rendered fixture. The radius rides on
    // the same rule, because the two are one decision about the lane's shape.
    && bundle.includes('::-webkit-scrollbar-track { margin: 0 !important; border-radius: 999px !important; }')
    && bundle.includes('var(--viewtune-wallpaper-image, none)')
    && bundle.includes('var(--viewtune-wallpaper-dim, 0%)')
    && bundle.includes('const SCROLLBAR_FILL_VARIABLE = "--glass-scrollbar"')],
  // …and its own shape, restated here as the flat-colour floor: every track gets the groove as ONE colour, and only
  // the lane composes the wallpaper into it. A card's inner scroller used to get the wallpaper as a `fixed` background
  // too — and a card with a `backdrop-filter` (the skin's cards have one) becomes its containing block, so the copy
  // sampled the wrong patch and showed as a slab of another colour down an opened tool card's edge until it repainted
  // (reported). The lane keeps the stack, because that gutter really does sit on the wallpaper.
  ['the groove is one flat colour everywhere except the lane', () =>
    bundle.includes('background-color: color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--glass-scrollbar, 0%), transparent) !important;')
    && bundle.includes('[class*="_scrollBody"]::-webkit-scrollbar-track,')
    && bundle.includes('var(--viewtune-wallpaper-image, none)')
    && bundle.includes('background-attachment: fixed !important;')],
  // …and in the LANE the dial is a LAYER, the first of three: a `background-color` sits under every image, so leaving
  // the groove's colour to the flat rule hid it behind the opaque wallpaper copy and the slot read as missing
  // (reported). The three sizes are asserted as the shape that says "three layers", and the dial comes before the
  // image in the one string the background-image is built from.
  ['the lane stacks the dial over the wallpaper', () =>
    bundle.includes('linear-gradient(color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--glass-scrollbar, 0%), transparent),')
    && bundle.includes('background-size: cover, cover, var(--viewtune-wallpaper-size, cover) !important;')],
  // The host's trajectory view is a SOLID page, and it shares the conversation column and the composer
  // seat with every other view, so the wallpaper leaked beside its opaque table: a dimmed strip down the
  // right edge (the scroller's stable gutter, which the gutter's groove paints) and the session-stats
  // band under the composer. Measured off a screenshot of the running app first, then fixed in one rule:
  // every surface under this column reads these names, and a pseudo-element inherits them from its
  // originating element, so withdrawing them takes the image out of the column, the groove and the seat
  // at once. Scoped by the page's own marker — every other view keeps its wallpaper.
  ['the trajectory page sits on the base colour instead of the wallpaper', () =>
    bundle.includes('[class*="_scrollBody"]:has([data-trajectory-scroll])')
    && bundle.includes('background-color: var(--dsw-alias-bg-base) !important;')
    && bundle.includes('--viewtune-wallpaper-image: none;')
    && bundle.includes('--viewtune-wallpaper-dim: 0%;')
    // …and the fade survives the swap. The band above the composer IS our masked pseudo-element, so
    // withdrawing the image left it painting nothing and the page met the composer with a hard edge.
    // Two things are this page's own, and both were measured off the running app:
    //   - the COLOUR is the surface the page is made of (bg-layer-1), never a slab of another shade —
    //     in the light theme bg-base and bg-layer-1 are the same colour, so only the dark theme showed
    //     the band as a bar of its own colour;
    //   - the band is LIFTED above the seat, so the ramp covers the last rows instead of beginning at
    //     the composer's edge. The lift is one variable, so tuning it does not touch this marker.
    // Scoped to THIS page: everywhere else the band fades in the wallpaper, which is the point of it.
    && bundle.includes(':has([data-trajectory-scroll]) [class*="_composerSeat"]::before')
    && bundle.includes('inset: calc(-1 * var(--viewtune-trajectory-fade-lift)) 0 0 0 !important;')
    && bundle.includes('background-color: var(--dsw-alias-bg-layer-1) !important;')],
  ['the skin has a settings row per dial', '"data-ud-check": `reader-settings-glass-${part.id}`'],
  // The reader's settings are copied to the HOST, because the browser's own copy cannot survive a
  // restart: the store persists to localStorage, which is keyed by ORIGIN, and this GUI is served on an
  // ephemeral port — so every launch was a new origin with an empty store. Reported as "every time I
  // quit DSH, all of viewtune's settings are reset". What is pinned here is the CLIENT's end of it: it
  // reads the record at startup, writes it back when changes settle, and flushes on the way out (a
  // reader who closes the tab inside the debounce window must not lose the change they just made). The
  // host's end lives in `lib/dsh-viewtune.js` and is covered by tests/viewtune-settings.test.ts.
  ['the settings have a copy on the host, which is the one that survives a restart', () =>
    bundle.includes('"/better-display/settings"')
    && bundle.includes('method: "PUT"')
    && bundle.includes('"pagehide"')],
  // …and the app-wide half of the backdrop is published by the PLUGIN, not by the reading view. A new
  // session opens on the host's conversation view, where the reading view is not mounted, so everything
  // that view used to publish — the wallpaper on `<html>`, the groove's dial — was missing until an
  // older conversation was opened: reported as "a new session does not apply the saved settings". The
  // effect is installed from `apply`, which is exactly what makes it independent of the view.
  ['the backdrop is published for the whole app, not by the reading view alone', () =>
    bundle.includes('"dsh-viewtune: app-wide backdrop"')],
  // The skin's reach into the HOST's conversation page: an always-installed stylesheet (the elements are
  // outside this view, so nothing scoped to the view could match) switched on by an attribute on `<html>`,
  // exactly like the wallpaper's own gate. Three things are pinned: the attribute, the effect that installs
  // it, and that the page reads only the two dials it has any business painting — code paper and the user's
  // bubble. A third would be this plugin repainting something nobody asked it to.
  ['the skin reaches the conversation page only while both switches say so', () =>
    bundle.includes('"data-viewtune-conversation-glass"')
    && bundle.includes('"dsh-viewtune: conversation glass"')
    && bundle.includes('["--glass-code", "code"]')
    && bundle.includes('["--glass-diff", "diff"]')
    && bundle.includes('["--glass-user", "user"]')
    && bundle.includes('[class*="_bubble"]')
    // The page is dialled through the TOKENS the host's components paint from, not through a list of
    // their hashed classes — a fence in a message is `.md-code-block`, a tool's result card is not, and
    // the tool cards are most of what a conversation shows. A cycle is what a token cannot be dialled
    // with, so the value is snapshotted on `body` first.
    && bundle.includes('--viewtune-code-plate: var(--dsw-alias-markdown-code-block)')
    && bundle.includes('--viewtune-inline-code: var(--dsw-alias-markdown-inline-code)')
    // …and the scope excludes the READING view, which publishes the same `data-chat-flow` on purpose.
    && bundle.includes('data-dsh-better-display] *)')
    // The banner row is two plates: the token override reaches the banner itself, and the sticky wrap over
    // it paints the theme's own background — not a code token — so it is cleared by the same first-child
    // handle the reading view needed for the same primitive. The spaced spelling is the SOURCE text: the
    // built reading-view CSS is minified, so this can only be the conversation module's own line.
    && bundle.includes('.md-code-block > :first-child {')
    // …and the diff paper keeps the DIFF dial, not the code one, in both views.
    && bundle.includes('var(--viewtune-code-plate, transparent) var(--glass-diff')
    // Both switches, in one expression: see conversationGlassOf.
    &&/record\?\.glass === true && record\?\.glassConversation === true/.test(bundle)],
  // …and the two surfaces 0.2.0 added, or that the earlier skin simply never reached: the 「已编辑 x 个文件」 card
  // every answer body now ends with (it paints from a LAYER token, so none of the dials above touched it) and the
  // host's own 「回到底部」 button (it paints from --dsw-alias-button-floating-fill — 「一直没加上」). Both are dialled
  // by NAME — a published attribute for the card, the local class name for the button, since the host publishes none
  // — rather than by sweeping a layer token that half the page paints from.
  ['…and the changed-files card and the host’s to-bottom button are dialled by name', () =>
    bundle.includes('[data-changed-files]')
    && bundle.includes('--viewtune-layer-plate: var(--dsw-alias-bg-layer-1)')
    // The card's hover DETAIL is handed to the primitives' HoverCard, which PORTALS it to the body: the rule is
    // gated but not scoped to the column, and it names both candidate boxes because the plate is on the hook's own
    // element or on its container — the hook is the part that is certain.
    && bundle.includes('[data-changes-hover-preview]')
    && bundle.includes('*:has(> [data-changes-hover-preview])')
    // …and the button carries our own pill's floor, so the dial can never hide an affordance the reader needs.
    && bundle.includes('button[class*="_toBottom"]')
    && bundle.includes('max(var(--glass-lane, 20%), 20%)')
    // …and the host's 「思考」 row, which paints itself opaque from the theme's BASE colour once its group is expanded
    // (a sticky covering plate, like the code block's banner wrap): dialled on the card family it belongs to.
    && bundle.includes('[data-expanded] [data-open] [data-disclosure-row]')
    // The card's HEADER is the half that stayed solid: it paints from a STATIC neutral the host hands down as
    // `--changes-fill` — theme-independent, so no token of ours could ever reach it. Read on the bar (where the card's
    // value is inherited), written as a background: read, not redefined, so it is not the cycle the snapshot avoids.
    && bundle.includes('[data-changed-files] [class*="_header"]')
    && bundle.includes('var(--changes-fill, var(--viewtune-layer-plate, transparent))')
    // …and the PER-FILE 产物 cards, the other card the host renders in that same spot. The reader asked whether they
    // follow the diff dial; they did not, because the host paints them from a STATIC neutral (`--deliverable-fill`,
    // themed by an attribute rather than by a token), so the dial is applied by READING that variable on the card — the
    // header's construction — instead of by sweeping a token that no sweep could match.
    && bundle.includes('[data-presented-file]')
    && bundle.includes('var(--deliverable-fill, var(--viewtune-layer-plate')
    // …and the diff paper's ROWS are four plates of their own, none of which anything here dialled: the reader's
    // 「增减的绿红底色还是不透明」. All four ride the DIFF dial, like the paper itself — in the column, and again on the
    // portaled detail, which a column-scoped token override cannot reach.
    && bundle.includes('--viewtune-diff-added: var(--dsw-alias-file-diff-added-bg)')
    && (bundle.match(/--dsw-alias-file-diff-added-bg: color-mix\(/g) ?? []).length === 2
    && (bundle.match(/--dsw-alias-file-diff-deleted-gutter: color-mix\(/g) ?? []).length === 2
    // The + and - GLYPH colours are legibility, not plate, and are deliberately untouched.
    && !bundle.includes('--dsw-alias-file-diff-added-marker:')],
  // The conversation page can also be asked to be a SOLID page — the trajectory view's own recipe applied
  // to the view that has none: the theme's base colour, the gutter's wallpaper names withdrawn (the groove
  // lives on that same scroller, so leaving them would paint a strip of photograph down a one-colour page),
  // and our masked band lifted over the last rows above the composer. Its own switch, its own attribute:
  // a reader can have the solid page, the skin, both, or neither.
  ['the conversation page can be made a solid page of its own', () =>
    bundle.includes('"data-viewtune-conversation-solid"')
    && bundle.includes('"dsh-viewtune: conversation solid page"')
    && bundle.includes('"reader-settings-conversation-solid"')
    && bundle.includes('record?.conversationSolid === true')
    && bundle.includes('--viewtune-conversation-fade-lift')],
  // The wallpaper's scrim DIAL is a row of its own, not just a value behind one. It went missing from the
  // panel once — state, props and hint all still there, `dimValue` computed and never rendered — and
  // nothing noticed, because every marker about the wallpaper was about the wallpaper itself. A control a
  // reader has already moved must not be able to vanish again without failing here.
  ['the wallpaper scrim keeps its row', '"reader-settings-wallpaper-dim"'],
  // The 「回到最新」 pill floats over the transcript, so it rides the toolbar dial with the blur — but
  // it carries a floor the dial cannot go under. An affordance that can be dialled out of sight is a
  // trap, and this one appears only once the reader has scrolled away from the latest message, which
  // is exactly when they need to find it.
  ['the jump pill rides the toolbar dial, with a floor', () =>
    /\[data-reader-glass\][^{]*_jump\{[^}]*max\(var\(--glass-lane/.test(readerCss)],
  // The chip's height is expressed on the row's own font axis, not as a fixed pixel value: the row is
  // `24px + delta` tall and clips its overflow, so a fixed height is what loses its bottom the moment
  // the reading font is set smaller — which is what it did until this was pinned.
  ['the counts chip is sized on the row axis, not a fixed height', () =>
    /_diffStatButton\{height:calc\(20px \+ var\(--dsh-content-font-delta/.test(bundle)],
  // …and its container must be a flex box. As a plain inline container the chip sits on a line box
  // whose height comes from the inherited `line-height` (28px in this view), which is taller than the
  // 24px row: centred, the chip overflowed the row and the row's `overflow: hidden` cut the bottom off
  // its hover fill. Sizing the chip itself was not enough — the line box was the clipper.
  ['the counts chip sits in a flex box, not a line box', () => /_diffStatRoot\{[^}]*display:flex/.test(bundle)],
  // The two halves live in different places, and that is load-bearing: the primitives' disclosure row
  // is a fixed 24px line with `overflow: hidden`, so a panel rendered inside its `collapsedContent`
  // is laid out as a flex item on that one line and clipped to a sliver. The counts may appear inside
  // the row; the panel may not. Checked by brace-matching the collapsed content's own object literal,
  // because the panel is a sibling later in the same JSX array and "does the artifact contain
  // DiffPanel" cannot tell the two positions apart.
  ['the diff panel sits beside the row, not inside it', () => {
    const at = bundle.indexOf('collapsedContent:');
    if (at === -1) return false;
    let depth = 0;
    for (let index = bundle.indexOf('{', at); index < bundle.length; index++) {
      if (bundle[index] === '{') depth++;
      else if (bundle[index] === '}') {
        depth--;
        if (depth === 0) {
          const inside = bundle.slice(at, index);
          return inside.includes('DiffStatButton') && !inside.includes('DiffPanel');
        }
      }
    }
    return false;
  }],
  // Two calls the product renders with its own keyed cards are rendered here instead of collapsing
  // into a generic row: a question set (what was asked, what was answered) and a delivery (which
  // files were handed over). Asserted by the data attribute they render with, matched with either
  // spelling of a valueless JSX attribute so a restyle of that markup is not a false failure.
  ['question set renders its own card', () => /"data-reader-tool-question":\s*(?:""|true)/.test(bundle)],
  ['delivery renders its own list', () => /"data-reader-tool-present":\s*(?:""|true)/.test(bundle)],

  // ===================== the audit round =====================
  // One marker per defect this round fixed in our OWN code, each pinned to the shape that fixes it. They are grouped
  // here rather than filed into the sections above so the next reader can see what this pass changed and why, and so a
  // revert of any one of them fails loudly instead of silently.
  ['a step position that is not a finite number is withheld, not printed as NaN', () =>
    // `typeof NaN === 'number'` and `NaN !== null`, so the guard that had been added for a missing count let `NaN/5`
    // through to the label and the aria-label. `total` needs no such test: `NaN > 0` is false, which is why the two
    // lines are spelled differently.
    bundle.includes('typeof data.answerStep === "number" && Number.isFinite(data.answerStep)')],
  ['a block that failed to render is retried a bounded number of times instead of staying replaced', () =>
    // Sticky `failed` + an index key meant one half-arrived payload replaced the block for the whole session. Retrying on
    // every render would be worse (a re-throw per streamed delta for content that is genuinely unrenderable), so it is a
    // bounded schedule: the limit is the decision, and so is the timer being cancelled on unmount and on entry only.
    bundle.includes('const BLOCK_RETRY_LIMIT = 3;')
    && bundle.includes('if (this.state.attempt >= BLOCK_RETRY_LIMIT) return;')
    && bundle.includes('attempt: state.attempt + 1')],
  ['a frame message cannot take the handler down with it', () =>
    // `postMessage` delivers a structured clone, which may legally hold a cycle or a `BigInt` — both a `TypeError` from
    // `JSON.stringify`. The receipt is formatted INSIDE the try, and the whole dispatch is inside one at the listener.
    bundle.includes('console.warn("[dsh-better-display] MCP app message failed:", error);')
    && bundle.includes('handleUserSubmit(params !== null && typeof params === "object" && !Array.isArray(params) ? params : {});')],
  ['a frame payload is stringified without throwing and without growing without bound', () =>
    // The two bounds: `safeJson` catches the throw and caps one value; `RECEIPT_MAX_CHARS` caps the finished line, whose
    // other branches read strings straight off the frame.
    bundle.includes('function safeJson(value, max = RECEIPT_MAX_CHARS) {')
    && bundle.includes('const RECEIPT_SUMMARY_CHARS = 300;')],
  ['the rail\u2019s pulse follows the turn that is RUNNING, and aria-busy only the loading tick', () =>
    // The pulse is documented as 「轮次运行期间一直脉动」 and the running turn was the one thing never passed in: the tick
    // pulsed while a history load was in flight and stood still while a turn streamed. `aria-busy` stays on the load,
    // which is the one of the two that is waiting on the reader's click.
    bundle.includes('const loading = busyTurn === item.turn;')
    && bundle.includes('const isBusy = loading || runningTurn === item.turn;')
    && bundle.includes('"aria-busy": loading ? "true" : void 0')],
  ['the rail\u2019s smooth scroll obeys prefers-reduced-motion like every other movement here', () =>
    // The one animation in the plugin that ran without the system gate, in a file whose own CSS has the media query
    // three lines below it. `auto` is the browser's instant jump: the same landing, without the animation.
    bundle.includes('behavior: allowMotion ? "smooth" : "auto"')],
  ['the diff body reads the same field names the diff badge does, new_str included', () =>
    // The badge counted lines from one field list and the body read another: `new_str` was missing from the second, so
    // `str_replace_editor` showed +N/-M with nothing to describe.
    bundle.includes('content: stringValue(args, "content", "new_string", "new_str", "newText", "file_text")')],
  ['both diff surfaces read meta.diffs through ONE normaliser', () =>
    // They were two: the row's +N/-M badge accepted a row with `oldText` omitted (a created file) and skipped rows it
    // could not use, while the 「结果」 pane had its own copy that rejected the whole list on the same input — the row
    // advertised a diff and opening it rendered the generic fallback. The last clause is the point of the marker: the
    // second normaliser must not come back.
    bundle.includes('function diffHunksOf(meta) {')
    && bundle.includes('const diffs = diffHunksOf(meta);')
    && !bundle.includes('function diffHunks(value) {')],
  ['the diff badge states which two numbers it is showing', () =>
    // `diffTotals` counts each SIDE's content lines, not the changed ones, so a one-line edit to a long file reads as
    // hundreds. The `+N/-M` shape is kept (it is the host's own convention and is right for a write); the label and the
    // tooltip say what the numbers are.
    bundle.includes('\u5dee\u5f02\u89c6\u56fe\uff1a\u65b0\u5185\u5bb9')
    && bundle.includes('\u884c\u6570\u6309\u4e24\u4fa7\u5168\u6587\u7edf\u8ba1')],
  ['a macOS Option combination reaches the binding it was recorded as', () =>
    // Option is macOS's dead-key modifier, so Option+C reports `key: 'ç'` and the shipped `Alt+C` never matched — while
    // re-recording appeared to fix it by storing `Alt+Ç`. The physical key (`code`) is not composed, so it is the
    // fallback exactly when the composed key is outside A–Z / 0–9, and only for a modified event (so a layout whose own
    // key really is `ç` still matches what it recorded).
    bundle.includes('function keyOfEvent(event) {')
    && bundle.includes('if (event.altKey || event.metaKey) {')
    && bundle.includes('/^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit([0-9])$/.exec(code)?.[1]')],

  // ===================== the 0.2.0-rc.2 adaptation =====================
  // One marker per platform contract that changed under this fork. Each is written against the ARTIFACT, so a rebuild
  // that quietly reverts the source to the 0.1.5 spelling fails here rather than at the user's next page load — which is
  // the only place these would otherwise show up, because none of them is a compile error at the source level.
  ['the icon set is 0.2.0’s: stroke-weight names, and none of the drawn-size ones', () =>
    // 0.2.0 replaced `IconXxx14` / `IconXxx16` with `IconXxxMedium` (1.3px stroke) and `IconXxxRegular` (1px). The old
    // names no longer exist, so a single leftover import is a component that renders nothing at all.
    //
    // The variants are pinned as the PLATFORM uses them, which is what settled the port: its own tool rows
    // (`dsh-client-ui-tool`) render these glyphs as `…Regular` at 14px and never as `…Medium`, so every tool-row and
    // content-row icon here is Regular; the settings gear is the one Medium, matching the platform's own settings
    // surfaces at 16px (the 1.3px stroke on a 16-viewBox is ~0.98px at this view's 12px, i.e. the Regular weight).
    bundle.includes('IconBrowseOutlineRegular')
    && bundle.includes('IconApiOutlineRegular')
    && bundle.includes('IconChecklistOutlineRegular')
    && bundle.includes('IconQuestionOutlineRegular')
    && bundle.includes('IconSettingsOutlineMedium')
    && bundle.includes('IconSparkleRegular')
    && !/Icon[A-Za-z]*?(14|16)\b/.test(bundle)],
  ['the throughput numbers are derived from the closing node, not read off the tail record', () =>
    // 0.2.0 removed `tokensPerSecond` / `ttftMs` from `TurnTailChatData`; its own derivation lives in a helper no plugin
    // can import, so `turn-reading.ts` ports the formulas. Both clauses matter: the port exists, AND the removed fields
    // are not being read from a record that no longer carries them (which would silently show nothing).
    bundle.includes('function stepReading(')
    && bundle.includes('function tokensPerSecondOf(')
    && !/tailData\??\.tokensPerSecond\b/.test(bundle)],
  ['the pending-interaction read is the unified session-status map', () =>
    // `useSessionPendingInteraction` is gone; every session's independent status facts (`running`, `pendingInteraction`,
    // `completionUnread`) now ride the GLOBAL `useSessionStatus`, and the optional chain is what keeps a session with no
    // status yet from reading as "waiting on the reader".
    bundle.includes('useSessionStatus')
    && bundle.includes('.pendingInteraction')
    && !bundle.includes('useSessionPendingInteraction')],
  ['a running call reads its arguments only when the platform says they exist', () =>
    // 0.2.0 split the running half into `phase: 'preparing'` (no arguments yet) and `phase: 'start'` (`argsRaw`), so the
    // row narrows instead of reading a field that half the union does not have.
    /phase === "start"/.test(bundle)],
  ['every label 0.2.0 made required is supplied', () =>
    // `ReadBlockLabels` and `DiffBlockLabels` now extend `CodeToolbarLabels` (language fallback + two wrap actions) and
    // `TerminalBlockLabels` gained the no-exit-code pill. Missing one is not a hole in the UI, it is a build failure —
    // but only because the types say so; the marker keeps it from being "fixed" by casting.
    bundle.includes('codeLabel:')
    && bundle.includes('wrapLabel:')
    && bundle.includes('unwrapLabel:')
    && bundle.includes('noExitCode:')],
  ['the context row reads the platform’s `producer`, not the retired `provenance`', () =>
    bundle.includes('producer.role')
    && !bundle.includes('provenance.role')],
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
  // The settings panel's entrance is decided when it opens (SettingsMenu), never by a state gate on
  // the animation property: lifting such a gate re-applies the animation, so turning 动效 on from
  // inside that very panel replayed its entrance as a flash.
  ['no state gate on the settings panel entrance', () => /\[data-motion=off\][^{]*_settingsPanel\{/.test(readerCss)],
  // The browser must never learn where the wallpapers live. It asks for a NAME; the host half decides
  // whether that name may be served, from a folder the client is never told. If the instance home
  // ever appears in the client bundle, that boundary has leaked.
  ['no wallpaper folder in the client bundle', 'DSH_HOME'],
  // The window scope must never find the layout frame by its class SUFFIX. "…_frame" is not unique:
  // the reading view's own turn rail container is a NAV whose class is `mgCddq_frame`, so a suffix
  // selector painted a second copy of the backdrop plus a second scrim onto that 26px strip and made
  // it read as a band of a different colour beside everything else. The frame is the element that owns
  // the sidebar column — a fact about the tree, not a name — and that is the selector to keep.
  ['no frame suffix selector in the window scope', '[class*="_frame"]'],
  // The host's scrollbar thumb is not ours to restyle, and insetting it is a measured dead end. The
  // track's inset shrinks the LANE only — the pill is the full thickness of the scrollbar whatever the
  // track's margin is — so a thumb rule buys the lane nothing and is exactly what made a reader report
  // that the scrollbar itself had got thinner. Its return is this mistake coming back.
  ['no rule for the host scrollbar thumb',
    () => /\[class\*="_scrollBody"\]::-webkit-scrollbar-thumb/.test(bundle)],
];

let ok = true;
/**
 * A marker is a fixed string, or a predicate for anything the build may re-spell.
 *
 * Anything else is refused rather than coerced. A boolean needle — which is what an unwrapped
 * `/…/.test(bundle)` produces — used to fall through to `bundle.includes(true)`, i.e. a search for
 * the literal text "true", which this bundle always contains: the marker reported `ok` forever, and
 * only a negative test showed it was decoration rather than a check. Loud is the whole point here.
 */
const matches = (needle) => {
  if (typeof needle === 'function') return needle() === true;
  if (typeof needle !== 'string') {
    throw new TypeError(`marker needle must be a string or a predicate, got ${typeof needle}`);
  }
  return bundle.includes(needle);
};
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
