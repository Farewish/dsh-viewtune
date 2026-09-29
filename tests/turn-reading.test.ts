/**
 * The ported step reading, against the platform's own formulas.
 *
 * The numbers this view shows (TTFT, tok/s) used to arrive ready-made on the turn-tail record. 0.2.0 moved the derivation
 * into `@deepseek-ai/dsh-client-ui-chat`, whose helper a plugin cannot reach, so `turn-reading.ts` computes them from the
 * same two fields. These cases pin the parts that decide a WRONG number rather than a missing one: a zero-length decode
 * window must not become an infinite rate, a partial timing record must not be mistaken for a measurement, and a usage
 * record with no usable `outputTokens` must stay unmeasured instead of becoming zero.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepReading, tokensPerSecondOf } from '../src/client/turn-reading.ts';
import type { AssistantMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client';

const node = (timing: unknown, usage?: unknown) => ({ kind: 'assistant', seq: 1, timing, usage }) as unknown as AssistantMessageNode;

test('a fully recorded step reads TTFT, decode time and output tokens', () => {
  const reading = stepReading(node({ stepStartTime: 1000, firstTokenTime: 1400, completedTime: 3400 }, { outputTokens: 200 }));
  assert.deepEqual(reading, { ttftMs: 400, decodeMs: 2000, outputTokens: 200 });
  // 200 tokens in 2s — the platform's own expression, not an approximation of it.
  assert.equal(tokensPerSecondOf(reading), 100);
});

test('an unrecorded part is null, never zero', () => {
  // No timing at all: the node carries a usage record but nothing to divide by.
  assert.deepEqual(stepReading(node(undefined, { outputTokens: 12 })), { ttftMs: null, decodeMs: null, outputTokens: 12 });
  // TTFT needs BOTH ends of its window; a missing step/start leaves it unmeasured while decode time still reads.
  assert.deepEqual(stepReading(node({ stepStartTime: null, firstTokenTime: 1400, completedTime: 3400 })), { ttftMs: null, decodeMs: 2000, outputTokens: null });
  // …and no first token means neither part is measurable.
  assert.deepEqual(stepReading(node({ stepStartTime: 1000, firstTokenTime: null, completedTime: 3400 })), { ttftMs: null, decodeMs: null, outputTokens: null });
});

test('the rate is only computed where the host computes it', () => {
  // A zero-length decode window is a turn whose tokens landed in the same millisecond as the first one — not infinity.
  assert.equal(tokensPerSecondOf({ ttftMs: 10, decodeMs: 0, outputTokens: 500 }), undefined);
  // Output tokens that are missing, negative, or not a number are not a measurement.
  assert.equal(tokensPerSecondOf({ ttftMs: null, decodeMs: 1000, outputTokens: null }), undefined);
  assert.equal(stepReading(node({ stepStartTime: 1, firstTokenTime: 2, completedTime: 3 }, { outputTokens: -5 })).outputTokens, null);
  assert.equal(stepReading(node({ stepStartTime: 1, firstTokenTime: 2, completedTime: 3 }, { outputTokens: 'many' })).outputTokens, null);
  assert.equal(stepReading(node({ stepStartTime: 1, firstTokenTime: 2, completedTime: 3 }, { outputTokens: Number.NaN })).outputTokens, null);
  // Zero is a real reading (a turn that produced no tokens), and it is a rate of zero rather than no rate.
  assert.equal(tokensPerSecondOf({ ttftMs: 1, decodeMs: 1000, outputTokens: 0 }), 0);
  // No reading at all stays undefined, which is what the metrics bag means by "not measured".
  assert.equal(tokensPerSecondOf(undefined), undefined);
});

test('clock skew inside a step cannot produce a negative duration', () => {
  // The host clamps both windows at zero; a plugin that did not would print a negative time.
  const reading = stepReading(node({ stepStartTime: 2000, firstTokenTime: 1500, completedTime: 1400 }));
  assert.deepEqual(reading, { ttftMs: 0, decodeMs: 0, outputTokens: null });
});
