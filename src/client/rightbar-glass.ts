/**
 * The right column's PAGE — the dockkit pane the right-hand windows open into (files, the diff view, the terminal).
 *
 * The reader described that column as two surfaces: 「右侧栏一共只分两部分，上面的顶栏和下面的页面。上面的顶栏可以合并到顶栏遮罩，
 * 下面的页面新增一项在磨砂玻璃下面」. The strip is not here — `wallpaper-scope.ts` paints it from the top bar's own scrim variables,
 * which is what makes the two read as one bar. This file is the page below it, and it owns the new 「右侧栏面板」 dial.
 *
 * What actually covered the wallpaper was never the pane. Measured on the live page: the pane (`[data-dockkit-pane]`) and its
 * `_paneBody_` are both `rgba(0, 0, 0, 0)`, and the only painted layer in the whole column is the rightbar FRAME's own gradient
 * (`[data-rightbar-collapsed]`, `background-image: linear-gradient(…)`). So the frame's gradient is withdrawn while a wallpaper is
 * set — with none, the theme's own background is what the column should keep — and the pane is given the dial's wash.
 *
 * The frost rides a PSEUDO-ELEMENT, not the pane, for the reason the top bar's does: `backdrop-filter` on an element makes it a
 * backdrop root, which kills every descendant's own blur and confines its stacking context. `isolation: isolate` keeps the one the
 * pseudo needs, without being a backdrop root itself.
 */
import { GLASS_ATTRIBUTE } from './app-backdrop.js';
import { WINDOW_SCOPE_ATTRIBUTE as WALLPAPER_ATTRIBUTE } from './wallpaper-scope.js';

export const RIGHTBAR_GLASS_STYLE_ID = 'dsh-viewtune-rightbar-glass';

/** The pane the right-hand windows open into, and the column boxes that paint over the wallpaper. */
const PANE = '[data-dockkit-pane]';
const COLUMN = '[data-rightbar-col], [data-rightbar-collapsed]';

/**
 * The stylesheet. The dial's NAME is spelled out rather than interpolated from the part table, exactly as in
 * `composer-glass.ts`: the guard cross-checks the `--glass-*` names a stylesheet reads against the names the settings rows write,
 * and an interpolated name is invisible to that check.
 */
export function rightbarGlassCss(): string {
  return [
    `/* The frame's gradient goes only while a wallpaper is set: with none there is nothing to reveal, and the theme's own`,
    `   background is what the column should keep. */`,
    `html[${WALLPAPER_ATTRIBUTE}] ${COLUMN} { background-image: none !important; }`,
    `/* …and the pane carries the dial's wash. */`,
    `html[${GLASS_ATTRIBUTE}] ${PANE} {`,
    `  background-color: color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(--glass-rightbar, 0%), transparent) !important;`,
    `  position: relative;`,
    `  isolation: isolate;`,
    `}`,
    `/* The frost, on a pseudo-element: see the note at the top of this file. */`,
    `html[${GLASS_ATTRIBUTE}] ${PANE}::before {`,
    `  content: '';`,
    `  position: absolute;`,
    `  inset: 0;`,
    `  z-index: -1;`,
    `  backdrop-filter: blur(var(--glass-blur-rightbar));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-rightbar));`,
    `}`,
  ].join('\n');
}

/** Install the stylesheet once; the disposer removes the element it appended. */
export function installRightbarGlass(doc: Document): () => void {
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', RIGHTBAR_GLASS_STYLE_ID);
  style.textContent = rightbarGlassCss();
  doc.head.append(style);
  return () => { style.remove(); };
}
