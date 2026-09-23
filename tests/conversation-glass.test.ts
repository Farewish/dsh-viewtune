/**
 * The skin's reach into the host's conversation page.
 *
 * Two things are worth pinning here beyond "the rules exist": that NOTHING applies without the gate (the
 * switch has to be a real off, not a weaker on), and that the page claims exactly two kinds of surface —
 * a third would be this plugin repainting something nobody asked it to.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONVERSATION_GLASS_ATTRIBUTE, applyConversationGlass, conversationGlassOf } from '../src/client/app-backdrop.ts';
import { conversationGlassCss } from '../src/client/conversation-glass.ts';
import { GLASS_PARTS } from '../src/client/glass.ts';

/** The smallest document the publisher touches. */
function fakeDocument() {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  return {
    documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
      style: {
        setProperty: (name: string, value: string) => { properties.set(name, value); },
        removeProperty: (name: string) => { properties.delete(name); },
      },
    },
    attributes,
    properties,
  } as unknown as Document & { attributes: Map<string, string>; properties: Map<string, string> };
}

test('the gate needs BOTH switches: it is a sub-option of the skin, not a rival to it', () => {
  assert.equal(conversationGlassOf({ glass: true, glassConversation: true }), true);
  // The skin off with the sub-option on: the reading view is then the only place the skin exists, and the
  // conversation page must not be the one place it survives.
  assert.equal(conversationGlassOf({ glass: false, glassConversation: true }), false);
  assert.equal(conversationGlassOf({ glass: true, glassConversation: false }), false);
  assert.equal(conversationGlassOf({ glass: true }), false);
  assert.equal(conversationGlassOf(undefined), false);
});

test('publishing sets the gate and just the two dials, and withdrawing takes them all back', () => {
  const doc = fakeDocument();
  applyConversationGlass(doc, { glass: true, glassConversation: true, glassParts: { code: 40, user: 10 } });
  assert.equal(doc.attributes.has(CONVERSATION_GLASS_ATTRIBUTE), true);
  assert.equal(doc.properties.get('--glass-code'), '40%');
  assert.equal(doc.properties.get('--glass-user'), '10%');
  // A part nobody moved falls back to its initial — the reader's own setting, so the assertion reads the table rather
  // than repeating the number here.
  applyConversationGlass(doc, { glass: true, glassConversation: true });
  assert.equal(doc.properties.get('--glass-user'), `${String(GLASS_PARTS.find(part => part.id === 'user')?.initial ?? -1)}%`);
  applyConversationGlass(doc, { glass: true, glassConversation: false });
  assert.equal(doc.attributes.has(CONVERSATION_GLASS_ATTRIBUTE), false);
  assert.deepEqual([...doc.properties.keys()], []);
});

test('every rule that paints is gated, and the one that is not only snapshots', () => {
  const css = conversationGlassCss();
  const selectors = css.split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('{') && !line.startsWith('/*'));
  assert.ok(selectors.length >= 4, `expected a few rules, saw ${String(selectors.length)}`);
  const ungated = selectors.filter(selector => !selector.startsWith(`html[${CONVERSATION_GLASS_ATTRIBUTE}]`));
  // Exactly one exemption, and it is the snapshot: a dial cannot be applied to the token it reads, so the
  // theme's value is taken once on `body` — the one place that is not a cycle. Anything else ungated is a
  // rule that would apply with the switch OFF, which the switch promises not to do.
  assert.deepEqual(ungated, ['body {'], `ungated rules: ${ungated.join(' | ')}`);
});

test('the page claims code paper and the user bubble, and no other dial', () => {
  const css = conversationGlassCss();
  // Code paper is dialled through the tokens the host's components paint from, because a fence in a
  // message and a tool's result card are different components — and the tool cards are most of what a
  // conversation shows. The inline chip has a token of its own and rides the same dial.
  assert.ok(css.includes('--dsw-alias-markdown-code-block:'));
  assert.ok(css.includes('--dsw-alias-markdown-code-block-banner:'));
  assert.ok(css.includes('--dsw-alias-markdown-inline-code:'));
  assert.ok(css.includes('[class*="_bubble"]'));
  assert.ok(css.includes('--glass-code'));
  assert.ok(css.includes('--glass-user'));
  assert.ok(css.includes('--glass-diff'));
  // The scope must exclude the reading view, which publishes the same column attribute on purpose.
  assert.ok(css.includes(':not([data-dsh-better-display], [data-dsh-better-display] *)'));
  // The banner row is two plates: the token override reaches the banner, and the sticky wrap over it paints
  // the theme's own background (not a code token), so it is cleared by the primitive's first-child handle.
  assert.ok(css.includes('.md-code-block > :first-child'));
  // The diff paper is code-shaped but rides the DIFF dial, in both views: one kind of paper, one control.
  assert.ok(/\[data-diff\]\s*\{[^}]*--glass-diff/.test(css));
  // Three dials, and no fourth: anything else here would mean the document resolves a property this page
  // has no business painting.
  assert.equal(/--glass-(?!code|diff|user)/.test(css), false, 'only the dials this page reads');
});
