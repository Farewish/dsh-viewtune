/**
 * Every relative link in the documents this package ships must resolve.
 *
 * This guard exists because of a mistake that no other check could see. The 0.5.7 READMEs pointed at a write-up under
 * `_tmp/`, which is the WORKSPACE's scratch directory — one level above this repository — so the file was never tracked
 * by git and never existed here at all. The artifact was fine, the types were fine, the tests were fine, and both READMEs
 * shipped a link to nothing.
 *
 * What it checks: the documents listed in `package.json`'s `files` (the same list the package is built from, so a
 * document that is not shipped is not this guard's business), plus the two READMEs, which are always shipped.
 *
 * What it ignores: absolute URLs, `mailto:`, and pure fragments. What it verifies: the target after any `#fragment` or
 * `?query` is stripped resolves on disk, relative to the document that links to it.
 *
 * Usage: node scripts/guard/check-doc-links.mjs [--root <dir>]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');

/** `--root <dir>` exists so the selftest can point this checker at a fixture that is known to be broken. */
function rootFrom(argv) {
  const at = argv.indexOf('--root');
  if (at === -1) return DEFAULT_ROOT;
  const value = argv[at + 1];
  if (value === undefined) {
    console.error('--root needs a directory');
    process.exit(2);
  }
  return resolve(value);
}

const ROOT = rootFrom(process.argv.slice(2));

/** The documents to check: everything `files` marks as shipped, kept to Markdown. */
function shippedDocuments() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const entries = Array.isArray(pkg.files) ? pkg.files : [];
  const docs = [];
  for (const entry of entries) {
    const full = join(ROOT, entry);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) {
      for (const file of readdirSync(full)) if (extname(file) === '.md') docs.push(join(entry, file));
      continue;
    }
    if (extname(entry) === '.md') docs.push(entry);
  }
  // The READMEs are always shipped even if a `files` entry is later renamed, so they are checked unconditionally.
  for (const name of ['README.md', 'README.en.md']) if (!docs.includes(name) && existsSync(join(ROOT, name))) docs.push(name);
  return [...new Set(docs)].sort();
}

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** One document's links, as `{ target, line }`. */
function linksOf(text) {
  const found = [];
  for (const match of text.matchAll(LINK)) {
    const target = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target)) continue; // absolute URL, mailto:, data:
    if (target.startsWith('#')) continue;
    const line = text.slice(0, match.index).split('\n').length;
    found.push({ target, line });
  }
  return found;
}

const documents = shippedDocuments();
if (documents.length === 0) {
  console.error(`no shipped documents found under ${ROOT} — is this the plugin root?`);
  process.exit(1);
}

const broken = [];
for (const document of documents) {
  const text = readFileSync(join(ROOT, document), 'utf8');
  for (const { target, line } of linksOf(text)) {
    const path = target.split('#')[0].split('?')[0];
    if (path === '') continue;
    const resolved = isAbsolute(path) ? path : join(ROOT, dirname(document), path);
    if (!existsSync(resolved)) broken.push({ document, line, target });
  }
}

console.log(`checked ${String(documents.length)} shipped document(s):`);
for (const document of documents) console.log(`  ${document}`);
if (broken.length === 0) {
  console.log('\nDOC LINKS OK — every relative link resolves');
  process.exit(0);
}
console.error(`\nDOC LINKS FAILED — ${String(broken.length)} broken link(s):`);
for (const { document, line, target } of broken) console.error(`  ${document}:${String(line)} -> ${target}`);
console.error('A link here is read by someone who installed the package: fix it or drop it.');
process.exit(1);
