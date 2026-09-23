/**
 * The input box's slide into the skin.
 *
 * The three things that make it work, pinned separately, because each one was a fact measured out of the host's own
 * stylesheet rather than a choice: the plate is a theme token, the override has to be inherited from the seat so it
 * does not leak to other token users, and the seat's own lift gradient has to go or the transparency would show the
 * band instead of the wallpaper. The gate is the skin's master attribute, which is what the reader asked for.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composerGlassCss } from '../src/client/composer-glass.ts';
import { GLASS_ATTRIBUTE } from '../src/client/app-backdrop.ts';
import { WINDOW_SCOPE_ATTRIBUTE as WALLPAPER_ATTRIBUTE } from '../src/client/wallpaper-scope.ts';

test('the input box takes the skin, without leaking the token override', () => {
  const css = composerGlassCss();
  // The snapshot exists because a custom property cannot read the token it overrides.
  assert.ok(css.includes('--viewtune-input-plate: var(--dsw-specific-input-major);'), 'the snapshot');
  // The override is scoped to the composer, which is what keeps other users of the token unchanged — and it is
  // declared on the SEAT so the card inside inherits it.
  assert.ok(css.includes(`html[${GLASS_ATTRIBUTE}] [class*="composer" i]`), 'the seat, case-insensitively');
  assert.ok(css.includes('--dsw-specific-input-major: color-mix(in srgb,'), 'the token override');
  // The two round buttons under the field ("添加附件" and "指令") share the composer's `_add` class and paint ONE token,
  // so one override covers the pair — on the same dial as the input, which is what keeps them part of one surface.
  assert.ok(css.includes('--viewtune-selector-plate: var(--dsw-specific-selector);'), 'the second snapshot');
  assert.ok(css.includes('--dsw-specific-selector: color-mix(in srgb, var(--viewtune-selector-plate) var(--glass-input, 25%), transparent);'), 'their override, on the input dial');
  assert.ok(css.includes('var(--glass-input, 25%)'), 'the dial, spelled out so the guard can cross-check it');
  // Spelled out rather than interpolated on purpose: the guard collects `var(--glass-*)` out of the artifact and
  // compares that set against the settings rows, so an interpolated name would make this surface invisible to it.
  assert.equal(/var\(--glass-input/.test(css), true, 'the name is a literal in the stylesheet');
  // Without this the translucent plate would reveal the seat's opaque lift band rather than the wallpaper — but ONLY
  // where our own band is there to replace it. Gated on the wallpaper attribute for exactly that reason: with the skin
  // on and no wallpaper, dropping the host's band left NO fade at all, which is the combination this gate fixes.
  assert.ok(css.includes(`html[${GLASS_ATTRIBUTE}][${WALLPAPER_ATTRIBUTE}] [class*="composer" i] {`), 'the lift goes only where ours replaces it');
  assert.ok(css.includes('background-image: none;'), 'the lift band is withdrawn');
  // The plate override itself is NOT gated on the wallpaper: the skin is on, so the plate is translucent either way.
  assert.ok(css.includes(`html[${GLASS_ATTRIBUTE}] [class*="composer" i] {`), 'the plate is always translucent with the skin');
  assert.equal(WALLPAPER_ATTRIBUTE, 'data-viewtune-wallpaper');
  // …and with NO wallpaper, our own band (the one the lift above defers to) does not exist, so the host's ramp would
  // be left running inside the seat's own box — the fade starting at the composer's edge, with the transcript drawn
  // right up against the input. A lifted band in the theme's base colour stands in, with the same two numbers, which
  // is what makes the fade start above the composer on every page and in every combination.
  assert.ok(css.includes(`html[${GLASS_ATTRIBUTE}]:not([${WALLPAPER_ATTRIBUTE}]) [class*="composer" i]::before`), 'the stand-in band');
  assert.ok(css.includes('inset: calc(-1 * var(--viewtune-wallpaper-fade-lift, 36px)) 0 0 0;'), 'lifted, not at the seat edge');
  assert.ok(css.includes('background-color: var(--dsw-alias-bg-base);'), "in the colour the host's own band used");
  assert.ok(css.includes('var(--viewtune-wallpaper-fade-ramp, 20px)'), 'and with the same ramp');
  // The trajectory page is the one page whose band is not the base colour: its own band paints `bg-layer-1`, the
  // surface that page is made of, so its stand-in has to match THAT. Only the colour — its lift and ramp stay as
  // they are, and no other page changes.
  assert.ok(css.includes(`html[${GLASS_ATTRIBUTE}]:not([${WALLPAPER_ATTRIBUTE}]) [class*="_scrollBody"]:has([data-trajectory-scroll]) [class*="composer" i]::before`), 'the trajectory stand-in');
  assert.ok(css.includes('background-color: var(--dsw-alias-bg-layer-1);'), "in the trajectory page's own colour");
  // The gate is the skin's own attribute, NOT the conversation page's: the composer is on screen in both views.
  assert.equal(GLASS_ATTRIBUTE, 'data-viewtune-glass');
  assert.equal(css.includes('conversation-glass'), false, 'not the conversation page gate');
});
