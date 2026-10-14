import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordSessionEvent, recordedEvents, recorderSize, resetRecorder } from '../src/commit-record.ts';
import { recordedCommits, recordedCommitsByCall } from '../src/commit-calls.ts';

/** One tool call and its result, as the harness appends them: two events sharing one call id. */
function call(session: string, id: string, seq: number, command: string, result: string): void {
  recordSessionEvent(session, seq, 1_700_000_000_000 + seq, 'tool/call', { callId: id, name: 'pwsh', args: { command } });
  recordSessionEvent(session, seq + 1, 1_700_000_000_000 + seq + 1, 'tool/result', { callId: id, content: [{ type: 'text', text: result }] });
}

test('a commit is answered by CALL ID, from the untruncated events', () => {
  resetRecorder();
  call('s1', 'call-a', 1, 'git -C D:\\repo commit -m "Fix the box heading"', '[main 1a2b3c4] Fix the box heading\n 1 file changed');
  call('s1', 'call-b', 3, 'git status --short', ' M src/a.ts');
  const byCall = recordedCommitsByCall('s1', ['call-a', 'call-b']);
  assert.deepEqual(byCall['call-a'], { hash: '1a2b3c4', subject: 'Fix the box heading' });
  assert.equal(byCall['call-b'], undefined, 'a call that did not commit is not reported');
});

test('the recorder keeps the UNTRUNCATED command, which is the whole point', () => {
  resetRecorder();
  // What the UI projection would hand the client for this call is a single `…`. The events are not projected, so the message survives.
  const long = 'Add the by-call commit lookup, because a truncated call cannot be looked up by its subject at all'.repeat(2);
  call('s2', 'call-long', 1, `git commit -m "${long}"`, `[main 9f9f9f9] ${long}`);
  assert.deepEqual(recordedCommitsByCall('s2', ['call-long'])['call-long'], { hash: '9f9f9f9', subject: long });
});

test('a subject that was not readable still yields the hash, and the hash alone is worth having', () => {
  resetRecorder();
  call('s3', 'call-f', 1, 'git commit -F msg.txt', '[main e49eaa9] Merge the file lists into 编辑');
  assert.deepEqual(recordedCommitsByCall('s3', ['call-f'])['call-f'], { hash: 'e49eaa9', subject: 'Merge the file lists into 编辑' });
});

test('a call that merely WRITES a commit command is not a commit', () => {
  resetRecorder();
  call('s4', 'call-w', 1, 'Set-Content -Path t.ts -Value "git commit -m ""x"""', 'written');
  assert.deepEqual(recordedCommits('s4'), []);
});

test('commits are reported in order, and a call with no id is still reported without one', () => {
  resetRecorder();
  recordSessionEvent('s5', 1, 1, 'tool/call', { args: { command: 'git commit -m "First"' } });
  recordSessionEvent('s5', 2, 2, 'tool/call', { args: { command: 'git commit -m "Second"' } });
  assert.deepEqual(recordedCommits('s5'), [{ subject: 'First' }, { subject: 'Second' }]);
});

test('the recorder is bounded per session, and one session cannot grow forever', () => {
  resetRecorder();
  for (let i = 0; i < 4100; i += 1) recordSessionEvent('big', i, i, 'tool/call', { args: { command: 'git status' } });
  const held = recordedEvents('big');
  assert.equal(held.length, 4000, 'the window is exactly what the module documents');
  assert.equal(held[0]?.seq, 100, 'the OLDEST events are the ones dropped');
  assert.equal(held[held.length - 1]?.seq, 4099);
});

test('a session that cannot be read answers empty rather than throwing', () => {
  resetRecorder();
  assert.deepEqual(recordedCommits('never-seen'), []);
  assert.deepEqual(recordedCommitsByCall('never-seen', ['call-a']), {});
  assert.deepEqual(recordedCommitsByCall('never-seen', []), {});
});

test('a hostile event value cannot break the recorder', () => {
  resetRecorder();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  recordSessionEvent('s6', 1, 1, 'tool/call', circular);
  recordSessionEvent('s6', 2, 2, 'tool/call', { args: { command: 'git commit -m "Still fine"' } });
  assert.deepEqual(recordedCommits('s6'), [{ subject: 'Still fine' }]);
  assert.deepEqual(recorderSize(), { sessions: 1, events: 2 });
});
