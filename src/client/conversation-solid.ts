/**
 * The conversation page as a SOLID page: the theme's base colour, with the same lifted fade above the
 * composer the trajectory page wears.
 *
 * The trajectory view is the host's own component and already paints itself on `--dsw-alias-bg-base`;
 * the conversation view is painted over whatever the wallpaper put behind the column, which is what this
 * switch replaces. Like every other rule this plugin aims at the host's tree, it is installed on the
 * document and switched on by an attribute on `<html>` — nothing applies until the reader asks.
 *
 * The scope is the host's conversation column, MINUS everything inside the reading view: that view
 * publishes the same `data-chat-flow` on purpose (it mimics the chat's column so host stylesheets treat
 * it alike), and this switch is about the conversation page only.
 *
 * What it does is deliberately the trajectory page's recipe, because the point is that the two pages
 * look alike: the scroller stops painting an image and paints the base colour, the two names the gutter
 * groove reads are withdrawn so the gutter goes solid with it, and the band above the composer — our own
 * masked pseudo-element — is lifted over the last rows and painted in that same colour. The ramp mask
 * is restated here rather than inherited: the wallpaper's copy of it is gated on a wallpaper existing,
 * and this switch has nothing to do with whether one does.
 */
import { CONVERSATION_SOLID_ATTRIBUTE } from './app-backdrop.js';

export const CONVERSATION_SOLID_STYLE_ID = 'dsh-viewtune-conversation-solid';

/** The gate, and the one selector every rule below hangs off. */
const GATE = `html[${CONVERSATION_SOLID_ATTRIBUTE}]`;
const COLUMN = `[data-chat-flow]:not([data-dsh-better-display], [data-dsh-better-display] *)`;
/** The host's scroll container — the element that owns both the page surface and the gutter groove. */
const SCROLLER = `${GATE} [class*="_scrollBody"]:has(${COLUMN})`;

/** How far above the composer the fade begins, and how long the fade itself takes. TWO numbers, like the reading
 *  page's band: the lift is where the text is gone (the composer's own edge), and the ramp is how long it takes to
 *  get there — so shortening the ramp moves the point where the text STARTS to fade towards the point where it
 *  disappears, which is what the reader asked for there. Same values on both pages, so they look alike. */
const FADE_LIFT = '36px';
const FADE_RAMP = '20px';

export function conversationSolidCss(): string {
  return [
    `/* The page surface, in the SAME colour the trajectory page shows: that page's own root paints`,
    `   --dsw-alias-bg-layer-1 over the theme's base, and a reader who asked the two pages to look alike`,
    `   means the colour they can see. Both the image AND the two names the gutter groove reads are`,
    `   withdrawn here: the groove lives on this element's scrollbar, so leaving the wallpaper names in`,
    `   place would leave a strip of photograph down the right edge of a page that is meant to be one`,
    `   colour. */`,
    `${SCROLLER} {`,
    `  background-image: none !important;`,
    `  background-color: var(--dsw-alias-bg-layer-1) !important;`,
    `  --viewtune-wallpaper-image: none;`,
    `  --viewtune-wallpaper-dim: 0%;`,
    `  --viewtune-conversation-fade-lift: ${FADE_LIFT};`,
    `  --viewtune-conversation-fade-ramp: ${FADE_RAMP};`,
    `}`,
    `/* The composer's own gradient is dropped, because the band below replaces it: two fades would ramp at`,
    `   two different speeds. */`,
    `${SCROLLER} [class*="_composerSeat"] {`,
    `  background-image: none !important;`,
    `}`,
    `/* Our masked copy, in the page's colour — the same one the surface wears, exactly as the trajectory`,
    `   page's band matches its own page. Lifted over the last rows. The mask belongs on the pseudo-element`,
    `   and never on the seat: a mask applies to the whole subtree, and masking the seat would hide the`,
    `   composer card inside it. Its ramp is anchored to END at the lift, so the two numbers answer two`,
    `   questions and the fade can be made faster without moving where the text is gone — the reading page's`,
    `   band is built the same way. (The trajectory page keeps its single-number band on purpose: the reader`,
    `   asked for that page to stay as it is.) */`,
    `${SCROLLER} [class*="_composerSeat"]::before {`,
    `  content: '';`,
    `  position: absolute;`,
    `  inset: calc(-1 * var(--viewtune-conversation-fade-lift, ${FADE_LIFT})) 0 0 0 !important;`,
    `  z-index: -1;`,
    `  pointer-events: none;`,
    `  background-image: none !important;`,
    `  background-color: var(--dsw-alias-bg-layer-1) !important;`,
    `  mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-conversation-fade-lift, ${FADE_LIFT}) - var(--viewtune-conversation-fade-ramp, ${FADE_RAMP})), #000 var(--viewtune-conversation-fade-lift, ${FADE_LIFT})) !important;`,
    `  -webkit-mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-conversation-fade-lift, ${FADE_LIFT}) - var(--viewtune-conversation-fade-ramp, ${FADE_RAMP})), #000 var(--viewtune-conversation-fade-lift, ${FADE_LIFT})) !important;`,
    `}`,
  ].join('\n');
}

/** Install the stylesheet once; the disposer takes it away with the gate it is switched on by. */
export function installConversationSolid(doc: Document): () => void {
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', CONVERSATION_SOLID_STYLE_ID);
  style.textContent = conversationSolidCss();
  doc.head.append(style);
  return () => {
    style.remove();
  };
}
