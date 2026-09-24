/**
 * Every CSS-module class the sources USE has a rule in the stylesheet they import.
 *
 * A CSS-module class name is hashed at build time, so a name with no rule behind it compiles to `undefined`: the
 * element renders with no class attribute at all and nothing anywhere reports it. Five `<select>`s in the settings
 * panel shipped exactly that way — referenced from the panel, declared in no stylesheet — so its choice rows were the
 * browser's own grey controls in the middle of a themed panel, for as long as nobody looked.
 *
 * A set comparison is the only thing that can catch it: no runtime assertion can see a missing class, because the
 * failure IS the absence of a value React is happy to render.
 *
 * Deliberately one-directional. The reverse (a rule nothing references) is worth knowing about but not worth failing
 * on: `:global(...)` blocks, and classes applied from outside this tree, are both legitimate.
 *
 * Known leniency, so it is not mistaken for coverage: a name that appears anywhere in a module's text counts as
 * declared, including inside `:global(...)`, where it is not in the module's map at all.
 *
 * Usage: node scripts/guard/check-stylesheet-classes.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SRC = join(ROOT, 'src');

/** Blank out comments, so a class name mentioned in prose is not read as a use. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** The class names a stylesheet declares. Over-collects on purpose: see the leniency note above. */
export function declaredClasses(cssText) {
  const names = new Set();
  for (const match of withoutComments(cssText).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1]);
  return names;
}

/**
 * The class uses in one source text that the given stylesheet does not declare.
 *
 * The pure core of the check: the self-test feeds it a pair that has never existed on disk, and `main` feeds it the
 * real files. `alias` is the local name the module was imported under (`css`, `md`, …).
 */
export function missingClasses(sourceText, declared, alias) {
  const body = withoutComments(sourceText);
  const pattern = new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, 'g');
  const missing = [];
  for (const use of body.matchAll(pattern)) {
    if (declared.has(use[1])) continue;
    missing.push({ line: body.slice(0, use.index).split('\n').length, name: use[1] });
  }
  return missing;
}

function filesUnder(directory, suffix) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path, suffix));
    else if (entry.endsWith(suffix) && !entry.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

/** The alias a source file imported a given module stylesheet under, if any. */
function importsOf(sourceText) {
  const imports = [];
  for (const found of sourceText.matchAll(/import\s+(\w+)\s+from\s+['"](\.[^'"]*\.module\.css)['"]/g)) {
    imports.push({ alias: found[1], relativePath: found[2] });
  }
  return imports;
}

function selfTest() {
  const declared = declaredClasses('.present { color: red }');
  const source = [
    "import css from './__selftest__.module.css';",
    'const a = css.present;',
    'const b = css.missing;',
    '// css.alsoMissing is only mentioned in a comment',
  ].join('\n');
  const missing = missingClasses(source, declared, 'css');
  const passes = missing.length === 1 && missing[0].name === 'missing' && missing[0].line === 3;
  if (!passes) {
    console.error(`SELFTEST FAILED — expected exactly css.missing on line 3, got ${JSON.stringify(missing)}`);
    process.exit(1);
  }
  const guarded = missingClasses('import css from "./m.module.css";\nconst a = css.thing;', declaredClasses('.thing{}'), 'css');
  if (guarded.length !== 0) {
    console.error(`SELFTEST FAILED — a declared class was reported: ${JSON.stringify(guarded)}`);
    process.exit(1);
  }
  console.log('ok   selftest — an undeclared module class is reported, a declared one is not, comments ignored');
}

// Always, not behind a flag: a checker nobody has seen fail is a checker nobody can trust, and this one is cheap.
selfTest();

const sources = filesUnder(SRC, '.ts').concat(filesUnder(SRC, '.tsx'))
  .map(path => ({ path, text: readFileSync(path, 'utf8') }));
const stylesheets = new Map();
const declaredFor = (path) => {
  if (!stylesheets.has(path)) stylesheets.set(path, declaredClasses(readFileSync(path, 'utf8')));
  return stylesheets.get(path);
};

const violations = [];
let scanned = 0;
const unreadable = [];
for (const { path, text } of sources) {
  for (const { alias, relativePath } of importsOf(text)) {
    const stylesheet = resolve(dirname(path), relativePath);
    let declared;
    // A stylesheet that cannot be READ is a violation, not a skip. `continue` here meant a renamed, moved or deleted
    // `.module.css` — the exact mistake this checker exists for — silently removed its own subject from the scan, and
    // the run still ended in `ok`.
    try {
      declared = declaredFor(stylesheet);
    } catch (error) {
      unreadable.push({ path, stylesheet, error });
      continue;
    }
    scanned += 1;
    for (const item of missingClasses(text, declared, alias)) {
      violations.push({ ...item, path: relative(ROOT, path).replace(/\\/g, '/'), stylesheet: relative(ROOT, stylesheet).replace(/\\/g, '/') });
    }
  }
}

if (unreadable.length > 0) {
  console.error(`STYLESHEET UNREADABLE — ${String(unreadable.length)}`);
  for (const item of unreadable) {
    console.error(`  ${relative(ROOT, item.path).replace(/\\/g, '/')} imports ${relative(ROOT, item.stylesheet).replace(/\\/g, '/')}: ${String(item.error)}`);
  }
  console.error('\nA css module that cannot be read cannot be checked, so its classes are unverified.');
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`STYLESHEET CLASSES MISSING — ${String(violations.length)}`);
  for (const item of violations) {
    console.error(`  ${item.path}:${String(item.line)} — css.${item.name} has no rule in ${item.stylesheet}`);
  }
  console.error('\nA class with no rule compiles to `undefined`: the element gets no class and nothing fails.');
  process.exit(1);
}
console.log(`ok   every css.<name> used in src/ has a rule (${String(scanned)} stylesheet import(s) checked)`);
