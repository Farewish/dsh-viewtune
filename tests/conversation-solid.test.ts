/**
 * The conversation page as a solid page.
 *
 * The switch is independent of the skin, so what is worth pinning is that it is genuinely self-sufficient:
 * the page surface, the gutter and the fade band all get their look from THIS stylesheet, with no help
 * from the wallpaper's rules (whose band is gated on a wallpaper existing at all). And, like the skin's
 * half, it must not reach into the reading view, which publishes the same column attribute on purpose.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONVERSATION_SOLID_ATTRIBUTE, applyConversationSolid } from '../src/client/app-backdrop.ts';
import { conversationSolidCss } from '../src/client/conversation-solid.ts';

/** The smallest document the publisher touches. */
function fakeDocument() {
  const attributes = new Map<string, string>();
  return {
    documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
    },
    attributes,
  } as unknown as Document & { attributes: Map<string, string> };
}

test('one switch, one attribute, and it is exactly what the record says', () => {
  const doc = fakeDocument();
  applyConversationSolid(doc, { conversationSolid: true, glass: false });
  assert.equal(doc.attributes.has(CONVERSATION_SOLID_ATTRIBUTE), true);
  // Independent of the skin: turning the skin off does not turn this off.
  applyConversationSolid(doc, { conversationSolid: true, glass: true });
  assert.equal(doc.attributes.has(CONVERSATION_SOLID_ATTRIBUTE), true);
  applyConversationSolid(doc, { conversationSolid: false });
  assert.equal(doc.attributes.has(CONVERSATION_SOLID_ATTRIBUTE), false);
  // A record written before this switch existed, and no record at all.
  applyConversationSolid(doc, { glass: true });
  assert.equal(doc.attributes.has(CONVERSATION_SOLID_ATTRIBUTE), false);
  applyConversationSolid(doc, undefined);
  assert.equal(doc.attributes.has(CONVERSATION_SOLID_ATTRIBUTE), false);
});

test('nothing in the solid stylesheet applies without its gate', () => {
  const css = conversationSolidCss();
  const selectors = css.split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('{') && !line.startsWith('/*'));
  assert.ok(selectors.length >= 3, `expected a few rules, saw ${String(selectors.length)}`);
  for (const selector of selectors) {
    assert.ok(selector.startsWith(`html[${CONVERSATION_SOLID_ATTRIBUTE}]`), `ungated rule: ${selector}`);
  }
});

test('the page paints itself, and does not depend on the wallpaper for the fade', () => {
  const css = conversationSolidCss();
  // The surface, and the two names the gutter groove reads off the same element: without them the right
  // edge of a one-colour page stays a strip of photograph. The colour is the one the TRAJECTORY page shows
  // — its own root paints `bg-layer-1` over the theme's base — because "the two pages look alike" means
  // the colour a reader can actually see.
  assert.equal(css.includes('background-color: var(--dsw-alias-bg-layer-1) !important'), true);
  assert.equal(css.includes('background-color: var(--dsw-alias-bg-base) !important'), false);
  assert.ok(css.includes('--viewtune-wallpaper-image: none'));
  assert.ok(css.includes('--viewtune-wallpaper-dim: 0%'));
  // The band is OURS here: the wallpaper's copy of that mask is gated on a wallpaper existing, and this
  // switch has nothing to do with whether one does — so the ramp is restated, and lifted. Its length is a
  // SECOND number, anchored to end at the lift: the reading page's band is built the same way, and the reader
  // asked for the faster (steeper) fade there and then for the same on this page.
  assert.ok(css.includes('mask-image: linear-gradient(180deg, transparent calc(var(--viewtune-conversation-fade-lift, 36px) - var(--viewtune-conversation-fade-ramp, 20px)), #000 var(--viewtune-conversation-fade-lift, 36px)) !important'));
  assert.ok(css.includes('inset: calc(-1 * var(--viewtune-conversation-fade-lift, 36px)) 0 0 0 !important'));
  assert.ok(css.includes('--viewtune-conversation-fade-lift: 36px'));
  assert.ok(css.includes('--viewtune-conversation-fade-ramp: 20px'), 'the fade length is its own number');
  // The host's own seat gradient is dropped: two fades would ramp at two speeds.
  assert.ok(/composerSeat"\] \{\s*\n\s*background-image: none !important;/.test(css));
  // …and the scope excludes the reading view, which publishes the same column attribute on purpose.
  assert.ok(css.includes(':not([data-dsh-better-display], [data-dsh-better-display] *)'));
});
