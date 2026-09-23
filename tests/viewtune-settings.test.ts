/**
 * The settings record's host half: where it lives, what may be stored in it, and how it survives a bad
 * write. The route over these is a shell, so everything that decides "is this a record we keep?" is
 * exercised here without starting a server.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

test('a missing, unreadable or non-record file reads as nothing at all', async () => {
  assert.equal(await readSettings(join(dir, 'never-written.json')), undefined);
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json at all', 'utf8');
  assert.equal(await readSettings(broken), undefined);
  const array = join(dir, 'array.json');
  writeFileSync(array, '[1,2]', 'utf8');
  assert.equal(await readSettings(array), undefined);
});

test('a record round-trips, and a refusal leaves the previous one in place', async () => {
  const file = join(dir, 'nested', 'settings.json');
  assert.equal(await writeSettings(file, { wallpaper: 'x.jpg', wallpaperDim: 51 }), true);
  assert.deepEqual(await readSettings(file), { wallpaper: 'x.jpg', wallpaperDim: 51 });
  // A body that is not a record is refused BEFORE anything is written: a shape this half does not
  // recognise must not be allowed to overwrite a good record with rubbish.
  assert.equal(await writeSettings(file, 42), false);
  assert.deepEqual(await readSettings(file), { wallpaper: 'x.jpg', wallpaperDim: 51 });
});
