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
// The MERGED control (see CollapseControl.tsx): one button for both actions, because the reading column's
// left edge leaves room for exactly one. The animation's own contract is unchanged — `open`/`idle` on
// `data-reader-collapse` — and WHICH action the button is rides a second attribute, so the stylesheet's
// enter/exit animation cannot be broken by the merge.
want('collapse state hook', '"data-reader-collapse": on ? "open" : "idle"', 1);
want('the action it stands for rides its own attribute', '"data-reader-collapse-action": primary', 1);
want('hidden gate', 'hidden: !on', 1);
// Both of the pair's conditions, and nothing new: the turn in view, or other turns.
want('the merged gate is the pair of conditions', 'const on = showCurrent || showAll', 1);
// The handlers run through a wrapper that records where focus was before the button disappears.
want('focus is remembered before the action', 'remember();', 2);
want('current-turn action', 'collapseCurrent()', 1);
// Twice: the main action when it is the one that applies, and the caret's menu item.
want('collapse-all action', 'collapseAll()', 2);
want('the second control is offered only when both apply', 'const both = on && primary === "current" && showAll', 1);
// A DIRECT action, not a menu: no `aria-haspopup`, no menu role, no dismissal watcher — the reader asked for
// the double chevron to collapse everything on the first click, and for it to carry 收起全部's own tooltip.
want('the second control is a plain button', '"data-reader-collapse-more": ""', 1);
// JSX puts an arrow's body on its own lines, so the two statements are asserted one at a time.
want('and it collapses everything itself', 'collapseAll();', 2);
// JSX compiles a hyphenated attribute to a quoted key, and the tooltip and the accessible name are the SAME
// string on purpose: the reader asked for the double chevron to say exactly what 全部收起 says.
want('its tooltip is the collapse-all one, word for word', '"aria-label": allLabel,', 1);
want('…and so is its title', 'title: allLabel,', 1);
// TWO boxes: the single chevron in the stage and the pair stacked on the appendage.
want('the stack of chevrons is drawn, not spelled', 'className: Reader_module_css_default.collapseChevrons', 1);
// …and the appendage keeps its SLOT when only one action applies: a control that widens when a second turn is
// expanded is a size change at exactly the moment the reader is reading.
want('the appendage holds its slot instead of appearing', '"data-reader-collapse-more-active": both ? "true" : "false"', 1);
want('…which the stylesheet reads as a reserved slot', 'data-reader-collapse-more-active=false', 1);
// The appendage is laid OVER the right end of the fixed stage, which is what lets the pill stay one width while
// a second half appears inside it. Its divider is a pseudo-element rather than a border, because a border
// cannot fade in place — and the reader asked for the line to appear where it is.
// Needles written the way the MINIFIER leaves the CSS (it reorders declarations and shortens `::before` to
// `:before`), because these are asserted against the built artifact, not the source.
want('the appendage keeps its place over the stage', '_collapseMore{width:20px', 1);
// …and it is 20px rather than 1.7em (20.4px) for the same reason the chevron slot is 8px: it leaves a left half
// of a whole 36px, so the shift inside it can be a whole number of pixels. That shift carries BOTH answers in
// one number — 2px is the geometric centre (2px of margin each side), 5px is the optical value the reader
// settled on — and it is bounded by the left half's slack (36px − 32px = 4px), which is why wanting more of it
// means widening that half rather than raising this number.
want('the split shift is a whole pixel and carries the optical value', 'var(--reader-collapse-split-shift,5px)', 1);
// The divider PRIMITIVE plus the rule that fades it in: a pseudo-element is the whole reason it can appear in
// place, since a border has no opacity of its own.
want('the divider is a pseudo-element', '_collapseMore:before{content:', 1);
want('…and it fades in with the split', '_collapseMore:before{opacity:1', 1);
// Three rules mention the stage's segments: the base one, the motion-off gate and the reduced-motion gate —
// which is what "the choreography ends with the switch" means.
want('…and the choreography ends with the motion switch', '_collapseStage>span', 3);
want('the handler reaches the control', 'collapseCurrent: collapseCurrentTurn', 1);
want('and so does the other', 'collapseAll: collapseEveryTurn', 1);
want('toolbar wrap hook', '"data-ud-check": "collapse-wrap"', 1);
// The label is a FIXED STAGE with three floating segments (see the CSS): that is what lets the pill keep one
// width while the words change — 「全部」 fades in from the left, 「收起」 slides, the chevron fades out to the
// right. All three are decoration and hidden from assistive tech; the button's own label carries the sentence,
// because the segments are animated independently and their DOM order is not what a screen reader should hear.
want('the label is a stage of three segments', 'className: Reader_module_css_default.collapseStage', 1);
want('…with 全部 as its own segment', 'className: Reader_module_css_default.collapseAllWord', 1);
want('…and 收起 as its own', 'className: Reader_module_css_default.collapseKeeping', 1);
want('…and the chevron as its own', 'className: Reader_module_css_default.collapseOneChevron', 1);
want('the words reach assistive tech through the button', '"aria-label": title', 1);
// Three ˄ in the markup: the main button's single one and the pair stacked on the appendage. The count is what
// says the chevrons are still DRAWN rather than spelled — and that the main button carries ONE, because in
// 「全部收起」 it is the chevron that fades away to free the fourth glyph's slot.
want('chevrons: drawn in a stack, never spelled', 'children: "˄"', 3);
want('tooltip names the scope', '收起当前这一轮的过程', 1);
// The motion preference moved into the settings panel: what has to hold now is that it still
// reaches that panel and that the panel still writes the stored value.
want('motion preference reaches the settings panel', 'preference: motionPreference', 1);
want('the panel still writes the stored preference', 'onChange: props.actions.setMotion', 1);
// B2: a keyboard path for both actions, and a focus handoff so collapsing never drops the reader to
// <body> when the button that was just used goes away.
//
// The keys are the reader's own bindings now, so what is asserted is the WIRING: the handler matches
// the configured value, and the attribute and the tooltip advertise that same value instead of a
// literal that would go stale the moment someone rebinds.
want('the collapse shortcut matches the configured binding', 'matchesShortcut(event, collapseTurnKey)', 1);
want('and so does collapse-all', 'matchesShortcut(event, collapseAllKey)', 1);
want('holding the key does not repeat the action', 'if (event.repeat) return;', 1);
want('focus handoff', 'focusWasInCollapseWrap', 4);
// JSX compiles a hyphenated attribute to a quoted key, so the assertion spells it that way — and the
// binding the button advertises is the one for the action it will actually perform, which is why the
// component names it `binding` rather than either key.
want('the advertised shortcut follows the action it will take', '"aria-keyshortcuts": binding || void 0', 1);
want('and that binding is chosen from the two', 'const binding = primary === "current" ? turnKey : allKey', 1);
want('the tooltip names the binding in force', 'keyHint(turnKey)', 1);
// The count is not the point here (the caret advertises it in four places: its label, its title, the menu
// item and the primary's title when that action applies) — what matters is that the binding is READ rather
// than spelled out, so rebinding cannot leave a stale literal in a tooltip.
present('and the other action advertises its binding too', 'keyHint(allKey)');
// The caret's own words, and the fact that the two places which show them read ONE variable.
//
// This assertion used to read 全部收起, which the control has not said since the labels were shortened: that string was
// in the bundle only because a SETTINGS HINT happened to contain it, so the check was passing on the panel's copy
// rather than on the control, and it began failing the moment that hint was deleted for saying too much. What the caret
// actually advertises — and what the reader asked it to say, word for word — is this sentence.
present('the caret advertises its own action, in the control\'s words', '收起所有已展开的过程');
// Its accessible name and its tooltip are the same variable, which is the property the reader asked for: one click,
// and the same words the second control used to carry.
want('and the caret\'s accessible name is that label', '"aria-label": allLabel', 1);
want('…and so is its tooltip', 'title: allLabel', 1);
// The two defaults, in the one table the resolver and the settings panel both read.
want('the defaults live in one table', 'collapseAll: "Alt+Shift+C"', 1);
want('including the turn default', 'collapseTurn: "Alt+C"', 1);

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
want('the predicate is a named function', 'function currentTurnOf(content, viewportTop, rows) {', 1);
// It must still be reachable with just a DOM-shaped argument, because test-current-turn.mjs
// runs this rule on its own against a fake DOM. Indexed so a NodeList works without the DOM
// iterable lib.
want('it walks the turn list when not handed one', 'const list = rows ?? content.querySelectorAll("[data-reader-turn]");', 1);
want('the walk is indexed, not iterated', 'for (let index = 0; index < list.length; index += 1) {', 1);
// Same predicate the reading scroll uses for its anchor, so the two agree on what is current.
want('first turn whose bottom passed the top edge', 'if (element.getBoundingClientRect().bottom > viewportTop + 8) return turnNumber;', 1);
want('skips groups without a turn number', 'if (!Number.isInteger(turnNumber)) continue;', 1);
want('the effect asks it for the turn in view', 'let firstVisible = currentTurnOf(content, viewportTop, rows);', 1);
// Resolving the scroller this way is deliberate: useReadingScroll does exactly the same, so
// "the viewport" means one container in both places. Hence 2 occurrences, not 1.
want('uses the same scrollport as the reading scroll', 'content.closest("[data-conversation-scroll]") ?? content;', 2);
want('and listens to that scroller itself', 'scroller.addEventListener("scroll", schedule, { passive: true });', 1);
want('throttled to one read per frame', 'frame = requestAnimationFrame(() => {', 1);
want('state only changes on a real move', 'setCurrentTurn((previous) => previous === firstVisible ? previous : firstVisible);', 1);
want('cleans up its listeners', 'scroller.removeEventListener("scroll", schedule);', 1);

