/**
 * The scrollbar's own groove, and the dial behind it.
 *
 * The host leaves the track transparent (`::-webkit-scrollbar-track{background:0 0}`), which is right
 * when the page has a flat background and wrong once a wallpaper or a skin is behind it: the 8px gutter
 * then reads as a hole in whatever is beside it. So the track gets a surface of its own, dialled like
 * the skin's other surfaces — `0%` is exactly the host's transparent track, `100%` is a solid groove.
 *
 * It lives in an always-installed stylesheet rather than in the reading view's CSS module because the
 * track belongs to the HOST's scroll container: that element is an ancestor of this view, so a selector
 * scoped to the view could never match it and a custom property set on the view's root could never
 * reach it. The dial's value is therefore published on `<html>` under the SAME name the stylesheet
 * reads — one property, the skin's own convention — so "every dial is read by a stylesheet" stays true
 * for this surface too.
 *
 * Three layers, in this order: the reader's groove, the wallpaper's scrim, and the wallpaper itself.
 * The scrim's fallback is 0% and the image's is `none`, so with no wallpaper the last two layers paint
 * nothing and the groove is all there is.
 */
export const SCROLLBAR_STYLE_ID = 'dsh-viewtune-scrollbar';

/**
 * The dial's property, published on `<html>` rather than on the reading view's root — the same
 * convention as the skin's other parts, just one level higher because the element is outside the view.
 * Spelled out literally in the stylesheet below; this constant is only what the publishing code uses.
 */
export const SCROLLBAR_FILL_VARIABLE = '--glass-scrollbar';

/**
 * The dial's value as the stylesheet wants it: a percentage, or an empty string to withdraw it.
 *
 * `0%` is not "a transparent colour" but the absence of a groove — the host's own track shows through
 * untouched, which keeps the dial's floor identical to the look before this existed.
 */
export function scrollbarFillOf(value: unknown): string {
  const percent = typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : 0;
  return `${String(percent)}%`;
}

export function scrollbarStyleCss(): string {
  return [
    `/* The gutter's FLOOR: every scroll container in the app gets a flat groove in the dial's colour, and nothing`,
    `   else. It is one colour, so it needs no attachment, no size and no position — which is the point. Painting the`,
    `   WALLPAPER here as well (an earlier cut did) is wrong for any scroller that lives inside a card: a card with a`,
    `   \`backdrop-filter\` or a transform becomes the containing block for a fixed background, so the copy is scaled and`,
    `   positioned against the CARD and samples a patch of the wallpaper from somewhere else entirely. That showed up`,
    `   as a slab of the wrong colour down the right edge of an opened tool card, until a scroll repainted it (reported`,
    `   as 「奇怪的黄色」). The groove and the wallpaper have to compose in exactly ONE place — the lane below. */`,
    `::-webkit-scrollbar-track,`,
    `::-webkit-scrollbar-corner {`,
    `  background-color: color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--glass-scrollbar, 0%), transparent) !important;`,
    `  background-image: none !important;`,
    `}`,
    `/* The lane: the reading view's (and the conversation page's) own scroller, whose stable gutter sits ON the`,
    `   wallpaper, so there the two really do have to compose — the dim wash and the image ride in one stack over the`,
    `   groove's colour, and the fallbacks (0% and none) leave a gutter with no wallpaper identical to the flat one. */`,
    `[class*="_scrollBody"]::-webkit-scrollbar-track,`,
    `[class*="_scrollBody"]::-webkit-scrollbar-corner {`,
    `  /* The DIAL's layer has to be a layer, and the FIRST one: a \`background-color\` sits UNDER every image, so`,
    `     leaving the groove's colour to the flat rule above hides it completely behind the opaque wallpaper copy —`,
    `     the slot then reads as "missing" because it matches the backdrop exactly. That was a real regression from`,
    `     splitting this rule in two. */`,
    `  background-image:`,
    `    linear-gradient(color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--glass-scrollbar, 0%), transparent),`,
    `                    color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--glass-scrollbar, 0%), transparent)),`,
    `    linear-gradient(color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--viewtune-wallpaper-dim, 0%), transparent),`,
    `                    color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--viewtune-wallpaper-dim, 0%), transparent)),`,
    `    var(--viewtune-wallpaper-image, none) !important;`,
    `  background-attachment: fixed !important;`,
    `  background-repeat: no-repeat !important;`,
    `  background-size: cover, cover, var(--viewtune-wallpaper-size, cover) !important;`,
    `  background-position: center, center, var(--viewtune-wallpaper-position, center) !important;`,
    `}`,
    `/* The lane fills the host's whole column, and that is the whole change. The host insets this track by`,
    `   2px on ALL FOUR sides, and the inset is exactly the gap a reader sees around the groove: 2px of`,
    `   backdrop between it and the top bar's bottom border, 2px between it and the toolbar's right edge,`,
    `   2px inside the window's own right edge. Taking it to 0 makes the groove meet the surfaces it sits`,
    `   between. Note what the inset does NOT shrink: the thumb. The pill is the full thickness of the`,
    `   scrollbar whatever the track's margin is (measured in a rendered fixture), so insetting the thumb`,
    `   here — which an earlier cut of this did — only makes the scrollbar itself thinner, and the lane`,
    `   gains nothing: it already has every pixel the column has.`,
    `   Its ENDS are rounded too, like the two short slots below: the reader asked for the groove to look the same`,
    `   wherever it appears, and with the inset gone the radius is what makes it a bar rather than a strip that`,
    `   stops dead against the surfaces above and below it. */`,
    `[class*="_scrollBody"]::-webkit-scrollbar-track { margin: 0 !important; border-radius: 999px !important; }`,
    `/* The composer's own slot is a short strip beside the field, and there a square end reads as a different widget`,
    `   next to the pill-shaped thumb the host draws. Its ends are rounded, and ONLY its: the transcript's lane and`,
    `   every other gutter keep their square edges, because those are what let a groove meet the surfaces it sits`,
    `   between (see above). The thumb is untouched either way — it is the host's own pill, and shaping it was a bug`,
    `   once already. Scoped through the COMPOSER rather than by the scroller's own class name, which is a per-build`,
    `   hash (uV2eYG_scroll in this build); the composer's seat is what the card and its field live inside. */`,
    `[class*="composer" i] [class*="_scroll"]::-webkit-scrollbar-track { border-radius: 999px !important; }`,
  ].join('\n');
}

/** Install the stylesheet once; the disposer also clears the value it left on the document. */
export function installScrollbarStyle(doc: Document): () => void {
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', SCROLLBAR_STYLE_ID);
  style.textContent = scrollbarStyleCss();
  doc.head.append(style);
  return () => {
    style.remove();
    applyScrollbarFill(doc, '');
  };
}

/** Publish the dial's value on `<html>`, or withdraw it (an empty string) for the host's own track. */
export function applyScrollbarFill(doc: Document, fill: string): void {
  if (fill === '') doc.documentElement.style.removeProperty(SCROLLBAR_FILL_VARIABLE);
  else doc.documentElement.style.setProperty(SCROLLBAR_FILL_VARIABLE, fill);
}
