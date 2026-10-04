/** Where a session that has never recorded a view should open. */
export type EntryView = 'reader' | 'conversation';

/**
 * The stored setting, resolved defensively — the same rule the rest of the store follows.
 *
 * `reader` is the SHIPPED default because that is what this plugin has always done: a session with no recorded view is
 * switched to the reading view. Anything unrecognised — absent, a stale value, a hand-edited file — resolves to it, so the
 * new setting can only ever turn the behaviour OFF, never change what an existing reader sees.
 */
export function entryViewOf(stored: unknown): EntryView {
  return stored === 'conversation' ? 'conversation' : 'reader';
}

/** Select the reading view on entry, without fighting a later explicit tab choice. */
export class ReaderEntryPolicy {
  private entered = false;

  constructor(private readonly requested: boolean, private readonly consumeRequest: () => void = () => {}) {}

  /**
   * The view to switch to, or `null` to leave the host's choice alone.
   *
   * `?reader` in the URL is an explicit request and still wins whatever the setting says. Otherwise the only session this
   * touches is one that has recorded NO view at all — a brand new session — and there the reader's setting decides:
   * 阅读页 switches it, 对话页 leaves it on the host's conversation view.
   */
  select(view: string | null | undefined, defaultView: EntryView = 'reader'): 'reader' | null {
    const requested = !this.entered && this.requested;
    if (!this.entered) {
      this.entered = true;
      if (this.requested) this.consumeRequest();
    }
    if (requested) return view !== 'reader' ? 'reader' : null;
    return view == null && defaultView === 'reader' ? 'reader' : null;
  }
}

export function readerEntryRequested(search: string): boolean {
  const value = new URLSearchParams(search).get('reader');
  return value === '1' || /^0\.1\.0-trial\.\d+$/.test(value ?? '');
}
