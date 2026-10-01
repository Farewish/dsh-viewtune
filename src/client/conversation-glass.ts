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
    `  --viewtune-layer-plate: var(--dsw-alias-bg-layer-1);`,
    `  --viewtune-diff-added: var(--dsw-alias-file-diff-added-bg);`,
    `  --viewtune-diff-deleted: var(--dsw-alias-file-diff-deleted-bg);`,
    `  --viewtune-diff-added-gutter: var(--dsw-alias-file-diff-added-gutter);`,
    `  --viewtune-diff-deleted-gutter: var(--dsw-alias-file-diff-deleted-gutter);`,
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
    `/* The fenced block's frost, on the code dial. It has to be stated as a SELECTOR rather than through the token`,
    `   above: a custom property can carry a colour but not a \`backdrop-filter\`, so the tint travels by token and the`,
    `   frost by selector. What that leaves out is honest and narrow — this page's tool result cards paint from the`,
    `   same token and have no stable handle, so they take the tint and stay sharp; the reading view's own tool cards`,
    `   (which this plugin renders) do carry the frost. */`,
    `${COLUMN} .md-code-block {`,
    `  backdrop-filter: blur(var(--glass-blur-code));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-code));`,
    `}`,
    `/* The diff paper, which is code-shaped but belongs to the DIFF dial — the same rule the reading view`,
    `   follows, so one kind of paper is one control in both views. Its plate reads the code token, which`,
    `   the scope above has just dialled for CODE, so the plate is re-stated here on the diff dial. The`,
    `   attribute is the host's own (it is what the reading view selects on too), which is why this needs no`,
    `   class name: a diff shows up in a tool's result card, and every one of them is marked the same way. */`,
    `${COLUMN} [data-diff] {`,
    `  background: color-mix(in srgb, var(--viewtune-code-plate, transparent) var(--glass-diff, 20%), transparent);`,
    `  backdrop-filter: blur(var(--glass-blur-diff));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-diff));`,
    `}`,
    `/* …and the diff paper's ROWS, which are four plates of their own: the add and delete bands, and the line-number`,
    `   gutters beside them (` + "`" + `--diff-gutter-fill` + "`" + ` is read off the same two alignment tokens' gutter twins). Nothing here dialled any of the`,
    `   four, which is what the reader still saw — the code paper went translucent and the green and red bands stayed`,
    `   solid. They ride the DIFF dial like the paper does, so one kind of paper stays one control; the marker colours`,
    `   (the + and - glyphs) are deliberately NOT touched: those are legibility, not plate. */`,
    `${COLUMN} {`,
    `  --dsw-alias-file-diff-added-bg: color-mix(in srgb, var(--viewtune-diff-added, transparent) var(--glass-diff, 30%), transparent);`,
    `  --dsw-alias-file-diff-deleted-bg: color-mix(in srgb, var(--viewtune-diff-deleted, transparent) var(--glass-diff, 30%), transparent);`,
    `  --dsw-alias-file-diff-added-gutter: color-mix(in srgb, var(--viewtune-diff-added-gutter, transparent) var(--glass-diff, 30%), transparent);`,
    `  --dsw-alias-file-diff-deleted-gutter: color-mix(in srgb, var(--viewtune-diff-deleted-gutter, transparent) var(--glass-diff, 30%), transparent);`,
    `}`,
    `/* The 「思考」 row of the host's process, ONCE ITS GROUP IS EXPANDED. The host paints that row with a STICKY`,
    `   \`background: var(--dsw-alias-bg-base)\` — the theme's base colour, which is pure black in the dark theme — so`,
    `   opening the thinking turned the row opaque (the reader's report; collapsed it is fine, because the rule only`,
    `   matches \`[data-expanded]\`). It is the same construction as the code block's sticky banner wrap: a covering`,
    `   plate painted from a token nothing here dialled. So it rides the CARD dial like the reasoning card it belongs`,
    `   to, with the card's frost — which is also what makes blurring it worthwhile: it is sticky precisely because the`,
    `   text scrolls under it, and that text is what its backdrop-filter blurs. Selected by the host's own published`,
    `   attributes rather than a class name, and excluded from the reading view like every other rule in this file. */`,
    `${GATE} [data-expanded] [data-open] [data-disclosure-row]:not([data-dsh-better-display], [data-dsh-better-display] *) {`,
    `  background: color-mix(in srgb, var(--dsw-alias-bg-base) var(--glass-card, 30%), transparent);`,
    `  backdrop-filter: blur(var(--glass-blur-card));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-card));`,
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
    `  backdrop-filter: blur(var(--glass-blur-user));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-user));`,
    `}`,
    `/* 0.2.0's 「已编辑 x 个文件」 card, which every answer body now ends with. It paints its plate from a LAYER token`,
    `   (--dsw-alias-bg-layer-1) rather than from any of the code tokens above, which is exactly why the skin never`,
    `   reached it — the reader's report. Dialled by the attribute the deliverables package publishes on it, so no`,
    `   class name and no token sweep: this is one named surface, the same way the bubble above is one.`,
    `   ON THE DIFF DIAL, which is the reader's own grouping suggestion and this file's own rule: group by WHAT a surface`,
    `   is, not by where it sits (the diff paper is on that dial in both views for the same reason). A card whose content`,
    `   is a list of changed files — and whose hover detail is a diff, with the four add/delete tokens already on the`,
    `   diff dial — belongs to that family; leaving it on 卡片与面板 split one family across two dials. */`,
    `${COLUMN} [data-changed-files] {`,
    `  background: color-mix(in srgb, var(--viewtune-layer-plate, transparent) var(--glass-diff, 30%), transparent);`,
    `  /* …with the diff dial's own frost. Note what that means for the shipped look: the diff family already opens at`,
    `     12px, so this card starts frosted where the card dial would have started it at 0 — the one visible consequence`,
    `     of the move, and one dial away from being turned off. */`,
    `  backdrop-filter: blur(var(--glass-blur-diff));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-diff));`,
    `}`,
    `/* …and the card's HEADER bar, which is the half the reader still saw solid: the host paints it from a STATIC`,
    `   neutral it hands down as `+"`"+`--changes-fill`+"`"+` (with `+"`"+`--changes-hover`+"`"+` for the pointer), and a static colour is theme-independent —`,
    `   there is no token to dial, which is exactly why the body went translucent and this bar did not. Read ON the bar,`,
    `   where the card's own value is INHERITED: the variable is read, never redefined, so this is not the cycle the`,
    `   snapshot above exists to avoid. It rides the DIFF dial like the body it belongs to, and the hover keeps the host's`,
    `   own feedback — a different base colour at the same part, since this rule outranks the host's `+"`"+`:hover`+"`"+` by specificity. */`,
    `${COLUMN} [data-changed-files] [class*="_header"] {`,
    `  background: color-mix(in srgb, var(--changes-fill, var(--viewtune-layer-plate, transparent)) var(--glass-diff, 30%), transparent);`,
    `}`,
    `${COLUMN} [data-changed-files] [class*="_header"]:hover {`,
    `  background: color-mix(in srgb, var(--changes-hover, var(--changes-fill, var(--viewtune-layer-plate, transparent))) var(--glass-diff, 30%), transparent);`,
    `}`,
    `/* …and the card's hover DETAIL, which is the same card family one level out: the deliverables package hands its`,
    `   content to the primitives' HoverCard, and that card is PORTALED to the body — so it is not inside the column,`,
    `   and the column scope cannot reach it. Two selectors, because the plate is one of them and which one is the`,
    `   portaled card's own box: the content the hook names, and its container. The hook is the part that is certain,`,
    `   so a build that moves the plate one level further out shows up as a still-opaque popover rather than as a rule`,
    `   that quietly painted nothing. */`,
    `${GATE} [data-changes-hover-preview]:not([data-dsh-better-display], [data-dsh-better-display] *),`,
    `${GATE} *:has(> [data-changes-hover-preview]):not([data-dsh-better-display], [data-dsh-better-display] *) {`,
    `  background: color-mix(in srgb, var(--viewtune-layer-plate, transparent) var(--glass-diff, 30%), transparent);`,
    `  /* …and the diff tokens again, because a token override set on the COLUMN cannot reach a card portaled to the`,
    `     body: this is the one surface that has to carry its own copy of the row plates. */`,
    `  --dsw-alias-file-diff-added-bg: color-mix(in srgb, var(--viewtune-diff-added, transparent) var(--glass-diff, 30%), transparent);`,
    `  --dsw-alias-file-diff-deleted-bg: color-mix(in srgb, var(--viewtune-diff-deleted, transparent) var(--glass-diff, 30%), transparent);`,
    `  --dsw-alias-file-diff-added-gutter: color-mix(in srgb, var(--viewtune-diff-added-gutter, transparent) var(--glass-diff, 30%), transparent);`,
    `  --dsw-alias-file-diff-deleted-gutter: color-mix(in srgb, var(--viewtune-diff-deleted-gutter, transparent) var(--glass-diff, 30%), transparent);`,
    `  /* …and the plate's frost, from the SAME diff dial as the tint and the rows: this popover is the changed-files`,
    `     card's detail, and that card now belongs to the diff family whole. */`,
    `  backdrop-filter: blur(var(--glass-blur-diff));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-diff));`,
    `}`,
    `/* The detail's CONTENT is a diff, so its frost is the DIFF dial's — the one the paper inside it wears everywhere`,
    `   else. Stated on this element as well as on the container because the content hook is the part of the portaled`,
    `   card that is certainly there: whichever box ends up being the plate, one of the two carries a frost. */`,
    `${GATE} [data-changes-hover-preview]:not([data-dsh-better-display], [data-dsh-better-display] *) {`,
    `  backdrop-filter: blur(var(--glass-blur-diff));`,
    `  -webkit-backdrop-filter: blur(var(--glass-blur-diff));`,
    `}`,
    `/* The host's own scroll-to-latest button on the conversation page (「回到底部」): it only appears once the reader`,
    `   has left the tail, and it paints from --dsw-alias-button-floating-fill, which nothing here dialled — the reader's`,
    `   「一直没加上」. It is chrome floating over the transcript, so it rides the LANE dial with the same floor our own`,
    `   「回到最新」 pill uses: an affordance that can be dialled out of sight is a trap, and this one appears exactly when`,
    `   the reader may need it. Found by its local class name because the host publishes no attribute on it; the scope is`,
    `   the conversation scroller, which is where the host renders it. */`,
    `${GATE} [data-conversation-scroll] button[class*="_toBottom"] {`,
    `  background: color-mix(in srgb, var(--dsw-alias-bg-base) max(var(--glass-lane, 20%), 20%), transparent);`,
    `  /* Three quarters of the lane's frost, exactly like our own 「回到最新」 pill in the reading view: the two are the`,
    `     same affordance on the two pages, so they flare the same way and share the floor above. */`,
    `  backdrop-filter: blur(calc(var(--glass-blur-lane) * 0.75));`,
    `  -webkit-backdrop-filter: blur(calc(var(--glass-blur-lane) * 0.75));`,
    `}`,
    `${GATE} [data-conversation-scroll] button[class*="_toBottom"]:hover {`,
    `  background: color-mix(in srgb, var(--dsw-alias-bg-base) min(100%, max(var(--glass-lane, 20%), 20%) + 15%), transparent);`,
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
