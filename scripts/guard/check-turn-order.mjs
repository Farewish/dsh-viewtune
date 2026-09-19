/**
 * Asserts the turn's rendered order in the bundle:
 *   user message -> process disclosure (label = 用时 once closed) -> main flow
 * The main flow holds the system prompt, the reasoning and the answer, so this is
 * what renders 我的话 -> 用时（可点击）-> 思考/回答 for every turn, with or without
 * a system prompt. The status-only fallback is part of the disclosure block, so it
 * is not ordered here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout this guard lives in (see the note in run.mjs). */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/**
 * In the repository the plugin *is* the checkout, so the lookups these guards used to make
 * against an installed profile (`plugin-location.mjs`) reduce to the root and its manifest.
 */
const installedPluginDir = () => ROOT;
const pluginPackageName = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;

const bundle = readFileSync(join(installedPluginDir(), 'lib', 'client.js'), 'utf8');

const start = bundle.indexOf('"data-reader-turn-result"');
const end = bundle.indexOf('showDeliverablesRow(boundary.status', start);
const region = bundle.slice(start, end);

// Line-start forms only: `hasProcess &&` also occurs inside the status copy.
const order = [
  ['every user message (leading slot)', '\t\t\t\t\tturnUserKeys.map'],
  ['process disclosure', '\n\t\t\t\t\thasProcess &&'],
  ['main flow (system prompt + reasoning + answer)', '\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\tid: flowId,'],
];

let last = -1;
let ok = true;
for (const [name, needle] of order) {
  const at = region.indexOf(needle);
  const ordered = at !== -1 && at > last;
  if (!ordered) ok = false;
  console.log(`${ordered ? 'ok  ' : 'BAD '} ${name} @ ${String(at)}`);
  last = at;
}

// Only array-slot occurrences are real blocks; `hasProcess` also appears inside a
// status string further down.
const slotDisclosures = (region.match(/\n\t{5}hasProcess &&/g) ?? []).length;
const slotFlow = (region.match(/\n\t{5}\/\* @__PURE__ \*\/ \(0, react_jsx_runtime\.jsx\)\("div", \{\n\t{6}id: flowId,/g) ?? []).length;
console.log(`disclosure slots: ${String(slotDisclosures)}, flow slots: ${String(slotFlow)}`);
if (slotDisclosures !== 1 || slotFlow !== 1) ok = false;

// The user node is rendered from the turn's own slot, not from the flow.
const userFromTurnSlot = bundle.includes('const mainKeys = group.keys.filter((key) => !turnUserKeys.includes(key));');
console.log(`${userFromTurnSlot ? 'ok  ' : 'BAD '} flow keys exclude the user node`);
if (!userFromTurnSlot) ok = false;

console.log(ok ? 'TURN ORDER OK' : 'TURN ORDER WRONG');
process.exit(ok ? 0 : 1);
