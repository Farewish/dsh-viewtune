import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_WALLPAPER, WALLPAPER_DIM_INITIAL, wallpaperDimOf, wallpaperGeometry, wallpaperListingOf, wallpaperNameOf,
  wallpaperProperties, wallpaperUrl,
} from '../src/client/wallpaper.ts';

test('the stored wallpaper name survives an old record, and anything nameless gets the shipped one', () => {
  assert.equal(wallpaperNameOf('sunset.png'), 'sunset.png');
  assert.equal(wallpaperNameOf('  spaced name.jpg  '), 'spaced name.jpg');
  // A record written before this preference existed has no such key at all, and a value that is not a name is the
  // same story: both mean the wallpaper this plugin ships, which the host seeds into the reader's folder.
  assert.equal(wallpaperNameOf(undefined), DEFAULT_WALLPAPER);
  assert.equal(wallpaperNameOf(null), DEFAULT_WALLPAPER);
  assert.equal(wallpaperNameOf(42), DEFAULT_WALLPAPER);
  // …but an EMPTY STRING is a reader who asked for none with 清除, and stays none rather than being overridden by the
  // default. The two cases are one character apart in the record and must not be conflated.
  assert.equal(wallpaperNameOf(''), '');
  // This side does not sanitize a path: what may be served is the host's decision, not the client's.
  assert.equal(wallpaperNameOf('../escape.png'), '../escape.png');
});

test('the scrim falls back to its initial and never leaves 0..100', () => {
  assert.equal(wallpaperDimOf(undefined), WALLPAPER_DIM_INITIAL);
  assert.equal(wallpaperDimOf('60'), WALLPAPER_DIM_INITIAL);
  assert.equal(wallpaperDimOf(Number.NaN), WALLPAPER_DIM_INITIAL);
  assert.equal(wallpaperDimOf(-20), 0);
  assert.equal(wallpaperDimOf(1000), 100);
  assert.equal(wallpaperDimOf(37.6), 38);
});

test('the image URL is percent-encoded and keyed by the file, so a re-dropped file shows up', () => {
  assert.equal(wallpaperUrl('sunset.png'), '/better-display/wallpaper/sunset.png');
  assert.equal(
    wallpaperUrl('my photo.png', 1734567890123),
    '/better-display/wallpaper/my%20photo.png?v=1734567890123',
  );
  // The encoding is also what keeps a quote in a file name from closing the `url("…")` the
  // stylesheet builds around it.
  assert.equal(wallpaperUrl('a"b.png'), '/better-display/wallpaper/a%22b.png');
  assert.equal(wallpaperUrl('a.png', Number.NaN), '/better-display/wallpaper/a.png');
});

test('the custom properties are absent without a wallpaper, and clamp with one', () => {
  assert.deepEqual(wallpaperProperties('', 45), {});
  assert.deepEqual(wallpaperProperties('a.png', 45, 7), {
    '--wallpaper-image': 'url("/better-display/wallpaper/a.png?v=7")',
    '--wallpaper-dim': '45%',
  });
  assert.equal(wallpaperProperties('a.png', 500)['--wallpaper-dim'], '100%');
});

test('the image FILLS the reading page: max ratio, centred, and a small image is scaled up', () => {
  const target = { left: 280, top: 76, width: 1400, height: 900 };
  // A 4000x3000 photograph: the LARGER ratio wins (0.35), which is the smallest scale that leaves no
  // unfilled area. It is centred on the PAGE, so the overflow is cropped equally top and bottom — the
  // crop lands where the reader is looking rather than wherever a viewport-sized cover happened to
  // put it.
  assert.deepEqual(
    wallpaperGeometry({ imageWidth: 4000, imageHeight: 3000, target, scope: 'view', viewportWidth: 1700, viewportHeight: 996 }),
    { size: '1400px 1050px', position: '280px 1px' },
  );
  // A small image is scaled UP to fill the page. Not capping the scale is the point: an earlier cut
  // capped it at 1 and the reader's 160x100 sample stayed a patch in the middle of the page.
  assert.deepEqual(
    wallpaperGeometry({ imageWidth: 160, imageHeight: 100, target, scope: 'view', viewportWidth: 1700, viewportHeight: 996 }),
    { size: '1440px 900px', position: '260px 76px' },
  );
  // Window scope fills the window: the same rule against the viewport, expressed as `cover`.
  assert.deepEqual(
    wallpaperGeometry({ imageWidth: 4000, imageHeight: 3000, target, scope: 'window', viewportWidth: 1700, viewportHeight: 996 }),
    { size: 'cover', position: 'center' },
  );
  // No measurement yet (the image's size has not arrived, or the page's box was not found): the same
  // fallback, so the backdrop is never absent while the refinement is pending.
  assert.deepEqual(
    wallpaperGeometry({ imageWidth: 0, imageHeight: 0, target: null, scope: 'view', viewportWidth: 1700, viewportHeight: 996 }),
    { size: 'cover', position: 'center' },
  );
});

test('the list payload is read defensively', () => {
  assert.deepEqual(wallpaperListingOf(undefined), { dir: '', items: [] });
  assert.deepEqual(wallpaperListingOf({ ok: true, dir: 'D:/x', items: 'nope' }), { dir: 'D:/x', items: [] });
  assert.deepEqual(
    wallpaperListingOf({
      dir: 'D:/x',
      items: [{ name: 'a.png', bytes: 3, mtimeMs: 9 }, { name: '' }, { bytes: 1 }, null, 'x'],
    }),
    { dir: 'D:/x', items: [{ name: 'a.png', bytes: 3, mtimeMs: 9 }] },
  );
});
