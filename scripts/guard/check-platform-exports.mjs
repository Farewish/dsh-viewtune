/**
 * Every platform export the artifact references must EXIST in the installed platform packages.
 *
 * This is the check the 0.2.0 rebase proved it needed. The typecheck already refuses a name that the platform's `.d.ts`
 * does not export — but it reads the SOURCE, and the thing the browser loads is `lib/client.js`, which the platform
 * resolves by name at page load. A bundle left stale against a renamed export (the icon set moved from drawn size to
 * stroke weight in 0.2.0: `IconBrowseOutline16` → `IconBrowseOutlineRegular`) typechecks perfectly and then renders
 * nothing, because the module system hands back `undefined`. Nothing else in this suite looks at what the artifact
 * requires from OUTSIDE itself: `compare-source-and-bundle.mjs` compares it to `src/`, and the marker checker searches
 * its own text.
 *
 * How it reads the platform side without executing it: the packages import `.css`, so they cannot be loaded in Node at
 * all. Their built files are ESM with a final `export { a, b as c };` list, so the names are read from that list — and
 * the mechanism is asserted rather than assumed: a package whose export list cannot be found is a failure, not a pass.
 *
 * Usage: node scripts/guard/check-platform-exports.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BUNDLE = join(ROOT, 'lib', 'client.js');

/**
 * The external packages the artifact requires, and the local binding the bundler gives each.
 *
 * Read from the artifact rather than hardcoded: the emitted form is `let <binding> = require("<specifier>")`, and a
 * platform package added or removed is exactly the kind of change this guard should follow without being edited.
 */
export function requiredExternals(bundleText) {
  const found = [];
  for (const match of bundleText.matchAll(/let\s+([A-Za-z_$][\w$]*)\s*=\s*require\("([^"]+)"\)/g)) {
    found.push({ binding: match[1], specifier: match[2] });
  }
  return found;
}

/** A built platform file's ESM export names, from its `export { … }` lists. */
export function exportNamesOf(builtText) {
  const names = new Set();
  for (const match of builtText.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const entry of match[1].split(',')) {
      const name = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** The members the artifact reads off one external binding, e.g. `<binding>.IconBrowseOutlineRegular`. */
export function referencedMembers(bundleText, binding) {
  const pattern = new RegExp(`${binding}\\.([A-Za-z_$][\\w$]*)`, 'g');
  return [...new Set([...bundleText.matchAll(pattern)].map((match) => match[1]))].sort();
}

/**
 * Findings for one bundle, given a resolver for its specifiers.
 *
 * `resolve` returns the built file's path and text, or throws. Kept injectable so the self-test below can drive the
 * whole comparison without a node_modules tree.
 */
export function findingsFor(bundleText, resolve) {
  const findings = [];
  for (const { binding, specifier } of requiredExternals(bundleText)) {
    // React and its JSX runtime are resolved and replaced by the loader, and this fork reads no named member off them.
    if (!specifier.startsWith('@deepseek-ai/')) continue;
    const used = referencedMembers(bundleText, binding);
    if (used.length === 0) continue;
    let resolved;
    try {
      resolved = resolve(specifier);
    } catch (error) {
      findings.push(`${specifier}: cannot be resolved from this checkout (${String(error)})`);
      continue;
    }
    const names = exportNamesOf(resolved.text);
    if (names.size === 0) {
      findings.push(`${specifier}: no export list found in ${resolved.file} — the read mechanism does not match this build`);
      continue;
    }
    for (const member of used) {
      if (!names.has(member)) findings.push(`${specifier}: the artifact reads ${member}, which the installed package does not export`);
    }
  }
  return findings;
}

function selfTest() {
  const head = 'let _p = require("@deepseek-ai/dsh-client-ui-primitives");\n';
  const conforming = head + '_p.IconPresent;\n';
  const missingOne = head + '_p.IconPresent;\n_p.IconAbsent;\n';
  const present = { file: 'fake/index.js', text: 'const IconPresent = 1;\nexport { IconPresent };\n' };
  const withBoth = findingsFor(conforming, () => present);
  // The same package, asked about a bundle that also reads a member it does not export.
  const withMissing = findingsFor(missingOne, () => present);
  if (withBoth.length !== 0) {
    console.error(`SELFTEST FAILED — a conforming package was reported: ${JSON.stringify(withBoth)}`);
    process.exit(1);
  }
  if (withMissing.length !== 1 || !withMissing[0].includes('IconAbsent')) {
    console.error(`SELFTEST FAILED — the missing member was not the only finding: ${JSON.stringify(withMissing)}`);
    process.exit(1);
  }
  // A package that cannot be read is a FAILURE, not a skip: the names are the whole question.
  const unresolvable = findingsFor(conforming, () => { throw new Error('not installed'); });
  if (unresolvable.length !== 1 || !unresolvable[0].includes('cannot be resolved')) {
    console.error(`SELFTEST FAILED — an unresolvable package was not reported: ${JSON.stringify(unresolvable)}`);
    process.exit(1);
  }
  // …and an export list that cannot be found must fail rather than pass on an empty set.
  const unreadable = findingsFor(conforming, () => ({ file: 'fake/index.js', text: 'module.exports = {};' }));
  if (unreadable.length !== 1 || !unreadable[0].includes('no export list found')) {
    console.error(`SELFTEST FAILED — a build with no export list was not reported: ${JSON.stringify(unreadable)}`);
    process.exit(1);
  }
  console.log('ok   selftest — a missing member, an unresolvable package and an unreadable build are all reported; a conforming one is not');
}

selfTest();

const bundleText = readFileSync(BUNDLE, 'utf8');
const requireFromPlugin = createRequire(BUNDLE);
const findings = findingsFor(bundleText, (specifier) => {
  const file = requireFromPlugin.resolve(specifier);
  return { file, text: readFileSync(file, 'utf8') };
});

if (findings.length > 0) {
  console.error(`PLATFORM EXPORTS MISSING — ${String(findings.length)}`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error('\nThe artifact requires these names from the installed platform packages. A name that is not exported is');
  console.error('`undefined` at page load — a control that silently renders nothing, not a build error.');
  process.exit(1);
}
const externals = requiredExternals(bundleText).filter((entry) => entry.specifier.startsWith('@deepseek-ai/'));
console.log(`ok   every platform member the artifact reads exists in the installed packages (${String(externals.length)} external package(s))`);
