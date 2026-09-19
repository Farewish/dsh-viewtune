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
  ["toolbar is a sticky lane", hasDecls(css, sel("toolbar"), ["position:sticky", "top:0"])],
  ["toolbar lane has a background", hasDecls(css, sel("toolbar"), ["background:var(--dsw-alias-bg-base)"])],
  ["status lane is not sticky", !hasDecls(css, sel("disclosure"), ["position:sticky"])],
  ["no rule reads a toolbar height", !css.includes("reader-toolbar-height")],
  ["the jump dock keeps its own sticky", declared("jumpDock") && hasDecls(css, sel("jumpDock"), ["position:sticky"])],
  // Toolbar appearance: an explicit lane height with the switches centred in it, and a
  // divider separating the pinned lane from the transcript.
  ["toolbar states its lane height", hasDecls(css, sel("toolbar"), ["min-height:42px"])],
  ["toolbar centres its switches", hasDecls(css, sel("toolbar"), ["align-items:center"])],
  ["toolbar carries a bottom divider", hasDecls(css, sel("toolbar"), ["border-bottom:.5px solid var(--dsw-alias-border-l2)"])],
  ["toolbar adds no inline padding", hasDecls(css, sel("toolbar"), ["padding:4px 0"])],
  // Collapse control. The fade-up on exit only exists if the box survives the animation:
  // `display` is forced on the `[hidden]` rule (the browser would otherwise set
  // `display:none`), and the visibility change is delayed to the end of the animation. Put
  // that change on the `[hidden]` rule instead and the control is hidden on frame one, so
  // the fade is never seen — that was a real reported bug.
  ["collapse control is styled", hasDecls(css, COLLAPSE, ["display:inline-flex"])],
  ["collapse label is no longer cramped", hasDecls(css, COLLAPSE, ["font-size:14px", "line-height:22px"])],
  ["collapse pill is outlined at the divider's tier", hasDecls(css, COLLAPSE, ["border:.5px solid var(--dsw-alias-border-l2)"])],
  ["collapse pill has a resting fill", hasDecls(css, COLLAPSE, ["background:var(--dsw-alias-interactive-bg-hover)"])],
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
