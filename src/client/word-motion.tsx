import { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import { MarkdownText } from './markdown/MarkdownText.js';
import { WORD_MOTION, WordTimeline } from './word-timeline.js';
import { revealFrames } from './reveal-frames.js';
import { StreamMotionContext } from './streaming.js';
import css from './Reader.module.css';

const WordScope = createContext({ enabled: false, generation: 0 });
const CODE_LABELS = { copyLabel: '复制代码', copiedLabel: '已复制' };

function useSourceReveal(element: RefObject<HTMLElement>, born: number | null, generation: number) {
  const scope = useContext(WordScope);
  const { blur } = useContext(StreamMotionContext);
  const cancelled = useRef(false);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    target.dataset.wordState = 'settled';
    if (!scope.enabled || scope.generation !== generation) { cancelled.current = true; return; }
    if (cancelled.current || born === null || document.hidden) return;
    const age = Number(document.timeline.currentTime ?? performance.now()) - born;
    if (age >= WORD_MOTION.duration || typeof target.animate !== 'function') return;
    // The reference opacity + blur frames, applied only to this new word. The blur is the reader's choice
    // (`revealFrames`): with it off the animation is opacity alone, which the compositor can run without repainting.
    const animation = target.animate(revealFrames(blur), { duration: WORD_MOTION.duration, easing: WORD_MOTION.easing, fill: 'backwards' });
    // One absolute clock prevents newly mounted/resegmented leaves from getting
    // a fresh delay or running ahead because their layout effects ran later.
    animation.startTime = born;
    target.dataset.wordState = 'resolving';
    const finish = () => { animation.cancel(); target.dataset.wordState = 'settled'; document.removeEventListener('visibilitychange', hidden); };
    animation.onfinish = finish;
    const hidden = () => { if (document.hidden) { cancelled.current = true; finish(); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { animation.cancel(); document.removeEventListener('visibilitychange', hidden); target.dataset.wordState = 'settled'; };
  }, [element, born, generation, scope.enabled, scope.generation]);
}

function Word({ children, born, generation, offset, inline }: { children: string; born: number | null; generation: number; offset: number; inline: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  useSourceReveal(element, born, generation);
  return <span ref={element} className={inline ? css.streamInlineWord : css.streamWord} data-reader-word data-source-start={offset} data-source-birth={born ?? undefined}>{children}</span>;
}

/** A native code block enters on the same clock, without rebuilding its text. */
function MotionAtom({ children, born, generation, offset }: { children: ReactNode; born: number | null; generation: number; offset: number }) {
  const element = useRef<HTMLDivElement>(null);
  useSourceReveal(element, born, generation);
  return <div ref={element} className={css.streamAtom} data-reader-atom data-source-start={offset} data-source-birth={born ?? undefined}>{children}</div>;
}

/** Native Think is literal text, not Markdown. Spans never alter its bytes. */
export function MotionPlainText({ text, enabled, revision }: { text: string; enabled: boolean; revision: number }) {
  const { words: perWord } = useContext(StreamMotionContext);
  const timeline = useRef<WordTimeline>();
  timeline.current ??= new WordTimeline();
  // With the per-word reveal off there are no identities to allocate and nothing to animate: the buffer still paces
  // the text, and this renders it as the plain string it is.
  if (perWord) timeline.current.begin(text, enabled, revision, Number(document.timeline.currentTime ?? performance.now()));
  const current = timeline.current;
  const generation = current.generation;
  const scope = useMemo(() => ({ enabled, generation }), [enabled, generation]);
  return <WordScope.Provider value={scope}><div className={css.reasonPlain}>
    {perWord && current.hasLiveText ? current.words(text, 0).map(word => word.text.trim()
      ? <Word key={word.key} born={word.born} generation={generation} offset={word.key} inline>{word.text}</Word>
      : <MotionGap key={word.key}>{word.text}</MotionGap>) : text}
  </div></WordScope.Provider>;
}

/**
 * The whitespace between two revealed words, as a keyed child.
 *
 * It used to be a bare string in the same children array. Words carry their source offset as a key, strings cannot
 * carry any, and React matches the unkeyed ones by position — so every time a word folded into the settled prefix and
 * the array shortened by one, EVERY string in the live window was matched against a different position and rebuilt.
 * A measured build put this at 8,492 new text nodes directly under the reasoning container in two seconds (≈17 per
 * frame, the window's whole punctuation and whitespace population) with the word spans nearly untouched.
 *
 * A class-less span is the smallest keyed stand-in for those bytes: `display: inline` is what a text node does, so
 * line breaking and the bytes themselves are unchanged — this is a reconciliation fix, not a rendering one.
 */
function MotionGap({ children }: { children: string }) {
  return <span>{children}</span>;
}

/** Native DSH Markdown semantics with a stable text-leaf animation hook. */
export function MotionMarkdown({ text, streaming, enabled, revision, fileMentions }: {
  text: string; streaming: boolean; enabled: boolean; revision: number; fileMentions?: MarkdownFileMentions;
}) {
  const { words: perWord } = useContext(StreamMotionContext);
  const timeline = useRef<WordTimeline>();
  timeline.current ??= new WordTimeline();
  // See MotionPlainText: with the per-word reveal off the timeline is not started at all, which is the point —
  // segmentation, birth times and word identities are the work this switch removes from a streaming answer.
  if (perWord) timeline.current.begin(text, enabled, revision, Number(document.timeline.currentTime ?? performance.now()));
  const generation = timeline.current.generation;
  const scope = useMemo(() => ({ enabled, generation }), [enabled, generation]);
  const renderText = useMemo(() => (value: string, offset: number, inline = false): ReactNode => {
    const current = timeline.current!;
    if (!current.hasLiveText) return value;
    return current.words(value, offset).map(word => word.text.trim()
      ? <Word key={word.key} born={word.born} generation={current.generation} offset={word.key} inline={inline || /^\p{P}+$/u.test(word.text)}>{word.text}</Word>
      : <MotionGap key={word.key}>{word.text}</MotionGap>);
  }, []);
  const renderAtom = useMemo(() => (children: ReactNode, offset: number): ReactNode => {
    const current = timeline.current!;
    return current.hasLiveText ? <MotionAtom born={current.bornAt(offset)} generation={current.generation} offset={offset}>{children}</MotionAtom> : children;
  }, []);
  return <WordScope.Provider value={scope}>
    {perWord
      ? <MarkdownText text={text} streaming={streaming} codeLabels={CODE_LABELS} fileMentions={fileMentions} renderText={renderText} renderAtom={renderAtom} />
      : <MarkdownText text={text} streaming={streaming} codeLabels={CODE_LABELS} fileMentions={fileMentions} />}
  </WordScope.Provider>;
}
