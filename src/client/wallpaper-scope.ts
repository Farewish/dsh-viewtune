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

/**
 * The chrome scrim's shipped value, and the scope a record that never chose one means.
 *
 * Both are the reader's own settings, taken as the defaults: the wallpaper carries the whole window and the sidebar
 * and top bar keep 25% of their colour over it, which is the look a fresh install now opens with.
 */
export const WALLPAPER_CHROME_INITIAL = 25;
export const WALLPAPER_CHROME_MAX = 100;

/**
 * The two scrims' FROST: how much they blur the photograph behind them, in px.
 *
 * TWO different fresh-install values, because the reader runs them apart — 15px behind the sidebar, 5px behind the top
 * bar — and because their two surfaces face different things (the column stands against the reading view, the bar
 * above everything). The FALLBACK is a third number, and deliberately not either of those: it is what an unusable
 * value resolves to, and the honest answer for a value this build cannot read is the wash a scrim has always been,
 * not a frost somebody chose for a different surface. An ABSENT key never reaches it — the store's own initial does.
 * The ceiling deliberately matches the skin's own (`GLASS_BLUR_MAX`): past it the chrome's labels sit on a smear
 * rather than on a frosted plate, and the two families of dial should not disagree about where that is.
 */
export const WALLPAPER_CHROME_SIDEBAR_BLUR_INITIAL = 15;
export const WALLPAPER_CHROME_HEADER_BLUR_INITIAL = 5;
export const WALLPAPER_CHROME_BLUR_FALLBACK = 0;
export const WALLPAPER_CHROME_BLUR_MAX = 40;

/**
 * The chrome scrim's two dials, and the record keys that carry them.
 *
 * It was ONE number until the reader asked for the surfaces separately: the sidebar stands against the reading
 * column and the top bar sits above everything, so a single dial made moving one move the other. One variable and
 * one key per surface, and the rule that paints each surface reads its own — see `windowScopeCss` and
 * `chromeScrimsOf`.
 */
export const CHROME_SIDEBAR_KEY = 'wallpaperChromeSidebar';
export const CHROME_HEADER_KEY = 'wallpaperChromeHeader';
/** …and the record keys of the same two surfaces' frost, read by `backdrop.ts` when it publishes the scope. */
export const CHROME_SIDEBAR_BLUR_KEY = 'wallpaperChromeSidebarBlur';
export const CHROME_HEADER_BLUR_KEY = 'wallpaperChromeHeaderBlur';
/** The pre-split key, read only to migrate a record that still carries it. */
export const CHROME_LEGACY_KEY = 'wallpaperChrome';
const CHROME_SIDEBAR_VARIABLE = '--viewtune-wallpaper-chrome-sidebar';
const CHROME_HEADER_VARIABLE = '--viewtune-wallpaper-chrome-header';
/** …and the same two surfaces' frost, read by the `backdrop-filter` on each scrim rule below. */
const CHROME_SIDEBAR_BLUR_VARIABLE = '--viewtune-wallpaper-chrome-sidebar-blur';
const CHROME_HEADER_BLUR_VARIABLE = '--viewtune-wallpaper-chrome-header-blur';

export function wallpaperScopeOf(value: unknown): WallpaperScope {
  return value === 'view' ? 'view' : 'window';
}

export function wallpaperChromeOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WALLPAPER_CHROME_INITIAL;
  return Math.min(WALLPAPER_CHROME_MAX, Math.max(0, Math.round(value)));
}

/** The two scrims' frost, read the same defensive way: an absent or unusable value is the shipped 0. */
export function wallpaperChromeBlurOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WALLPAPER_CHROME_BLUR_FALLBACK;
  return Math.min(WALLPAPER_CHROME_BLUR_MAX, Math.max(0, Math.round(value)));
}

/** The two scrims, named by the surface each one keeps readable. */
export interface ChromeScrims {
  /** How opaque the LEFT COLUMN stays over the photograph. */
  readonly sidebar: number;
  /** …and the TOP BAR, the Windows title-bar strip above it included. */
  readonly header: number;
}

