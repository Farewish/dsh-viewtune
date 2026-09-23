import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WALLPAPER_CHROME_INITIAL, applyWindowScope, installWindowScope, wallpaperChromeOf, wallpaperScopeOf,
  windowScopeCss,
} from '../src/client/wallpaper-scope.ts';
import { scrollbarFillOf, scrollbarStyleCss } from '../src/client/scrollbar.ts';

/** The smallest document the two functions touch, so this can run without a browser. */
function fakeDocument() {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const created: { tag: string; attrs: Map<string, string>; textContent: string; removed: boolean }[] = [];
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
      style: {
        setProperty: (name: string, value: string) => { properties.set(name, value); },
        removeProperty: (name: string) => { properties.delete(name); },
      },
    },
    createElement: (tag: string) => {
      const node = {
        tag,
        attrs: new Map<string, string>(),
        // The code assigns `textContent`; the fixture has to be that, not a `text` of its own.
        textContent: '',
        removed: false,
        setAttribute(name: string, value: string) { node.attrs.set(name, value); },
        remove() { node.removed = true; },
      };
      created.push(node);
      return node;
    },
    head: { append: () => undefined },
  };
  return { document, attributes, properties, created };
}

test('the scope and the chrome scrim fall back, and the scrim never leaves 0..100', () => {
  assert.equal(wallpaperScopeOf('window'), 'window');
  assert.equal(wallpaperScopeOf('view'), 'view');
  // A record written before this preference existed has no such key at all, and anything that is not one of the two
  // named scopes is the same story: the default, which is the whole window — the shipped defaults are the reader's own
  // settings.
  assert.equal(wallpaperScopeOf(undefined), 'window');
  assert.equal(wallpaperScopeOf('WINDOW'), 'window');
  assert.equal(wallpaperChromeOf(undefined), WALLPAPER_CHROME_INITIAL);
  assert.equal(wallpaperChromeOf('55'), WALLPAPER_CHROME_INITIAL);
  assert.equal(wallpaperChromeOf(-5), 0);
  assert.equal(wallpaperChromeOf(500), 100);
});