console.log('\n--- one scroll spy, not two (the handoff stutter regression)');
// Both readings need the same measurement, and every getBoundingClientRect() flushes layout.
// Two listeners meant walking every turn row twice per scroll, which is what made a wheel
// handoff stutter while the pointer stayed over the transcript. Pin the single-spy shape.
want('exactly one scroll listener on the scroller', 'scroller.addEventListener("scroll",', 1);
absent('no second spy walking the rows again', 'updateActive');
want('one query feeds both readings', 'const rows = content.querySelectorAll("[data-reader-turn]");', 1);
want('the current turn reuses that query', 'let firstVisible = currentTurnOf(content, viewportTop, rows);', 1);

console.log('\n--- styles');
// Asserted by the declarations each rule carries, through the anchor helpers: class names and
// keyframe names are re-hashed per build and the minifier chooses its own property order, so a
// verbatim rule string verifies one build's output rather than the control's behaviour.
const collapse = classSel(bundleCss, 'collapseControl');
const collapseMore = classSel(bundleCss, 'collapseMore');
const collapseGroup = classSel(bundleCss, 'collapseGroup');
const collapseStage = classSel(bundleCss, 'collapseStage');
const collapseKeeping = classSel(bundleCss, 'collapseKeeping');
const collapseAllWord = classSel(bundleCss, 'collapseAllWord');
const collapseChevron = classSel(bundleCss, 'collapseOneChevron');
const wrap = classSel(bundleCss, 'collapseWrap');
const intro = keyframeOf(bundleCss, 'readerCollapseIn');
const exit = keyframeOf(bundleCss, 'readerCollapseOut');
/**
 * Whether a rule paints no background at all.
 *
 * Asserted by *value*, not by spelling: the minifier rewrites `background: transparent` to
 * `background: 0 0`, and both mean "no fill". The rule must also declare a background — an absent
 * declaration would let `.textButton`'s hover fill show through, which is the thing being ruled out.
 */
