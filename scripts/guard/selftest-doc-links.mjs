/**
 * `check-doc-links.mjs` is able to fail — the guard's own reverse check, next to `selftest-pill-scope.mjs`.
 *
 * It builds two small fixtures under the system temp directory: one whose document links to a file that exists, and one
 * whose document links to a file that does not (the 0.5.7 mistake, reduced to two lines). The checker must pass the first
 * and fail the second; anything else means the checker answers a question nobody asked.
 *
 * The fixtures are written outside the repository on purpose: a selftest that leaves broken links in `docs/` would be
 * caught by the very checker it is testing, in the next run.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-doc-links.mjs');

/** A fixture root: one shipped document per case, described by `package.json`'s `files`. */
function fixture(links) {
  const root = mkdtempSync(join(tmpdir(), 'viewtune-doc-links-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', files: ['README.md', 'docs'] }, null, 2));
  writeFileSync(join(root, 'README.md'), '# fixture\n\nNot a link to check: https://example.com/\n');
  writeFileSync(join(root, 'docs', 'guide.md'), `${links.join('\n')}\n`);
  writeFileSync(join(root, 'docs', 'present.md'), '# present\n');
  return root;
}

function run(root) {
  // `stdio: 'ignore'` on purpose: this environment cannot give a child a piped stdout (the sandbox refuses the pipe), and a
  // piped spawn comes back with `undefined` output and no status worth reading. The exit code is the whole assertion, which
  // is also what the guard itself reads from its own children.
  return spawnSync(process.execPath, [CHECKER, '--root', root], { stdio: 'ignore' });
}

const good = fixture(['[present](./present.md)', '[fragment](./present.md#heading)', '[absolute](https://example.com/)']);
if (run(good).status !== 0) {
  console.error('the checker rejected a document whose links all resolve');
  process.exit(1);
}
console.log('ok   a document whose links resolve passes');

const bad = fixture(['[missing](./not-here.md)']);
if (run(bad).status === 0) {
  console.error('the checker accepted a document linking to a file that does not exist');
  process.exit(1);
}
console.log('ok   a document linking to a missing file fails');

// The fixtures live outside the repository, so there is nothing to clean up inside it. Assert that much, since it is the
// reason this selftest cannot poison the next run.
if (existsSync(join(HERE, '..', '..', 'docs', 'not-here.md'))) {
  console.error('the selftest left a file inside the repository');
  process.exit(1);
}
console.log('SELFTEST DOC LINKS OK — the checker passes what resolves and fails what does not');
