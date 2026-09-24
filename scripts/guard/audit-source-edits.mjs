/**
 * Audits the fork's own source edits for the defects that manual bundle-first work invites.
 *
 * The bundle used to be hand-edited while the source was a mirror, so the two could drift, dead
 * branches lingered after a decision changed, and references to removed features survived. The
 * repository now *builds* `lib/` from `src/` again, which removes the drift by construction —
 * but this still checks the decisions themselves, because a hand edit can also be lost in the
 * other direction: a change kept only in the artifact disappears on the next rebuild, and a
 * leftover in the source survives every rebuild.
 *
 * Bundle-side markers for anything the compiler may rewrite are predicates (see the anchor
 * helpers); a verbatim string on the bundle side would assert one build's output.
 *
 * Usage: node audit-source-edits.mjs
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
const read = (p) => readFileSync(`${REPO}/${p}`, "utf8");

const source = {
  reader: read("src/client/Reader.tsx"),
  blocks: read("src/client/Blocks.tsx"),
  pill: read("src/client/StepsPill.tsx"),
  projection: read("src/client/projection.ts"),
  types: read("src/client/types.ts"),
  metrics: read("src/client/TurnMetrics.module.css"),
};
const bundle = read("lib/client.js");

const findings = [];
const note = (severity, file, message) => findings.push({ severity, file, message });
const has = (text, needle) => text.includes(needle);

// ---------------------------------------------------------------- 1. dead branches
// The pill decides truncation and then renders the muted "out of window" marker, which builds no
// label and no numbers. Text that only a numbered branch could reach is still unreachable — the
// decision to withhold the number did not change, only the decision to say so.
if (has(source.pill, "if (truncated) {")) {
  for (const [name, needle] of [
    ["历史窗口截断", "历史窗口截断"],
    ["不在当前历史窗口内", "不在当前历史窗口内"],
    ["已加载的步骤不完整", "已加载的步骤不完整"],
  ]) {
    if (has(source.pill, needle)) {
      note("DEAD", "StepsPill.tsx", `unreachable branch text kept: ${name}`);
    }
  }
}

// ------------------------------------------------- 2. references to removed features
for (const [name, needle] of [
  ["history backfill", "fillHistory"],
  ["backfill loop", "backfill."],
  ["fill pages counter", "fillPages"],
  ["backfill diagnostic", "backfill probe"],
]) {
  for (const [file, text] of Object.entries(source)) {
    if (has(text, needle)) note("LEFTOVER", file, `still references the removed ${name}`);
  }
  if (has(bundle, needle)) note("LEFTOVER", "lib/client.js", `still references the removed ${name}`);
}

// ------------------------------------------------------ 3. the pill's own structure
{
  const p = source.pill;
  const guardAt = p.indexOf("if (truncated) {");
  const markerAt = p.indexOf('data-ud-check="steps-window"');
  const labelAt = p.indexOf("const label =");
  const truncAt = p.indexOf("const truncated =");
  const answerAt = p.indexOf("const answer = answerStep;");

  for (const [name, at] of [
    ["truncation computed", truncAt],
    ["answer position kept absolute", answerAt],
    ["the out-of-window branch", guardAt],
    ["the out-of-window marker", markerAt],
    ["label built", labelAt],
  ]) {
    if (at === -1) note("BAD", "StepsPill.tsx", `missing step: ${name}`);
  }
  // The branch has to run before the label exists, or a truncated turn still builds one.
  if (guardAt !== -1 && labelAt !== -1 && guardAt > labelAt) {
    note("BAD", "StepsPill.tsx", "the truncation branch runs after the label is built");
  }
  // ...and it must render the marker rather than a bare null: that was the old decision, and a
  // silent pill is what this fork set out to remove.
  if (guardAt !== -1 && markerAt !== -1 && markerAt < guardAt) {
    note("BAD", "StepsPill.tsx", "the marker is declared before the branch that renders it");
  }
  if (truncAt !== -1 && guardAt !== -1 && truncAt > guardAt) {
    note("BAD", "StepsPill.tsx", "truncation is tested after the guard that needs it");
  }
  if (has(p, "answerStep > total ? null : answerStep")) {
    note("STALE", "StepsPill.tsx", "old clamp-to-null logic still present");
  }

  // The module exports the memoised component inside the boundary; both must be there.
  if (!/export const StepsPill = memo\(/.test(p) && !/export function StepsPill/.test(p)) {
    note("BAD", "StepsPill.tsx", "no exported StepsPill component");
  }
  if (!has(p, "class QuietBoundary")) note("BAD", "StepsPill.tsx", "error boundary class is gone");
  if (!has(p, "<QuietBoundary>")) note("BAD", "StepsPill.tsx", "the component is not wrapped in the boundary");
}

// ------------------------------------------------------------- 4. wiring in Blocks
{
  const b = source.blocks;
  if (!has(b, "<StepsPill")) note("BAD", "Blocks.tsx", "the pill is not rendered");
  if (!has(b, "metrics.steps")) note("BAD", "Blocks.tsx", "the pill receives no data");
  if (!has(b, "import { StepsPill }")) note("BAD", "Blocks.tsx", "the pill is not imported");
  const at = b.indexOf("<StepsPill");
  const clock = b.indexOf("<MessageClock");
  if (at !== -1 && clock !== -1 && at > clock) {
    note("BAD", "Blocks.tsx", "the pill is not before the closing clock");
  }
}

// ------------------------------------------------------- 5. reader-side data supply
{
  const r = source.reader;
  if (!has(r, "turn-process")) note("BAD", "Reader.tsx", "the reader never looks for the process record");
  if (!has(r, "steps: turnProcess ?")) note("BAD", "Reader.tsx", "the record is not passed to the actions");
  if (!has(r, "data-chat-flow")) note("BAD", "Reader.tsx", "the chat-flow hook is missing");
  if (!has(r, "(node.kind as string) === 'command-input'")) {
    note("BAD", "Reader.tsx", "the command-input branch is missing");
  }
  if (!has(r, "css.systemPrompt")) note("BAD", "Reader.tsx", "the system prompt has no dedicated class");
  // Dead wiring: something computed but never used would be a leftover.
  for (const [name, needle] of [
    ["incompleteOldestTurn", "incompleteOldestTurn"],
    ["isUserKey", "isUserKey"],
    ["TurnProcessChatData", "TurnProcessChatData"],
  ]) {
    const count = r.split(needle).length - 1;
    if (count === 1 && needle !== "TurnProcessChatData") {
      note("SUSPECT", "Reader.tsx", `${name} appears only once (import or use, not both)`);
    }
  }
}

// --------------------------------------------------------- 6. artifact cross-check
{
  /**
   * Each row: the decision, and whether each side satisfies it — so every row, including the one about an ABSENCE
   * (`no backfill`, already negated in the tuple), agrees on `true`.
   *
   * The comparison used to be `inSource !== inBundle`, which reads "neither side carries it" as agreement. That is the
   * exact failure mode these rows exist for: revert the decision in `src/` and rebuild, and the two sides go missing
   * together while the suite stays green. Both sides must satisfy the row, and a missing pair is named as such.
   */
  const decisions = [
    ["pill marks an out-of-window turn", has(source.pill, 'data-ud-check="steps-window"'), has(bundle, '"data-ud-check": "steps-window"')],
    ["pill is boundary-wrapped", has(source.pill, "QuietBoundary"), pillBoundaryClass(bundle) !== undefined],
    ["reader scopes the record to this turn", has(source.reader, "data.turn !== group.turn"), has(bundle, "data.turn !== group.turn")],
    ["chat-flow hook", has(source.reader, "data-chat-flow"), has(bundle, '"data-chat-flow": ""')],
    ["system prompt class", has(source.reader, "css.systemPrompt"), has(bundle, "Reader_module_css_default.systemPrompt")],
    ["command-input branch", has(source.reader, "'command-input'"), has(bundle, '"command-input"')],
    ["dual class on the prompt", has(source.reader, "css.toolRaw} ${css.systemPrompt"), /Reader_module_css_default\.toolRaw[\s\S]{0,60}Reader_module_css_default\.systemPrompt/.test(bundle)],
    ["popNote style", has(source.metrics, ".popNote"), moduleCssLiteral(bundle, "TurnMetrics.module.css").includes("_popNote{")],
    ["no backfill", !has(source.reader, "fillHistory"), !has(bundle, "fillHistory")],
  ];
  for (const [name, inSource, inBundle] of decisions) {
    if (!inSource || !inBundle) {
      const missing = inSource || inBundle ? "" : "  (neither side carries it)";
      note("DRIFT", "source vs lib/client.js", `${name}: source=${String(inSource)} bundle=${String(inBundle)}${missing}`);
    }
  }
}

// ------------------------------------------------------------------- the report
if (findings.length === 0) {
  console.log("SOURCE AUDIT OK — no dead branches, no leftovers, no drift");
  process.exit(0);
}
const order = { BAD: 0, DRIFT: 1, DEAD: 2, LEFTOVER: 3, STALE: 4, SUSPECT: 5 };
for (const f of findings.sort((a, b) => order[a.severity] - order[b.severity])) {
  console.log(`${f.severity.padEnd(9)} ${f.file.padEnd(22)} ${f.message}`);
}
console.log(`\n${String(findings.length)} finding(s)`);
process.exit(1);
