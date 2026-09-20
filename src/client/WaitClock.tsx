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
  const anchor = startTime ?? mountedAt;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const waited = Math.max(0, now - anchor);
  const overtime = waited >= WAIT_OVERTIME_MS;
  const counting = waited >= WAIT_COUNT_FROM_MS;
  return <span className={css.waitClock} data-reader-wait-clock
    {...(overtime ? { 'data-overtime': '' } : {})}>
    {/* Mounted from the first frame so its width is already reserved — the readout appearing must
        not shift the chevron that sits right after the label — but held invisible until the wait is
        worth a number. `visibility` keeps it out of the accessibility tree as well as out of the
        eye's way, so nothing announces a zero. */}
    <span className={css.waitSeconds} data-pending={counting ? undefined : ''}>{formatRunDuration(waited)}</span>
    {overtime && <span className={css.waitOvertime} data-reader-wait-badge>暂未响应</span>}
  </span>;
}