const isUnfilled = (selector) => {
  const values = [...ruleDecls(bundleCss, selector)]
    .filter((declaration) => declaration.startsWith('background:'))
    .map((declaration) => declaration.slice('background:'.length).trim());
  return values.length > 0 && values.every((value) => value === 'transparent' || value === '0 0' || value === 'none');
};
/**
 * The `transform` a rule declares, tolerating the minifier's MERGED selector lists (`a, b, c{…}`): it looks for
 * the selector as one entry of a list rather than as a whole rule, because identical declarations in consecutive
 * rules are merged and the segment's own selector may then never start a rule.
 */
const transformOf = (selector) => {
  for (const chunk of bundleCss.split('}')) {
    const brace = chunk.indexOf('{');
    if (brace === -1) continue;
    if (!chunk.slice(0, brace).split(',').some((part) => part.trim() === selector)) continue;
    const found = chunk.slice(brace + 1).split(';').map((part) => part.trim()).find((part) => part.startsWith('transform:'));
    if (found) return found;
  }
  return '';
};
/**
 * Whether 全部 rides exactly 收起's transform in one state.
 *
 * An empty result on EITHER side fails: a missing declaration must not compare equal to another missing one, or
 * the invariant would hold vacuously the day both rules stop carrying a transform.
 */
