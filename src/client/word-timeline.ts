/** Motion parameters from the public transitions.dev streaming-text recipe. */
export const WORD_MOTION = {
  duration: 350,
  gap: 60,
  blur: 1,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  maxDelay: 240,
  /** Floor for the per-word cadence once a batch is compressed. */
  minGap: 3,
  /** One paint's words should land inside this window, however many arrive. */
  batchMs: 90,
} as const;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const closingPunctuation = /^[\p{Pe}\p{Pf},.!?:;，。！？、；：％‰…·]+$/u;
const openingPunctuation = /^[\p{Ps}\p{Pi}]+$/u;
export interface RevealingWord { key: number; text: string; born: number | null }
interface SourceBirth { end: number; born: number | null }

/** Source-offset identity survives reparsing, frozen blocks, and final formatting. */
export class WordTimeline {
  generation = 0;
  hasLiveText = false;
  private source: string | null = null;
  private enabled = false;
  private revision = 0;
  private floor = 0;
  /** How much of `births` is already past its reveal window — see the advance at the end of `begin`. */
  private settled = 0;
  private lastBirth = -Infinity;
  private readonly births: SourceBirth[] = [];

  begin(source: string, enabled: boolean, revision: number, now: number): void {
    if (this.source === source && this.enabled === enabled && this.revision === revision) return;
    const replaced = revision !== this.revision || (this.source !== null && !source.startsWith(this.source));
    if (replaced || !enabled) {
      this.births.length = 0;
      this.settled = 0;
      this.lastBirth = -Infinity;
      this.generation++;
      this.floor = source.length;
    } else if (this.source === null) {
      // A mounted historical prefix must not replay; a fresh live buffer mounts empty.
      this.floor = source.length;
    } else {
      // Allocate in source order, before Markdown can split/reorder text leaves.
      // Intervals cover every offset, so resegmented CJK words inherit the time
      // of their characters rather than falling through as instant "history".
      const from = this.source.length;
      const added = source.slice(from);
      // The cadence follows the batch, not a constant. A fixed per-word gap caps
      // the reveal at ~16 words/second however fast the model actually wrote, so
      // a 500 tok/s answer still dripped out one word at a time. A batch of many
      // words is compressed into one short window instead; a lone word keeps the
      // original typing rhythm.
      let arriving = 0;
      for (const part of segmenter.segment(added)) if (part.segment.trim()) arriving++;
      const gap = arriving > 1
        ? Math.max(WORD_MOTION.minGap, Math.min(WORD_MOTION.gap, WORD_MOTION.batchMs / arriving))
        : WORD_MOTION.gap;
      for (const part of segmenter.segment(added)) {
        let born = Number.isFinite(this.lastBirth) ? this.lastBirth : null;
        if (part.segment.trim()) {
          // Capping at the batch window is what stops a queue from forming: the
          // clock can never run further ahead than one window past the newest text.
          born = Math.min(now + WORD_MOTION.batchMs, Math.max(now, this.lastBirth + gap));
          this.lastBirth = born;
        }
        const end = from + part.index + part.segment.length;
        const previous = this.births.at(-1);
        if (previous && previous.born === born) previous.end = end;
        else this.births.push({ end, born });
      }
      // A word only needs an identity while it is still animating. Everything whose window has closed collapses back
      // into ONE inert leaf in `words()`, which is what keeps a streaming card's per-frame work proportional to the
      // NEW words instead of to everything received so far. Without this the floor never moved off zero on a live
      // card — it is only set on the two reset paths above — so the whole accumulated reasoning was re-segmented with
      // `Intl.Segmenter` and rebuilt as N `<Word>` elements sixty times a second. That is the jank: a reasoning stream
      // publishes text every frame, while a tool call flushes once and stops the loop, which is why only thinking
      // stuttered. `born` never decreases and the table is append-only, so a cursor is enough to find the boundary.
      const settledBy = now - (WORD_MOTION.duration + WORD_MOTION.maxDelay);
      while (this.settled < this.births.length) {
        const entry = this.births[this.settled]!;
        if (entry.born !== null && entry.born > settledBy) break;
        this.floor = Math.max(this.floor, entry.end);
        this.settled += 1;
      }
    }
    this.source = source;
    this.enabled = enabled;
    this.revision = revision;
    this.hasLiveText = enabled && this.births.length > 0;
  }

  bornAt(offset: number): number | null {
    if (!this.enabled || offset < this.floor || this.births.length === 0) return null;
    let low = 0;
    let high = this.births.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.births[middle]!.end <= offset) low = middle + 1;
      else high = middle;
    }
    return this.births[low]!.born;
  }

  words(value: string, offset: number): RevealingWord[] {
    // Atomic inline animation boxes must not turn commas into legal line starts
    // or strand opening quotes at a line end. Keep source-offset identities when
    // punctuation arrives in a later chunk, so the preceding word never replays.
    // Already received text is one inert leaf, not thousands of React Words.
    // Only the newly appended suffix needs word identities and birth times.
    const prefixLength = Math.min(value.length, Math.max(0, this.floor - offset));
    const prefix: RevealingWord[] = prefixLength > 0
      ? [{ key: offset, text: value.slice(0, prefixLength), born: null }]
      : [];
    const parts: { index: number; segment: string }[] = [];
    for (const segment of segmenter.segment(value.slice(prefixLength))) {
      const part = { index: prefixLength + segment.index, segment: segment.segment };
      const previous = parts.at(-1);
      if (previous?.segment.trim() && (closingPunctuation.test(part.segment) || openingPunctuation.test(previous.segment))) {
        previous.segment += part.segment;
      } else parts.push({ index: part.index, segment: part.segment });
    }
    return prefix.concat(parts.map(part => {
      const key = offset + part.index;
      return { key, text: part.segment, born: this.bornAt(key) };
    }));
  }
}
