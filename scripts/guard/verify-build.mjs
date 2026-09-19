/**
 * Rebuilds `lib/client.js` from `src/` into a scratch directory and checks that the result still
 * has the shape this repository ships.
 *
 * Why this is the invariant worth asserting: `lib/` is committed, so the published bytes and the
 * sources can drift apart in either direction — a change kept only in the artifact disappears on
 * the next build, and a change only in the source never reaches a user until someone builds. Byte
 * equality is not available as a test (lightningcss re-hashes class and keyframe names, the
 * minifier reorders declarations and picks its own time units, and the formatter is its own), so
 * this compares the parts that *are* the contract:
 *
 *   - the module-table registration id (a mismatch fails the whole page);
 *   - the set of `require()` specifiers (an unanswered require throws at factory execution);
 *   - the exports the loader reads;
 *   - the CSS-module variables and their `tagId` ownership (HMR keys off them);
 *   - the Reader stylesheet's rules and keyframes, normalised for naming, order and units — the
 *     check that actually catches a lost or added rule.
 *
 * Nothing outside the scratch directory is written: only git-tracked files are copied, with
 * `node_modules` junctioned so the build resolves its dependencies.
 *
 * Usage: npm run guard -- verify-build   (or: node scripts/guard/verify-build.mjs [--keep])
 */
import { spawnSync } from 'node:child_process';
import {
  closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { moduleCssLiteral, normaliseCss } from './bundle-anchors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIPPED = join(ROOT, 'lib', 'client.js');
const keep = process.argv.includes('--keep');

/** Run git and capture stdout through a file descriptor (the sandbox forbids piped stdio). */
function gitLines(args) {
  const out = join(mkdtempSync(join(tmpdir(), 'guard-git-')), 'out.txt');
  const fd = openSync(out, 'w');
  const result = spawnSync('git', ['-C', ROOT, ...args], { stdio: ['ignore', fd, 'inherit'] });
  closeSync(fd);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed (${String(result.status)})`);
  return readFileSync(out, 'utf8').split('\n').filter((line) => line !== '');
}

const scratch = mkdtempSync(join(tmpdir(), 'guard-build-'));
for (const name of gitLines(['ls-files'])) {
  const destination = join(scratch, name);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(ROOT, name), destination);
}
symlinkSync(join(ROOT, 'node_modules'), join(scratch, 'node_modules'), 'junction');

const build = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsdown', 'dist', 'run.mjs')], {
  cwd: scratch,
  stdio: 'inherit',
});
if (build.status !== 0) {
  console.error(`\nbuild failed (status ${String(build.status)})`);
  process.exit(1);
}

const rebuilt = readFileSync(join(scratch, 'lib', 'client.js'), 'utf8');
const shipped = readFileSync(SHIPPED, 'utf8');

/** The contract-bearing facts about one bundle. */
function shape(text) {
  return {
    id: /__ModuleLoader__\.load\(\{\s*\n?\s*id: "([^"]+)"/.exec(text)?.[1],
    requires: [...new Set([...text.matchAll(/require\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]))].sort(),
    exports: [...new Set([...text.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]))].sort(),
    literals: [...text.matchAll(/const (css(?:\$\d+)?) = "/g)].map((m) => m[1]).sort(),
    tagIds: [...text.matchAll(/const (tagId(?:\$\d+)?) = "([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`).sort(),
  };
}

/** One stylesheet as `selector -> sorted declarations`, with build-specific naming removed. */
function stylesheet(text, moduleFile) {
  const css = normaliseCss(moduleCssLiteral(text, moduleFile));
  const rules = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m !== null; m = re.exec(css)) {
    const selector = m[1].trim();
    if (selector.startsWith('@keyframes') || selector === 'from' || selector === 'to') continue;
    rules.set(selector, [...new Set(m[2].split(';').map((d) => d.trim()).filter(Boolean))].sort());
  }
  return rules;
}

let bad = 0;
const compare = (label, a, b) => {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) bad += 1;
  console.log(`${same ? 'ok  ' : 'DIFF'} ${label}${same ? '' : `\n     shipped: ${JSON.stringify(a)}\n     rebuilt: ${JSON.stringify(b)}`}`);
};

const a = shape(shipped);
const b = shape(rebuilt);
console.log(`\nshipped ${String(shipped.length)} chars | rebuilt ${String(rebuilt.length)} chars\n`);
compare('module-table registration id', a.id, b.id);
compare('require() specifiers', a.requires, b.requires);
compare('exports', a.exports, b.exports);
compare('CSS module variables', a.literals, b.literals);
compare('CSS module ownership (tagId)', a.tagIds, b.tagIds);

const stylesheetName = 'Reader.module.css';
const sa = stylesheet(shipped, stylesheetName);
const sb = stylesheet(rebuilt, stylesheetName);
compare(`stylesheet rule count (${stylesheetName})`, sa.size, sb.size);
compare('stylesheet selectors only in the shipped artifact', [...sa.keys()].filter((k) => !sb.has(k)), []);
compare('stylesheet selectors only in the rebuilt artifact', [...sb.keys()].filter((k) => !sa.has(k)), []);
compare(
  'stylesheet rules whose declarations differ',
  [...sa.keys()].filter((k) => sb.has(k) && JSON.stringify(sa.get(k)) !== JSON.stringify(sb.get(k))),
  [],
);

if (!keep) {
  rmSync(join(scratch, 'node_modules'), { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? '\nREBUILD REPRODUCES THE SHIPPED SHAPE' : `\nREBUILD DIVERGES: ${String(bad)} difference(s)`);
process.exitCode = bad === 0 ? 0 : 1;
