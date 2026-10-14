/**
 * Looking a commit's short hash up by its SUBJECT.
 *
 * Why this exists, host-side: the reading view's 提交 lane reads a commit off the tool call that made it, and the only place a hash is ever
 * visible there is git's own output line (`[main 70beff5] subject`). A commit made with `-F <file>` has no `-m` to read, and when the call's
 * output is piped or truncated that line never reaches the plugin, so the lane shows a subject with no hash — which is what the reader
 * reported (「之前的百条提交都不显示哈希」). The repository still knows the answer, so the host answers it: one `git log` per working
 * directory, matched by subject.
 *
 * Host-side and free of HTTP, like `wallpaper-files.ts`: the route in `dsh-viewtune.ts` is a thin shell over this, and the parsing — the part
 * worth testing — is a pure function.
 * @module
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** How far back to look. Deep enough for any turn this reader will open, shallow enough to stay instant. */
const LOG_DEPTH = 3000;

/** What git prints between the short hash and the subject (`%x1f`, a unit separator — a subject may contain anything else). */
const FIELD_SEPARATOR = '\u001f';

/**
 * `git log --format=%h%x1f%s` output, as subject → short hash.
 *
 * The FIRST hash wins for a repeated subject: `git log` is newest-first, so the newest commit with that subject is the one a turn just made.
 * Subjects are matched whole and case-sensitively — the subject is what the reader sees in the lane, and a fuzzy match would put a hash on a
 * commit that is not the one shown.
 */
export function parseCommitLog(text: string): Record<string, string> {
  const bySubject: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const separator = line.indexOf(FIELD_SEPARATOR);
    if (separator <= 0) continue;
    const hash = line.slice(0, separator).trim();
    const subject = line.slice(separator + 1).trim();
    if (hash === '' || subject === '' || bySubject[subject] !== undefined) continue;
    bySubject[subject] = hash;
  }
  return bySubject;
}

/**
 * The short hashes of the subjects asked for, in the repository at `cwd`.
 *
 * Answers only what it can prove: a subject the log does not carry is simply absent, and any failure (not a repository, git missing, a
 * timeout, a directory that is not there) answers an empty record rather than throwing — a lane that cannot show a hash must never break the
 * reading view.
 */
export async function commitHashes(cwd: string, subjects: readonly string[]): Promise<Record<string, string>> {
  if (subjects.length === 0) return {};
  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) return {};
  } catch {
    return {};
  }
  let stdout = '';
  try {
    // `execFile`, never a shell: the working directory is the reader's own, and nothing here reaches a command line.
    const result = await run('git', ['-C', cwd, 'log', '--all', '--no-merges', `-n${String(LOG_DEPTH)}`, '--format=%h%x1f%s'], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch {
    return {};
  }
  const bySubject = parseCommitLog(stdout);
  const wanted: Record<string, string> = {};
  for (const subject of subjects) {
    const found = bySubject[subject];
    if (found !== undefined) wanted[subject] = found;
  }
  return wanted;
}
