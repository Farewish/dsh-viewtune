import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitHashes, commitHashesResult, parseCommitLog } from '../src/commit-hash.ts';

const SEP = '\u001f';
const join = (lines: readonly string[]): string => lines.join('\n');

test('parseCommitLog reads git\'s own two-field format, subject to hash', () => {
  const log = join([`70beff5${SEP}Release 0.5.9`, `3b654f1${SEP}Animate the three lanes`, '', 'no separator here', `${SEP}hash missing`]);
  assert.deepEqual(parseCommitLog(log), {
    'Release 0.5.9': '70beff5',
    'Animate the three lanes': '3b654f1',
  });
});

test('a repeated subject keeps the NEWEST hash, because git log is newest-first', () => {
  assert.deepEqual(parseCommitLog(join([`aaa1111${SEP}Same subject`, `bbb2222${SEP}Same subject`])), { 'Same subject': 'aaa1111' });
});

test('subjects are matched whole: a near miss is not a hash for the line the reader sees', () => {
  const parsed = parseCommitLog(join([`aaa1111${SEP}Fix the frame`]));
  assert.equal(parsed['Fix the frame'], 'aaa1111');
  assert.equal(parsed['Fix the frames'], undefined);
  assert.equal(parsed['fix the frame'], undefined);
});

test('a subject may contain anything but the separator, quotes and parentheses included', () => {
  const subject = 'Revert "Ellipsise a delivered file\'s name: the card style stacks the name (unreleased)"';
  assert.deepEqual(parseCommitLog(join([`abc1234${SEP}${subject}`])), { [subject]: 'abc1234' });
});

test('commitHashes answers an empty record rather than throwing when there is nothing to read', async () => {
  assert.deepEqual(await commitHashes('', ['anything']), {});
  assert.deepEqual(await commitHashes('no/such/directory/at/all', ['anything']), {});
  assert.deepEqual(await commitHashes('.', []), {});
});

test('an answer nobody could ask for is marked unqueried, so the client does not cache it', async () => {
  assert.deepEqual(await commitHashesResult('no/such/directory/at/all', ['anything']), { hashes: {}, queried: false });
  assert.deepEqual(await commitHashesResult('', ['anything']), { hashes: {}, queried: false });
  assert.deepEqual(await commitHashesResult('.', []), { hashes: {}, queried: true });
});