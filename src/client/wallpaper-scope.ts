/**
 * The window-wide wallpaper: one backdrop for the whole app, not just the reading view.
 *
 * What the probes established, and why this file is shaped the way it is:
 *
 *   - the LEFT COLUMN is reachable through one scoped token (`--dsw-specific-sidebar-fill`), which is
 *     what the layout's sidebar column and the sidebar package's own root both paint from;
 *   - the TOP BAR has no background of its own — the conversation root paints behind it, and that
 *     root has no usable class suffix (every module mints a `_root`). So the backdrop is not "seen
 *     through" it: the same backdrop is PAINTED onto the header, and because every copy is
 *     `background-attachment: fixed` it is anchored to the viewport, which makes the copies line up
 *     as one continuous image;
 *   - `_header` alone also matches other headers (the terminal block's, for one), so the top bar is
 *     narrowed with `:has(> [class*="_titleRow"])` — `:has()` is available here, verified;
 *   - the frame carries the image, and the chrome carries only a scrim. The image is painted ONCE: two
 *     copies under two scrims would darken one region twice, which is exactly how the first probe
 *     broke the reading view.
 *
 * The stylesheet is static and gated on an attribute this plugin writes onto `<html>`; the values
 * that change (image, dim, chrome scrim) ride the same element as custom properties, because the
 * alternative — reading the reader's store from `apply` — is not possible: `createReaderStore()`
 * returns a handle, and the live snapshot belongs to the framework's instance.
 */
import { wallpaperDimOf } from './wallpaper.js';

export const WINDOW_SCOPE_ATTRIBUTE = 'data-viewtune-wallpaper';
export const WINDOW_SCOPE_STYLE_ID = 'dsh-viewtune-wallpaper-scope';

/** Where the wallpaper stops: the reading view alone, or the whole window. */
export type WallpaperScope = 'view' | 'window';

export const WALLPAPER_CHROME_INITIAL = 55;
export const WALLPAPER_CHROME_MAX = 100;

export function wallpaperScopeOf(value: unknown): WallpaperScope {
  return value === 'window' ? 'window' : 'view';
}

export function wallpaperChromeOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WALLPAPER_CHROME_INITIAL;
  return Math.min(WALLPAPER_CHROME_MAX, Math.max(0, Math.round(value)));
}

/** The values the document element carries while a wallpaper is chosen. */
export interface WindowScopeValues {
  /**
   * Which scope is in force. Published because it is what the stylesheet gates on: `view` reaches the
   * conversation column (transcript, the space under it, the gutter, the composer's fade band) and
   * `window` additionally reaches the sidebar and the top bar.
   */
  readonly scope: WallpaperScope;
  /** A full CSS `url("…")` value, already encoded by `wallpaperUrl`. */
  readonly image: string;
  /** How far the backdrop itself is mixed toward the theme's background, as a percentage. */
  readonly dim: number;
  /** How opaque the sidebar and the top bar stay, so their labels read over a photograph. */
  readonly chrome: number;
  /**
   * The image layer's size and place, as the reading view measured them. Absent means "cover, centred",
   * which is what window scope wants and the fallback before the image's natural size is known.
   */
  readonly size?: string;
  readonly position?: string;
}

/**
 * Two gates, because two different things are being decided.
 *
 * `SCOPED` is the whole-window scope: only it reaches the sidebar and the top bar.
 *
 * `SCOPED_ANY` is "a wallpaper is chosen at all": the conversation column BELOW the header belongs to
 * the reading view in either scope — the transcript, the space under it, the scrollbar gutter, and the
 * composer's fade band. Leaving those to the theme's own colour is what kept two black blocks around
 * the input box while the switch was off: the column is the reading view, not the chrome.
 */
const SCOPED_ANY = `html[${WINDOW_SCOPE_ATTRIBUTE}]`;
const SCOPED = `html[${WINDOW_SCOPE_ATTRIBUTE}="window"]`;

/** One scrim layer, mixed toward the THEME's own background so it darkens dark and lightens light. */
const scrim = (variable: string, fallback: number): string =>
  `linear-gradient(color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(${variable}, ${String(fallback)}%), transparent),`
  + ` color-mix(in srgb, var(--dsw-alias-bg-base, #000) var(${variable}, ${String(fallback)}%), transparent))`;

/**
 * The geometry every backdrop copy shares.
 *
 * Every declaration carries `!important` on purpose. The host's own rules set these through the
 * `background` SHORTHAND, and one of them — the composer seat — is written with two classes
 * (`.root[data-phase=active] .seat`), so it outranks a single attribute selector. Without `!important`
 * here, the host's `repeat` and `auto` won and the backdrop tiled as a grid of small copies: not a
 * hypothetical, that is exactly what the reader saw.
 */
