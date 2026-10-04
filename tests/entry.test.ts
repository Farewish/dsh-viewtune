import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryViewOf, ReaderEntryPolicy, readerEntryRequested } from '../src/client/entry-policy.js';

test('the reader’s setting decides which page a brand new session opens on', () => {
  // 阅读页 is the shipped default and keeps the behaviour this plugin always had; 对话页 leaves the host's own view alone.
  assert.equal(new ReaderEntryPolicy(false).select(null, 'reader'), 'reader');
  assert.equal(new ReaderEntryPolicy(false).select(null, 'conversation'), null);
  // A session that HAS recorded a view is never touched, whichever the setting says: that is the "do not fight a later tab
  // choice" rule, and it is what keeps this setting from overriding the reader's own tabs.
  const toConversation = new ReaderEntryPolicy(false);
  for (const view of ['chat', 'trajectory', 'other-plugin']) assert.equal(toConversation.select(view, 'conversation'), null);
  // …and `?reader` still wins over the setting, because it is an explicit request rather than a default.
  assert.equal(new ReaderEntryPolicy(true).select('chat', 'conversation'), 'reader');
});

test('the stored entry-view setting resolves defensively, defaulting to the shipped 阅读页', () => {
  assert.equal(entryViewOf('conversation'), 'conversation');
  assert.equal(entryViewOf('reader'), 'reader');
  // Anything unrecognised — absent, a stale value, a hand-edited file — resolves to the shipped default, so the setting can
  // only turn the old behaviour off, never change what an existing reader sees.
  for (const stored of [undefined, null, '', 'Reader', 'chat', 0, {}, []]) assert.equal(entryViewOf(stored), 'reader');
});

test('fresh sessions default to reading, without requiring a special URL', () => {
  const policy = new ReaderEntryPolicy(false);
  assert.equal(policy.select(null), 'reader');
  assert.equal(policy.select('reader'), null);
  assert.equal(policy.select(undefined), 'reader');
});

test('an explicit native or third-party tab selection is not overwritten', () => {
  const policy = new ReaderEntryPolicy(false);
  for (const view of ['chat', 'trajectory', 'other-plugin']) assert.equal(policy.select(view), null);
  assert.equal(policy.select(null), 'reader');
  assert.equal(policy.select('chat'), null);
});

test('the trial URL enters reading once and releases later tab choices', () => {
  let consumed = 0;
  const policy = new ReaderEntryPolicy(true, () => { consumed++; });
  assert.equal(policy.select('chat'), 'reader');
  assert.equal(consumed, 1);
  assert.equal(policy.select('reader'), null);
  assert.equal(policy.select('chat'), null);
  assert.equal(policy.select('trajectory'), null);
  assert.equal(consumed, 1);
  assert.equal(policy.select(null), 'reader');
});

test('already-selected reading still consumes the entry request', () => {
  let consumed = false;
  const policy = new ReaderEntryPolicy(true, () => { consumed = true; });
  assert.equal(policy.select('reader'), null);
  assert.equal(consumed, true);
  assert.equal(policy.select('chat'), null);
});

test('current and previously delivered trial links have real entry semantics', () => {
  for (const query of ['?reader=1', '?reader=0.1.0-trial.2', '?reader=0.1.0-trial.3']) assert.equal(readerEntryRequested(query), true);
  for (const query of ['', '?reader=0', '?reader=unrelated', '?other=reader']) assert.equal(readerEntryRequested(query), false);
});
