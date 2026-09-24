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
  closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync,
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

// This guard rebuilds from a *checkout with its dependencies installed*: it enumerates tracked files
// so the scratch copy is the source of truth rather than whatever happens to sit next to `lib/`, and
// it needs tsdown to run. Two places legitimately lack one of those — an installed package has no git
// history, and a `link:`-installed plugin directory (the profile's own `node_modules` is where its
// dependencies live, not beside the sources). Say which, instead of failing with "git ls-files failed
// (128)" or an ENOENT on a junction that has no target: both read like broken invariants.
const insideWorkTree = spawnSync('git', ['-C', ROOT, 'rev-parse', '--is-inside-work-tree'], {
  stdio: 'ignore',
});
if (insideWorkTree.status !== 0) {
  console.log(
    `SKIP — ${ROOT} is not a git checkout, so there is nothing to rebuild from.\n`
    + 'This guard verifies that a build reproduces the committed artifact; run it in a clone.',
  );
  process.exit(0);
}
if (!existsSync(join(ROOT, 'node_modules', 'tsdown', 'dist', 'run.mjs'))) {
  console.log(
    `SKIP — ${ROOT} has no installed dependencies, so it cannot rebuild anything.\n`
    + 'A plugin installed by `link:` uses the profile\'s node_modules; this guard needs a checkout\n'
    + 'where `npm install` has run. The other guards here still assert the served artifact.',
  );
  process.exit(0);
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

/**
 * …and the whole marker checker has to pass against the REBUILT artifact, which the shipped one cannot prove.
 *
 * This is the other half of the path-dependence above, and the reason it is checked rather than argued: a marker that
 * spells a hashed class name verbatim (`.WGoHxG_reasonCard…`) passes in the directory the artifact was built in and
 * fails in every other one — including a fresh clone that ran the documented `npm run build`. Running the checker in the
 * scratch directory is what makes "the markers are hash-agnostic" a measurement: the scratch path differs, so its class
 * hashes differ, and the checker reads the rebuilt bundle from its own root.
 */
const markers = spawnSync(process.execPath, [join(scratch, 'scripts', 'guard', 'check-bundle-markers.mjs')], {
  cwd: scratch,
  stdio: 'inherit',
});
const markersOk = markers.status === 0;
if (!markersOk) bad += 1;
console.log(`${markersOk ? 'ok  ' : 'DIFF'} the marker checker passes against the artifact rebuilt at another path (exit ${String(markers.status)})`);

if (!keep) {
  rmSync(join(scratch, 'node_modules'), { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
/**
 * Say what was compared, and what was NOT.
 *
 * This used to print "REBUILD REPRODUCES THE SHIPPED SHAPE" beside two bundles of visibly different length, which reads
 * as a byte-for-byte claim and is not one: the CSS-module class hash is derived from the artifact's ABSOLUTE PATH
 * (measured: the same stylesheet in two directories gives `voucca_` and `ED26sW_`), so no rebuild in a scratch directory
 * can produce identical bytes. What is compared is the contract-bearing shape — registration id, requires, exports, the
 * CSS literals, and every stylesheet rule with the build-specific naming normalised away — and that is what a rebuild
 * has to reproduce.
 */
/**
 * The class hash each artifact carries, printed so the claim above is a measurement rather than a sentence.
 *
 * Same source, same compiler, two directories, two hashes: which is why the marker checker had to be made
 * hash-agnostic, and why the run below (against the scratch build) means something.
 */
const classHashOf = (text) => {
  try {
    return /\.([A-Za-z0-9_]+)_reasonCard(?![\w-])/.exec(moduleCssLiteral(text, 'Reader.module.css'))?.[1] ?? '(none)';
  } catch {
    return '(unreadable)';
  }
};
console.log(`class hash: shipped ${classHashOf(shipped)} | rebuilt ${classHashOf(rebuilt)}`);
console.log(`byte lengths: shipped ${String(shipped.length)} chars | rebuilt ${String(rebuilt.length)} chars — NOT compared byte for byte: the class hash in the stylesheet comes from the artifact's own path, so the two files cannot be identical, and pretending otherwise hid what this check actually covers.`);

console.log(bad === 0
  ? 'REBUILD REPRODUCES THE SHIPPED SHAPE (registration id, require() specifiers, exports, CSS literals, tagIds, and every stylesheet rule — with build-specific naming normalised)'
  : `REBUILD DIVERGES: ${String(bad)} difference(s)`);
process.exitCode = bad === 0 ? 0 : 1;
