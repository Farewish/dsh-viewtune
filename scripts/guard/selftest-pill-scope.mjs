/**
 * Proves the pill scope checker catches the fault it was written for.
 *
 * The checker was added after a dead-branch cleanup deleted `const loaded` while a use
 * survived. Its first run reported "ok" against a copy that still had the declaration, so
 * the check itself was unverified — a checker that has never flagged a known-bad input
 * proves nothing.
 *
 * This builds the exact broken state (declaration removed, use kept) in a scratch copy and
 * requires the checker to name `loaded`, then confirms the healthy bundle still passes.
 *
 * Usage: node selftest-pill-scope.mjs
 *
 * The child's report is captured through a temporary FILE, never a pipe: the file sandbox
 * forbids piped child stdio, so the previous `spawnSync(..., { encoding: "utf8" })` form
 * returned `status: null, error: EPERM` for *both* inputs. That made the selftest report
 * "the broken bundle is rejected" (it was — by EPERM) and "healthy bundle passes" as BAD,
 * i.e. it looked like a battery of real findings when the checker had never actually run.
 */
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from 'node:url';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const TOOLS = join(ROOT, "../..");
const CHECKER = join(ROOT, 'scripts', 'guard', 'check-pill-scope.mjs');
const HEALTHY = join(ROOT, "lib/client.js");

const run = (file) => {
  const log = join(tmpdir(), `pillscope-${String(Date.now())}-${String(Math.random()).slice(2)}.log`);
  const fd = openSync(log, "w");
  const res = spawnSync(process.execPath, [CHECKER, "--file", file], {
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const output = readFileSync(log, "utf8");
  rmSync(log, { force: true });
  return { status: res.status, output };
};

// 1. A healthy bundle must pass.
const healthy = run(HEALTHY);
console.log(`${healthy.status === 0 ? "ok  " : "BAD "} healthy bundle passes`);
if (healthy.status !== 0) console.log(healthy.output.trim());

// 2. The known-bad state must be caught, by name.
const scratch = join(mkdtempSync(join(tmpdir(), "pillscope-")), "broken.js");
let broken = readFileSync(HEALTHY, "utf8");
const use = "const label = answer !== null";
if (!broken.includes(use)) throw new Error("could not build the broken case: label anchor missing");
// Re-introduce the fault: the use stays, the declaration goes.
broken = broken.replace(
  use,
  "const label = answer !== null && loaded !== null",
);
if (broken === readFileSync(HEALTHY, "utf8")) throw new Error("could not build the broken case");
writeFileSync(scratch, broken, "utf8");

const detected = run(scratch);
const namesIt = detected.output.includes("loaded");
console.log(`${detected.status !== 0 ? "ok  " : "BAD "} broken bundle is rejected`);
console.log(`${namesIt ? "ok  " : "BAD "} and the report names the undefined identifier`);
if (detected.status === 0 || !namesIt) {
  console.log(detected.output.trim());
}
rmSync(scratch, { force: true });

const ok = healthy.status === 0 && detected.status !== 0 && namesIt;
console.log(ok ? "\nSCOPE CHECKER VERIFIED" : "\nSCOPE CHECKER IS NOT TRUSTWORTHY");
process.exit(ok ? 0 : 1);
