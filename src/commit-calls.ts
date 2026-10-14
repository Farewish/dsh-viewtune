/**
 * The commits a session actually made, answered by CALL ID from the untruncated events.
 *
 * The client cannot always name a commit: the UI projection truncates a long call, so a subject can arrive as `…` and the result can lose git's
 * own line. The events are the originals, so this walks the recorded ones in order, runs the shared parsing over each, and returns the commits it
 * recognises keyed by the call they belong to. A caller with a `callId` then gets the RIGHT hash — no positional pairing and no time window,
 * which is what a concurrent commit to the same repository would break.
 *
 * A call's id is looked for in the event's own data under the names the harness uses, and when no id can be found the commit is still reported,
 * in order, so a caller that knows no ids either can pair positionally as a last resort. Nothing here throws: an event that cannot be read is
 * skipped.
 * @module
 */

import { commitSummary, commitSubject, GIT_COMMIT, UNKNOWN_COMMIT } from './commit-parse.js';
import { recordedEvents, RECORD_SEARCH_LIMIT, type RecordedEvent } from './commit-record.js';

export interface RecordedCommit {
  /** The call this commit belongs to, when the event carried an id. */
  readonly callId?: string;
  readonly hash?: string;
  readonly subject: string;
}

const CALL_ID_FIELDS: readonly string[] = ['callId', 'callID', 'id', 'toolCallId', 'tool_call_id'];

/** The names a shell command travels under in this harness's tool calls, matching the client's own reader. */
const COMMAND_FIELDS: readonly string[] = ['command', 'cmd', 'script', 'input'];

/**
 * The command inside one recorded event, or undefined when the event is not a command-carrying call.
 *
 * The event arrives SERIALIZED, so the command is a string INSIDE JSON — and the client's quoting rule (which strips quoted spans so prose cannot
 * look like a commit) must NOT be applied to the whole document: in JSON every string is quoted, so that would erase the command itself. That is
 * exactly the bug the recorder's own test caught. This walks the parsed value for the fields a command can live under and hands back the raw
 * string, which needs no unquoting at all.
 */
export function commandIn(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): string | undefined => {
    if (depth > 6 || value === null || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (COMMAND_FIELDS.includes(key) && typeof inner === 'string' && inner !== '') return inner;
    }
    for (const inner of Object.values(value as Record<string, unknown>)) {
      const found = walk(inner, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(parsed, 0);
}

/**
 * Every string inside one recorded event, joined by real newlines.
 *
 * Git's summary line lives in a RESULT, which is a string inside the serialized event — and `commitSummary` anchors its patterns to a line start,
 * so it has to see real newlines rather than the `\n` escapes of JSON. Joining the strings (and unescaping them) gives it exactly the text the
 * tool printed.
 */
export function textIn(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return '';
  }
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || seen.has(value)) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (typeof value !== 'object') return;
    seen.add(value);
    for (const inner of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) walk(inner, depth + 1);
  };
  walk(parsed, 0);
  return parts.join('\n');
}

/** A call id inside one serialized event, under any of the names the harness uses at its call sites. */
function callIdOf(text: string): string | undefined {
  for (const field of CALL_ID_FIELDS) {
    const match = new RegExp(`"${field}"\\s*:\\s*"([^"]{1,200})"`).exec(text);
    if (match !== null && match[1] !== undefined && match[1] !== '') return match[1];
  }
  return undefined;
}

/** One recorded event paired with the id it names, if any. */
function idOf(event: RecordedEvent): string | undefined {
  return callIdOf(event.text);
}

/**
 * Every commit the recorded events prove, oldest first.
 *
 * The detection is the client's own: the command comes from an event whose text carries `git commit`, and git's line comes from the event that
 * carries the matching id (the result). A commit is reported when either half is present, because either half is useful — a hash with no subject
 * still pastes into `git show`.
 */
export function recordedCommits(sessionId: string): readonly RecordedCommit[] {
  const events = recordedEvents(sessionId);
  const commits: RecordedCommit[] = [];
  const seen = new Set<string>();
  // Results can arrive in the same event as the call (a folded event), or in a later one carrying the same id; both are covered by reading
  // every event for a git line and remembering it by id.
  const summaries = new Map<string, { hash?: string; subject?: string }>();
  for (const event of events) {
    // The RESULT text, unescaped: git's own line anchors to a line start, so it must see real newlines rather than JSON escapes.
    const summary = commitSummary(textIn(event.text).slice(0, RECORD_SEARCH_LIMIT));
    const id = idOf(event);
    if (id !== undefined && summary.hash !== undefined) summaries.set(id, summary);
  }
  for (const event of events) {
    // The command string itself, taken out of the serialized event (see `commandIn` for why it is not the whole event that is unquoted).
    const command = commandIn(event.text);
    if (command === undefined || !GIT_COMMIT.test(command)) continue;
    const id = idOf(event);
    const summary = id === undefined ? undefined : summaries.get(id);
    const fromCommand = commitSubject(command);
    const subject = fromCommand === UNKNOWN_COMMIT && summary?.subject !== undefined && summary.subject !== ''
      ? summary.subject
      : fromCommand;
    const hash = summary?.hash;
    const key = `${id ?? ''}\u0000${hash ?? ''}\u0000${subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    commits.push(hash === undefined ? { ...(id === undefined ? {} : { callId: id }), subject } : { ...(id === undefined ? {} : { callId: id }), hash, subject });
  }
  return commits;
}

/** The commits the recorded events prove, keyed by call id — what the route answers. */
export function recordedCommitsByCall(sessionId: string, callIds: readonly string[]): Record<string, { hash?: string; subject: string }> {
  const wanted = new Set(callIds);
  const byCall: Record<string, { hash?: string; subject: string }> = {};
  for (const commit of recordedCommits(sessionId)) {
    if (commit.callId === undefined || !wanted.has(commit.callId)) continue;
    byCall[commit.callId] = commit.hash === undefined ? { subject: commit.subject } : { hash: commit.hash, subject: commit.subject };
  }
  return byCall;
}