const ridesKeeping = (state) => {
  // The resting state's rules are bare class selectors; a state's rules are compound, led by the group.
  const prefix = state === '' ? '' : `${collapseGroup}${state} `;
  const mine = transformOf(`${prefix}${collapseAllWord}`);
  return mine !== '' && mine === transformOf(`${prefix}${collapseKeeping}`);
};
/**
 * Every rule of this control that animates has to be REACHED by the motion switch.
 *
 * The gate is written per element (`[data-motion=off] .collapseStage > span, …`), and that is not enough on its own:
 * specificity is not order, so `[data-motion=off] .collapseStage > span` at (0,2,1) loses to
 * `.collapseGroup[data-reader-collapse-action=all] .collapseAllWord` at (0,3,0) wherever the gate sits. The switch
 * therefore ended the pill's own enter and exit while 全部 kept fading in and the chevron stack kept rising — the
 * reader's report that it "did not control all of the collapse button's animations".
 *
 * Asserted as the PROPERTY rather than as a list of selectors, so a new state rule that animates fails here until a
 * gate reaches it: collect the element names every `[data-motion=off]` rule names, then require every rule that
 * mentions this control and declares an animation or a transition to name at least one of them. Both counts have to
 * be non-zero — a check that found no rules at all would pass forever.
 */
