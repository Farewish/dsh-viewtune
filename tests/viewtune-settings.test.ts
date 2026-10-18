/**
 * The settings record's host half: where it lives, what may be stored in it, and how it survives a bad
 * write. The route over these is a shell, so everything that decides "is this a record we keep?" is
 * exercised here without starting a server.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  SETTINGS_MAX_BYTES, readSettings, settingsFileOf, settingsRecordOf, writeSettings,
} from '../src/viewtune-settings.ts';

const dir = mkdtempSync(join(tmpdir(), 'viewtune-settings-'));

test('the record lives in the instance home, and can be pointed somewhere that outlives a version', () => {
  const home = join('D:', 'homes', '0.1.5-rc.2');
  assert.equal(settingsFileOf({ DSH_HOME: home }, 'C:\\Users\\reader'), join(home, 'viewtune-settings.json'));
  // The instance home is version-scoped, so the escape hatch is what lets a record outlive an upgrade.
  const elsewhere = join(dir, 'kept.json');
  assert.equal(settingsFileOf({ DSH_HOME: home, DSH_VIEWTUNE_SETTINGS: elsewhere }, 'C:\\Users\\reader'), resolve(elsewhere));
  assert.equal(settingsFileOf({}, 'C:\\Users\\reader'), join('C:\\Users\\reader', '.dsh', 'viewtune-settings.json'));
});

test('only a plain, bounded, serializable object is a record', () => {
  assert.deepEqual(settingsRecordOf({ wallpaper: 'x.jpg' }), { wallpaper: 'x.jpg' });
  assert.equal(settingsRecordOf(null), undefined);
  assert.equal(settingsRecordOf([1, 2]), undefined);
  assert.equal(settingsRecordOf('x'), undefined);
  assert.equal(settingsRecordOf(7), undefined);
  assert.equal(settingsRecordOf(undefined), undefined);
  // The route is unauthenticated on localhost, so the bound is part of what a record IS.
  assert.equal(settingsRecordOf({ pad: 'x'.repeat(SETTINGS_MAX_BYTES) }), undefined);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.equal(settingsRecordOf(cycle), undefined);
});

test('a missing file is distinct from one that exists but cannot be trusted', async () => {
  assert.deepEqual(await readSettings(join(dir, 'never-written.json')), { kind: 'missing' });
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json at all', 'utf8');
  assert.deepEqual(await readSettings(broken), { kind: 'invalid' });
  const array = join(dir, 'array.json');
  writeFileSync(array, '[1,2]', 'utf8');
  assert.deepEqual(await readSettings(array), { kind: 'invalid' });
  // The read path enforces the same bound as the write path, before parsing the file.
  const oversized = join(dir, 'oversized.json');
  writeFileSync(oversized, `{"pad":"${'x'.repeat(SETTINGS_MAX_BYTES)}"}`, 'utf8');
  assert.deepEqual(await readSettings(oversized), { kind: 'invalid' });
  const directory = join(dir, 'not-a-file');
  mkdirSync(directory);
  assert.deepEqual(await readSettings(directory), { kind: 'invalid' });
});

test('concurrent writes are serialized and leave one whole record', async () => {
  const file = join(dir, 'concurrent.json');
  const results = await Promise.all([writeSettings(file, { n: 1 }), writeSettings(file, { n: 2 })]);
  assert.deepEqual(results, [true, true]);
  // The queue preserves call order, so the second record is the one on disk; the point is that the
  // result is one complete record and not an interleaving of the two.
  assert.deepEqual(await readSettings(file), { kind: 'ok', record: { n: 2 } });
  assert.deepEqual(readdirSync(dir).filter(name => name.includes('.tmp')), []);
});

test('a record round-trips, and a refusal leaves the previous one in place', async () => {
  const file = join(dir, 'nested', 'settings.json');
  assert.equal(await writeSettings(file, { wallpaper: 'x.jpg', wallpaperDim: 51 }), true);
  assert.deepEqual(await readSettings(file), { kind: 'ok', record: { wallpaper: 'x.jpg', wallpaperDim: 51 } });
  // A body that is not a record is refused BEFORE anything is written: a shape this half does not
  // recognise must not be allowed to overwrite a good record with rubbish.
  assert.equal(await writeSettings(file, 42), false);
  assert.deepEqual(await readSettings(file), { kind: 'ok', record: { wallpaper: 'x.jpg', wallpaperDim: 51 } });
});
