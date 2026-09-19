import assert from 'node:assert/strict';
import { test } from 'node:test';
import { questionCardModel } from '../src/client/native/question-card-model.ts';

const args = (questions: unknown) => JSON.stringify({ questions });
const result = (answers: unknown) => JSON.stringify({ answers });

test('a question set pairs each question with the answer carrying its id', () => {
  const card = questionCardModel(
    args([{ id: 'mode', header: '模式', question: '选哪种？' }, { id: 'scope', question: '范围？' }]),
    result([{ id: 'scope', selected: ['全部'] }, { id: 'mode', selected: ['A'], custom: '或者 B' }]),
  );
  assert.deepEqual(card, {
    entries: [
      { id: 'mode', question: '选哪种？', answers: ['A', '或者 B'] },
      { id: 'scope', question: '范围？', answers: ['全部'] },
    ],
    answered: 2,
    total: 2,
  });
});

test('an unanswered question stays empty instead of taking the next answer', () => {
  const card = questionCardModel(
    args([{ id: 'a', question: 'A？' }, { id: 'b', question: 'B？' }]),
    result([{ id: 'b', selected: ['是'] }]),
  );
  assert.deepEqual(card?.entries.map(entry => entry.answers), [[], ['是']]);
  assert.equal(card?.answered, 1);
  assert.equal(card?.total, 2);
});

test('a custom answer follows the selected labels, and an empty one is dropped', () => {
  const card = questionCardModel(
    args([{ id: 'a', question: 'A？' }]),
    result([{ id: 'a', selected: ['一', '二'], custom: '' }]),
  );
  assert.deepEqual(card?.entries[0]?.answers, ['一', '二']);
});

test('an answer whose id matches no question is ignored', () => {
  const card = questionCardModel(
    args([{ id: 'a', question: 'A？' }]),
    result([{ id: 'z', selected: ['x'] }, { id: 'a', selected: ['对'] }]),
  );
  assert.deepEqual(card?.entries[0]?.answers, ['对']);
});

test('a repeated question id is kept once, and a repeated answer id is not applied twice', () => {
  const card = questionCardModel(
    args([{ id: 'a', question: '第一次' }, { id: 'a', question: '第二次' }]),
    result([{ id: 'a', selected: ['第一次的答复'] }, { id: 'a', selected: ['第二次的答复'] }]),
  );
  assert.equal(card?.total, 1);
  assert.deepEqual(card?.entries[0], { id: 'a', question: '第一次', answers: ['第一次的答复'] });
});

test('a pending question is a card whose answers are all still empty', () => {
  assert.deepEqual(questionCardModel(args([{ id: 'a', question: 'A？' }]), ''), {
    entries: [{ id: 'a', question: 'A？', answers: [] }],
    answered: 0,
    total: 1,
  });
});

test('a result that is not an answer payload leaves every question unanswered', () => {
  assert.equal(questionCardModel(args([{ id: 'a', question: 'A？' }]), '用户已回答')?.answered, 0);
});

test('a call that is not a question set has no card', () => {
  assert.equal(questionCardModel('{"path":"a.ts"}', result([])), null);
  assert.equal(questionCardModel('{"questions":[]}', result([])), null);
  assert.equal(questionCardModel('{"questions":[{"question":"没有 id"}]}', result([])), null);
  assert.equal(questionCardModel('{ not json', result([])), null);
});
