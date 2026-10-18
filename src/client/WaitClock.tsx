import { useEffect, useState } from 'react';
import { formatRunDuration } from './message-chrome.js';
import css from './Reader.module.css';

/** Past this, a wait stops being a pause and reads as the model not answering. */
export const WAIT_OVERTIME_MS = 10_000;

/**
 * Below this the wait is a pause, not a wait.
 *
 * A number that appears the instant a request leaves draws the eye to something that is usually
 * over before it can be read; three seconds is roughly where "a beat" turns into "this is taking a
 * while", and it is also the earliest point at which the readout carries information the reader did
 * not already have.
 */
export const WAIT_COUNT_FROM_MS = 3_000;

/**
 * How long the model has been given the turn, counted in plain seconds.
 *
 * Just the number and, past ten seconds, a「暂未响应」badge — no bar, because the
 * question the reader has is「how long has this been hanging」, not「how far
 * along」: there is no known total to be a fraction of.
 *
 * The clock restarts whenever the anchor changes, so each wait is timed from the
 * event that started it rather than from the beginning of the turn.
 */
export function WaitClock({ startTime }: { startTime: number | null }) {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [counting, setCounting] = useState(false);
  const anchor = startTime ?? mountedAt;
  // Do not start the 250ms clock while the number is still hidden: that was twelve empty renders
  // before the readout could appear at all. A single timer wakes up at the threshold instead.
  useEffect(() => {
    setCounting(false);
    const delay = Math.max(0, WAIT_COUNT_FROM_MS - (Date.now() - anchor));
    const id = setTimeout(() => {
      setNow(Date.now());
      setCounting(true);
    }, delay);
    return () => clearTimeout(id);
  }, [anchor]);
  useEffect(() => {
    if (!counting) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const tick = () => setNow(Date.now());
    const start = () => {
      if (id !== undefined) return;
      tick();
      id = setInterval(tick, 250);
    };
    const stop = () => {
      if (id === undefined) return;
      clearInterval(id);
      id = undefined;
    };
    // A background tab has no reader looking at the number; stop the clock and catch up on return.
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') stop();
      else start();
    };
    start();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [counting]);
  const waited = Math.max(0, now - anchor);
  const overtime = waited >= WAIT_OVERTIME_MS;
  // Nothing at all renders before the wait is worth a number. Keeping the readout mounted and merely
  // invisible held a blank slot open between the status text and the chevron for the whole first
  // three seconds — the quiet clutter this view is supposed to avoid, and worse than the movement it
  // was there to prevent. The cost is that the chevron moves once, when the readout arrives, which
  // is the same movement the status text itself makes whenever it changes; the width floor on the
  // readout keeps the counting from moving anything after that.
  if (waited < WAIT_COUNT_FROM_MS) return null;
  return <span className={css.waitClock} data-reader-wait-clock
    {...(overtime ? { 'data-overtime': '' } : {})}>
    <span className={css.waitSeconds}>{formatRunDuration(waited)}</span>
    {overtime && <span className={css.waitOvertime} data-reader-wait-badge>暂未响应</span>}
  </span>;
}
