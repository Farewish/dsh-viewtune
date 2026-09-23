/**
 * The settings record's client half: the read that seeds or restores, and the write that waits for a
 * burst of changes to settle. Both halves of the contract are checked here — including that the client
 * and the host agree on the path, since a typo on one side is a settings store that silently never
 * restores anything.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { READER_SETTINGS_PATH as HOST_PATH } from '../src/dsh-viewtune.ts';
import {
  READER_SETTINGS_PATH, createSettingsWriter, loadHostSettings,
} from '../src/client/settings-sync.ts';

test('the client reads and writes the route the host actually registers', () => {
  assert.equal(READER_SETTINGS_PATH, '/better-display/settings');
  assert.equal(READER_SETTINGS_PATH, HOST_PATH);
});

test('a burst of changes becomes one write, and flush sends the latest one', () => {
  const saved: unknown[] = [];
  const writer = createSettingsWriter(async state => { saved.push(state); }, 5);
  writer.push({ dim: 20 });
  writer.push({ dim: 40 });
  writer.push({ dim: 51 });
  // Dragging a slider is a hundred states a second; none of them is on the wire yet.
  assert.deepEqual(saved, []);
  writer.flush();
  assert.deepEqual(saved, [{ dim: 51 }]);
  // Nothing waiting is not a write: a flush on teardown must not re-send the world.
  writer.flush();
  assert.deepEqual(saved, [{ dim: 51 }]);
});

test('a settled change lands on its own, without an explicit flush', async () => {
  const saved: unknown[] = [];
  const writer = createSettingsWriter(async state => { saved.push(state); }, 1);
  writer.push({ wallpaper: 'x.jpg' });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(saved, [{ wallpaper: 'x.jpg' }]);
});

test('a failed write is swallowed, and the next change still goes out', async () => {
  const saved: unknown[] = [];
  let fail = true;
  const writer = createSettingsWriter(async state => {
    if (fail) throw new Error('offline');
    saved.push(state);
  }, 1);
  writer.push({ dim: 1 });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(saved, []);
  fail = false;
  writer.push({ dim: 2 });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(saved, [{ dim: 2 }]);
});

test("the host's record is what restores, and an empty one means nothing was ever stored", async () => {
  const original = globalThis.fetch;
  const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  try {
    globalThis.fetch = answer({ settings: { wallpaper: 'x.jpg', wallpaperDim: 51 } });
    assert.deepEqual(await loadHostSettings(), { wallpaper: 'x.jpg', wallpaperDim: 51 });
    // The host answers `{}` before anything has been stored. That has to read as "seed me from this
    // browser", never as "the reader's settings are empty" — blanking them is the bug being fixed.
    globalThis.fetch = answer({ settings: {} });
    assert.equal(await loadHostSettings(), undefined);
    globalThis.fetch = answer({ settings: [1, 2] });
    assert.equal(await loadHostSettings(), undefined);
    globalThis.fetch = answer({}, false);
    assert.equal(await loadHostSettings(), undefined);
    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    assert.equal(await loadHostSettings(), undefined);
  } finally {
    globalThis.fetch = original;
  }
});