test('the stylesheet is gated, and every copy of the IMAGE is viewport-anchored', () => {
  const css = windowScopeCss();
  // Gated: nothing applies until the reader turns the scope on, so the rules can be installed eagerly.
  assert.ok(css.includes('html[data-viewtune-wallpaper="window"]'));
  // Every copy of the image rides a rule that anchors it to the viewport. That is the whole reason
  // several copies are safe: they line up as ONE image instead of layering scrims on each other.
  const rules = css.split('}').filter(rule => rule.trim() !== '');
  const imageRules = rules.filter(rule => rule.includes('var(--viewtune-wallpaper-image)'));
  for (const rule of imageRules) {
    assert.ok(rule.includes('background-attachment: fixed'), `an image copy is not viewport-anchored:${rule}`);
  }
  // The chrome's rule carries only a SCRIM — a flat colour — and it is the one carrier that must NOT be
  // anchored: attachment:fixed is only ever needed to line an image up with the viewport, and on a colour
  // it buys nothing while putting the paint in the compositor. That is where the reader's bug lived: the
  // scrim stayed missing on a fresh load until that part of the page happened to repaint.
  const anchoredRules = rules.filter(rule => rule.includes('background-attachment: fixed'));
  assert.equal(anchoredRules.length, imageRules.length);
  // The carriers, each for a stated reason: the window-level surfaces, the column's scroller (the space
  // under a short transcript), the scrollbar gutter, and the composer's fade band.
  // The scrollbar gutter is deliberately NOT here: it belongs to the host's scroll container, so it
  // has its own always-installed stylesheet (see the test at the end of this file).
  for (const carrier of ['*:has(> [class*="_sidebarCol"])', '_scrollBody', '_composerSeat']) {
    assert.ok(imageRules.some(rule => rule.includes(carrier)), `no backdrop carrier for ${carrier}`);
  }
  // The conversation column below the header belongs to the reading view in BOTH scopes — gating these
  // on `="window"` is what left two black blocks around the input box with the switch off.
  assert.ok(css.includes('[data-viewtune-wallpaper] [class*="_scrollBody"]'));
  assert.ok(css.includes('[data-viewtune-wallpaper] [class*="_composerSeat"]'));
  // The chrome carries a scrim of its own — and NOT a second copy of the image. Found by its own
  // custom property rather than by the sidebar-column selector: that selector now also appears inside
  // the structural frame selector, so matching on it can pick up the wrong rule.
  const chromeRule = rules.find(rule => rule.includes('--viewtune-wallpaper-chrome')) ?? '';
  assert.ok(chromeRule.includes('[class*="_sidebarCol"]'));
  assert.ok(!chromeRule.includes('--viewtune-wallpaper-image'));
  // …and it is the one carrier that must NOT be viewport-anchored: attachment:fixed is only ever needed to
  // line an image up with the viewport, and on a flat colour it buys nothing while putting the paint in the
  // compositor. That is where the reader's bug lived — the scrim stayed missing on a fresh load until that
  // part of the page happened to repaint. Asserted positively so the day someone gives it one, this says why.
  assert.equal(chromeRule.includes('background-attachment'), false, 'the chrome scrim must not be viewport-anchored');
  // The token has to be overridden ON `body`, not merely inherited from the root: the theme defines
  // it in its own `body{…}` block, and a definition on an element beats an inherited value however
  // important the parent's rule is. Overriding only the root left the left column fully opaque.
  assert.match(css, /data-viewtune-wallpaper="window"\] body \{ --dsw-specific-sidebar-fill: transparent !important; \}/);
  assert.ok(css.includes('*:has([class*="_titleRow"])'));
  // The frame is found by STRUCTURE, never by the "…_frame" suffix: that suffix also matches the
  // reading view's own turn rail container (`NAV.mgCddq_frame`), which then carried a second copy of
  // the backdrop plus a second scrim — a 26px band visibly darker than everything beside it, which is
  // exactly what the reader reported as "a background of a different colour".
  assert.ok(!css.includes('[class*="_frame"]'));
  assert.ok(css.includes('*:has(> [class*="_sidebarCol"])'));

  // The composer's fade band keeps its fade — as a MASK over a copy of the backdrop, and the mask has
  // to sit on a pseudo-element. Two mistakes this pins against, both observed on screen: a mask on the
  // seat itself masks its whole subtree, which hid the composer card (the input box) inside it; and
  // leaving the geometry un-`!important` let the host's higher-specificity `background` shorthand win,
  // so the copy tiled as a grid of small wallpapers.
  const seatPseudo = rules.find(rule => rule.includes('_composerSeat') && rule.includes('::before')) ?? '';
  assert.ok(seatPseudo.includes('var(--viewtune-wallpaper-image)'));
  // The band is LIFTED over the seat's own box, like the conversation page's and the trajectory page's, and it ramps
  // over exactly the strip it was raised by — one number for both. It used to start at `inset: 0`, which is why the
  // reading view's fade sat a full lift lower than the other two pages' (reported by the reader).
  assert.ok(seatPseudo.includes('inset: calc(-1 * var(--viewtune-wallpaper-fade-lift, 36px)) 0 0 0 !important;'));
  // The ramp is anchored to END at the lift, so its length is a second number: shortening it moves the point where
  // the text starts to fade towards the point where it is gone, which is the "faster fade" the reader asked for —
  // and the end never moves.
  assert.ok(seatPseudo.includes('mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-wallpaper-fade-lift, 36px) - var(--viewtune-wallpaper-fade-ramp, 20px)), #000 var(--viewtune-wallpaper-fade-lift, 36px))'));
  assert.ok(seatPseudo.includes('background-repeat: no-repeat !important'));
  const seat = rules.find(rule => rule.includes('_composerSeat') && !rule.includes('::before')) ?? '';
  assert.ok(seat.includes('background-image: none !important'), 'the opaque host gradient must be dropped');
  assert.ok(seat.includes('--viewtune-wallpaper-fade-lift: 36px'), 'the lift is a number of its own, like the others');
  assert.ok(seat.includes('--viewtune-wallpaper-fade-ramp: 20px'), 'and so is the ramp, so the fade can be made faster');
  assert.ok(!seat.includes('mask-image'), 'the mask must not sit on the seat itself');
});

test('the document element carries the scope and the values, clamps them, and loses them again', () => {
  const fake = fakeDocument();
  const doc = fake.document as unknown as Document;

  applyWindowScope(doc, { scope: 'window', image: 'url("a.png")', dim: 45, chrome: 55 });
  assert.equal(fake.attributes.get('data-viewtune-wallpaper'), 'window');
  assert.deepEqual([...fake.properties], [
    ['--viewtune-wallpaper-image', 'url("a.png")'],
    ['--viewtune-wallpaper-dim', '45%'],
    ['--viewtune-wallpaper-chrome', '55%'],
  ]);

  // The view scope still publishes: the conversation column below the header follows the wallpaper in
  // either scope, and the attribute's VALUE is what keeps the chrome out of it.
  applyWindowScope(doc, { scope: 'view', image: 'url("a.png")', dim: 45, chrome: 55 });
  assert.equal(fake.attributes.get('data-viewtune-wallpaper'), 'view');

  // Out-of-range values are clamped on the way in, so a bad record cannot paint a broken backdrop.
  applyWindowScope(doc, { scope: 'window', image: 'url("a.png")', dim: 999, chrome: -4 });
  assert.deepEqual([...fake.properties], [
    ['--viewtune-wallpaper-image', 'url("a.png")'],
    ['--viewtune-wallpaper-dim', '100%'],
    ['--viewtune-wallpaper-chrome', '0%'],
  ]);

  applyWindowScope(doc, null);
  assert.equal(fake.attributes.has('data-viewtune-wallpaper'), false);
  assert.deepEqual([...fake.properties], []);
});