const FIXED = 'background-attachment: fixed !important; background-repeat: no-repeat !important;'
  // The scrim layer always covers its element. The IMAGE layer's size and place come from the geometry
  // the reading view measures (see `wallpaperGeometry`): a fixed layer is positioned against the
  // VIEWPORT, so "fit the reading page" cannot be expressed in the element's own terms — it has to be
  // converted into viewport coordinates, and every copy has to read the same conversion or the copies
  // stop lining up.
  + ' background-size: cover, var(--viewtune-wallpaper-size, cover) !important;'
  + ' background-position: center, var(--viewtune-wallpaper-position, center) !important;';

/**
 * The static stylesheet, installed once per activation.
 *
 * Nothing here applies until the attribute is set, so turning the scope back off is one attribute
 * removal rather than an unpicking of rules — and a reader who never turns it on is unaffected.
 */
/** What the sidebar column's own scoped token is called, so the override can name it twice. */
const SIDEBAR_FILL = '--dsw-specific-sidebar-fill';

export function windowScopeCss(): string {
  return [
    `/* The window-level surfaces carry the image. The frame is found by STRUCTURE, not by its class`,
    `   suffix: "…_frame" is not unique — the reading view's own turn rail is a NAV whose container is`,
    `   "mgCddq_frame", so a suffix selector painted a second copy plus a second scrim onto that 26px`,
    `   strip and made it read as a different-coloured band beside everything else. The layout frame is`,
    `   the element that OWNS the sidebar column, which is a fact about the tree rather than a name.`,
    `   The page's own two elements carry the same copy because the frame's box does NOT include the`,
    `   window scrollbar's gutter; without them that strip shows the raw canvas. Every copy is`,
    `   viewport-anchored, so they line up as one image rather than stacking scrims. */`,
    `${SCOPED},`,
    `${SCOPED} body,`,
    `${SCOPED} *:has(> [class*="_sidebarCol"]) {`,
    `  background-image: ${scrim('--viewtune-wallpaper-dim', 45)}, var(--viewtune-wallpaper-image) !important;`,
    `  ${FIXED}`,
    `}`,
    `/* The column's own scroller. The transcript's box ends where its CONTENT ends, so the space below a`,
    `   short conversation shows the column's base colour — the second black block, and the one that`,
    `   survives when only the reading view carries a backdrop. This element scrolls the transcript all`,
    `   the way to the composer, so it also owns the gutter. */`,
    `${SCOPED_ANY} [class*="_scrollBody"] {`,
    `  background-image: ${scrim('--viewtune-wallpaper-dim', 45)}, var(--viewtune-wallpaper-image) !important;`,
    `  ${FIXED}`,
    `}`,
    `/* The scrollbar gutter is NOT painted here: it belongs to the host's scroll container, and it
       now has a groove of its own with a dial behind it (see scrollbar.ts), which also carries the
       wallpaper layers so a wallpaper stays continuous across the gutter. */`,
    `/* The composer's fade band. The host paints an opaque gradient of the theme's own background there`,
    `   (transparent 0px → base 36px, sticky to the bottom) so the transcript fades out as it scrolls`,
    `   under the composer — which is why it stayed a slab of black/white through every experiment: its`,
    `   job is to cover. Two things must not be done to it: transparent would let the transcript glare`,
    `   onto a photograph, and painting the backdrop on the seat ITSELF would cover the whole box and`,
    `   turn the fade into a hard edge. So the seat's own gradient is dropped and the backdrop goes on a`,
    `   PSEUDO-ELEMENT behind the seat's content, with the host's own ramp turned into a mask. */`,
    `${SCOPED_ANY} [class*="_composerSeat"] { background-image: none !important; --viewtune-wallpaper-fade-lift: 36px; --viewtune-wallpaper-fade-ramp: 20px; }`,
    `${SCOPED_ANY} [class*="_composerSeat"]::before {`,
    `  content: '';`,
    `  position: absolute;`,
    `  /* LIFTED over the seat's own box, exactly like the conversation page's band and the trajectory page's:`,
    `     the ramp then begins that far above the composer, over the transcript's last rows, instead of at the`,
    `     composer's edge. This band was the odd one out — it started at 0, which is why the reading view's fade`,
    `     sat a full lift lower than the other two pages' (reported). */`,
    `  inset: calc(-1 * var(--viewtune-wallpaper-fade-lift, 36px)) 0 0 0 !important;`,
    `  /* The seat is positioned and has a z-index of its own, so it is a stacking context: -1 keeps this`,
    `     copy behind the composer card while staying above everything the seat floats over. */`,
    `  z-index: -1;`,
    `  pointer-events: none;`,
    `  background-image: ${scrim('--viewtune-wallpaper-dim', 45)}, var(--viewtune-wallpaper-image) !important;`,
    `  ${FIXED}`,
    `  /* The mask belongs HERE, never on the seat: a mask applies to the whole subtree, so masking the`,
    `     seat masked the composer card inside it and hid the input box. On the pseudo-element it hides`,
    `     only this copy, which is what the fade is supposed to reveal.`,
    `     TWO numbers, not one, because they answer different questions: the LIFT is how far above the`,
    `     composer the band reaches, and the RAMP is how long the fade takes. The ramp is anchored to END at`,
    `     the lift (the composer's own edge), so shortening it moves the point where the text STARTS to fade`,
    `     closer to the point where it is gone — the reader asked for exactly that ("文字消失的地方不变，`,
    `     开始变淡的地方推迟一点"), and it is one number either way. */`,
    `  mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-wallpaper-fade-lift, 36px) - var(--viewtune-wallpaper-fade-ramp, 20px)), #000 var(--viewtune-wallpaper-fade-lift, 36px)) !important;`,
    `  -webkit-mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-wallpaper-fade-lift, 36px) - var(--viewtune-wallpaper-fade-ramp, 20px)), #000 var(--viewtune-wallpaper-fade-lift, 36px)) !important;`,
    `}`,
    `/* The chrome keeps a scrim of its own, so its labels stay readable over a photograph. No second`,
    `   copy of the image: the frame is already carrying it underneath.`,
    `   Note what this rule does NOT carry: viewport attachment. A fixed attachment is only ever needed to`,
    `   line an IMAGE up with the viewport, and this layer is a flat colour — while attachment:fixed is also`,
    `   what puts the paint in the compositor. That mattered: the reader reported the scrim missing on a`,
    `   fresh load until that part of the page happened to repaint, which is the signature of a composited`,
    `   layer the property change never invalidated. A colour has nothing to line up and nothing to go`,
    `   stale. */`,
    `${SCOPED} [class*="_sidebarCol"],`,
    `${SCOPED} [class*="_header"]:has(> [class*="_titleRow"]) {`,
    `  background-image: ${scrim('--viewtune-wallpaper-chrome', 55)} !important;`,
    `}`,
    `/* One scoped token is what the left column paints from; making it see-through is the whole of`,
    `   "the sidebar lets the backdrop through". It has to be named on BODY as well as on the root:`,
    `   the theme defines this token in its own "body{…}" block, and a definition ON an element beats`,
    `   any value inherited from its parent, however important that parent's rule is. Taking only the`,
    `   root left the left column opaque — the first thing the reader hit. */`,
    `${SCOPED},`,
    `${SCOPED} body { ${SIDEBAR_FILL}: transparent !important; }`,
    `/* Everything between the page and the frame stops painting its own colour. The ":has()" clause`,
    `   catches the conversation root by what it CONTAINS, which is the only handle it offers. */`,
    `${SCOPED} body,`,
    `${SCOPED} #root,`,
    `${SCOPED} *:has([class*="_titleRow"]) { background-color: transparent !important; }`,
    `/* …EXCEPT the trajectory page, which is a solid page and never asked for a backdrop. It is a host`,
    `   view that shares this column and the composer seat, so the image leaked into two places beside`,
    `   its opaque table: a dimmed strip down the right edge (the scroller's stable gutter, which the`,
    `   gutter's groove paints) and the session-stats band under the composer. One rule fixes both,`,
    `   because everything that shows the image under this column reads these NAMES — the column's own`,
    `   background, the groove on its scrollbar, the seat's pseudo-element — and a pseudo-element`,
    `   inherits them from its originating element. The page is found by its own marker, not by a`,
    `   hashed class, so every other view keeps its wallpaper. */`,
    `${SCOPED_ANY} [class*="_scrollBody"]:has([data-trajectory-scroll]) {`,
    `  background-image: none !important;`,
    `  background-color: var(--dsw-alias-bg-base) !important;`,
    `  --viewtune-wallpaper-image: none;`,
    `  --viewtune-wallpaper-dim: 0%;`,
    `  /* How far ABOVE the composer the fade band starts, so a row is already gone by the time it gets`,
    `     there. One number: raise it and the text disappears earlier. */`,
    `  --viewtune-trajectory-fade-lift: 36px;`,
    `}`,
    `/* …and the band above the composer still has to FADE the page out, which is the whole job that block`,
    `   was given, so it cannot simply stop painting: it is our masked pseudo-element, and with the image`,
    `   withdrawn the page met the composer with a hard edge. Two things about it are this page's own.`,
    `   The COLOUR is the surface the page is made of (bg-layer-1, what the trajectory table paints), so`,
    `   the band is never a slab of some other shade: in the light theme those two tokens are the same`,
    `   colour and the band is invisible, and in the dark theme matching them is exactly what stops the`,
    `   bottom reading as a bar of a different colour. The LIFT raises the whole ramp above the seat, so`,
    `   the fade covers the last rows instead of starting at the composer's edge. */`,
    `${SCOPED_ANY} [class*="_scrollBody"]:has([data-trajectory-scroll]) [class*="_composerSeat"]::before {`,
    `  inset: calc(-1 * var(--viewtune-trajectory-fade-lift)) 0 0 0 !important;`,
    `  background-image: none !important;`,
    `  background-color: var(--dsw-alias-bg-layer-1) !important;`,
    `  /* Its OWN mask, restated here so this page does not inherit the shared one: the other pages now ramp over a`,
    `     length of their own (` + '`--viewtune-wallpaper-fade-ramp`' + `, shortened at the reader's request) while this`,
    `     page's band stays the single-number form it always had — one lift, ramping over exactly that lift. The`,
    `     declaration is what isolates it, not the value: raised to the shared ramp it would drift again the next time`,
    `     that one is tuned. */`,
    `  mask-image: linear-gradient(180deg, transparent 0px, #000 var(--viewtune-trajectory-fade-lift, 36px)) !important;`,
    `  -webkit-mask-image: linear-gradient(180deg, transparent 0px, #000 var(--viewtune-trajectory-fade-lift, 36px)) !important;`,
    `}`,
  ].join('\n');
}

