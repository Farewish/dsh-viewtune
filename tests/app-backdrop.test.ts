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
import { WALLPAPER_DIM_INITIAL, DEFAULT_WALLPAPER } from '../src/client/wallpaper.ts';
import { WALLPAPER_CHROME_BLUR_FALLBACK, WALLPAPER_CHROME_BLUR_MAX, WALLPAPER_CHROME_INITIAL } from '../src/client/wallpaper-scope.ts';
import { GLASS_PARTS } from '../src/client/glass.ts';

test('a record becomes exactly what the document element carries', () => {
  // The chrome scrim is pinned here as the PRE-SPLIT single dial: this end reads a record without the store, so an
  // old record has to mean the same thing at both ends (see `chromeScrimsOf`) — one number arriving as both surfaces
  // rather than the reader's chrome opening at the shipped default after an upgrade.
  assert.deepEqual(
    backdropOf({ wallpaper: 'x.jpg', wallpaperDim: 30, wallpaperScope: 'window', wallpaperChrome: 10 }),
    { scope: 'window', image: 'url("/better-display/wallpaper/x.jpg")', dim: 30, chromeSidebar: 10, chromeHeader: 10, chromeSidebarBlur: 0, chromeHeaderBlur: 0 },
  );
  // …and the split's own keys are read as written, two different numbers included: that is the whole point of it.
  assert.deepEqual(
    backdropOf({ wallpaper: 'x.jpg', wallpaperChromeSidebar: 10, wallpaperChromeHeader: 80 }),
    {
      scope: 'window',
      image: 'url("/better-display/wallpaper/x.jpg")',
      dim: WALLPAPER_DIM_INITIAL,
      chromeSidebar: 10,
      chromeHeader: 80,
      // The frosts are absent from that record — it predates them — so both come back at the shipped 0, which is the
      // flat wash the scrims have always been rather than a frost nobody asked for.
      chromeSidebarBlur: WALLPAPER_CHROME_BLUR_FALLBACK,
      chromeHeaderBlur: WALLPAPER_CHROME_BLUR_FALLBACK,
    },
  );
  // …and the frosts are read as written and CLAMPED like every other dial here: 999px of blur is not a look, it is a
  // smear, and the ceiling is the same one the panel's slider stops at.
  assert.deepEqual(
    backdropOf({ wallpaper: 'x.jpg', wallpaperChromeSidebarBlur: 12, wallpaperChromeHeaderBlur: 999 }),
    {
      scope: 'window',
      image: 'url("/better-display/wallpaper/x.jpg")',
      dim: WALLPAPER_DIM_INITIAL,
      chromeSidebar: WALLPAPER_CHROME_INITIAL,
      chromeHeader: WALLPAPER_CHROME_INITIAL,
      chromeSidebarBlur: 12,
      chromeHeaderBlur: WALLPAPER_CHROME_BLUR_MAX,
    },
  );
  // Anything unreadable falls back exactly as the reading view's own readers do — one record, two ends,
  // and the ends must not disagree about what a missing key means. The scope's fallback is the window now, because the
  // shipped defaults are the reader's own settings.
  assert.deepEqual(
    backdropOf({ wallpaper: 'x.jpg' }),
    {
      scope: 'window',
      image: 'url("/better-display/wallpaper/x.jpg")',
      dim: WALLPAPER_DIM_INITIAL,
      chromeSidebar: WALLPAPER_CHROME_INITIAL,
      chromeHeader: WALLPAPER_CHROME_INITIAL,
      chromeSidebarBlur: WALLPAPER_CHROME_BLUR_FALLBACK,
      chromeHeaderBlur: WALLPAPER_CHROME_BLUR_FALLBACK,
    },
  );
  // No wallpaper NAMED is the shipped one, which the host seeds into the reader's folder on activation: a fresh
  // install paints a backdrop before it has ever saved a record. `''` is different — that is a reader who asked for
  // none with 清除 — and it is what takes the attributes back off.
  assert.deepEqual(backdropOf({}), {
    scope: 'window',
    image: `url("/better-display/wallpaper/${DEFAULT_WALLPAPER}")`,
    dim: WALLPAPER_DIM_INITIAL,
    chromeSidebar: WALLPAPER_CHROME_INITIAL,
    chromeHeader: WALLPAPER_CHROME_INITIAL,
    chromeSidebarBlur: WALLPAPER_CHROME_BLUR_FALLBACK,
    chromeHeaderBlur: WALLPAPER_CHROME_BLUR_FALLBACK,
  });
  assert.equal(backdropOf({ wallpaper: '' }), null);
  assert.equal(backdropOf({ wallpaper: 42 })?.image, `url("/better-display/wallpaper/${DEFAULT_WALLPAPER}")`);
  // A missing record is the same story one step further out: the reading view has never run, so there is nothing to
  // read from — the defaults are exactly what it would have shown.
  assert.equal(backdropOf(undefined)?.image, `url("/better-display/wallpaper/${DEFAULT_WALLPAPER}")`);
});

test('the groove has a dial only while the skin is on', () => {
  // Read off the part table rather than spelled out: the initials are one reading of the reader's settings file (the
  // groove is at 20%), and a test that repeats a default is a test that has to be edited every time one moves.
  const groove = `${String(GLASS_PARTS.find(part => part.id === 'scrollbar')?.initial ?? -1)}%`;
  assert.equal(scrollbarFillFrom({ glass: true, glassParts: { scrollbar: 10 } }), '10%');
  // A record that never moved the dial carries the shipped initial, which is the reader's own setting.
  assert.equal(scrollbarFillFrom({ glass: true }), groove);
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
