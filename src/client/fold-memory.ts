/**
 * Per-session turn-window state, for the lifetime of this client module.
 *
 * The window (`foldWindow` + `revealed`) is reading-view state, not a preference: leaving the
 * reader for the chat view and coming back must not re-hide turns the reader had revealed, or the
 * restored position lands outside the rendered window. A page reload / host restart resets it,
 * exactly like the scroll memory.
 */
export interface SavedFoldState {
  /** The live turn that was known when this state was saved; a different one means a new turn. */
  readonly liveTurn: number | null;
  readonly foldWindow: number;
  readonly revealed: number;
}

const saved = new Map<string, SavedFoldState>();

/** Remember one reader's turn window; an empty key opts out. */
export function rememberFoldState(key: string, state: SavedFoldState): void {
  if (key === '') return;
  saved.set(key, state);
}

/** The last remembered turn window for a session, if any. */
export function recallFoldState(key: string): SavedFoldState | undefined {
  return saved.get(key);
}
