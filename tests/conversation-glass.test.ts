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
  // …and the FROST travels with the tint, with the same two rules: a surface the reader moved is written as px, and a
  // surface whose frost is 0 is NOT written at all — `blur(0px)` is not `none`, so writing it would put a composited
  // layer on a surface nobody asked to frost (see glassBlurProperties).
  applyConversationGlass(doc, { glass: true, glassConversation: true, glassBlur: { card: 18 } });
  assert.equal(doc.properties.get('--glass-blur-card'), '18px');
  // A surface nobody moved falls back to its shipped frost, read off the table (the user bubble's 3px)…
  assert.equal(doc.properties.get('--glass-blur-user'), `${String(GLASS_PARTS.find(part => part.id === 'user')?.blur?.initial ?? -1)}px`);
  // …and the 0-initial surface — the LANE, since the defaults are one reading of the reader's settings file; it used to
  // be the card and the chip — is the one that must not be written at all.
  assert.equal(doc.properties.get('--glass-blur-lane'), undefined);
  // …and withdrawing the gate takes every one of them back off, the initial-frost ones included: a withdrawn gate is
  // not the same thing as a record that omits the key.
  applyConversationGlass(doc, { glass: true, glassConversation: false });
  assert.equal(doc.attributes.has(CONVERSATION_GLASS_ATTRIBUTE), false);
  assert.deepEqual([...doc.properties.keys()], []);
});

test('every rule that paints is gated, and the one that is not only snapshots', () => {
  const css = conversationGlassCss();
  // Comments are stripped before anything is read as a rule, and they have to be: these stylesheets carry long
  // explanations, a continuation line of one is indistinguishable from a selector by `startsWith('/*')` alone, and a
  // comment that quotes a declaration (`… { background: var(--x) }`) reads as an UNGATED rule otherwise. The same
  // lesson was learned in wallpaper-scope.test.ts, for the same reason.
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
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
  // …and the bubble rule carries the exclusion too. Matching by a class-name SUBSTRING reaches every element on the
  // page whose class contains it, so "this plugin's own bubble is named `…_user`" was a statement about today's name
  // rather than a boundary: renaming that local would have let the conversation switch into the reading view.
  const bubbleRule = css.split('\n').find(line => line.includes('[class*="_bubble"]'));
  assert.ok(
    bubbleRule !== undefined && bubbleRule.includes(':not([data-dsh-better-display], [data-dsh-better-display] *)'),
    `the bubble rule is not excluded from the reading view: ${String(bubbleRule)}`,
  );
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
  // Five dials now, and no sixth: code paper, the diff paper, the bubble, the changed-files card family, and the
  // chrome that floats over this page. Anything else here would mean the document resolves a property this page has
  // no business painting — the `blur-` family excepted, because those are the SAME five surfaces' frost, published by
  // the same two switches and named `--glass-blur-<part>`.
  assert.equal(/--glass-(?!code|diff|user|card|lane|blur-)/.test(css), false, 'only the dials this page reads');
});

