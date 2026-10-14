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
  /**
   * The callers waiting for each pending subject, resolved when its batch answers.
   *
   * A POLLING LOOP used to sit here instead, and it was the bug that made every lookup answer nothing while the route itself answered correctly
   * from the page: the loop's escape hatch (`nothing pending and no frame scheduled`) became true the moment the batch was SENT, because sending
   * clears both — so the very first 10ms tick returned `undefined` while the request was still in flight. Promises cannot race that way.
   */
  readonly waiters: Map<string, ((hash: string | undefined) => void)[]>;
  flush: number | null;
}

const caches = new Map<string, Cache>();

function cacheOf(cwd: string): Cache {
  const existing = caches.get(cwd);
  if (existing !== undefined) return existing;
  const created: Cache = { known: new Map(), pending: new Set(), waiters: new Map(), flush: null };
  caches.set(cwd, created);
  return created;
}

/** Hand one subject's answer to everybody waiting for it. */
function settle(cache: Cache, subject: string, hash: string | undefined): void {
  for (const waiter of cache.waiters.get(subject) ?? []) waiter(hash);
  cache.waiters.delete(subject);
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
      if (!response.ok) throw new Error(`commit-hashes ${String(response.status)}`);
      const data = await response.json() as { hashes?: Record<string, string> };
      for (const subject of subjects) {
        // Absent is an ANSWER too: the host looked and did not find it, so asking again would only cost a request.
        const hash = data.hashes?.[subject] ?? '';
        cache.known.set(subject, hash);
        settle(cache, subject, hash === '' ? undefined : hash);
      }
    }).catch(() => {
      // Nothing cached, and every waiter is told so: the next mount may ask again, which is the right trade for a server that is briefly away.
      for (const subject of subjects) settle(cache, subject, undefined);
    });
  };
  if (typeof requestAnimationFrame === 'function') cache.flush = requestAnimationFrame(send) as unknown as number;
  else cache.flush = setTimeout(send, 0) as unknown as number;
}

/**
 * The short hash of `subject` in `cwd`, or undefined when the repository does not carry it (or the host cannot be reached).
 *
 * Resolves immediately for anything already answered, so a lane that remounts — scrolling, folding, a re-render — never asks twice. Callers of the
 * same subject in the same batch share ONE promise, and the promise settles exactly when that batch answers.
 */
export function commitHashOf(cwd: string | undefined, subject: string): Promise<string | undefined> {
  if (cwd === undefined || cwd === '' || subject === '') return Promise.resolve(undefined);
  const cache = cacheOf(cwd);
  const known = cache.known.get(subject);
  if (known !== undefined) return Promise.resolve(known === '' ? undefined : known);
  const answer = new Promise<string | undefined>(resolve => {
    const waiters = cache.waiters.get(subject);
    if (waiters === undefined) cache.waiters.set(subject, [resolve]);
    else waiters.push(resolve);
  });
  cache.pending.add(subject);
  schedule(cwd, cache);
  return answer;
}
