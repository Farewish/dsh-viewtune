/**
 * Compares the compiled bundle against its source mirror decision by decision.
 *
 * This was written when a full typecheck was believed impossible here (the client UI packages
 * were said not to be published separately — they are, and `verify-types.mjs` now runs the real
 * check). What this still adds is a *correspondence* check: the artifact and `src/` are edited
 * as a pair, so a change applied to one and not the other shows up instead of hiding. Type
 * checking cannot see that, because it only ever looks at the source.
 *
 * For each decision this fork made, it reports the source form and the bundle form. Markers the
 * compiler is free to rewrite are predicates rather than strings; see the note above `pairs`.
 *
 * Usage: node compare-source-and-bundle.mjs
 */
import { readFileSync } from "node:fs";
import { moduleCssLiteral, pillBoundaryClass } from "./bundle-anchors.mjs";
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const REPO = ROOT;
const source = {
  reader: readFileSync(`${REPO}/src/client/Reader.tsx`, "utf8"),
  blocks: readFileSync(`${REPO}/src/client/Blocks.tsx`, "utf8"),
  pill: readFileSync(`${REPO}/src/client/StepsPill.tsx`, "utf8"),
  types: readFileSync(`${REPO}/src/client/types.ts`, "utf8"),
  metrics: readFileSync(`${REPO}/src/client/TurnMetrics.module.css`, "utf8"),
};
const bundle = readFileSync(`${REPO}/lib/client.js`, "utf8");

/**
 * Each entry: decision, a source-side marker, a bundle-side marker.
 *
 * A bundle-side marker may be a predicate instead of a string. The compiled side legitimately
 * differs from the source in ways that are not drift — the minifier inlines a single-use
 * constant (`truncated`), renames a local to the source's own name (`QuietBoundary`), re-hashes
 * a CSS class, and re-spells an array literal — so a verbatim string there asserts one build's
 * output rather than the decision the row is about. Anything the compiler is free to rewrite is
 * written as a predicate; anything checked against the source stays a string.
 */
const pairs = [
  ["pill: truncation test", "const truncated = answer !== null && total !== null && answer > total;", (b) => b.includes("answer !== null && total !== null && answer > total")],
  ["pill: hides when truncated", "if (truncated) return null;", (b) => /if \(truncated\) return null;|if \(answer !== null && total !== null && answer > total\) return null;/.test(b)],
  ["pill: loaded count only in the ratio", "`${answer}/${loaded} 个步骤`", "`${answer}/${loaded} 个步骤`"],
  ["pill: error boundary", "class QuietBoundary", (b) => pillBoundaryClass(b) !== undefined],
  ["pill: boundary wraps the component", "<QuietBoundary>", (b) => {
    const boundary = pillBoundaryClass(b);
    return boundary !== undefined && b.includes(`${boundary}, {`);
  }],
  ["pill: copy", "轮次过程记录", "轮次过程记录"],
  ["pill: fields shown", "data.toolCallCount", "data.toolCallCount"],
  ["reader: record scoped to the turn", "data.turn !== group.turn", "data.turn !== group.turn"],
  ["reader: record lookup skips others", "!isNode(n, 'turn-process')", '!isNode(n, "turn-process")'],
  ["reader: record handed to actions", "steps: turnProcess ?", "steps: turnProcess ?"],
  ["reader: chat-flow hook", 'data-chat-flow=""', '"data-chat-flow": ""'],
  ["reader: prompt class", "css.systemPrompt", "Reader_module_css_default.systemPrompt"],
  ["reader: prompt keeps the old class", "css.toolRaw} ${css.systemPrompt", (b) => /Reader_module_css_default\.toolRaw[\s\S]{0,60}Reader_module_css_default\.systemPrompt/.test(b)],
  ["reader: command-input branch", "=== 'command-input'", '=== "command-input"'],
  ["reader: command bubble", "css.commandInput", "Reader_module_css_default.commandInput"],
  ["blocks: pill rendered", "<StepsPill", "(0, react_jsx_runtime.jsx)(StepsPill, {"],
  ["blocks: pill gets its data", "metrics.steps.data", "metrics.steps.data"],
  ["blocks: actions still gated on metrics", "metrics.steps !== undefined", "metrics.steps !== void 0"],
  ["css: popNote rule", ".popNote", (b) => moduleCssLiteral(b, "TurnMetrics.module.css").includes("_popNote{")],
];

let mismatched = 0;
for (const [name, inSource, inBundle] of pairs) {
  const hasSource = source.reader.includes(inSource) || source.blocks.includes(inSource)
    || source.pill.includes(inSource) || source.types.includes(inSource) || source.metrics.includes(inSource);
  const hasBundle = typeof inBundle === "function" ? inBundle(bundle) : bundle.includes(inBundle);
  if (hasSource === hasBundle) {
    console.log(`ok    ${name}  (${hasSource ? "both" : "neither"})`);
  } else {
    mismatched += 1;
    console.log(`DRIFT ${name}  source=${String(hasSource)} bundle=${String(hasBundle)}`);
  }
}

// Type-only declarations cannot appear in a compiled bundle, so they are checked on the
// source side alone: declared once, and actually imported where it is used.
{
  const declared = source.types.includes("export interface TurnProcessChatData");
  const imported = source.reader.includes("TurnProcessChatData");
  const used = source.reader.includes("as TurnProcessChatData");
  const ok = declared && imported && used;
  if (!ok) mismatched += 1;
  console.log(`${ok ? "ok    " : "DRIFT "} types: process record declared, imported and used`);
}

// The bundle must not carry anything the source does not describe.
const forbidden = [
  ["removed backfill", "fillHistory"],
  ["removed backfill loop", "backfill.current"],
  ["removed diagnostic", "backfill probe"],
  ["withdrawn pill text", "不在当前历史窗口内"],
];
console.log("");
for (const [name, needle] of forbidden) {
  const present = bundle.includes(needle);
  if (present) mismatched += 1;
  console.log(`${present ? "BAD " : "ok  "} ${name} absent from the bundle`);
}

console.log(`\n${String(mismatched)} mismatch(es)`);
console.log(mismatched === 0 ? "SOURCE AND BUNDLE AGREE" : "SOURCE AND BUNDLE DISAGREE");
process.exit(mismatched === 0 ? 0 : 1);
