import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subscribeScroll } from '../src/client/scroll-bus.ts';

test('one scroll event fans out once per frame and the last unsubscribe removes the listener', () => {
  const target = new EventTarget();
  const frames: (() => void)[] = [];
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let nextId = 1;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frames.push(() => { callback(0); });
    return nextId++;
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const calls: string[] = [];
    const offA = subscribeScroll(target, () => calls.push('a'));
    const offB = subscribeScroll(target, () => calls.push('b'));
    target.dispatchEvent(new Event('scroll'));
    target.dispatchEvent(new Event('scroll'));
    assert.deepEqual(calls, [], 'the listeners run in the scheduled frame, not synchronously');
    assert.equal(frames.length, 1, 'two scroll events share one frame');
    frames.shift()!();
    assert.deepEqual(calls, ['a', 'b']);

    offA();
    offB();
    target.dispatchEvent(new Event('scroll'));
    assert.equal(frames.length, 0, 'the native listener is gone with the last subscriber');
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});
