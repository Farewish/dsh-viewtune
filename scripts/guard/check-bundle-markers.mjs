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
    bundle.includes('var(--reader-collapse-split-shift,5px)')
    && bundle.includes('var(--reader-collapse-more-shift,-1px)')],
  // …and the word 全部 is the LEFT HALF OF A RIGID PAIR with 收起, which is how the reader wanted it to move ("并排
  // 移动"): the slots already differ by exactly 全部's own width, so giving both the same transform keeps them
  // adjacent at every instant and makes the crossing structurally impossible. Its own timing is then only about
  // the fade, which is quick. (Four earlier attempts gave 全部 a timing of its own to dodge an overlap that only
  // existed because the two moved independently.) As emitted (`.16s`, and `.` prefixed class names).
  ['the word 全部 rides 收起\'s transform instead of crossing it', () =>
    bundle.includes('var(--reader-collapse-word-fade,.16s)')
    && bundle.includes('transition:opacity 80ms linear')
    && /_collapseAllWord\{[^}]*transform:translate\(-1em\)/.test(bundle)],
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
  ['the column handles hand the wheel to the transcript', () =>
    bundle.includes('handleTakesWheel(')
    && bundle.includes('"col-resize"')
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
    return filled === 3 && settles === deadlines && deadlines === 4;
  }],
  // The toolbar pins UNDER THE TOP BAR and spans the view: it cancels the reading column's centring
  // offset plus the view's inline padding and adds the same amount back as its own padding, so it reads
  // as one band with the shell's header rule while 收起 and the gear stay exactly where the text
  // starts. "Fixed under the top bar" is chrome; a lane that scrolls away is not what was asked.
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
    /\.WGoHxG_settingsGroup\{[^}]*border-top:\.5px solid var\(--dsw-alias-border-l2\)/.test(bundle)],
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
    bundle.includes('.WGoHxG_reasonCard[data-focus=true]:not([data-expanded=true]) .WGoHxG_reasonViewport{max-height:min(60vh,560px);transition:none}')
    && bundle.includes('@media (prefers-reduced-motion:no-preference){[data-reader-follow-mode=glide]:not([data-motion=off]) .WGoHxG_reasonCard[data-focus=true]:not([data-expanded=true]) .WGoHxG_reasonViewport{transition:height .16s var(--reason-ease,ease-out)}}')
    && bundle.includes('.WGoHxG_reasonCard:not([data-focus=true]) .WGoHxG_reasonViewport{transition:max-height .3s var(--reason-ease,ease-out)}')],
  ['…and the compensation chases that easing frame by frame, ending on the target or on a deadline', () =>
    // A transitioned height has not moved yet at the moment of the write, so a single read would see no growth at all;
    // charging the whole request instead would lead the box and wobble its bottom edge. The chase ends on the target
    // (with no transition in flight the first read IS the target, which is why 贴底 and 动效关 are untouched) or on a
    // deadline (a target the stylesheet's ceiling clamps never arrives).
    bundle.includes('"data-reader-follow-mode": followMode,')
    && bundle.includes('heightChase = 0;\n\t\t\t\t\tcompensateHeight();\n\t\t\t\t\tif (port.offsetHeight === target) return;')
    && bundle.includes('compensateHeight();\n\t\t\t\t\t\tif (port.offsetHeight === target || performance.now() > deadline) return;')],
  ['…with the motion switch dropping those transitions', () => bundle.includes('[data-motion=off] .WGoHxG_reasonCard[data-focus=true] .WGoHxG_reasonViewport,') && /prefers-reduced-motion[^}]*reasonCard\[data-focus=true\][^{]*\{transition:none\}/.test(bundle)],
  ['the card requests the focus when it is the one being written into at the bottom of the transcript', () => bundle.includes('onFocusChange(focusKey, true)') && bundle.includes('isNearTail(scroller.scrollTop')],
  ['…and hands it back on takeover, on 展开阅读, at the end of a 跟随最新 stream, on unmount, and when this card stops growing', () => (bundle.match(/onFocusChange\(focusKey, false\)/g) ?? []).length === 3],
  ['…with the newest request winning, so exactly one card can hold it', 'focused ? key : current === key ? null : current'],
  ['…and the page stops following the tail while a card holds it, told apart from a reader takeover', 'useReadingScroll(root, motion, live, followMode, focusedCard !== null)'],
  ['…because a suspension only yields to a scroll that moved BACKWARDS, which is what a reader taking over does', 'if (suspendedRef.current && scroll.scrollTop >= lastSuspendedTop) {'],
  ['…with the expansion ON unless a record says otherwise', 'focusExpand: true'],
  ['…and that record read the defensive way', 'state.focusExpand) !== false'],
  ['手动滚动 never lets the card move on its own', 'reasoningMode !== "manual"'],
  ['跟随最新 aims at the newest line rather than at a step', 'reasoningMode === "latest"'],
  ['and 自动滚动 realises the pace as a whole-line step', 'reasoningTarget(from, text.offsetHeight, port.clientHeight, lineHeight, stepLines(rate))'],
  ['a pace is rounded to whole lines and never to zero', 'return Math.max(1, Math.round(rate * holdMs / 1e3));'],
  ['…with the defaults being the reader’s own mode at the standard pace', () => bundle.includes('reasoningFollow: "latest"') && bundle.includes('reasoningRate: 2')],
  ['…both read defensively', () => bundle.includes('reasoningFollowModeOf(state.reasoningFollow)') && bundle.includes('reasoningRateOf(state.reasoningRate)')],
  ['…and a change to either reaches the follower that is already running', () => /reasoningMode,\s*rate\s*\]\)/.test(bundle)],
  // 自动收起更早流程, pinned at every end that has to agree. The fold itself (only a turn with `status === "open"` stays
  // open), the TWO places the rule is asked — the reader's rendering and the toolbar's own "what is open" pass, which
  // would otherwise disagree with what is on screen — the default and the defensive read, and the clear that makes a
  // new turn put the earlier processes away (gated by the same two conditions the fold uses).
  ['自动收起更早流程 folds every turn but the growing one', 'if (foldEarlier && boundary.status !== "open") return false;'],
  ['…and the toolbar asks the same rule, so it agrees with the screen', () => (bundle.match(/processExpanded\(choice, boundary, foldEarlier\)/g) ?? []).length === 2],
  ['…with the switch off unless a record says otherwise', 'autoCollapseEarlier: false'],
  ['…and that record read the defensive way', 'state.autoCollapseEarlier) === true'],
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
  ['…with the glide unless a record says otherwise', 'followMode: "glide"'],
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
  // that matters: before the notch is consumed, so a disabled wheel leaves the event exactly as it found it rather
  // than swallowing it and doing nothing.
  ['the strip wheel switch reaches the listener, which stops before consuming the notch', () => {
    const attribute = (bundle.match(/data-reader-strip-wheel/g) ?? []).length;
    const gate = bundle.indexOf('if (!stripWheelEnabled(root.getAttribute(STRIP_WHEEL_ATTRIBUTE))) return;');
    return attribute === 2
      && gate !== -1
      && gate < bundle.indexOf('handleTakesWheel(view.getComputedStyle(element)', gate);
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
  // tested directly there. Two things are load-bearing: the follower consults `liveRef` in the FRAME LOOP and in the
  // RESIZE OBSERVER (gating one leaves the other path still following), and the wheel handler asks `wheelAtBottom`
  // before it treats the gesture as a takeover.
  ['the tail-follow runs while the layout is still producing, and a wheel at the bottom is not a takeover', () =>
    bundle.includes('!producingRef.current || suspendedRef.current ||')
    && bundle.includes('producingRef.current && !suspendedRef.current && following.current')
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
    // because the gate is only worth having for an animation that never ends — and both are matched by SHAPE rather
    // than by the literal the source wrote: the build reorders the `animation` shorthand and hashes the keyframe name,
    // so the artifact reads `animation:1s ease-in-out infinite alternate <hash>_markBusyPulse`.
    /animation:1s ease-in-out infinite alternate \w+_markBusyPulse\}/.test(bundle)
    && /@media \(prefers-reduced-motion:reduce\)\{\.\w+_markBusy \.\w+_tick\{animation:none\}\}/.test(bundle)
    && /animation:1\.5s ease-in-out infinite \w+_pulse\}/.test(bundle)
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
    bundle.includes('if (revealTurn(pendingReveal)) setPendingReveal(null);')
    && bundle.includes('setPendingReveal(item.turn);')
    && bundle.includes('if (!targetRow) return false;')],
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
  ['…and the grant closes the tail gap and takes the ceiling jump out of the space above, both before paint', () =>
    // The reader's report pins this one: while a card holds the focus the page's follow is suspended, so the slack
    // `isNearTail` allows (72px) was never closed and the card's bottom — reading row included — sat behind the
    // composer's edge; clicking 回到最新, which writes the maximum, made it "just exactly complete". The ceiling jump of
    // that same commit was also painted one frame before it was compensated, which is why both happen in a layout effect.
    bundle.includes('scroller.scrollTop = scroller.scrollHeight;')
    && bundle.includes('compensateNow.current = compensateHeight;')
    && bundle.includes('compensateNow.current();')],
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
  // The whole-window scope, whose mechanism the runtime probes established. Five claims: the two
  // settings rows exist; the stylesheet is GATED on an attribute, so nothing applies until the reader
  // opts in; every copy of the IMAGE rides a viewport-anchored rule (that is what lets several copies
  // be safe — they line up as one image instead of layering scrims, which is what made one region
  // visibly darker than its neighbour in the first probe); the chrome carries a scrim and no second
  // copy; and the reading view steps aside while the scope is the window, for the same reason. The
  // gate is pinned through the `SCOPED` interpolations rather than a spelled-out selector, because
  // the selector is built from the attribute constant at runtime.
  ['the settings panel offers the window-wide wallpaper', '"data-ud-check": "reader-settings-wallpaper-scope"'],
  ['the window scope has its own chrome scrim dial', '"data-ud-check": "reader-settings-wallpaper-chrome"'],
  ['the window backdrop is gated, and every copy of the IMAGE is viewport-anchored', () => {
    const images = (bundle.match(/var\(--viewtune-wallpaper-image\)/g) ?? []).length;
    const anchored = (bundle.match(/\$\{FIXED\}/g) ?? []).length;
    return bundle.includes('"data-viewtune-wallpaper"')
      && bundle.includes('="window"]')
      // Every anchored rule carries a copy — and the chrome's scrim-only rule is deliberately NOT anchored:
      // attachment:fixed only ever lines an image up with the viewport, and on a flat colour it buys nothing
      // while putting the paint in the compositor, which is where the reader's missing-scrim bug lived. A
      // relation, not a count: adding a carrier must not be able to pass by quietly adjusting two numbers.
      && images === anchored
      // The token's name lives in a constant and is interpolated into its rule, so the bundle has the
      // declaration rather than a spelled-out declaration line.
      && bundle.includes('const SIDEBAR_FILL = "--dsw-specific-sidebar-fill"')
      && bundle.includes('[class*="_header"]:has(> [class*="_titleRow"])');
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
    /body\{--viewtune-layer-plate:var\(--dsw-alias-bg-layer-1\)\}/.test(bundle)
    && /--dsw-alias-bg-layer-1:color-mix\(in srgb,\s*var\(--viewtune-layer-plate/.test(bundle)],
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
    const props = [...bundle.matchAll(/var\((--glass-[a-z]+)/g)].map(match => match[1]);
    return new Set(props).size === 9
      && ['--glass-lane', '--glass-user', '--glass-card', '--glass-code', '--glass-diff', '--glass-chip', '--glass-scrollbar', '--glass-pill', '--glass-input']
        .every(name => props.includes(name) && bundle.includes(`"${name}"`));
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
    && /--dsl-code-block-banner-background-color:color-mix\(in srgb,\s*var\(--dsw-alias-markdown-code-block-banner[^}]*var\(--glass-code/.test(readerCss)
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
