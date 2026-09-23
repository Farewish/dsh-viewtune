/**
 * Checks whether the Reader CSS module string shipped in the bundle actually contains the
 * rules this fork added — read through the anchor helpers, so a rebuild does not turn every
 * assertion red for spelling reasons.
 *
 * The catch this exists for: the bundle injects each CSS module as one string literal and then
 * copies it into a `<style>` element. A rule that sits *outside* that literal is present in the
 * file yet never applied, which shows up only as unstyled markup in the browser (no frame, no
 * max-height). That is why the stylesheet is read as a literal and asserted on, rather than
 * trusted from `src/`: the two can disagree.
 *
 * Two changes make it survive a rebuild. The stylesheet is located by the module it came from
 * (`Reader.module.css`), not by the `css$4` ordinal — the ordinal is emission order, so adding
 * or reordering a CSS module used to make this read a different stylesheet while still
 * reporting a verdict. And each rule is asserted by the declarations it carries rather than by
 * a prefix of the minified text, because lightningcss reorders properties and re-hashes class
 * names on every build.
 *
 * Usage: node verify-reader-css-string.mjs [bundlePath]
 */
import { readFileSync } from "node:fs";
import { classSel, hasDecls, keyframeOf, moduleCssLiteral, ruleDecls } from "./bundle-anchors.mjs";
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const BUNDLE = process.argv[2] ?? join(ROOT, "lib/client.js");
const text = readFileSync(BUNDLE, "utf8");
const css = moduleCssLiteral(text, "Reader.module.css");

console.log(`${BUNDLE}`);
console.log(`Reader stylesheet literal: ${String(css.length)} chars`);
console.log(`  starts: ${JSON.stringify(css.slice(0, 70))}`);
console.log(`  ends  : ${JSON.stringify(css.slice(-70))}`);

/** `.hash_local`, resolved from the source-side name. */
const sel = (local) => classSel(css, local);
const declared = (local) => ruleDecls(css, sel(local)).size > 0;

const INTRO = keyframeOf(css, "readerCollapseIn");
const EXIT = keyframeOf(css, "readerCollapseOut");
const COLLAPSE = sel("collapseControl");