/**
 * Both scrims out of a record, MIGRATING the record that predates the split.
 *
 * The single dial was `wallpaperChrome`, and a record carrying it (and neither new key) is a reader who had set both
 * surfaces to that one number, so that is what it reads as. Decided per surface rather than once for the pair: a
 * record from an intermediate state may carry one of the two, and then only the missing one falls back — reading the
 * legacy key for a surface that has its own would overwrite a choice the reader made after the split. With neither
 * key present `wallpaperChromeOf(undefined)` answers the shipped default, which is what a fresh install wants.
 */
export function chromeScrimsOf(record: Record<string, unknown> | undefined): ChromeScrims {
  const legacy = record?.[CHROME_LEGACY_KEY];
  const scrimOf = (key: string): number => {
    const own = record?.[key];
    return typeof own === 'number' && Number.isFinite(own) ? wallpaperChromeOf(own) : wallpaperChromeOf(legacy);
  };
  return { sidebar: scrimOf(CHROME_SIDEBAR_KEY), header: scrimOf(CHROME_HEADER_KEY) };
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
  /** How opaque the LEFT COLUMN stays, so the sidebar's own labels read over a photograph. */
  readonly chromeSidebar: number;
  /** …and the TOP BAR's own, which is a separate choice: see `ChromeScrims`. */
  readonly chromeHeader: number;
  /** How much the LEFT COLUMN blurs what is behind it, in px — the scrim's frost. */
  readonly chromeSidebarBlur: number;
  /** …and the TOP BAR's own. */
  readonly chromeHeaderBlur: number;
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
    `/* NOTE FOR WHOEVER COMES NEXT: there was a \`${SCOPED} body::before\` rule here for one debugging round — a`,
    `   fixed-position ELEMENT carrying a second copy of the wallpaper, on the theory that \`backdrop-filter\` cannot`,
    `   sample a fixed-attachment background. The reader's own measurements disproved it (the conversation page's card`,
    `   and bubble frosted over that very layer), and the real cause turned out to be a declaration the build's CSS`,
    `   pipeline had de-duplicated away — see the note in Reader.module.css. It is gone rather than kept "just in case":`,
    `   it painted a full-viewport image layer for nothing. (This note names the attachment in prose only: the`,
    `   stylesheet test counts that declaration by TEXT, so spelling it out here would count as a carrier.) */`,
    `/* Where the frost goes, it needs something to blur INSIDE its own backdrop root: the layer above is that thing`,
    `   for every plate on the page. The reading view's own root is a query container (\`container-type\`), and the`,
    `   transcript's column carries the motion transform — neither is a backdrop root on its own, but both make the`,
    `   fixed BACKGROUND invisible to a descendant's \`backdrop-filter\`, which is the half this element fixes. */`,
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
    `/* Which elements are the chrome, in BOTH platform generations this line has run on.`,
    `   0.1.5 rendered the top bar's title row as a DIRECT child of the header, so`,
    `   \`[class*="_header"]:has(> [class*="_titleRow"])\` was exact and still is on that build. 0.2.0 changed`,
    `   the header's second child into a SLOT (\`conversation.session.header\`, whose occupant renders its own`,
    `   title row inside whatever wrapper the slot registry gives it): the direct-child test stops matching,`,
    `   and the reader's report is exactly that — 顶栏 not scrimmed, silently, because a selector that matches`,
    `   nothing paints nothing and nothing fails.`,
    `   So the top bar is named by the hook the conversation package PUBLISHES on its own leading cell`,
    `   (\`data-conversation-header-leading\`), and the header is the element that has it as a direct child.`,
    `   That is a fact the host states about its tree rather than a build-minted class name, which is the same`,
    `   reason this file uses \`:has([class*="_titleRow"])\` for the conversation root further down. The old`,
    `   shape stays in the rule list: harmless when it matches, and it keeps the 0.1.5 line working.`,
    `   The title-bar strip is the last piece: with \`[data-windows-titlebar]\` the layout paints the strip`,
    `   ABOVE the frame's own background from the sidebar-fill token (which this file makes transparent),`,
    `   so that strip showed the photograph with no scrim at all. It is chrome, so it gets the chrome scrim. */`,
    `/* ONE RULE PER SURFACE, and each names its own variable: the two scrims are separate dials, so a rule that`,
    `   read the other surface's value would be a setting that quietly moves the wrong thing. The title-bar`,
    `   strip belongs to the TOP of the window and takes the header's value, not the sidebar's. */`,
    `${SCOPED} [class*="_sidebarCol"] {`,
    `  background-image: ${scrim(CHROME_SIDEBAR_VARIABLE, 55)} !important;`,
    `  /* …and the FROST on a pseudo-element, exactly as the header below does it, for the reader's report that the host's`,
    `     own hover descriptions in this column came out truncated. \`backdrop-filter\` on the column itself makes it a`,
    `     BACKDROP ROOT and a STACKING CONTEXT, which confines a descendant's paint to the column: the two reasons are`,
    `     spelled out in the header's rule, measured there against the host's inline popovers, and they apply here`,
    `     unchanged. The column keeps its scrim image — a background clips nothing — and the frost moves to a pseudo-element`,
    `     that sits behind the content. \`isolation: isolate\` keeps the stacking context the pseudo needs in order to stay`,
    `     behind the content, and unlike \`backdrop-filter\` it does not make the column a backdrop root. No \`z-index\` here:`,
    `     unlike the header, this column competes with no sticky lane of ours.`,
    `     The read has no fallback on purpose: the property is published only while that scrim's frost is above zero, and an`,
    `     unset variable leaves \`backdrop-filter\` at \`none\` — which matters here more than anywhere, because a non-\`none\``,
    `     value is what puts this element's paint in the compositor and made the scrim go stale on a fresh load (see the`,
    `     note above). \`blur(0px)\` would bring that back for everyone who never touches the dial. */`,
    `  position: relative;`,
    `  isolation: isolate;`,
    `  /* …and ABOVE the top bar (ours sits at 12, for the reading view's sticky lane at 11). The two are side by side and`,
    `     do not overlap, with one exception that matters: under \`[data-windows-titlebar]\` the host floats the sidebar's own`,
    `     collapse toggle at the window's top-left corner, inside the bar's strip, and its hover description then overlaps`,
    `     the bar. With the bar above, that description was covered by the bar's scrim and frost — the reader's second`,
    `     report, "it shows but sits under the top bar's blur". Raising the column does not move anything (z-index does not`,
    `     affect fixed positioning), it only settles which of the two paints over the other where they meet. */`,
    `  z-index: 13;`,
    `}`,
    `${SCOPED} [class*="_sidebarCol"]::before {`,
    `  content: '';`,
    `  position: absolute;`,
    `  inset: 0;`,
    `  z-index: -1;`,
    `  backdrop-filter: blur(var(${CHROME_SIDEBAR_BLUR_VARIABLE}));`,
    `  -webkit-backdrop-filter: blur(var(${CHROME_SIDEBAR_BLUR_VARIABLE}));`,
    `}`,
    `${SCOPED} *:has(> [data-conversation-header-leading]),`,
    `${SCOPED} [class*="_header"]:has(> [class*="_titleRow"]),`,
    `/* …and the RIGHT COLUMN's own top strip, which the reader asked to merge into this scrim: 「右侧栏一共只分两部分，上面的顶栏和`,
    `   下面的页面。上面的顶栏可以合并到顶栏遮罩」. It is the dockkit pane's tab strip (\`[data-dockkit-strip]\`, 38px, measured on`,
    `   the live page) and it sits inside \`[data-rightbar-col]\`, which is what keeps this from catching the left dock's strip too. */`,
    `${SCOPED} [data-rightbar-col] [data-dockkit-strip],`,
    `${SCOPED} [data-rightbar-collapsed] [data-dockkit-strip],`,
    `/* …and the row BELOW that strip, which the reader spotted missing: 「貌似还差一行」. It is the opened page's own header (the`,
    `   document preview's file path, language and reload button), and its class is \`_header\` from a CSS module of its own — a`,
    `   different hash from the pane's. Scoped to the pane BODY's first two levels on purpose: \`[class*="_header"]\` alone also`,
    `   matches a terminal block's header, and one of those can live INSIDE the document, where a scrim would be wrong. */`,
    `${SCOPED} [data-rightbar-col] [class*="_paneBody"] > [class*="_header"],`,
    `${SCOPED} [data-rightbar-col] [class*="_paneBody"] > * > [class*="_header"],`,
    `/* …and at ANY depth inside the pane body, because the first cut stopped at two levels and the reader reported 「没变」: the row`,
    `   the document preview draws sits deeper than that. The trade this makes is stated rather than hidden: a terminal BLOCK's own`,
    `   header, if one is ever rendered inside a document in this column, would be scrimmed too. The alternative — matching`,
    `   \`_header\` anywhere — is worse, because it would also hit the transcript's terminal rows. */`,
    `${SCOPED} [data-rightbar-col] [class*="_paneBody"] [class*="_header"],`,
    `${SCOPED} [data-rightbar-collapsed] [class*="_paneBody"] > [class*="_header"],`,
    `${SCOPED} [data-rightbar-collapsed] [class*="_paneBody"] > * > [class*="_header"],`,
    `${SCOPED} [data-rightbar-collapsed] [class*="_paneBody"] [class*="_header"] {`,
    `  background-image: ${scrim(CHROME_HEADER_VARIABLE, 55)} !important;`,
    `  position: relative;`,
    `  isolation: isolate;`,
    `  z-index: 12;`,
    `}`,
    `/* …and the code block's BAND inside this column, made transparent — 「把那个栏变成透明的」.`,
    `   The layer that painted it is named by the host's OWN stylesheet, read rather than guessed:`,
    `   \`@deepseek-ai/dsh-client-ui-primitives/lib/markdown/CodeBlock.module.css\` carries`,
    `   \`.bannerWrap { position: sticky; z-index: 6; background-color: var(--dsw-alias-bg-base); … }\` — a SOLID theme background on`,
    `   the WRAPPER, one level above the \`.banner\` the first attempts were clearing, which is why those looked like they had done`,
    `   nothing while the inner element was already see-through.`,
    `   ONLY this rule for now, on the reader's instruction (「先只做3，之后再看看哪个是对的」): the banner's own inner colour and the`,
    `   header-scrim exclusion are NOT touched here, so the next look says plainly whether clearing the wrapper alone is enough.`,
    `   Bounded by the right column, like everything in this group: the same wrapper exists in the reading view, so an unbounded rule`,
    `   here is exactly what reached the reading view's code blocks twice. */`,
    `${SCOPED} [data-rightbar-col] [class*="_bannerWrap_"],`,
    `${SCOPED} [data-rightbar-collapsed] [class*="_bannerWrap_"] {`,
    `  background-color: transparent !important;`,
    `  background-image: none !important;`,
    `}`,
    `/* …and the FROST on a pseudo-element, never on the bar itself. Two measured reasons, both about the host's own`,
    `   INLINE popovers in this bar (the 「x 个后台任务运行」 panel: \`.QsffPG_menu{position:absolute;top:calc(100% + 5px);`,
    `   left:0;z-index:100;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter)}\` — the very`,
    `   same plate and blur as 「x 个子智能体」, which escapes all of this by being PORTALED):`,
    `     1. \`backdrop-filter\` on the bar makes the bar a BACKDROP ROOT, so a descendant's own backdrop-filter can no`,
    `        longer see the page — the panel's platform blur went dead and its text overlapped what showed through it`,
    `        (「文字重叠看不清」). A pseudo-element's backdrop-filter is its own root and leaves the bar's descendants`,
    `        alone.`,
    `     2. it also makes the bar a STACKING CONTEXT, which confined that \`z-index:100\` to the bar's own subtree, so the`,
    `        reading view's sticky LANE (\`z-index:11\`, a later sibling in the same context) covered and blurred it.`,
    `        \`isolation: isolate\` keeps the stacking context the pseudo needs to sit behind the content — and it is NOT a`,
    `        backdrop root — while \`z-index:12\` puts the bar back above that lane.`,
    `   \`position: relative\` is safe here because the panel anchors to its OWN root, not to this bar:`,
    `   \`.QsffPG_root{position:relative}\` and the menu is \`absolute; top: calc(100% + 5px); left: 0\` inside it. */`,
    `${SCOPED} *:has(> [data-conversation-header-leading])::before,`,
    `${SCOPED} [class*="_header"]:has(> [class*="_titleRow"])::before,`,
    `${SCOPED} [data-rightbar-col] [data-dockkit-strip]::before,`,
    `${SCOPED} [data-rightbar-collapsed] [data-dockkit-strip]::before,`,
    `${SCOPED} [data-rightbar-col] [class*="_paneBody"] > [class*="_header"]::before,`,
    `${SCOPED} [data-rightbar-col] [class*="_paneBody"] > * > [class*="_header"]::before,`,
    `${SCOPED} [data-rightbar-col] [class*="_paneBody"] [class*="_header"]::before,`,
    `${SCOPED} [data-rightbar-collapsed] [class*="_paneBody"] > [class*="_header"]::before,`,
    `${SCOPED} [data-rightbar-collapsed] [class*="_paneBody"] > * > [class*="_header"]::before,`,
    `${SCOPED} [data-rightbar-collapsed] [class*="_paneBody"] [class*="_header"]::before {`,
    `  content: '';`,
    `  position: absolute;`,
    `  inset: 0;`,
    `  z-index: -1;`,
    `  backdrop-filter: blur(var(${CHROME_HEADER_BLUR_VARIABLE}));`,
    `  -webkit-backdrop-filter: blur(var(${CHROME_HEADER_BLUR_VARIABLE}));`,
    `}`,
    `${SCOPED}[data-windows-titlebar] *:has(> [class*="_sidebarCol"])::before {`,
    `  background-image: ${scrim(CHROME_HEADER_VARIABLE, 55)} !important;`,
    `  backdrop-filter: blur(var(${CHROME_HEADER_BLUR_VARIABLE}));`,
    `  -webkit-backdrop-filter: blur(var(${CHROME_HEADER_BLUR_VARIABLE}));`,
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
    `/* ── THE GUIDE'S 「新建终端」 CARD, given the same plate as 「工作区文件」 ───────────────────────────────────────────────────────`,
    `   The reader asked for the two entries to look alike (「把'新建终端'调成和'工作区文件'的颜色一致」) and measured both, so these three`,
    `   declarations are COPIED from the sibling rather than guessed: its background \`rgb(35, 35, 36)\`, its hairline`,
    `   \`rgba(255, 255, 255, 0.16)\` at the odd 0.667px it actually computes to, and its \`20px\` radius. The terminal entry is a ghost`,
    `   button (\`_ghost_\`) and ships with no plate, no border and no radius at all.`,
    `   The selector uses the stable LOCAL names the reader's dump shows (\`_ghost_\`, \`_main\`) — the hashes in front of them change with`,
    `   every build — bounded by \`:has([data-sidebar-right-guide-entry="files"])\`, so it can only match inside the container that holds`,
    `   the guide's own entries. NOT gated on the wallpaper: this is a consistency fix between two host entries, not a wallpaper effect. */`,
    `*:has([data-sidebar-right-guide-entry="files"]) button[class*="_ghost_"][class*="_main"] {`,
    `  background-color: rgb(35, 35, 36) !important;`,
    `  border: 0.667px solid rgba(255, 255, 255, 0.16) !important;`,
    `  border-radius: 20px !important;`,
    `}`,
    `/* …and the HOVER the plate had taken away, restored the way the reader asked for it in the end: 「鼠标悬停时，黑色底板消失或透明」.`,
    `   So the hover does not tint the plate — it REMOVES it, and the entry goes back to the ghost look it shipped with while the pointer is`,
    `   inside; the hairline and the radius stay, so the card does not jump. That is deliberately the opposite of the first attempt`,
    `   (\`7f92774\`, which lightened the plate): \`!important\` on the base rule beats the host's own hover, so the state has to be`,
    `   re-declared here either way, and the reader chose this one. \`:focus-visible\` rides along: the same feedback for keyboard users. */`,
    `*:has([data-sidebar-right-guide-entry="files"]) button[class*="_ghost_"][class*="_main"]:hover,`,
    `*:has([data-sidebar-right-guide-entry="files"]) button[class*="_ghost_"][class*="_main"]:focus-visible {`,
    `  background-color: transparent !important;`,
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
    root.style.removeProperty(CHROME_SIDEBAR_VARIABLE);
    root.style.removeProperty(CHROME_HEADER_VARIABLE);
    root.style.removeProperty(CHROME_SIDEBAR_BLUR_VARIABLE);
    root.style.removeProperty(CHROME_HEADER_BLUR_VARIABLE);
    nudgeChromePaint(doc);
    return;
  }
  root.setAttribute(WINDOW_SCOPE_ATTRIBUTE, values.scope);
  root.style.setProperty('--viewtune-wallpaper-image', values.image);
  root.style.setProperty('--viewtune-wallpaper-dim', `${String(wallpaperDimOf(values.dim))}%`);
  root.style.setProperty(CHROME_SIDEBAR_VARIABLE, `${String(wallpaperChromeOf(values.chromeSidebar))}%`);
  root.style.setProperty(CHROME_HEADER_VARIABLE, `${String(wallpaperChromeOf(values.chromeHeader))}%`);
  // The two frosts, written the same way the skin's own are: a LENGTH while it is above zero, and the property
  // REMOVED at 0 — because `blur(0px)` is not `none`, and the scrim's own note above says what a composited layer
  // costs here.
  for (const [name, value] of [[CHROME_SIDEBAR_BLUR_VARIABLE, values.chromeSidebarBlur], [CHROME_HEADER_BLUR_VARIABLE, values.chromeHeaderBlur]] as const) {
    if (wallpaperChromeBlurOf(value) > 0) root.style.setProperty(name, `${String(wallpaperChromeBlurOf(value))}px`);
    else root.style.removeProperty(name);
  }
  for (const [name, value] of [['--viewtune-wallpaper-size', values.size], ['--viewtune-wallpaper-position', values.position]] as const) {
    if (value === undefined) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  nudgeChromePaint(doc);
}

/**
 * Make the scrimmed surfaces re-resolve their paint after their values changed.
 *
 * The reader reported the chrome scrim missing on a fresh load until that part of the page happened to
 * repaint — the signature of a style change that never became a paint for those elements. The scrim no
 * longer carries the construct that made that likely (see the rule above: no viewport attachment on a flat
 * colour), and this is the belt to that braces. Reading one layout property per element flushes style and
 * layout, which is exactly what marks them dirty for paint — two reads per settings change, and a no-op on
 * a document that has no such elements (the fakes the tests use have no `querySelectorAll` at all).
 *
 * The selector is the SAME SET the scrim rule paints, and it has to be kept that way: the top bar is
 * `*:has(> [data-conversation-header-leading])` from 0.2.0 on, and nudging only the `_header` class here
 * would leave the very element the reader complained about waiting for its own repaint.
 */
function nudgeChromePaint(doc: Document): void {
  if (typeof doc.querySelectorAll !== 'function') return;
  for (const element of doc.querySelectorAll('[class*="_sidebarCol"], [class*="_header"], *:has(> [data-conversation-header-leading])')) {
    void (element as HTMLElement).offsetHeight;
  }
}