/**
 * Install the stylesheet once, and hand back a disposer that also clears what it left on the document.
 *
 * `doc` is a parameter so the behaviour can be tested without a browser.
 */
export function installWindowScope(doc: Document): () => void {
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', WINDOW_SCOPE_STYLE_ID);
  style.textContent = windowScopeCss();
  doc.head.append(style);
  return () => {
    style.remove();
    applyWindowScope(doc, null);
  };
}

/**
 * Publish (or withdraw) the values the stylesheet reads.
 *
 * Written to `<html>` rather than to the reading view's own root on purpose: the sidebar and the top
 * bar are NOT descendants of the reading view, so a custom property set there could never reach them.
 * It also means the backdrop survives the reader switching away from this view — the values stay until
 * something changes them, and only a scope/plugin teardown clears them.
 *
 * The attribute records WHICH scope, and it is set as soon as a wallpaper is chosen — not only in the
 * window scope: the conversation column below the header belongs to the reading view either way, and
 * gating it on `window` is what left two black blocks around the input box with the switch off.
 */
export function applyWindowScope(doc: Document, values: WindowScopeValues | null): void {
  const root = doc.documentElement;
  if (values === null) {
    root.removeAttribute(WINDOW_SCOPE_ATTRIBUTE);
    root.style.removeProperty('--viewtune-wallpaper-image');
    root.style.removeProperty('--viewtune-wallpaper-dim');
    root.style.removeProperty('--viewtune-wallpaper-chrome');
    nudgeChromePaint(doc);
    return;
  }
  root.setAttribute(WINDOW_SCOPE_ATTRIBUTE, values.scope);
  root.style.setProperty('--viewtune-wallpaper-image', values.image);
  root.style.setProperty('--viewtune-wallpaper-dim', `${String(wallpaperDimOf(values.dim))}%`);
  root.style.setProperty('--viewtune-wallpaper-chrome', `${String(wallpaperChromeOf(values.chrome))}%`);
  for (const [name, value] of [['--viewtune-wallpaper-size', values.size], ['--viewtune-wallpaper-position', values.position]] as const) {
    if (value === undefined) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  nudgeChromePaint(doc);
}

/**
 * Make the two scrimmed surfaces re-resolve their paint after their values changed.
 *
 * The reader reported the chrome scrim missing on a fresh load until that part of the page happened to
 * repaint — the signature of a style change that never became a paint for those elements. The scrim no
 * longer carries the construct that made that likely (see the rule above: no viewport attachment on a flat
 * colour), and this is the belt to that braces. Reading one layout property per element flushes style and
 * layout, which is exactly what marks them dirty for paint — two reads per settings change, and a no-op on
 * a document that has no such elements (the fakes the tests use have no `querySelectorAll` at all).
 */
function nudgeChromePaint(doc: Document): void {
  if (typeof doc.querySelectorAll !== 'function') return;
  for (const element of doc.querySelectorAll('[class*="_sidebarCol"], [class*="_header"]')) {
    void (element as HTMLElement).offsetHeight;
  }
}
