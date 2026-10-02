/**
 * The host's `turn-trigger` record, read the way the reading view needs it.
 *
 * The mapping is pinned against the host's own dictionary, because the whole point of the feature is that the two views
 * say the same thing: `goal` is 「继续执行目标」 (the reader's own screenshot), `webhook` splits on `provider`, and an
 * unrecognised source still says something true rather than rendering an empty row.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TURN_TRIGGER_EXPLANATION, turnTriggerReading, turnTriggerText, turnTriggerTime } from '../src/client/turn-trigger.ts';

test('every source kind the host names gets the host’s own title', () => {
  assert.deepEqual(turnTriggerReading({ kind: 'goal' }), { title: '继续执行目标', icon: 'goal' });
  assert.deepEqual(turnTriggerReading({ kind: 'agent-message' }), { title: '收到任务消息', icon: 'agent' });
  assert.deepEqual(turnTriggerReading({ kind: 'team-message' }), { title: '收到团队消息', icon: 'team' });
  assert.deepEqual(turnTriggerReading({ kind: 'subagent-settled' }), { title: '子任务状态更新', icon: 'subagent' });
  assert.deepEqual(turnTriggerReading({ kind: 'schedule' }), { title: '自动化任务', icon: 'schedule' });
  assert.deepEqual(turnTriggerReading({ kind: 'tool-jobs' }), { title: '后台任务状态更新', icon: 'job' });
  assert.deepEqual(turnTriggerReading({ kind: 'cordis-host-runner' }), { title: '插件状态更新', icon: 'plugin' });
});

test('a webhook is two cases, exactly as the host splits it', () => {
  assert.deepEqual(turnTriggerReading({ kind: 'webhook', provider: 'github' }), { title: '收到 GitHub 事件', icon: 'github' });
  assert.deepEqual(turnTriggerReading({ kind: 'webhook' }), { title: '收到外部事件', icon: 'webhook' });
  assert.deepEqual(turnTriggerReading({ kind: 'webhook', provider: 'slack' }), { title: '收到外部事件', icon: 'webhook' });
});

test('an unusable source is the host’s own default, never an empty row', () => {
  // The record exists because something woke the turn up; when this client cannot name it, that is still true.
  assert.deepEqual(turnTriggerReading(undefined), { title: '收到执行请求', icon: 'request' });
  assert.deepEqual(turnTriggerReading(null), { title: '收到执行请求', icon: 'request' });
  assert.deepEqual(turnTriggerReading('github'), { title: '收到执行请求', icon: 'request' });
  assert.deepEqual(turnTriggerReading({ kind: 42 }), { title: '收到执行请求', icon: 'request' });
  assert.deepEqual(turnTriggerReading({}), { title: '收到执行请求', icon: 'request' });
});

test('the time is the record’s own number, and nothing else', () => {
  assert.equal(turnTriggerTime(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(turnTriggerTime('1700000000000'), null);
  assert.equal(turnTriggerTime(Number.NaN), null);
  assert.equal(turnTriggerTime(Number.POSITIVE_INFINITY), null);
  assert.equal(turnTriggerTime(undefined), null);
});

test('the notification text is the string blocks of whatever shape it arrives in', () => {
  assert.equal(turnTriggerText([{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }]), '第一段\n\n第二段');
  // A block with no text, a non-block entry, and a blank string all contribute nothing.
  assert.equal(turnTriggerText([{ type: 'image' }, 'nope', { text: '   ' }, { text: '留下' }]), '留下');
  assert.equal(turnTriggerText(undefined), '');
  assert.equal(turnTriggerText('text'), '');
  assert.equal(turnTriggerText([]), '');
});

test('the explanation is the host’s sentence, word for word', () => {
  assert.equal(TURN_TRIGGER_EXPLANATION, '这条通知触发了本轮回复。');
});
