/**
 * Verifies the compiled shape of this session's four changes, one at a time.
 *
 * The question is not whether the source looks right but whether the artifact does — and
 * whether the data actually reaches it. The checks below walk each change end to end: where
 * its data comes from, what the compiled code does with it, and what the user sees.
 *
 * Style assertions go through the anchor helpers: lightningcss re-hashes class names and
 * reorders declarations on every build, so a rule matched by a verbatim string verifies one
 * build rather than the rule. Values the compiler may fold or inline are matched as
 * expressions instead of statements.
 *
 * Usage: node verify-session-changes.mjs [bundlePath]
 */
import { readFileSync } from "node:fs";
import { classSel, hasDecls, moduleCssLiteral, ruleDecls } from "./bundle-anchors.mjs";
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
const readerCss = moduleCssLiteral(text, "Reader.module.css");

function between(startNeedle, endNeedle, from = 0) {
  const at = text.indexOf(startNeedle, from);
  if (at === -1) return null;
  const end = text.indexOf(endNeedle, at);
  return end === -1 ? null : text.slice(at, end + endNeedle.length);
}

const checks = [];
const add = (name, pass, detail = "") => checks.push({ name, pass, detail });

// ---------------------------------------------------- 1. steps pill: data → render
{
  // The end of this memo used to be anchored on its dependency array — `[group.keys, nodes,
  // group.turn]` — which is the minifier's spelling, so the extraction returned null and took
  // two real assertions down with it. End at the next hook instead.
  const lookup = (() => {
    const start = "const turnProcess = (0, react.useMemo)";
    const at = text.indexOf(start);
    if (at === -1) return null;
    // Search past THIS occurrence: the start needle itself contains `(0, react.useMemo)`, so
    // looking from inside it re-finds it and yields a 20-character window.
    const next = text.indexOf("(0, react.useMemo)", at + start.length);
    return text.slice(at, next === -1 ? at + 2000 : next);
  })();
  add("reader finds the process record", lookup !== null);
  add("record is scoped to this turn", (lookup ?? "").includes("data.turn !== group.turn"));
  add("record skips nodes that are not the record", (lookup ?? "").includes('isNode(n, "turn-process")'));

  const memo = between("const metrics = (0, react.useMemo)", "]);");
  add("record reaches the action row", (memo ?? "").includes("steps: turnProcess ?"));
  add("total steps come from the turn", (memo ?? "").includes("totalSteps: turn?.steps.length"));

  const call = between('(0, react_jsx_runtime.jsx)(StepsPill, {', "});");
  add("pill is rendered in the action row", call !== null);
  add("pill receives the record", (call ?? "").includes("data: metrics.steps.data"));
  add("pill receives the total", (call ?? "").includes("totalSteps: metrics.steps.totalSteps"));

  const row = between("Reader_module_css_default.answerActions", "children: receipt");
  const pillAt = (row ?? "").indexOf("StepsPill");
  const clockAt = (row ?? "").indexOf("MessageClock");
  add("pill sits before the closing clock", pillAt !== -1 && clockAt !== -1 && pillAt < clockAt);

  // Truncation: hidden, so the numbers can never contradict each other.
  // The published artifact kept `const truncated = …` as a declaration; a rebuild inlines the
  // single-use constant into the guard, so the expression — not the statement — is the anchor.
  const guard = text.includes("answer !== null && total !== null && answer > total");
  add("truncation is detected", guard);
  add("truncated turns render nothing", /if \(truncated\) return null;|if \(answer !== null && total !== null && answer > total\) return null;/.test(text));
  add("no cross-scope subtraction", !text.includes("${total - answerStep}"));
  // A truncated turn renders nothing, so nothing downstream needs a partial-count branch:
  // the ratio is built from the turn's own total, after the guard has already returned.
  add("ratio uses the turn's own total", text.includes("`${answer}/${total} 个步骤`"));
  add("no dead partial-count branch", !text.includes('truncated ? "已加载步骤"') && !text.includes("const loaded = truncated"));
  add("the caveat line is gone", !text.includes("这里只有事件序号与计数"));
}

// ------------------------------------------------- 2. system prompt scrollport
{
  const SYSTEM_PROMPT = classSel(readerCss, 'systemPrompt');
  add("prompt has a dedicated class", text.includes("Reader_module_css_default.systemPrompt"));
  add("prompt keeps the legacy class too", /Reader_module_css_default\.toolRaw[\s\S]{0,60}Reader_module_css_default\.systemPrompt/.test(text));
  add("prompt rule exists", ruleDecls(readerCss, SYSTEM_PROMPT).size > 0);
  add("prompt rule bounds the height", hasDecls(readerCss, SYSTEM_PROMPT, ["max-height:320px"]));
  add("prompt rule scrolls", hasDecls(readerCss, SYSTEM_PROMPT, ["overflow:auto"]));
  add("prompt rule keeps the frame", hasDecls(readerCss, SYSTEM_PROMPT, ["border-radius:8px"]));
}

// ------------------------------------------------------ 3. command-input branch
{
  const branch = between('if (node.kind === "command-input") {', "});");
  add("command input branch exists", branch !== null);
  add("branch renders a labelled bubble", (branch ?? "").includes("命令输入"));
  add("branch renders the command text", (branch ?? "").includes("data.text"));
  add("branch is a user bubble", (branch ?? "").includes("Reader_module_css_default.user"));
  add("commandInput style exists", ruleDecls(readerCss, classSel(readerCss, "commandInput")).size > 0);
}

// ------------------------------------------------------------ 4. chat-flow hook
{
  const column = between("className: Reader_module_css_default.column", "children: [");
  add("reader column carries data-chat-flow", (column ?? "").includes('"data-chat-flow": ""'));
}

// ----------------------------------------------------------------- the report
let ok = true;
for (const c of checks) {
  if (!c.pass) ok = false;
  console.log(`${c.pass ? "ok  " : "BAD "} ${c.name}`);
}
console.log(`\n${String(checks.filter((c) => c.pass).length)}/${String(checks.length)} passed`);
console.log(ok ? "SESSION CHANGES VERIFIED" : "SESSION CHANGES HAVE PROBLEMS");
process.exit(ok ? 0 : 1);
