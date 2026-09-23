/**
 * The app-wide backdrop: what a record turns into, and when the window is told about a save.
 *
 * The reason this module exists at all is a session boundary the reading view cannot see — a new
 * session opens on the host's conversation view — so what is checked here is that a record is enough on
 * its own (no measurement, no view) and that only an ACCEPTED save is announced.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backdropOf, scrollbarFillFrom } from '../src/client/app-backdrop.ts';
import { saveHostSettings, subscribeToHostSettings } from '../src/client/settings-sync.ts';
import { WALLPAPER_DIM_INITIAL } from '../src/client/wallpaper.ts';
import { WALLPAPER_CHROME_INITIAL } from '../src/client/wallpaper-scope.ts';

test('a record becomes exactly what the document element carries', () => {
  assert.deepEqual(
    backdropOf({ wallpaper: 'x.jpg', wallpaperDim: 30, wallpaperScope: 'window', wallpaperChrome: 10 }),
    { scope: 'window', image: 'url("/better-display/wallpaper/x.jpg")', dim: 30, chrome: 10 },
  );
  // Anything unreadable falls back exactly as the reading view's own readers do — one record, two ends,
  // and the ends must not disagree about what a missing key means.
  assert.deepEqual(
    backdropOf({ wallpaper: 'x.jpg' }),
    {
      scope: 'view',
      image: 'url("/better-display/wallpaper/x.jpg")',
      dim: WALLPAPER_DIM_INITIAL,
      chrome: WALLPAPER_CHROME_INITIAL,
    },
  );
  // No wallpaper — or no record at all — is `null`, which is what takes the attributes back off.
  assert.equal(backdropOf(undefined), null);
  assert.equal(backdropOf({}), null);
  assert.equal(backdropOf({ wallpaper: 42 }), null);
});

test('the groove has a dial only while the skin is on', () => {
  assert.equal(scrollbarFillFrom({ glass: true, glassParts: { scrollbar: 10 } }), '10%');
  assert.equal(scrollbarFillFrom({ glass: true }), '20%');
  assert.equal(scrollbarFillFrom({ glass: false, glassParts: { scrollbar: 10 } }), '');
  // A record written before the skin existed, or a broken one: the host's own track, unchanged.
  assert.equal(scrollbarFillFrom({}), '');
  assert.equal(scrollbarFillFrom(undefined), '');
});

test('an accepted save is announced, a refused one is not', async () => {
  const original = globalThis.fetch;
  const seen: unknown[] = [];
  const unsubscribe = subscribeToHostSettings(record => { seen.push(record); });
  try {
    globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
    await saveHostSettings({ wallpaper: 'x.jpg' });
    assert.deepEqual(seen, [{ wallpaper: 'x.jpg' }]);
    // The host refuses anything that is not a record. Following a write that did NOT happen would make
    // the window show a wallpaper no restart would bring back.
    globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
    await saveHostSettings({ wallpaper: 'y.jpg' });
    assert.deepEqual(seen, [{ wallpaper: 'x.jpg' }]);
  } finally {
    unsubscribe();
  }
  globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
  await saveHostSettings({ wallpaper: 'z.jpg' });
  globalThis.fetch = original;
  assert.deepEqual(seen, [{ wallpaper: 'x.jpg' }]);
});
