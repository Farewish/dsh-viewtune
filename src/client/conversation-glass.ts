/**
 * The frosted glass skin, on the host's CONVERSATION page.
 *
 * Everything else this plugin paints lives inside the reading view, where a stylesheet scoped to that
 * view's root can reach it. The conversation page is not ours: its messages, its code blocks and the
 * tool cards that make up most of it are the host's own components, whose class names are hashed per
 * package. Enumerating those would be a list to keep chasing, so this page is dialled where the host's
 * components AGREE instead — on the theme tokens they all paint from.
 *
 * Two consequences shape the whole file:
 *
 *  - A dial cannot be applied to the token it is reading: `--x: color-mix(… var(--x) …)` is a cycle and
 *    resolves to nothing. So the value is snapshotted once, under our own names, on `body` — which is
 *    where the theme defines these tokens, and therefore the one place the snapshot is not circular.
 *  - The scope is the conversation view's column (`data-chat-flow`), MINUS everything inside the reading
 *    view — because that view publishes the same attribute on purpose (see Reader.tsx), so that host
 *    stylesheets treat it like the chat's. Without the exclusion the skin would dial its own surfaces
 *    twice.
 *
 * Only two dials are read, and only while BOTH the skin and the conversation switch are on: with the
 * switch off nothing here applies at all, and the page keeps exactly the look it always had.
 */
import { CONVERSATION_GLASS_ATTRIBUTE } from './app-backdrop.js';

export const CONVERSATION_GLASS_STYLE_ID = 'dsh-viewtune-conversation-glass';

/** The gate every rule below hangs off, spelled once. */
const GATE = `html[${CONVERSATION_GLASS_ATTRIBUTE}]`;

/**
 * The conversation view's column, and nothing of ours.
 *
 * `data-chat-flow` is published by the host's ChatView AND by this plugin's reader root; a separate
 * conversation switch must not reach into the reading view, so the reader's subtree is excluded by the
 * marker its own root always carries.
 */
const COLUMN = `${GATE} [data-chat-flow]:not([data-dsh-better-display], [data-dsh-better-display] *)`;

export function conversationGlassCss(): string {
  return [
    `/* The theme's plate values, taken once under our own names. This rule paints nothing and is not`,
    `   gated: it is a snapshot, and a snapshot of a value that exists anyway cannot change the look of`,
    `   anything. Gating it would only mean the snapshot had to be re-taken. */`,
    `body {`,
    `  --viewtune-code-plate: var(--dsw-alias-markdown-code-block);`,
    `  --viewtune-code-banner: var(--dsw-alias-markdown-code-block-banner);`,
    `  --viewtune-inline-code: var(--dsw-alias-markdown-inline-code);`,
    `}`,
    `/* Every host component on this page that draws code paper reads one of these three: the fenced block`,
    `   (whose body and shiki sheet both read the plate), the block's banner row, the tool result cards`,
    `   (ioCard and friends), the diff paper, and the inline chip in prose. Dialling the tokens is what`,
    `   makes one rule cover all of them — the tool cards are most of a conversation and none of them is`,
    `   .md-code-block. */`,
    `${COLUMN} {`,
    `  --dsw-alias-markdown-code-block: color-mix(in srgb, var(--viewtune-code-plate, transparent) var(--glass-code, 25%), transparent);`,
    `  --dsw-alias-markdown-code-block-banner: color-mix(in srgb, var(--viewtune-code-banner, transparent) var(--glass-code, 25%), transparent);`,
    `  --dsw-alias-markdown-inline-code: color-mix(in srgb, var(--viewtune-inline-code, transparent) var(--glass-code, 25%), transparent);`,
    `}`,
    `/* One plate per block, not two: the block paints its own from the token, and its body paints ANOTHER`,
    `   of the same token, so a fence with no language stayed a solid slab over the dialled plate. The body`,
    `   is cleared instead of dialled twice — and this is the one rule that has to reach a component's own`,
    `   selector, because the second plate is a `+"`pre`"+` the theme styles directly. */`,
    `${COLUMN} pre {`,
    `  background: transparent !important;`,
    `}`,
    `/* The banner row is TWO plates as well, and this is the last opaque layer on the page: a sticky wrap`,
    `   painted with the theme's own background (--dsw-alias-bg-base, not a code token at all) and the`,
    `   banner inside it, which the token override above already dials. Clearing the wrap is the same move`,
    `   the reading view needed for the same component — the markup is the primitive's, so the handle is the`,
    `   same: the block's first child. */`,
    `${COLUMN} .md-code-block > :first-child {`,
    `  background-color: transparent;`,
    `}`,
    `/* The diff paper, which is code-shaped but belongs to the DIFF dial — the same rule the reading view`,
    `   follows, so one kind of paper is one control in both views. Its plate reads the code token, which`,
    `   the scope above has just dialled for CODE, so the plate is re-stated here on the diff dial. The`,
    `   attribute is the host's own (it is what the reading view selects on too), which is why this needs no`,
    `   class name: a diff shows up in a tool's result card, and every one of them is marked the same way. */`,
    `${COLUMN} [data-diff] {`,
    `  background: color-mix(in srgb, var(--viewtune-code-plate, transparent) var(--glass-diff, 20%), transparent);`,
    `}`,
    `/* The user's bubble: the one surface on this page with a token of its own, and the reason this switch`,
    `   exists at all. Matched by the local name the host's chat package ends its bubble class with — this`,
    `   plugin's own bubble is a different local ("…_user"), so the reading view's copy keeps its own rule. */`,
    // …and that was an argument from the CURRENT name, not a boundary: `[class*="_bubble"]` matches any class CONTAINING
    // the word, anywhere in the document, and the reading view is only spared because its own bubble happens to be named
    // `…_user` today. `COLUMN` states the real rule for this module — the conversation switch must not reach into the
    // reading view — so this rule carries the same exclusion the column rules do, rather than depending on a rename.
    `${GATE} [class*="_bubble"]:not([data-dsh-better-display], [data-dsh-better-display] *) {`,
    `  background: color-mix(in srgb, var(--dsw-specific-bubble, rgba(0, 0, 0, .08)) var(--glass-user, 25%), transparent);`,
    `}`,
  ].join('\n');
}

/** Install the stylesheet once; the disposer takes it away with the gate it is switched on by. */
export function installConversationGlass(doc: Document): () => void {
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', CONVERSATION_GLASS_STYLE_ID);
  style.textContent = conversationGlassCss();
  doc.head.append(style);
  return () => {
    style.remove();
  };
}
