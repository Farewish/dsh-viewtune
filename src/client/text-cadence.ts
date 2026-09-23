/**
 * How often a streaming message hands its revealed text to React.
 *
 * One publication is a whole render of the growing node: the Markdown tail re-parsed, its words re-segmented, new
 * `<Word>` elements mounted, and then a layout the followers measure. On a high-refresh display the host's own
 * cadence is one publication per frame, which is up to four times the work a reader can see — and it makes the
 * pacing follow whatever the last frame happened to cost, so a fast screen gets an uneven reveal rather than a
 * faster one.
 *
 * Both cadences drive the SAME reveal: `StreamBuffer.advance` is a function of the clock (`now - lastAt`), so a
 * steadier cadence samples that trajectory less often instead of changing it. What a reader sees is the same
 * animation in slightly larger steps, and a pace that no longer depends on frame timing.
 *
 * Pure, and in a module of its own, so the rule can be tested without a DOM or a browser clock — the same reason
 * `reading-scroll.ts` exists.
 */
export type TextCadence = 'frame' | 'steady';

/** The row the settings panel offers, in the order it offers them. */
export const TEXT_CADENCES: readonly { id: TextCadence; label: string }[] = [
  { id: 'steady', label: '固定 60 次/秒' },
  { id: 'frame', label: '跟随屏幕刷新' },
];

/** One publication per this many milliseconds; `0` means "every frame the browser gives us". */
export const TEXT_CADENCE_STEP_MS: Record<TextCadence, number> = { frame: 0, steady: 1000 / 60 };

/**
 * The stored value, read defensively: only the exact string asks for the per-frame cadence.
 *
 * The steadier cadence is the DEFAULT — it is what a fresh install opens with, and what a record written before this
 * setting existed resolves to, so the expensive option has to be asked for by name. That is also why the panel labels
 * it as a cost: per-frame publication is the one that makes the reveal's work follow the display's refresh rate.
 */
export function textCadenceOf(value: unknown): TextCadence {
  return value === 'frame' ? 'frame' : 'steady';
}

/**
 * Is a publication due at `now`, given when the last one happened?
 *
 * The comparison is `>=` rather than `>`: a display whose frame interval is exactly the step would otherwise
 * publish every OTHER frame, halving the cadence a reader asked for. `now` and `lastPublished` come from the same
 * clock (the rAF timestamp), so the difference never mixes time origins.
 */
export function publishDue(now: number, lastPublished: number, cadence: TextCadence): boolean {
  const step = TEXT_CADENCE_STEP_MS[cadence];
  return step === 0 || now - lastPublished >= step;
}
