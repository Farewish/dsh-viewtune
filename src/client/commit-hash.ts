/**
 * Asking the host for the short hash of a commit it can already see.
 *
 * The 提交 lane reads its hash off git's output line in the tool call that made the commit, which is not always there: a commit made with
 * `-F <file>` has no `-m` to carry a subject, and a piped or truncated output never shows the line at all (the reader's report: the newest
 * commit had a hash and the hundred before it did not). So the hash is recovered from the repository instead, by subject, through
 * `/better-display/commit-hashes`.
 *
 * Cached per working directory, and BATCHED within a frame: a turn can show a dozen commits, they all mount together, and one request for the
 * lot is the difference between one `git log` and a dozen. A failure caches nothing, so a later mount may try again; a subject the host cannot
 * find is remembered as absent, so no request is repeated for it either.
 * @module
 */

export const COMMIT_HASHES_PATH = '/better-display/commit-hashes';

interface Cache {
  readonly known: Map<string, string>;
  readonly pending: Set<string>;
  flush: number | null;
}

const caches = new Map<string, Cache>();

function cacheOf(cwd: string): Cache {
  const existing = caches.get(cwd);
  if (existing !== undefined) return existing;
  const created: Cache = { known: new Map(), pending: new Set(), flush: null };
  caches.set(cwd, created);
  return created;
}

/** One request for everything pending in this directory, on the next frame. */
function schedule(cwd: string, cache: Cache): void {
  if (cache.flush !== null) return;
  const send = (): void => {
    cache.flush = null;
    const subjects = [...cache.pending];
    cache.pending.clear();
    if (subjects.length === 0) return;
    void fetch(COMMIT_HASHES_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, subjects }),
    }).then(async response => {
      if (!response.ok) return;
      const data = await response.json() as { hashes?: Record<string, string> };
      for (const subject of subjects) {
        // Absent is an ANSWER too: the host looked and did not find it, so asking again would only cost a request.
        cache.known.set(subject, data.hashes?.[subject] ?? '' );
      }
    }).catch(() => {
      // Nothing cached: the next mount may ask again, which is the right trade for a server that is briefly away.
    });
  };
  if (typeof requestAnimationFrame === 'function') cache.flush = requestAnimationFrame(send) as unknown as number;
  else cache.flush = setTimeout(send, 0) as unknown as number;
}

/**
 * The short hash of `subject` in `cwd`, or undefined when the repository does not carry it (or the host cannot be reached).
 *
 * Resolves immediately for anything already answered, so a lane that remounts — scrolling, folding, a re-render — never asks twice.
 */
export async function commitHashOf(cwd: string | undefined, subject: string): Promise<string | undefined> {
  if (cwd === undefined || cwd === '' || subject === '') return undefined;
  const cache = cacheOf(cwd);
  const known = cache.known.get(subject);
  if (known !== undefined) return known === '' ? undefined : known;
  cache.pending.add(subject);
  schedule(cwd, cache);
  // Wait for the batch: the answer arrives through the cache, which is also what a second caller rides on.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise(resolve => { setTimeout(resolve, 10); });
    const settled = cache.known.get(subject);
    if (settled !== undefined) return settled === '' ? undefined : settled;
    if (!cache.pending.has(subject) && cache.flush === null) return undefined;
  }
  return undefined;
}