const motionReach = (() => {
  const rules = [...bundleCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(match => ({ selector: match[1].trim(), body: match[2] }))
    .filter(rule => !rule.selector.startsWith('@'));
  const names = (selector) => [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  const reached = new Set(rules.filter(rule => rule.selector.includes('[data-motion=off]')).flatMap(rule => names(rule.selector)));
  const animated = rules.filter(rule => !rule.selector.includes('[data-motion=off]')
    && /(?:^|;)\s*(?:animation|transition)\s*:/.test(rule.body)
    && (rule.selector.includes('collapse') || rule.body.includes('reader-collapse')));
  const ungated = animated.filter(rule => !names(rule.selector).some(name => reached.has(name)));
  // Named, not counted: a failure here is a rule somebody has to go and gate, and the count alone would not say which.
  for (const rule of ungated) console.log(`       not reached by any motion gate: ${rule.selector}`);
  return { ok: reached.size > 0 && animated.length > 0 && ungated.length === 0, total: animated.length, ungated };
})();
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
  // The second control is part of the SAME pill — the reader asked for one control of one width — so it has no
  // frame and no fill of its own, it TAKES its type from the pill instead of setting one, and it arrives by
  // fading (with its divider, which is a pseudo-element for exactly that reason) rather than by animating in as
  // a sibling box. What stays put is its slot: the pill's width does not change when it appears.
  // (These replace four assertions about 「全部收起」's own framed, unfilled text button — that control was
  // merged into this one, so what it was is no longer what the guarded file contains.)
  ['the second control has no frame of its own', hasDecls(bundleCss, collapseMore, ['border:0'])],
  ['…and no fill of its own', isUnfilled(collapseMore)],
  ['…and takes its type from the pill', hasDecls(bundleCss, collapseMore, ['font:inherit'])],
  // The DIVIDER is what fades in with the split. The box around it deliberately carries no opacity: it is
  // transparent, so fading it as well would take the stack inside it along and the stack would vanish outright
  // instead of rising — which is what the reader reported.
  // The `[^{]*` after the class is load-bearing: the minifier MERGES this rule with the stack's/segment's into one
  // selector list, so the class is followed by a comma rather than by the brace.
  ['…it arrives by its divider fading in with the split',
    new RegExp(`\\[data-reader-collapse-split=true\\][^{]*${escapeRegExp(collapseMore)}:before[^{]*\\{[^}]*opacity:1`).test(bundleCss)],
  ['…and holds its place while only one action applies',
    hasDecls(bundleCss, `${collapseMore}[data-reader-collapse-more-active=false]`, ['visibility:hidden'])
      // …but only AFTER its exit has played: hiding the box at once is what made the stack vanish outright instead
      // of rising, so the delayed visibility is asserted as part of the same invariant.
      && /data-reader-collapse-more-active=false\][^{]*\{[^}]*transition:visibility 0s linear var\(--reader-collapse-more-exit/.test(bundleCss)],
  // The second control is a plain button inside the pill's own stacking, so it has no `hidden` half of its own:
  // what keeps it from being reached while it is invisible is the reserved-slot rule asserted above.
  ['intro keyframes shipped', bundleCss.includes(`@keyframes ${intro}{`)],
  // The choreography's offsets must land on WHOLE pixels. The chevron's slot is 8px rather than .6em (7.2px)
  // for that reason: a fractional translate leaves CJK glyphs on a half pixel, which reads as blur — and the
  // centring correction below is exactly half that slot, so the slot has to be even for the correction to be
  // whole. (The reader reported 「全部收起」 as off-centre; it was 4px left of centre, because the hidden
  // chevron's slot still took room at the right end.)
  ['the chevron slot is a whole number of pixels', hasDecls(bundleCss, collapseChevron, ['width:8px'])],
  ['the stage is the two label slots plus that chevron', hasDecls(bundleCss, collapseStage, ['width:calc(4em + 8px)'])],
  ['…and every resting offset is whole too',
    hasDecls(bundleCss, collapseChevron, ['transform:translate(-1em)']) && hasDecls(bundleCss, collapseKeeping, ['transform:translate(-1em)'])],
  ['「全部收起」 is centred by half the empty chevron slot',
    hasDecls(bundleCss, `${collapseGroup}[data-reader-collapse-action=all] ${collapseKeeping}`, ['transform:translate(4px)'])],
  // 全部 is the LEFT HALF OF A RIGID PAIR with 收起: the reader asked for the two words to move side by side ("我更
  // 想让全部和收起并排移动"), and since the slots already differ by exactly 全部's own width, equal transforms keep
  // them adjacent at every instant — which is also what makes the crossing structurally impossible. Asserted as an
  // EQUALITY between the two segments per state, not as two hard-coded numbers: the relation is the invariant, and
  // it survives re-tuning the shift. (This replaced four attempts to dodge the overlap with timing while the two
  // moved independently — a delayed fade, `ease-in`, a longer slide, a slower fade.)
  ['全部 rides 收起\'s transform at rest', ridesKeeping('')],
  ['…and in the split state', ridesKeeping('[data-reader-collapse-split=true]')],
  ['…and in 「全部收起」', ridesKeeping('[data-reader-collapse-action=all]')],
  ['…so its own timing is only about the fade', hasDecls(bundleCss, `${collapseGroup}[data-reader-collapse-action=all] ${collapseAllWord}`,
    ['opacity:1', 'transform:translate(4px)'])],
  ['exit keyframes shipped', bundleCss.includes(`@keyframes ${exit}{`)],
  [`the motion switch reaches every animated rule here (${String(motionReach.total - motionReach.ungated.length)}/${String(motionReach.total)})`,
    motionReach.ok],
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
if (hasDecls(bundleCss, classSel(bundleCss, 'toolbar'), ['position:sticky', 'top:0'])) {
  console.log('ok   toolbar lane pins under the top bar');
} else {
  bad++;
  console.log('MISS toolbar lane does not pin');
}

console.log(`\n${bad === 0 ? 'BUNDLE COLLAPSE OK' : 'BUNDLE COLLAPSE FAILED: ' + bad}`);
process.exit(bad === 0 ? 0 : 1);
