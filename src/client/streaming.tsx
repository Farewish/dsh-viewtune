import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StreamBuffer } from './stream-buffer.js';
import { WORD_MOTION } from './word-timeline.js';
import { publishDue } from './text-cadence.js';
import type { TextCadence } from './text-cadence.js';

export const StreamMotionContext = createContext({ enabled: false, activatedAt: 0, cadence: 'frame' as TextCadence, blur: true, words: true });

export function useStreamingText(source: string, streaming: boolean, options: { startedAt?: number; interrupted: boolean; selected: boolean }) {
  const { enabled, activatedAt, cadence } = useContext(StreamMotionContext);
  const fresh = (options.startedAt ?? 0) >= activatedAt;
  const buffer = useRef<StreamBuffer>();
  if (!buffer.current) buffer.current = new StreamBuffer(enabled && streaming && fresh ? '' : source);
  const [display, setDisplay] = useState(() => ({ text: buffer.current!.visible, revision: 0 }));
  const [finalizing, setFinalizing] = useState(streaming);
  const frame = useRef(0);
  /**
   * When the last publication happened. A REF, not a local of the effect below — and that is the whole point.
   *
   * The effect re-runs on every `source` change, i.e. on every streamed delta. A local seeded at the top of it
   * therefore measures the time since the last ARRIVAL, not the time since the last publication: deltas closer
   * together than the step keep re-seeding the clock, `publishDue` never says yes, `advance` is never called, and the
   * reveal STALLS — no text at all until a pause of a full step, or until the 8192-character backlog guard fires. The
   * faster the model, the worse it gets, which is the wrong way round for a pace meant to decouple the reveal from
   * frame timing. Held across effect runs, the gate means what its doc says: one publication per step at most, and the
   * next one due immediately when the last was longer ago than a step (a pause, or the first delta of a new answer).
   */
  const publishedAt = useRef(0);
  const immediate = !enabled || options.interrupted || options.selected;
  const publish = () => {
    const current = buffer.current!;
    setDisplay(previous => previous.text === current.visible && previous.revision === current.revision ? previous : { text: current.visible, revision: current.revision });
  };
  useLayoutEffect(() => {
    const current = buffer.current!;
    current.update(source, performance.now(), { immediate: immediate || document.hidden, finished: !streaming });
    publish();
    cancelAnimationFrame(frame.current);
    // The clock of the last publication, for the cadence the reader chose. The loop still runs every frame — the
    // reveal's own pacing is a function of time, and the loop is what keeps it moving — but the render that a
    // publication costs (the Markdown tail, the word identities, the layout below it) happens on this cadence.
    if (publishedAt.current === 0) publishedAt.current = performance.now();
    const tick = (now: number) => {
      // A hidden page has nothing to reveal to: flush rather than pace, which is also what keeps a backgrounded
      // stream from coming back with a backlog.
      if (document.hidden) { current.flush(); publish(); publishedAt.current = now; }
      else if (publishDue(now, publishedAt.current, cadence)) { current.advance(now); publish(); publishedAt.current = now; }
      if (current.pending) frame.current = requestAnimationFrame(tick);
    };
    if (current.pending) frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [source, streaming, immediate, cadence]);
  useEffect(() => {
    const hidden = () => {
      if (!document.hidden) return;
      cancelAnimationFrame(frame.current);
      buffer.current!.flush(); publish(); setFinalizing(false);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  const pending = display.text !== source;
  useEffect(() => {
    if (streaming || pending) { setFinalizing(true); return; }
    if (immediate || document.hidden) { setFinalizing(false); return; }
    const timer = setTimeout(() => setFinalizing(false), WORD_MOTION.duration + WORD_MOTION.maxDelay);
    return () => clearTimeout(timer);
  }, [streaming, pending, immediate]);
  return { text: immediate ? source : display.text, pending: !immediate && pending, revision: display.revision, formatStreaming: streaming || (!immediate && (pending || finalizing)), reveal: enabled && !options.interrupted && !options.selected };
}
