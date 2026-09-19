/**
 * Reports identifiers the steps pill uses but never declares.
 *
 * Written after a dead-branch cleanup removed a declaration while a use survived: valid
 * syntax, so the parser is happy, and the pill's error boundary hid the failure at runtime
 * — the symptom was "the pill vanished", not a crash.
 *
 * Comments and string literals are stripped first. Without that the scan reports prose
 * ("the", "count", "__PURE__") and every UI label, which is noise that makes the check
 * worthless.
 *
 * Usage: node check-pill-scope.mjs [--file <bundle>]
 *
 * `--file` exists so the check can be pointed at a deliberately broken copy, which is how
 * its own effectiveness is verified: a checker that has never reported a known-bad input
 * is indistinguishable from one that reports nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const fileAt = process.argv.indexOf("--file");
const BUNDLE = fileAt === -1
  ? join(ROOT, "lib/client.js")
  : process.argv[fileAt + 1];
if (BUNDLE === undefined) throw new Error("--file needs a path");
const text = readFileSync(BUNDLE, "utf8");

/**
 * Slice the compiled pill out of the bundle by its SOURCE region, then by brace matching.
 *
 * This used to search for `const StepsPillPill = (0, react.memo)` and stop at
 * `function StepsPill(props)`. Both are shapes one particular rolldown/minifier run happens
 * to emit: an otherwise identical rebuild names the component from the source
 * (`const Pill = memo(function Pill…)`) and the checker reported "pill component not
 * found" — a false alarm that reads exactly like a real defect. Rolldown prints one
 * `//#region <source path>` per module in every build, so the source path is the stable
 * anchor.
 *
 * Inside the region, the component is found by its `react.memo` wrapper and delimited by
 * brace matching rather than by a second symbol name. Scanning the whole region instead
 * would drag in the error boundary's class body, whose members are not identifier uses —
 * that produced nine phantom "undeclared" reports per build.
 */
const regionMatch = /\/\/#region \S*StepsPill\.tsx/.exec(text);
if (regionMatch === null) throw new Error('StepsPill source region not found in the bundle');
const regionEnd = text.indexOf('//#endregion', regionMatch.index);
if (regionEnd === -1) throw new Error('StepsPill source region has no end marker');
// Strip first: the component body contains Chinese UI strings with braces in them.
const region = strip(text.slice(regionMatch.index, regionEnd));
const memoAt = region.indexOf('react.memo)');
if (memoAt === -1) throw new Error('pill memo wrapper not found inside its source region');
/**
 * Declarations are collected from the WHOLE module region; uses are collected only from the
 * memo anchor onward.
 *
 * That split is what makes the scan both complete and quiet. The region also contains the
 * quiet error boundary — a class whose members (`constructor`, `render`, `state`, …) are not
 * identifier uses, and scanning them produced nine phantom reports per build. They all sit
 * before the memo anchor, so starting the use-scan there drops them while the boundary's own
 * name stays visible as a declaration (the export wrapper below the pill does reference it).
 */
const declarations = region;
const usages = region.slice(memoAt);

if (process.argv.includes('--debug')) {
  // A slice that stops short of the offending line reports "ok" for the wrong reason, which
  // is the one failure mode this checker exists for — so its bounds are inspectable.
  console.log(`debug: region ${String(regionMatch.index)}..${String(regionEnd)} (${String(region.length)} chars, stripped)`);
  console.log(`debug: memoAt ${String(memoAt)}; declarations ${String(declarations.length)} chars, usages ${String(usages.length)} chars`);
  console.log(`debug: usages contain "loaded": ${String(usages.includes('loaded'))}`);
}

/** Remove comments and string/template literals. */
function strip(code) {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < code.length) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === quote) break;
        i += 1;
      }
      i += 1;
      out += '""';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const GLOBALS = new Set([
  "window", "document", "console", "Object", "Array", "Map", "Set", "Number", "String",
  "Boolean", "JSON", "Math", "Date", "Promise", "Error", "Symbol", "RegExp", "undefined",
  "null", "true", "false", "this", "void", "typeof", "new", "return", "if", "else", "const",
  "let", "var", "function", "for", "of", "in", "while", "switch", "case", "break", "continue",
  "try", "catch", "finally", "throw", "class", "extends", "super", "default", "delete",
  "instanceof", "await", "async", "export", "import", "from", "as", "do", "Infinity", "NaN",
  "globalThis", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame",
]);

/** Names the enclosing module factory legitimately provides. */
const fromModule = ["react", "react_jsx_runtime", "TurnMetrics_module_css_default", "StepsPillBoundary"];

const declared = new Set([
  ...fromModule,
  ...[...declarations.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...declarations.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  // Declared-function parameters, including destructured ones. Without this a module that
  // exports a wrapper (`function StepsPill(props)`) reports `props` as undeclared.
  ...[...declarations.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim().split("=")[0].trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s)),
  ),
  ...[...declarations.matchAll(/\(\s*\{([^}]*)\}/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim().split(":")[0].split("=")[0].trim()),
  ),
  ...[...declarations.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim()),
  ),
  ...[...declarations.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  // Arrow-function parameters, including the bare single-argument form.
  ...[...declarations.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)].map((m) => m[1]),
  ...[...declarations.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*=>/g)].map((m) => m[1]),
]);

const uses = new Map();
for (const m of usages.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
  const name = m[1];
  if (declared.has(name) || GLOBALS.has(name)) continue;
  const after = usages.slice(m.index + name.length).trimStart();
  if (after.startsWith(":")) continue; // object literal key
  uses.set(name, (uses.get(name) ?? 0) + 1);
}

if (uses.size === 0) {
  console.log("ok  every identifier the pill uses is declared");
  process.exit(0);
}
console.log("undeclared identifiers used by the steps pill:");
for (const [name, count] of uses) console.log(`  ${name} × ${String(count)}`);
process.exit(1);