test('installing the stylesheet is one style element, and disposing removes it and the values', () => {
  const fake = fakeDocument();
  const doc = fake.document as unknown as Document;
  const dispose = installWindowScope(doc);

  assert.equal(fake.created.length, 1);
  const style = fake.created[0];
  assert.equal(style.tag, 'style');
  assert.equal(style.attrs.get('data-viewtune-style'), 'dsh-viewtune-wallpaper-scope');
  assert.ok(style.textContent.includes('data-viewtune-wallpaper'));

  // Disposing has to undo BOTH halves: the sheet, and what the reading view left on the document.
  applyWindowScope(doc, { image: 'url("a.png")', dim: 45, chrome: 55 });
  dispose();
  assert.equal(style.removed, true);
  assert.equal(fake.attributes.has('data-viewtune-wallpaper'), false);
  assert.deepEqual([...fake.properties], []);
});

test('publishing nudges the two scrimmed surfaces, so a stale paint cannot outlive the value change', () => {
  // The reader's report: the chrome scrim missing on a fresh load until that part of the page happened to
  // repaint. The rule no longer carries the composited construct that made it likely (see the chrome test
  // above); this is the belt to that braces — each publish flushes style and layout for the two surfaces,
  // which is what marks them for paint. Both paths are checked, publishing and withdrawing, because the
  // scrim has to disappear just as reliably as it appears.
  const read: string[] = [];
  const element = (name: string) => ({
    get offsetHeight(): number { read.push(name); return 1; },
  });
  const doc = {
    documentElement: {
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
      style: { setProperty: () => undefined, removeProperty: () => undefined },
    },
    querySelectorAll: () => [element('sidebar'), element('header')],
  } as unknown as Document;
  applyWindowScope(doc, { scope: 'window', image: 'url("x")', dim: 45, chrome: 55 });
  assert.deepEqual(read, ['sidebar', 'header']);
  read.length = 0;
  applyWindowScope(doc, null);
  assert.deepEqual(read, ['sidebar', 'header']);
});

test("the trajectory page sits on the theme's base colour instead of the wallpaper", () => {
  const css = windowScopeCss();
  // The host's trajectory view shares this column and the composer seat, so the image leaked beside its
  // opaque table: a dimmed strip down the right edge (the scroller's stable gutter, which the groove
  // paints) and the stats band under the composer. Found by the page's own marker so every other host
  // view — and the reading view — keeps its wallpaper.
  assert.ok(css.includes('[class*="_scrollBody"]:has([data-trajectory-scroll])'));
  assert.ok(css.includes('background-color: var(--dsw-alias-bg-base) !important;'));
  // The one rule covers all three surfaces because they READ these names: the column's own background,
  // the groove on its scrollbar (a pseudo-element inherits from its originating element) and the seat's
  // masked pseudo-element. Withdrawing only the background would leave the gutter strip painted.
  assert.ok(css.includes('--viewtune-wallpaper-image: none;'));
  assert.ok(css.includes('--viewtune-wallpaper-dim: 0%;'));
  // The band above the composer must still FADE the page out — that is the job it was given, and it is
  // our masked pseudo-element, so withdrawing the image left it painting nothing and the page met the
  // composer with a hard edge. On this page it paints the surface the page is MADE of, so it is never a
  // slab of another shade (light theme: bg-base and bg-layer-1 are the same colour, which is why the
  // band only ever showed in the dark theme)…
  assert.ok(css.includes(
    '[class*="_scrollBody"]:has([data-trajectory-scroll]) [class*="_composerSeat"]::before'));
  assert.ok(css.includes('background-color: var(--dsw-alias-bg-layer-1) !important;'));
  // …and the band is lifted above the seat, so the ramp covers the last rows instead of starting at the
  // composer's edge. The lift is a variable, and only its NAME is pinned here: tuning how far up the
  // fade begins is one number, and it should not have to touch this test or the guard.
  assert.ok(css.includes('inset: calc(-1 * var(--viewtune-trajectory-fade-lift)) 0 0 0 !important;'));
  assert.ok(css.includes('--viewtune-trajectory-fade-lift:'));
  // Its OWN mask, so this page does not inherit the shared one: the other pages now ramp over a length of their own
  // (shortened at the reader's request) while this page keeps the single-number form it always had. The declaration
  // is what isolates it — the value would drift again the next time the shared ramp is tuned.
  assert.ok(css.includes('mask-image: linear-gradient(180deg, transparent 0px, #000 var(--viewtune-trajectory-fade-lift, 36px)) !important;'));
});

