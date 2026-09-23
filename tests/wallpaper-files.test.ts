import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  contentTypeOf, isWallpaperName, listWallpapers, resolveWallpaperFile, seedDefaultWallpaper, wallpaperDirOf,
} from '../src/wallpaper-files.ts';

test('the folder is the instance home by default, and the override wins', () => {
  assert.equal(
    wallpaperDirOf({ DSH_HOME: 'D:\\DSH\\homes\\0.1.5-rc.2' }, 'C:\\Users\\x'),
    join('D:\\DSH\\homes\\0.1.5-rc.2', 'wallpapers'),
  );
  // No instance home at all: the conventional per-user location, not the process's cwd.
  assert.equal(wallpaperDirOf({}, 'C:\\Users\\x'), join('C:\\Users\\x', '.dsh', 'wallpapers'));
  // The override is the escape hatch for a folder that should outlive one harness version.
  assert.equal(
    wallpaperDirOf({ DSH_HOME: 'D:\\h', DSH_VIEWTUNE_WALLPAPERS: ' E:\\pics ' }, 'C:\\Users\\x'),
    'E:\\pics',
  );
});

test('only image extensions are wallpapers, case aside', () => {
  assert.ok(isWallpaperName('a.PNG'));
  assert.ok(isWallpaperName('a.jpeg'));
  assert.ok(!isWallpaperName('a.txt'));
  assert.ok(!isWallpaperName('a.png.exe'));
  assert.ok(!isWallpaperName('png'));
  assert.equal(contentTypeOf('a.PNG'), 'image/png');
  assert.equal(contentTypeOf('a.webp'), 'image/webp');
  assert.equal(contentTypeOf('a.unknown'), 'application/octet-stream');
});

test('a name from the browser cannot reach outside the folder', () => {
  const dir = join('D:\\', 'pics');
  assert.equal(resolveWallpaperFile(dir, 'a.png'), join('D:\\', 'pics', 'a.png'));
  assert.equal(resolveWallpaperFile(dir, 'my%20photo.png'), join('D:\\', 'pics', 'my photo.png'));
  // Percent-decoded first, so an encoded separator is caught by the same rule as a literal one.
  assert.equal(resolveWallpaperFile(dir, '..%2Fsecret.png'), undefined);
  assert.equal(resolveWallpaperFile(dir, '../secret.png'), undefined);
  assert.equal(resolveWallpaperFile(dir, '..\\secret.png'), undefined);
  assert.equal(resolveWallpaperFile(dir, 'sub/a.png'), undefined);
  assert.equal(resolveWallpaperFile(dir, 'sub\\a.png'), undefined);
  assert.equal(resolveWallpaperFile(dir, 'C:\\Windows\\a.png'), undefined);
  assert.equal(resolveWallpaperFile(dir, ''), undefined);
  assert.equal(resolveWallpaperFile(dir, '   '), undefined);
  assert.equal(resolveWallpaperFile(dir, 'a.txt'), undefined);
  // A malformed escape is a refusal, not an exception thrown out of the route.
  assert.equal(resolveWallpaperFile(dir, '%'), undefined);
});

test('the listing is images only, newest first, and a missing folder is empty rather than an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'viewtune-wallpapers-'));
  try {
    await writeFile(join(dir, 'notes.txt'), 'x');
    await mkdir(join(dir, 'looks-like.png')); // a DIRECTORY with an image extension is not an image
    await writeFile(join(dir, 'old.png'), 'x');
    await writeFile(join(dir, 'new.png'), 'xx');
    await utimes(join(dir, 'old.png'), new Date(1000), new Date(1000));
    await utimes(join(dir, 'new.png'), new Date(2000), new Date(2000));

    const entries = await listWallpapers(dir);
    assert.deepEqual(entries.map(entry => entry.name), ['new.png', 'old.png']);
    assert.equal(entries[0].bytes, 2);
    assert.equal(entries[0].mtimeMs, 2000);

    assert.deepEqual(await listWallpapers(join(dir, 'missing')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the shipped wallpaper is put in an empty folder, and never over one that is there', async () => {
  const root = await mkdtemp(join(tmpdir(), 'viewtune-seed-'));
  const source = join(root, 'shipped.png');
  await writeFile(source, 'shipped');
  try {
    // A FRESH install: the folder does not exist yet, and the settings' default names this file — so without the seed
    // the reader's first look would be a reference to something nobody put there.
    const fresh = join(root, 'wallpapers');
    assert.equal(await seedDefaultWallpaper(fresh, source, 'shipped.png'), true);
    assert.equal(await readFile(join(fresh, 'shipped.png'), 'utf8'), 'shipped');
    // Second activation, and a reader's own picture under that name: neither may be replaced. The seed is a one-time
    // "is anything here already", not a sync.
    await writeFile(join(fresh, 'shipped.png'), 'mine');
    assert.equal(await seedDefaultWallpaper(fresh, source, 'shipped.png'), false);
    assert.equal(await readFile(join(fresh, 'shipped.png'), 'utf8'), 'mine');
    // A source that is not there — a half-finished install — answers false rather than throwing, because activation
    // must not be able to fail over a bitmap.
    assert.equal(await seedDefaultWallpaper(join(root, 'elsewhere'), join(root, 'nope.png'), 'nope.png'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
