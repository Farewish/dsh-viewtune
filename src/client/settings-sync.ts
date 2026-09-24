/**
 * The reader's settings, on their way to and from the host.
 *
 * The store persists to `localStorage`, and `localStorage` is keyed by ORIGIN — scheme, host and port.
 * The GUI is served on an ephemeral port, so that copy is a different, empty one on every launch: the
 * reported "every time I quit DSH, all of viewtune's settings are reset". The host keeps the copy that
 * survives (see `../viewtune-settings.ts`), and this module is the client's end of it: read it once at
 * startup, write it back as the reader changes things.
 *
 * The write is DEBOUNCED rather than immediate — dragging an opacity slider is a hundred states a
 * second, and each one would be a request — and it is flushed when the reading view goes away, so the
 * last move a reader made is never the one that gets lost.
 */
export const READER_SETTINGS_PATH = '/better-display/settings';

/**
 * The part of the reader's state the HOST record is allowed to carry: the preferences, and nothing else.
 *
 * `expanded` is what one session's reading looks like — which turns' processes the reader had opened — keyed by bare
 * turn identifiers (`turn:236:closed:completed`) and never pruned. It went into the same shared file as the
 * preferences, which cost three things: a second session inherited the first one's choices for the same key (turn
 * numbering restarts at 1 in every session, so `turn:5` collides trivially), the map grew for as long as the reader
 * kept opening things, and once it pushed the file past the host's ceiling (`SETTINGS_MAX_BYTES`) the host would refuse
 * the WHOLE record and this module's write would report nothing — so the first symptom of that growth would have been
 * every setting silently ceasing to persist, across restarts, with nothing anywhere saying so.
 *
 * A function of its own rather than a filter at the call sites, so the record's shape is stated once and can be tested
 * without a server. The browser's OWN copy is deliberately left alone (`localStorage` through the store): it is keyed
 * by origin and this GUI is served on an ephemeral port, so it is born and dies with one page — and inside one page's
 * lifetime, restoring the expansion choices is exactly what the reader wants.
 */
export function hostRecordOf<T extends object>(state: T): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === 'expanded') continue;
    record[key] = value;
  }
  return record;
}

/**
 * How long a settled state waits before it is sent.
 *
 * Long enough to swallow a drag, short enough that a reader who changes something and immediately quits
 * still gets it written — and the flush on the way out covers the rest.
 */
export const SETTINGS_SAVE_DELAY_MS = 400;

/**
 * What a read of the host's record actually established.
 *
 * Three outcomes, and the whole point is that they are NOT collapsed into "no settings". A record that was read,
 * a host that answered that nothing is stored, and a read that failed call for three different things from the caller:
 * take this record, seed the record from this browser, or touch the record not at all. Collapsing the last two — which
 * is what `undefined` did — means a transient failure reads as "nothing stored", and the caller's seed then replaces a
 * record it never managed to fetch with whatever this origin happens to hold: the defaults, on a fresh port.
 */
export type HostSettingsRead =
  | { kind: 'stored'; record: Record<string, unknown> }
  | { kind: 'empty' }
  | { kind: 'unavailable' };

/**
 * Read the host's record.
 *
 * `empty` is the host answering `{}`, which it does before anything has ever been stored. Every failure — offline,
 * refused, a body that is not a record, a body that is not even JSON — is `unavailable`, and the caller keeps its
 * hands off the record. A reader whose settings cannot be fetched still gets a working app; what they must not get is
 * a working app that quietly overwrote the settings it failed to fetch.
 */
