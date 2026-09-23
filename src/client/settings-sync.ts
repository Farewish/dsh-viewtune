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
 * How long a settled state waits before it is sent.
 *
 * Long enough to swallow a drag, short enough that a reader who changes something and immediately quits
 * still gets it written — and the flush on the way out covers the rest.
 */
export const SETTINGS_SAVE_DELAY_MS = 400;

/**
 * The host's record, or `undefined` when there is nothing to take.
 *
 * An empty record reads as `undefined` on purpose: it is what the host answers before anything has ever
 * been stored, and the caller's job in that case is to SEED it from this browser rather than to blank
 * the reader's settings with it. Every failure — offline, refused, malformed — answers the same way,
 * because a reader whose settings cannot be fetched still has to get a working app.
 */
export async function loadHostSettings(): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(READER_SETTINGS_PATH, { headers: { accept: 'application/json' } });
    if (!res.ok) return undefined;
    const body = await res.json() as { settings?: unknown };
    const settings = body.settings;
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
    return Object.keys(settings).length > 0 ? settings as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Send one record. Never throws: a failed write leaves the reader working and the next change retries. */
export async function saveHostSettings(state: unknown): Promise<void> {
  try {
    const res = await fetch(READER_SETTINGS_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    // Only a record the host ACCEPTED is announced: the app-wide backdrop follows what is actually
    // stored, so a refused or failed write cannot make the window show something no restart would.
    if (!res.ok) return;
    if (state === null || typeof state !== 'object' || Array.isArray(state)) return;
    for (const listener of [...listeners]) listener(state as Record<string, unknown>);
  } catch {
    // Deliberately silent: the browser's own copy is still there, and the whole record is re-sent on
    // the next change, so there is nothing to repair and nothing worth interrupting a reader over.
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
 */
export function createSettingsWriter(
  save: (state: unknown) => Promise<unknown> = saveHostSettings,
  delayMs: number = SETTINGS_SAVE_DELAY_MS,
): SettingsWriter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: unknown;
  let waiting = false;
  const send = (): void => {
    timer = undefined;
    if (!waiting) return;
    const state = pending;
    waiting = false;
    void save(state).catch(() => undefined);
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
