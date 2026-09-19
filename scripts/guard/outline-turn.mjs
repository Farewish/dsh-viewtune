/**
 * Asserts the wanted layout in the shipped bundle:
 *   user message -> process disclosure (label = 用时 once closed) -> flow
 * with the clickable 用时 pill in its original place at the end of the answer.
 *
 * Usage: node outline-turn.mjs
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
const turnStart = bundle.indexOf('"data-reader-turn-result"');
const turnEnd = bundle.indexOf('showDeliverablesRow(boundary.status', turnStart);
const turn = bundle.slice(turnStart, turnEnd);

const seats = [
  ['every user/steering message (leading slot, rendered first)', '\t\t\t\t\tturnUserKeys.map((userKey) => /* @__PURE__ */'],
  ['process disclosure (label: 用时 X 秒 once the turn closes)', '\n\t\t\t\t\thasProcess && /* @__PURE__ */'],
  ['status-only fallback (inside the disclosure block)', '\n\t\t\t\t\t!hasProcess && boundary.status === "open"'],
  ['main flow container (system prompt, reasoning card, tools, answer)', '\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\tid: flowId,'],
];

const found = seats
  .map(([label, needle]) => ({ label, at: turn.indexOf(needle) }))
  .filter((seat) => seat.at !== -1)
  .sort((left, right) => left.at - right.at);

console.log('turn children, in rendered (document) order:');
for (const [index, seat] of found.entries()) console.log(`  ${String(index + 1)}. ${seat.label}   @${String(seat.at)}`);

const actions = bundle.indexOf('Reader_module_css_default.answerActions');
const checks = {
  'turn order is user -> disclosure -> flow': turn.indexOf('\t\t\t\t\tturnUserKeys.map') < turn.indexOf('\n\t\t\t\t\thasProcess &&')
    && turn.indexOf('\n\t\t\t\t\thasProcess &&') < turn.indexOf('id: flowId'),
  'all user/steering nodes are collected': bundle.includes('group.keys.filter((key) => {\n\t\t\t\tconst kind = snapshot.nodes.get(key)?.kind;'),
  'every user message is rendered in the leading slot': bundle.includes('turnUserKeys.map((userKey) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BlockBoundary, {'),
  'user nodes are excluded from the flow': bundle.includes('const mainKeys = group.keys.filter((key) => !turnUserKeys.includes(key));'),
  'MainNode still draws user nodes as a fallback': bundle.includes('if (isNode(node, "user") || isNode(node, "steering")) {\n\t\t\t\tconst blocks = contentBlocks(node.data.content);'),
  'no leftover startsWithUser assumption': !bundle.includes('startsWithUser'),
  'disclosure label still shows the duration': bundle.includes('用时 ${elapsed}'),
  '用时 pill still lives in the answer actions': bundle.slice(actions, actions + 2600).includes('TurnMetrics'),
  'answer actions still keep the clock': bundle.includes('endedAt !== void 0'),
};
for (const [name, pass] of Object.entries(checks)) console.log(`${pass ? 'ok  ' : 'BAD '} ${name}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
