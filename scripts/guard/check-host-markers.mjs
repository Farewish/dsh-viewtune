/**
 * The HOST half's invariants, which had no checker at all.
 *
 * Everything in `scripts/guard/` reads `lib/client.js`. The host bundle — `lib/dsh-viewtune.js`, the half that owns the
 * routes, the settings file and the wallpaper folder — was covered by nothing: its decisions could be reverted and every
 * guard would still say `GUARD OK`. That is the same failure mode the fork's comments call out in the source ("a marker
 * that silently asserted against the wrong thing would be worse than no marker"), one level up.
 *
 * These are not unit tests of behaviour. They are assertions that the compiled host still carries the SHAPES the
 * decisions require, in the bundle the Host actually loads — the cap on each unauthenticated body, the promise that
 * cannot be left unsettled, the answer a failed settings write gets, and the revalidation pair that makes a replaced
 * wallpaper appear. Each one is a bug that was fixed once; the point is that reverting it fails here.
 *
 * Deliberately textual, and deliberately narrow: a marker per decision, no attempt to re-derive the bundle.
 *
 * Usage: node scripts/guard/check-host-markers.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BUNDLE = join(ROOT, 'lib', 'dsh-viewtune.js');

/**
 * Every invariant, as `[what it protects, is-it-there]`.
 *
 * The predicate takes the bundle text so the self-test below can feed it a known-bad one: a checker nobody has seen
 * fail is a checker nobody can trust, and that is asserted rather than promised.
 */
export const INVARIANTS = [
  ["the reveal route's body is capped while it arrives", (bundle) =>
    bundle.includes('readBody(req, REVEAL_MAX_BYTES)')],
  ['that cap is a real number, not a symbol the reader has to trust', (bundle) =>
    /const REVEAL_MAX_BYTES = \d+;/.test(bundle)],
  ["the settings route's body is capped the same way", (bundle) =>
    bundle.includes('readBody(req, SETTINGS_MAX_BYTES)')],
  ["a body reader settles on the request's close, not only on end", (bundle) =>
    // Neither `end` nor `error` is guaranteed on an aborted request, so a route awaiting this promise hung for ever.
    bundle.includes('req.on("aborted", () => {') && bundle.includes('req.on("close", () => {')],
  ['a failed settings WRITE is answered with a failure, not with ok', (bundle) =>
    // The client shows 「未能保存」 on a rejected PUT. Answering 200 for a write that threw made the one surface that
    // reports a lost setting report success.
    /written = await writeSettings\([^)]*\);[\s\S]{0,400}?json\(res, 500, \{/.test(bundle)],
  ['a replaced wallpaper is revalidated rather than served stale for a minute', (bundle) =>
    bundle.includes('"Cache-Control": "private, no-cache"')
    && bundle.includes('ETag: etag,')
    && bundle.includes('if (req.headers["if-none-match"] === etag) {')
    && bundle.includes('res.writeHead(304, headers);')],
  ["the etag is the file's own identity, so an unchanged file still answers 304", (bundle) =>
    /const etag = `W\/"\$\{String\(info\.size\)\}-\$\{String\(Math\.round\(info\.mtimeMs\)\)\}"`;/.test(bundle)],
  ['the wallpaper route is a prefix WITHOUT the trailing slash the matcher would double', (bundle) =>
    // `pathname === prefix || pathname.startsWith(prefix + '/')`, so a registered trailing slash never matches and every
    // thumbnail silently 404s against the server's bare answer.
    bundle.includes('const WALLPAPER_ROUTE = "/better-display/wallpaper";')],
  ['the reveal route answers POST only, and only from this origin', (bundle) =>
    // Both are one-line refusals that a rewrite could drop without any test noticing. Matched as shapes rather than as
    // single lines: the formatter decides where the object literal's properties land.
    /error: "POST only"/.test(bundle) && /if \(!sameOrigin\(req\)\)/.test(bundle)],
];
// What this guard deliberately does NOT cover: the wallpaper FOLDER never reaching the browser. That is asserted on the
// client half, where it belongs (`check-bundle-markers.mjs`, the `no wallpaper folder in the client bundle` marker) —
// the host is the half that is supposed to know the path.

/** The invariant labels this bundle does NOT keep. */
export function violationsOf(bundle) {
  return INVARIANTS.filter(([, holds]) => holds(bundle) !== true).map(([label]) => label);
}

function selfTest() {
  // A bundle with none of the shapes: every invariant must be reported, so the checker cannot be a tautology.
  const absent = violationsOf('');
  if (absent.length !== INVARIANTS.length) {
    console.error(`SELFTEST FAILED — an empty bundle reported ${String(absent.length)} of ${String(INVARIANTS.length)}`);
    process.exit(1);
  }
  // …and once the shapes are there, nothing is reported: a checker that always fails is as useless as one that never does.
  const satisfied = violationsOf(
    'readBody(req, REVEAL_MAX_BYTES)\nconst REVEAL_MAX_BYTES = 4096;\nreadBody(req, SETTINGS_MAX_BYTES)'
    + '\nreq.on("aborted", () => {\nreq.on("close", () => {'
    + '\nwritten = await writeSettings(F, V);\njson(res, 500, {'
    + '\n"Cache-Control": "private, no-cache",\nETag: etag,\nif (req.headers["if-none-match"] === etag) {\nres.writeHead(304, headers);'
    + '\nconst etag = `W/"${String(info.size)}-${String(Math.round(info.mtimeMs))}"`;'
    + '\nconst WALLPAPER_ROUTE = "/better-display/wallpaper";'
    + '\nif (!sameOrigin(req)) {\nres.statusCode = 405;\nerror: "POST only"',
  );
  if (satisfied.length !== 0) {
    console.error(`SELFTEST FAILED — a conforming bundle was reported: ${JSON.stringify(satisfied)}`);
    process.exit(1);
  }
  console.log(`ok   selftest — all ${String(INVARIANTS.length)} invariants fail on an empty bundle and pass on a conforming one`);
}

selfTest();

let bundle;
try {
  bundle = readFileSync(BUNDLE, 'utf8');
} catch {
  console.error(`${BUNDLE} is missing — run \`npm run build\` first.`);
  process.exit(1);
}

const missing = violationsOf(bundle);
if (missing.length > 0) {
  console.error(`HOST STATE WRONG — ${String(missing.length)}/${String(INVARIANTS.length)} invariant(s) missing:`);
  for (const label of missing) console.error(`  MISS ${label}`);
  console.error('\nThe host bundle no longer carries a decision the sources make. Rebuild, or restore the decision.');
  process.exit(1);
}
console.log(`ok   ${String(INVARIANTS.length)} host invariant(s) hold in lib/dsh-viewtune.js`);