export async function loadHostSettings(): Promise<HostSettingsRead> {
  try {
    const res = await fetch(READER_SETTINGS_PATH, { headers: { accept: 'application/json' } });
    if (!res.ok) return { kind: 'unavailable' };
    const body = await res.json() as { settings?: unknown };
    const settings = body.settings;
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return { kind: 'unavailable' };
    return Object.keys(settings).length > 0 ? { kind: 'stored', record: settings as Record<string, unknown> } : { kind: 'empty' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * Whether a refusal has been reported yet.
 *
 * ONCE per session, deliberately. A refusal is not a hiccup: the host answered that this is not a record it will keep,
 * so nothing the reader changes from here on is stored — which is worth one line, and not one per change, because a
 * dragged slider is a hundred writes a second. It is one of the two halves of the same story: a READ that failed is
 * now told apart from an empty record (see `loadHostSettings`), and a WRITE that was refused stops being invisible
 * here. Without this, the first symptom of any future unbounded key would be a settings file that quietly stopped
 * changing, which is exactly what the per-turn expansion map was on its way to becoming.
 */
let refusalReported = false;

/**
 * Send one record. Never throws: a failed write leaves the reader working and the next change retries.
 *
 * `keepalive` is what makes the flush on the way out true. The writer's flush runs on `pagehide` and on teardown, and a
 * plain `fetch` started there is NOT guaranteed to go out — the page may be gone before it is sent, which is exactly the
 * case the flush exists for ("a reader who changes something and closes the tab inside the debounce window"). The flag
 * asks the browser to finish the request outside the page's lifetime; the 64 KB body limit it comes with is three orders
 * of magnitude above a settings record (the host caps those at 64 KiB anyway).
 *
 * The answer says whether the record was STORED, not merely answered, because the writer uses it: a record this client
 * already stored is not sent again (see `createSettingsWriter`), and a write that failed must not be mistaken for one
 * that landed.
 */
export async function saveHostSettings(state: unknown): Promise<boolean> {
  try {
    const res = await fetch(READER_SETTINGS_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true,
    });
    // Only a record the host ACCEPTED is announced: the app-wide backdrop follows what is actually
    // stored, so a refused or failed write cannot make the window show something no restart would.
    if (!res.ok) {
      if (!refusalReported) {
        refusalReported = true;
        console.warn(`[viewtune] the settings record was not stored (HTTP ${String(res.status)}), so nothing changed from now on will be saved`);
      }
      return false;
    }
    if (state === null || typeof state !== 'object' || Array.isArray(state)) return true;
    for (const listener of [...listeners]) listener(state as Record<string, unknown>);
    return true;
  } catch {
    // Deliberately silent: the browser's own copy is still there, and the whole record is re-sent on
    // the next change, so there is nothing to repair and nothing worth interrupting a reader over.
    return false;
  }
}

type SettingsListener = (record: Record<string, unknown>) => void;
const listeners = new Set<SettingsListener>();

/**
 * Watch the records this client saves.
 *
 * The reading view is where the wallpaper is chosen, but it is NOT mounted in every session — a new one
 * opens on the host's conversation view — so the app-wide half of the backdrop (the values on `<html>`
 * and the scrollbar groove's dial) cannot depend on that view being there. It reads the host's record at
 * activation and follows every accepted save through this.
 */
export function subscribeToHostSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export interface SettingsWriter {
  /** Note the current state; the write happens once the changes settle. */
  push(state: unknown): void;
  /** Write now if anything is waiting — for a view tearing down or a page going away. */
  flush(): void;
}

/**
 * A debounced writer. The save function and the delay are parameters so the behaviour is testable
 * without a server or a real clock, and `push` of the same settled state twice is one write.
 *
 * The second, coarser dedupe is `lastStored`: a record whose BYTES are the ones this writer already stored is not sent
 * again, even minutes later. That is not a micro-optimisation, it is what keeps an unrelated store change from writing
 * the file: the reading view subscribes to the whole state (it has to — the host record is the whole state minus
 * `expanded`, and the route replaces the record rather than merging), so opening one thinking card changes the store
 * without changing a single byte of what would be written. Each such write would also re-run the window-scope paint, a
 * whole-document scan plus a forced layout, so "expand a card" cost one HTTP write and one full-page layout for nothing.
 *
 * Only a body the host ACCEPTED is remembered. A failed or refused write leaves `lastStored` alone, so the next push of
 * that same record still goes out — which is the behaviour a reader depends on after a hiccup. A `save` that answers
 * nothing at all (`undefined`, as the test doubles do) is treated the same way: nothing is ever suppressed on a guess.
 */
export function createSettingsWriter(
  save: (state: unknown) => Promise<unknown> = saveHostSettings,
  delayMs: number = SETTINGS_SAVE_DELAY_MS,
): SettingsWriter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: unknown;
  let waiting = false;
  let lastStored: string | undefined;
  const send = (): void => {
    timer = undefined;
    if (!waiting) return;
    const state = pending;
    waiting = false;
    let body: string | undefined;
    try {
      body = JSON.stringify(state);
    } catch {
      // A record that cannot be serialised is handed over anyway: `save` owns what happens next, and it does not throw.
      body = undefined;
    }
    if (body !== undefined && body === lastStored) return;
    void save(state).then(stored => {
      if (stored === true) lastStored = body;
    }, () => undefined);
  };
  return {
    push(state: unknown): void {
      pending = state;
      waiting = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(send, delayMs);
    },
    flush(): void {
      if (timer !== undefined) clearTimeout(timer);
      send();
    },
  };
}