test("the gutter's groove reads the dial, and falls back to the host's own track", () => {
  const css = scrollbarStyleCss();
  // The groove layer reads the DIAL itself — the skin's convention, one level higher because the element
  // it styles (the host's scroll container) is outside the reading view.
  assert.ok(css.includes('var(--glass-scrollbar, 0%)'));
  // The wallpaper's two layers ride in the same stack, with fallbacks that paint nothing when there is no
  // wallpaper: that is what keeps a bare gutter identical to the host's own transparent track.
  assert.ok(css.includes('var(--viewtune-wallpaper-dim, 0%)'));
  assert.ok(css.includes('var(--viewtune-wallpaper-image, none)'));
  // The lane fills the host's whole column. The host insets this track by 2px on ALL FOUR sides, and
  // that inset is exactly the gap a reader sees around the groove — above it (against the top bar's
  // border), beside it (against the toolbar's right edge) and inside the window's right edge.
  // TWO rules now, and the split is the fix for a reported bug: every track gets the flat groove, and only the LANE
  // composes the wallpaper into it. A card's inner scroller used to get the wallpaper too, and a card with a
  // `backdrop-filter` (the skin's own cards have one) becomes the containing block for a fixed background — so the
  // copy was scaled against the CARD and sampled the wallpaper from somewhere else, showing as a slab of the wrong
  // colour down the edge of an opened tool card until a scroll repainted it.
  const flatAt = css.indexOf('::-webkit-scrollbar-track,\n::-webkit-scrollbar-corner {');
  assert.ok(flatAt > 0, 'the flat groove rule');
  const flatRule = css.slice(flatAt, css.indexOf('}', flatAt));
  assert.ok(flatRule.includes('background-image: none !important;'), 'the flat groove paints no wallpaper');
  assert.ok(!flatRule.includes('--viewtune-wallpaper'), 'and does not reach for it either');
  const laneAt = css.indexOf('[class*="_scrollBody"]::-webkit-scrollbar-track,\n[class*="_scrollBody"]::-webkit-scrollbar-corner {');
  assert.ok(laneAt > 0, 'the lane rule');
  const laneRule = css.slice(laneAt, css.indexOf('}', laneAt));
  assert.ok(laneRule.includes('var(--viewtune-wallpaper-image, none)'), 'only the lane composes the wallpaper');
  assert.ok(laneRule.includes('background-attachment: fixed !important;'), 'still anchored to the viewport');
  // The dial is a LAYER here, and the FIRST one. A `background-color` sits under every image, so leaving the groove's
  // colour to the flat rule hid it completely behind the opaque wallpaper copy — the slot read as missing because it
  // matched the backdrop exactly. That was a real regression from splitting the rule in two.
  assert.ok(laneRule.includes('var(--glass-scrollbar, 0%)'), 'the dial is a layer in the lane, not the colour under it');
  assert.ok(laneRule.indexOf('var(--glass-scrollbar, 0%)') < laneRule.indexOf('var(--viewtune-wallpaper-image'),
    'and it is the topmost layer, or the image would cover it');
  assert.ok(laneRule.includes('background-size: cover, cover, var(--viewtune-wallpaper-size, cover) !important;'), 'three layers, three sizes');
  assert.ok(css.includes('[class*="_scrollBody"]::-webkit-scrollbar-track { margin: 0 !important; border-radius: 999px !important; }'));
  // Its ENDS are rounded like the two short slots' (the panel's and the composer's): the reader asked for the groove to
  // look the same wherever it appears, and with the inset gone the radius is what makes it a bar rather than a strip
  // that stops dead against the surfaces above and below it.
  assert.ok(css.includes('[class*="_scrollBody"]::-webkit-scrollbar-track { margin: 0 !important; border-radius: 999px !important; }'), 'the lane is rounded too');
  assert.ok(css.includes('[class*="composer" i] [class*="_scroll"]::-webkit-scrollbar-track { border-radius: 999px !important; }'), 'and so is the composer slot');
  // And the inset is the whole change: it shrinks the LANE, never the thumb. Insetting the thumb here is
  // wrong — that is what made the scrollbar itself thinner while the lane gained nothing.
  assert.equal(css.includes('::-webkit-scrollbar-thumb'), false);
  // The dial's floor is the absence of a groove, not a transparent colour.
  assert.equal(scrollbarFillOf(0), '0%');
  assert.equal(scrollbarFillOf(20), '20%');
  assert.equal(scrollbarFillOf(999), '100%');
  assert.equal(scrollbarFillOf('lots'), '0%');
});
