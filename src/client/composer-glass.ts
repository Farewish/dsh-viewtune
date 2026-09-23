/**
 * The host's input box, transparent like the rest of the skin.
 *
 * The composer belongs to the host and is on screen in BOTH views, which is why this follows the skin's master switch
 * rather than the conversation-page one: neither of those two switches describes it on its own.
 *
 * Two facts from the host's own stylesheet decide the shape of this file:
 *
 * - the plate is a THEME TOKEN — `.uV2eYG_card { background: var(--dsw-specific-input-major) }` — so the override is a
 *   token redefinition rather than a new background, exactly like the conversation page's code plates. The dial needs
 *   the original value to mix with, and a custom property cannot read the token it is overriding, so the value is
 *   copied onto `body` (where the theme defines it) and read back from there.
 * - the declaration goes on the composer's SEAT, not on `body`: the card is a descendant and inherits it, so nothing
 *   else in the shell that uses `--dsw-specific-input-major` changes.
 *
 * The seat also paints its own lift — `.wSkVaW_composerSeat { background: linear-gradient(180deg, transparent 0px,
 * var(--dsw-alias-bg-base) 36px) }` — directly behind that plate. A translucent card over an opaque band shows the
 * BAND, not the wallpaper, so the band is withdrawn while the skin is on — but ONLY where our own band replaces it,
 * which is wherever a wallpaper is set (see the gate below). With no wallpaper there is nothing to reveal, so the
 * host's band stays and the fade survives; that combination used to lose it.
 */
import { GLASS_ATTRIBUTE } from './app-backdrop.js';
import { WINDOW_SCOPE_ATTRIBUTE as WALLPAPER_ATTRIBUTE } from './wallpaper-scope.js';

export const COMPOSER_GLASS_STYLE_ID = 'dsh-viewtune-composer-glass';

/** The seat's class name, matched case-insensitively (`_composerSeat`, `_ComposerContentEditable`, …). */
const COMPOSER = '[class*="composer" i]';

/**
 * The stylesheet: an ungated snapshot plus the gated override.
 *
 * The snapshot is ungated because it only copies a token; the override is gated on the skin's own attribute, which is
 * published on `<html>` (the rules style host elements outside this view, so the switch has to be a fact about the
 * document).
 *
 * The dial's NAME is spelled out here rather than interpolated from the part table, and that is deliberate: the guard
 * cross-checks the `--glass-*` names this stylesheet reads against the names the settings rows write, so a surface
 * wired to a property no row writes has to be visible in the artifact. An interpolated name is invisible to that
 * check — which is exactly how this one was caught.
 */
export function composerGlassCss(): string {
  return [
    `/* The plate's original value, where the theme defines it. */`,
    `body {`,
    `  --viewtune-input-plate: var(--dsw-specific-input-major);`,
    `  /* The two round buttons under the field — 「添加附件」 and 「指令」 — both carry the composer's \`_add\` class and`,
    `     both paint this one token, so one override covers the pair. Their own dial is the input's: they are part of`,
    `     the same surface, and the reader asked for them to go translucent WITH it. */`,
    `  --viewtune-selector-plate: var(--dsw-specific-selector);`,
    `}`,
    `/* The seat: inherit a translucent plate into the card, and the same treatment into those two buttons. Their`,
    `   declaration comes from the seat too, so nothing outside the composer that uses this token changes. */`,
    `html[${GLASS_ATTRIBUTE}] ${COMPOSER} {`,
    `  --dsw-specific-input-major: color-mix(in srgb, var(--viewtune-input-plate) var(--glass-input, 25%), transparent);`,
    `  --dsw-specific-selector: color-mix(in srgb, var(--viewtune-selector-plate) var(--glass-input, 25%), transparent);`,
    `}`,
    `/* The lift band goes ONLY where our own band is going to replace it — that is, wherever a wallpaper is chosen`,
    `   (the attribute is set in either scope, and the band lives in wallpaper-scope.ts). Without this gate, turning`,
    `   the skin on with NO wallpaper dropped the host's band and left nothing behind it: no fade at all on any page,`,
    `   which is the one combination this rule used to break. With no wallpaper there is also nothing for a`,
    `   translucent plate to reveal, so keeping the host's band costs nothing and keeps the fade. */`,
    `html[${GLASS_ATTRIBUTE}][${WALLPAPER_ATTRIBUTE}] ${COMPOSER} {`,
    `  background-image: none;`,
    `}`,
    `/* NO WALLPAPER: the band in wallpaper-scope.ts is gated on a wallpaper existing, so without one nothing replaced`,
    `   the host's — and the host's ramp runs INSIDE the seat's own box, which means it starts at the composer's very`,
    `   edge and the transcript above stays fully drawn right up against the input (reported: the text overlaps the`,
    `   box). So the same LIFTED band is painted here, in the theme's base colour — the colour the host's own band`,
    `   used — with the same two numbers, repeated as fallbacks because the declaration lives in the module that needs`,
    `   a wallpaper to run at all. Same construction, same page-independent scope: it fixes every page, including the`,
    `   trajectory one, whose own band is gated the same way. */`,
    `html[${GLASS_ATTRIBUTE}]:not([${WALLPAPER_ATTRIBUTE}]) ${COMPOSER} { background-image: none; }`,
    `html[${GLASS_ATTRIBUTE}]:not([${WALLPAPER_ATTRIBUTE}]) ${COMPOSER}::before {`,
    `  content: '';`,
    `  position: absolute;`,
    `  inset: calc(-1 * var(--viewtune-wallpaper-fade-lift, 36px)) 0 0 0;`,
    `  z-index: -1;`,
    `  pointer-events: none;`,
    `  background-color: var(--dsw-alias-bg-base);`,
    `  mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-wallpaper-fade-lift, 36px) - var(--viewtune-wallpaper-fade-ramp, 20px)), #000 var(--viewtune-wallpaper-fade-lift, 36px));`,
    `  -webkit-mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-wallpaper-fade-lift, 36px) - var(--viewtune-wallpaper-fade-ramp, 20px)), #000 var(--viewtune-wallpaper-fade-lift, 36px));`,
    `}`,
    `/* …except on the trajectory page, whose own band paints \`bg-layer-1\` — the surface that page is MADE of, which`,
    `   is what stops its bottom reading as a bar of another shade. Its stand-in has to match THAT colour, not the base`,
    `   one the other pages use; only the colour, so the lift and the ramp stay the shared numbers and no other page`,
    `   changes. Nothing else about this page is touched: its own band, its single lift and its 36px ramp stay as they`,
    `   are. */`,
    `html[${GLASS_ATTRIBUTE}]:not([${WALLPAPER_ATTRIBUTE}]) [class*="_scrollBody"]:has([data-trajectory-scroll]) ${COMPOSER}::before {`,
    `  background-color: var(--dsw-alias-bg-layer-1);`,
    `}`,
  ].join('\n');
}

/** Install it once per document and hand back the disposer `ctx.effect` requires. */
export function installComposerGlass(doc: Document): () => void {
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', COMPOSER_GLASS_STYLE_ID);
  style.textContent = composerGlassCss();
  doc.head.append(style);
  return () => { style.remove(); };
}