const checks = [
  ["systemPrompt rule inside the literal", declared("systemPrompt")],
  ["commandInput rule inside the literal", declared("commandInput")],
  ["systemPrompt has max-height", hasDecls(css, sel("systemPrompt"), ["max-height:320px"])],
  ["systemPrompt has overflow:auto", hasDecls(css, sel("systemPrompt"), ["overflow:auto"])],
  ["systemPrompt keeps the frame colour", hasDecls(css, sel("systemPrompt"), ["background:var(--dsw-alias-bg-module-platform)"])],
  ["toolRaw still declared", declared("toolRaw")],
  // Lane shape: the toolbar pins (both switches stay reachable), the process status row does
  // not. `position:sticky` legitimately remains for `.jumpDock` and the timeline rail's slot.
  ["toolbar pins under the top bar", hasDecls(css, sel("toolbar"), ["position:sticky", "top:0"])],
  ["toolbar lane has a background", hasDecls(css, sel("toolbar"), ["background:var(--dsw-alias-bg-base)"])],
  ["status lane is not sticky", !hasDecls(css, sel("disclosure"), ["position:sticky"])],
  ["no rule reads a toolbar height", !css.includes("reader-toolbar-height")],
  ["the jump dock keeps its own sticky", declared("jumpDock") && hasDecls(css, sel("jumpDock"), ["position:sticky"])],
  // Toolbar appearance: an explicit lane height with the switches centred in it, and a
  // divider separating the pinned lane from the transcript.
  ["toolbar states its lane height", hasDecls(css, sel("toolbar"), ["min-height:42px"])],
  ["toolbar centres its switches", hasDecls(css, sel("toolbar"), ["align-items:center"])],
  ["toolbar carries a bottom divider", hasDecls(css, sel("toolbar"), ["border-bottom:.5px solid var(--dsw-alias-border-l2)"])],
  ["toolbar spans the view", hasDecls(css, sel("toolbar"), ["padding-left:max(0px, calc(var(--reader-inline-pad) + 50cqw - 50% - var(--reader-toolbar-shift-left)))"])],
  // The right control is pinned to the LANE's own end, less the gap: the reader asked for exactly that
  // ("its right end fixed 1px before the toolbar's right end"), and it replaced the outward shift the left
  // control still uses. Spelled the way the parser normalises it — `,` with no space — because that is
  // what is compared against.
  ["toolbar pins its right control to the lane's end", hasDecls(css, sel("toolbar"), ["padding-right:var(--reader-toolbar-gap-right,1px)"])],
  ["toolbar's right end stops short of the view edge", hasDecls(css, sel("toolbar"), ["margin-right:calc(-1 * var(--reader-inline-pad) + 50% - 50cqw + var(--reader-toolbar-end-right))"])],
  // Collapse control. The fade-up on exit only exists if the box survives the animation:
  // `display` is forced on the `[hidden]` rule (the browser would otherwise set
  // `display:none`), and the visibility change is delayed to the end of the animation. Put
  // that change on the `[hidden]` rule instead and the control is hidden on frame one, so
  // the fade is never seen — that was a real reported bug.
  ["collapse control is styled", hasDecls(css, COLLAPSE, ["display:inline-flex"])],
  ["collapse label matches the 回到最新 pill's type", hasDecls(css, COLLAPSE, ["font-size:12px", "line-height:20px"])],
  // …and that IS the 回到最新 pill's type: the reader asked for one small size in the lane rather than two, so
  // the pair of assertions is the invariant. (The old one pinned 14px/22px — the size the label had been moved
  // UP to after being complained about; the complaint it answered no longer applies, the agreement now does.)
  ["…and that is the type that pill actually uses", hasDecls(css, sel("jump"), ["font-size:12px", "line-height:20px"])],
  ["collapse pill is outlined at the divider's tier", hasDecls(css, COLLAPSE, ["border:.5px solid var(--dsw-alias-border-l2)"])],
  ["collapse pill has a resting fill", hasDecls(css, COLLAPSE, ["background:var(--dsw-alias-interactive-bg-hover)"])],
  // Every scroll container in the reader keeps the wheel to itself, and the settings panel is one of them: without
  // this the gesture chains to the reading scroller as soon as the panel reaches its end (reported as 「滚轮接力」).
  // It is pinned here rather than left to review because the same guard is on the diff area, the rail and the tables
  // — a new scroll container is exactly the kind of thing that gets added without it.
  ["the settings panel keeps the wheel to itself", hasDecls(css, sel("settingsPanel"), ["overscroll-behavior:contain"])],
  // The panel itself does not scroll: its TABS are pinned at the top and the page body below them is the scroll
  // container, so the scrollbar's track starts under the tabs instead of running up past them (reported). Asserted as
  // the relation between the two rules — the panel hides its overflow and the body scrolls — because either one alone
  // would leave the tabs inside the scroller again.
  ["the settings panel pins its tabs above the scroller", hasDecls(css, sel("settingsPanel"), ["overflow:hidden"])],
  ["…and the page bodies below them scroll instead", hasDecls(css, sel("settingsBody"), ["overflow-y:auto", "min-height:0"])],
  ["…keeping the wheel to themselves too", hasDecls(css, sel("settingsBody"), ["overscroll-behavior:contain"])],
  // …and its slot gets the same rounded ends the composer's has, for the same reason: a short strip beside the host's
  // pill-shaped thumb reads as a different widget when it ends square. Only the radius is stated here — the painted
  // groove is already on every track, from the always-installed scrollbar stylesheet.
  ["the panel's scroll slot has rounded ends", hasDecls(css, `${sel("settingsBody")}::-webkit-scrollbar-track`, ["border-radius:999px!important"])],
  // The host's primitive blocks (ReadBlock, TerminalBlock, SearchBlock, DiffBlock, WebBlock — the 「结构」/「Pwsh」/Edit's
  // 「输入」 panes) are hashed classes, so the code dial is applied to the TOKENS they paint, scoped to this view's
  // root; the JSON pane paints the core layer colour instead, and that one is scoped to the tool containers so the
  // redefinition cannot leak to every layer-coloured surface in the view.
  ["the host primitive code blocks take the code dial",
    /\[data-reader-glass\]\{--dsw-alias-markdown-code-block:color-mix\(in srgb,\s*var\(--viewtune-code-plate/.test(css)
    && /--dsw-alias-markdown-code-block-banner:color-mix\(in srgb,\s*var\(--viewtune-code-banner/.test(css)],
  ["…and the JSON pane's layer colour only inside the tool content",
    /body\{--viewtune-layer-plate:var\(--dsw-alias-bg-layer-1\)\}/.test(css)
    && /--dsw-alias-bg-layer-1:color-mix\(in srgb,\s*var\(--viewtune-layer-plate/.test(css)],
  ["hidden only forces display", hasDecls(css, `${COLLAPSE}[hidden]`, ["display:inline-flex"])],
  ["hidden never hides by itself", !hasDecls(css, `${COLLAPSE}[hidden]`, ["visibility:hidden"])],
  [
    "the exit delays its own visibility change",
    hasDecls(css, `${COLLAPSE}[data-reader-collapse=idle]`, ["visibility:hidden"])
      && /transition:[^;}]*visibility\s+0s[^;}]*[\d.]+m?s/.test(css),
  ],
  ["both fade keyframes are shipped", css.includes(`@keyframes ${INTRO}{`) && css.includes(`@keyframes ${EXIT}{`)],
];

let ok = true;
for (const [name, pass] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "BAD "} ${name}`);
}
console.log(ok ? "\nREADER CSS STRING OK" : "\nREADER CSS STRING WRONG");
process.exit(ok ? 0 : 1);
