/**
 * Per-session reading scroll position, kept only for the lifetime of this client module.
 *
 * Switching between the reader, the chat view, or another page unmounts the reader but not the
 * module; coming back restores the place the reader left. A page reload or host restart creates a
 * new module instance, so the map is empty again — exactly the lifetime the host's own conversation
 * view gives its scroll position.
 */
export interface SavedReadingScroll {
  readonly top: number;
  /** Whether the reader was still following the live tail. */
  readonly following: boolean;
  /** The turn on the reading line and its offset from the scrollport top, when a row existed. */
  readonly anchor?: { readonly turn: number; readonly offset: number };
}

const saved = new Map<string, SavedReadingScroll>();

/** Remember one reader's position; an empty key opts out. */
export function rememberReadingScroll(
  key: string,
  top: number,
  following: boolean,
  anchor?: { turn: number; offset: number },
): void {
  if (key === '') return;
  saved.set(key, { top: Math.max(0, top), following, ...(anchor === undefined ? {} : { anchor }) });
}

/** The last remembered position for a session, if any. */
export function recallReadingScroll(key: string): SavedReadingScroll | undefined {
  return saved.get(key);
}
