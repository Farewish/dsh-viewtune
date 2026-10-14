/**
 * Recording what a session's tool calls actually said, so a commit can be answered by CALL ID.
 *
 * Why this exists. The reading view's 提交 lane reads a commit off the tool call that made it, and everything it can see is the UI projection of
 * that call — which the host TRUNCATES. A long `-m` message arrives as `…`, and a truncated result carries no `[main 1a2b3c4] subject` line at
 * all, so the lane ends up with a subject of `…` and no hash (the reader hit exactly that; the earlier fix looked a hash up by subject, which
 * cannot work when the subject itself was cut away, and pairing by position would show someone else's hash under concurrent commits).
 *
 * The events the host publishes are the UNTRUNCATED originals, so this keeps them: `session/event` fires for every append, and the recorder
 * holds a bounded window per session. Nothing needs to know the event type names — the detection below is the same shape-matching the client
 * has always done, run over the recorded data — which is deliberate: a future event-type rename cannot silently break the lane.
 *
 * Bounded on purpose: this is a cache for the view, not an archive. A session keeps its newest EVENTS_PER_SESSION events and the store keeps
 * SESSIONS sessions; both are small, so a long-running instance cannot grow without limit.
 * @module
 */

/** How many of a session's newest events are kept. A turn's calls and their results sit well inside this. */
const EVENTS_PER_SESSION = 4000;
/** How many sessions are kept. The reader looks at the open one; a few more cover recently visited tabs. */
const SESSIONS = 24;
/** How much of one event's serialized data is searched. A tool result can be large; a commit line sits near its start. */
const SEARCH_LIMIT = 20000;

/** One recorded event, reduced to what the commit detection reads. */
export interface RecordedEvent {
  readonly seq: number;
  readonly time: number;
  readonly type: string;
  /** The event's own data, serialized once, capped at SEARCH_LIMIT characters. */
  readonly text: string;
}

interface SessionRecord {
  readonly events: RecordedEvent[];
  readonly bySeq: Map<number, RecordedEvent>;
}

const sessions = new Map<string, SessionRecord>();

function recordOf(sessionId: string): SessionRecord {
  const existing = sessions.get(sessionId);
  if (existing !== undefined) {
    // Re-insertion keeps Map iteration order as "least recently used first", which is the eviction order below.
    sessions.delete(sessionId);
    sessions.set(sessionId, existing);
    return existing;
  }
  const created: SessionRecord = { events: [], bySeq: new Map() };
  sessions.set(sessionId, created);
  while (sessions.size > SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done === true) break;
    sessions.delete(oldest.value);
  }
  return created;
}

/** Serialize one event's data defensively: a circular or hostile value must not stop the recorder. */
function serialize(data: unknown): string {
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return typeof text === 'string' ? text.slice(0, SEARCH_LIMIT) : '';
  } catch {
    return '';
  }
}

/**
 * Record one appended event. Called for EVERY `session/event`, never throwing: a record that breaks must not take the host down with it.
 */
export function recordSessionEvent(sessionId: string, seq: number, time: number, type: string, data: unknown): void {
  try {
    const session = recordOf(sessionId);
    const event: RecordedEvent = { seq, time, type, text: serialize(data) };
    session.events.push(event);
    session.bySeq.set(seq, event);
    while (session.events.length > EVENTS_PER_SESSION) {
      const dropped = session.events.shift();
      if (dropped === undefined) break;
      session.bySeq.delete(dropped.seq);
    }
  } catch {
    // Nothing to do: the lane simply will not find a hash for whatever this event was.
  }
}

/** How many sessions and events are held, for a test to assert the bounds. */
export function recorderSize(): { sessions: number; events: number } {
  let events = 0;
  for (const session of sessions.values()) events += session.events.length;
  return { sessions: sessions.size, events };
}

/** Forget everything. Exported for tests; the host never calls it. */
export function resetRecorder(): void {
  sessions.clear();
}

/** How much of an event's own text is handed to the detector. */
export const RECORD_SEARCH_LIMIT = SEARCH_LIMIT;

/** The recorded events of one session, oldest first, or empty when nothing was recorded. */
export function recordedEvents(sessionId: string): readonly RecordedEvent[] {
  return sessions.get(sessionId)?.events ?? [];
}