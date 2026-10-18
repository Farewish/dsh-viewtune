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
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** How far back to look. Deep enough for any turn this reader will open, shallow enough to stay instant. */
const LOG_DEPTH = 3000;

/** The most directories one lookup will stat, so a huge workspace cannot turn a lane render into a filesystem crawl. */
const REPO_CANDIDATES = 60;

/** Directories never worth walking into: build output, dependencies, and version control's own storage. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'build', '.next', 'out', 'coverage']);

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
  // A null-prototype map: a commit subject may legally be `toString` or `__proto__`, and a plain `{}`
  // would read those as inherited members and never record the hash.
  const bySubject: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of text.split('\n')) {
    const separator = line.indexOf(FIELD_SEPARATOR);
    if (separator <= 0) continue;
    const hash = line.slice(0, separator).trim();
    const subject = line.slice(separator + 1).trim();
    if (hash === '' || subject === '' || bySubject[subject] !== undefined) continue;
    bySubject[subject] = hash;
  }
  return { ...bySubject };
}

/**
 * The directories worth asking `git log` about, given where the session says it works.
 *
 * The session's own `cwd` is the WORKSPACE ROOT, and that is not always the repository: this project keeps the plugin in a git WORKTREE
 * (`worktree/dsh-viewtune`), so `git log` in the root fails with `fatal: not a git repository` and every subject lookup answered nothing —
 * while a hand-typed worktree path worked. Rather than trust one directory, this offers the candidates that can hold the commit: the directory
 * itself, its ancestors (a repository above the session's folder is a real layout), and its immediate and second-level children (a worktree is
 * exactly that). Bounded on purpose: at most REPO_CANDIDATES directories are stat-ed, so a huge workspace cannot turn one lane render into a
 * filesystem crawl.
 */
async function candidateDirs(cwd: string): Promise<readonly string[]> {
  const found: string[] = [];
  const push = (dir: string): void => {
    if (found.length < REPO_CANDIDATES && !found.includes(dir)) found.push(dir);
  };
  push(resolve(cwd));
  // Ancestors, nearest first.
  let current = resolve(cwd);
  for (let up = 0; up < 4; up += 1) {
    const parent = dirname(current);
    if (parent === current) break;
    push(parent);
    current = parent;
  }
  // Children and grandchildren: a git worktree or a nested project lives here.
  const list = async (dir: string): Promise<readonly string[]> => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter(entry => entry.isDirectory() && !SKIP_DIRS.has(entry.name)).map(entry => join(dir, entry.name));
    } catch {
      return [];
    }
  };
  for (const dir of found.slice(0, 2)) {
    for (const child of await list(dir)) {
      push(child);
      for (const grandchild of await list(child)) push(grandchild);
    }
  }
  return found;
}

/** A lookup's answer plus whether any repository actually answered it. */
export interface CommitHashesResult {
  readonly hashes: Record<string, string>;
  /** False when nothing could be asked (missing cwd, no git, every invocation failed). */
  readonly queried: boolean;
}

/**
 * The short hashes of the subjects asked for, in whichever repository under `cwd` actually carries them.
 *
 * Answers only what it can prove: a subject no repository carries is simply absent, and any failure (not a repository, git missing, a timeout)
 * answers an empty record rather than throwing — a lane that cannot show a hash must never break the reading view. Discovery is safe by
 * construction: a candidate is accepted only because a WANTED SUBJECT matched inside it, so a wrong directory cannot produce a wrong hash.
 *
 * `queried` separates "the host looked and did not find it" from "the host could not look": the client
 * may cache the first answer and must retry the second.
 */
export async function commitHashesResult(cwd: string, subjects: readonly string[]): Promise<CommitHashesResult> {
  if (subjects.length === 0) return { hashes: {}, queried: true };
  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) return { hashes: {}, queried: false };
  } catch {
    return { hashes: {}, queried: false };
  }
  const wanted = new Set(subjects);
  const found: Record<string, string> = Object.create(null) as Record<string, string>;
  let queried = false;
  for (const dir of await candidateDirs(cwd)) {
    let stdout = '';
    try {
      // `execFile`, never a shell: the directory is the reader's own, and nothing here reaches a command line.
      const result = await run('git', ['-C', dir, 'log', '--all', '--no-merges', `-n${String(LOG_DEPTH)}`, '--format=%h%x1f%s'], {
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      stdout = result.stdout;
      queried = true;
    } catch {
      // Not a repository (or git is unavailable): the next candidate may be.
      continue;
    }
    const bySubject = parseCommitLog(stdout);
    for (const subject of subjects) {
      if (found[subject] !== undefined) continue;
      const hash = bySubject[subject];
      if (hash !== undefined) found[subject] = hash;
    }
    if (Object.keys(found).length === wanted.size) break;
  }
  return { hashes: { ...found }, queried };
}

/** The hash map alone, for callers that need no cacheability answer. */
export async function commitHashes(cwd: string, subjects: readonly string[]): Promise<Record<string, string>> {
  return (await commitHashesResult(cwd, subjects)).hashes;
}