test('the changed-files card, its portaled detail, and the host’s to-bottom button are dialled by NAME', () => {
  const css = conversationGlassCss();
  const lines = css.split('\n');
  // The card 0.2.0 appends to every answer body: one published attribute, no class name and no token sweep. It paints
  // from a LAYER token, which is exactly why the skin never reached it. Asserted across the selector/declaration line
  // break, because these rules are written one declaration per line.
  assert.ok(/\[data-changed-files\]\s*\{[^}]*--glass-diff/.test(css), 'the changed-files card rides the DIFF dial');
  // …and the PER-FILE 产物 cards that the host renders in that same spot (the reader's question: they follow the diff
  // dial too, and they did not before — the host paints them from a STATIC neutral, `--deliverable-fill`, which no token
  // sweep could reach). Same construction as the card's header: the host's own variable is READ on the card where it is
  // inherited, never redefined, so no cycle forms; the hover keeps the host's own feedback colour at the same dial.
  assert.ok(/\[data-presented-file\]\s*\{[^}]*--glass-diff/.test(css), 'the presented-file cards ride the DIFF dial');
  assert.ok(/\[data-presented-file\]\s*\{[^}]*backdrop-filter: blur\(var\(--glass-blur-diff\)\)/.test(css), '…with the diff dial’s frost');
  assert.ok(css.includes('var(--deliverable-fill, var(--viewtune-layer-plate'), '…reading the host’s own fill, not a hard-coded neutral');
  assert.ok(/\[data-presented-file\]:hover\s*\{[^}]*var\(--deliverable-hover/.test(css), '…and the hover reads the host’s own hover colour');
  // …and its hover DETAIL, which the deliverables package hands to the primitives' HoverCard: that card is PORTALED to
  // the body, so it is outside the column and the column scope cannot reach it. Three lines, because the plate and the
  // frost are stated on the two candidate boxes separately: the tint/frost pair on the content and its container, and
  // then the DIFF frost on the content alone (the detail is a diff), so whichever box turns out to be the plate, one
  // of them carries a frost.
  const preview = lines.filter(line => line.includes('[data-changes-hover-preview]'));
  assert.equal(preview.length, 3, `the portaled detail names both candidates: ${preview.join(' | ')}`);
  for (const line of preview) {
    assert.ok(line.startsWith(`html[${CONVERSATION_GLASS_ATTRIBUTE}]`), `the detail rule is gated: ${line}`);
    assert.ok(!line.includes('[data-chat-flow]'), `the portaled detail is not inside the column: ${line}`);
  }
  assert.ok(css.includes('*:has(> [data-changes-hover-preview])'), 'the container is one of the two candidates');
  assert.ok(css.includes('--viewtune-layer-plate: var(--dsw-alias-bg-layer-1);'), 'the plate it mixes is snapshotted');
  // The host's own 「回到底部」, which publishes NO attribute: found by its local class name inside the conversation
  // scroller (where the host renders it), and given the same FLOOR our own pill uses — an affordance that can be
  // dialled out of sight is a trap, and this one appears exactly when the reader may need it.
  const button = /button\[class\*="_toBottom"\]\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(button.includes('--glass-lane'), `the to-bottom button rides the lane dial: ${button}`);
  assert.ok(button.includes('max(var(--glass-lane, 20%), 20%)'), 'the affordance cannot be dialled out of sight');
  // …and its frost is the LANE's, at the three quarters our own 「回到最新」 pill wears: the two are the same
  // affordance on the two pages, so one lane dial moves both by the same rule.
  assert.ok(button.includes('blur(calc(var(--glass-blur-lane) * 0.75))'), 'and it blurs what is behind it, like the pill');
  assert.ok(css.includes('button[class*="_toBottom"]:hover'), 'its hover state is dialled too, not left opaque');
  // The card's HEADER bar, the half that stayed solid after the body was dialled: the host paints it from a STATIC
  // neutral (theme-independent, so there is no token to dial) that it hands down as `--changes-fill`. Read on the bar,
  // where that value is inherited — read, never redefined, so it is not the cycle the snapshot avoids.
  const header = /\[data-changed-files\] \[class\*="_header"\]\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(header.includes('var(--changes-fill'), `the card header is dialled from the host's own fill: ${header}`);
  assert.ok(header.includes('--glass-diff'), `…and rides the same diff dial as the body it belongs to: ${header}`);
  assert.ok(css.includes('[data-changed-files] [class*="_header"]:hover'), 'its hover keeps giving feedback');
  // The diff paper's ROWS: four plates of their own, all on the DIFF dial, in the column AND again on the portaled
  // detail (a token override on the column cannot reach a card portaled to the body). Paired explicitly, because the
  // two band tokens end in `-bg` and the two gutters do not.
  const rows: readonly (readonly [string, string])[] = [
    ['--viewtune-diff-added', '--dsw-alias-file-diff-added-bg'],
    ['--viewtune-diff-deleted', '--dsw-alias-file-diff-deleted-bg'],
    ['--viewtune-diff-added-gutter', '--dsw-alias-file-diff-added-gutter'],
    ['--viewtune-diff-deleted-gutter', '--dsw-alias-file-diff-deleted-gutter'],
  ];
  for (const [snapshot, alias] of rows) {
    const overrides = css.split('\n').filter(line => line.includes(`${alias}:`));
    assert.equal(overrides.length, 2, `${alias} is dialled in both scopes, saw ${String(overrides.length)}`);
    for (const line of overrides) assert.ok(line.includes('--glass-diff'), `the row plate rides the diff dial: ${line}`);
    assert.ok(css.includes(`${snapshot}: var(${alias})`), `and its theme value is snapshotted: ${snapshot}`);
  }
  // The marker colours (the + and - glyphs) are legibility, not plate: dialling them would dim the signs themselves.
  assert.equal(css.includes('file-diff-added-marker'), false, 'the + and - glyph colours are left alone');
});
