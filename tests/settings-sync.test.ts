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
  READER_SETTINGS_PATH, createSettingsWriter, hostRecordOf, loadHostSettings, saveHostSettings,
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

test('the record sent to the host is the preferences, never the per-turn expansion choices', () => {
  const state = {
    motion: true,
    expanded: { 'turn:5:closed:completed': true, 'turn:9:open:pending': false },
    wallpaperDim: 51,
  };
  const record = hostRecordOf(state);
  assert.deepEqual(record, { motion: true, wallpaperDim: 51 });
  assert.equal(Object.hasOwn(record, 'expanded'), false);
  // The state itself is left alone: the browser's own copy keeps the choices for the session it is in.
  assert.deepEqual(state.expanded, { 'turn:5:closed:completed': true, 'turn:9:open:pending': false });
  // Nothing session-shaped to remove is also fine, and the result is a record, not the input by reference.
  const plain = hostRecordOf({ motion: false });
  assert.deepEqual(plain, { motion: false });
  assert.notEqual(plain, hostRecordOf({ motion: false }));
});

test('a record the host REFUSED is reported once, and is not announced as stored', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warned: string[] = [];
  console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(' ')); };
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 400 })) as unknown as typeof fetch;
    await saveHostSettings({ motion: true });
    await saveHostSettings({ motion: false });
    // A refusal means nothing this reader changes will be stored — worth one line, not one per change: a dragged
    // slider is a hundred writes a second, and a console full of them is its own kind of silence.
    assert.equal(warned.length, 1);
    // The wording covers both halves the host can answer with: a record it declined to keep (400) and a write that
    // failed outright (500). Both mean the same thing to the reader, which is what the line has to say.
    assert.match(warned[0]!, /not stored/);
    assert.match(warned[0]!, /400/);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
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

test('a record the host already stored is not sent again, so an unrelated change costs no write', async () => {
  const saved: unknown[] = [];
  const writer = createSettingsWriter(async state => { saved.push(state); return true; }, 1);
  writer.push({ motion: true, wallpaperDim: 51 });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(saved, [{ motion: true, wallpaperDim: 51 }]);
  // The same bytes again — which is exactly what opening one thinking card produces, because the record is the state
  // minus `expanded`. Each of these used to be a PUT, and each accepted PUT re-paints the window scope.
  writer.push({ motion: true, wallpaperDim: 51 });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(saved, [{ motion: true, wallpaperDim: 51 }]);
  // A real change is still written.
  writer.push({ motion: false, wallpaperDim: 51 });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(saved, [{ motion: true, wallpaperDim: 51 }, { motion: false, wallpaperDim: 51 }]);
});

test('a write that did NOT land is not deduplicated away', async () => {
  const attempted: unknown[] = [];
  // `false` is what `saveHostSettings` answers for a refusal and for a failed request; the same record pushed again must
  // reach the host, or one hiccup would leave the record permanently behind this browser's copy.
  const writer = createSettingsWriter(async state => { attempted.push(state); return false; }, 1);
  writer.push({ motion: true });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  writer.push({ motion: true });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(attempted, [{ motion: true }, { motion: true }]);
});

test('a read answers three ways, and a failed one is not an empty one', async () => {
  const original = globalThis.fetch;
  const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  try {
    globalThis.fetch = answer({ settings: { wallpaper: 'x.jpg', wallpaperDim: 51 } });
    assert.deepEqual(await loadHostSettings(), { kind: 'stored', record: { wallpaper: 'x.jpg', wallpaperDim: 51 } });
    // The host answers `{}` before anything has been stored. THIS is the one case where the caller may seed the
    // record from this browser — and telling it apart from the failures below is the whole reason this is a result
    // type rather than `undefined`. Collapsed together, a transient failure would seed the defaults over a record
    // nobody managed to fetch.
    globalThis.fetch = answer({ settings: {} });
    assert.deepEqual(await loadHostSettings(), { kind: 'empty' });
    globalThis.fetch = answer({ settings: [1, 2] });
    assert.deepEqual(await loadHostSettings(), { kind: 'unavailable' });
    globalThis.fetch = answer({}, false);
    assert.deepEqual(await loadHostSettings(), { kind: 'unavailable' });
    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    assert.deepEqual(await loadHostSettings(), { kind: 'unavailable' });
  } finally {
    globalThis.fetch = original;
  }
});
