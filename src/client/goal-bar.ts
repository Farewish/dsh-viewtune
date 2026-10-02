/**
 * The host's goal bar above the composer, expanded and collapsed.
 *
 * WHY. The host renders one line — `white-space: nowrap; text-overflow: ellipsis; overflow: hidden` on its objective
 * span, inside a bar pinned to `height: 36px` — and publishes no `title` and no affordance of its own, so a long goal
 * cannot be read in full anywhere. The reader's report is exactly that: 「超出的字会用「……」省略，没有办法完整预览」.
 *
 * HOW, and what this deliberately does NOT do. The bar is the host's own component, and its React tree re-renders on
 * every goal change: a node this plugin INSERTED would be dropped by the next render and would have to be re-attached
 * forever. So nothing is inserted. Instead a click toggles ONE attribute on the document element
 * (`data-viewtune-goal-expanded`) and the stylesheet below does the rest — the same division of labour as the wallpaper
 * and the skin, both of which are also an attribute plus rules. The click is delegated from the view, for the same
 * reason: the element it acts on does not exist yet when this module is installed, and the host replaces it whenever it
 * re-renders.
 *
 * WHAT COUNTS AS THE CONTROL. `data-goal-bar` — the hook the package publishes on the bar itself — is the CLICK
 * TARGET, and everything interactive inside it is excluded: the resume / edit / pause / clear buttons, and the edit
 * field while it is open. Scoping it this way rather than to the objective's own class has two consequences worth
 * stating: it does not depend on a build-minted class name, and the little marker at the end of the bar (a
 * `pointer-events: none` pseudo-element) is clickable too, because its click lands on the bar.
 *
 * A DRAG IS NOT A CLICK. Selecting part of the goal to copy it ends with a click event too, and collapsing the bar at
 * that moment would be hostile — the reader was copying text, not folding it away. A non-collapsed selection therefore
 * cancels the toggle.
 *
 * The state is a MODE, not a preference: it lives for the session and resets on reload, which is what fits a control
 * that says "show me this now". It is inert when there is no goal bar on the page at all.
 */
export const GOAL_EXPANDED_ATTRIBUTE = 'data-viewtune-goal-expanded';

/** The hook the goal package publishes on its bar (`@deepseek-ai/dsh-client-ui-goal`). */
export const GOAL_BAR_SELECTOR = '[data-goal-bar]';

/**
 * What inside the bar is NOT the control.
 *
 * Element KINDS rather than the host's class names, because those are minted per build. Kept as a LIST rather than one
 * combined selector so each kind can be pinned on its own: the four icon actions are buttons, the edit field is a form
 * control, and a test that could only say "something interactive" would not be able to tell those two regressions
 * apart.
 */
export const GOAL_BAR_INTERACTIVE: readonly string[] = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
];

export const GOAL_BAR_STYLE_ID = 'dsh-viewtune-goal-bar';

/** The shape this module needs of a click target — duck-typed, so a test can pass a fake instead of a DOM element. */
export interface GoalClickTarget {
  closest: (selector: string) => unknown;
}

function isGoalClickTarget(value: unknown): value is GoalClickTarget {
  return typeof value === 'object' && value !== null && typeof (value as GoalClickTarget).closest === 'function';
}

/**
 * Whether this click belongs to the control.
 *
 * `selectionCollapsed` is the caller's reading of the current selection: `false` means the reader has text selected,
 * which is a drag that happens to end in a click.
 */
export function goalClickToggles(target: unknown, selectionCollapsed: boolean): boolean {
  if (!selectionCollapsed) return false;
  if (!isGoalClickTarget(target)) return false;
  if (target.closest(GOAL_BAR_SELECTOR) === null) return false;
  return !GOAL_BAR_INTERACTIVE.some(selector => target.closest(selector) !== null);
}

/** The document element's own attribute interface, and nothing else — again so a test needs no DOM. */
export interface GoalAttributeRoot {
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
}

/**
 * Flip the mode, or set it outright when `expanded` is given. Returns the state it leaves behind, so a caller (and a
 * test) can see what happened without reading the attribute back.
 */
export function toggleGoalBar(root: GoalAttributeRoot, expanded?: boolean): boolean {
  const next = expanded ?? !root.hasAttribute(GOAL_EXPANDED_ATTRIBUTE);
  if (next) root.setAttribute(GOAL_EXPANDED_ATTRIBUTE, '');
  else root.removeAttribute(GOAL_EXPANDED_ATTRIBUTE);
  return next;
}

/**
 * The stylesheet: three subjects, and the host's own numbers kept where nothing needs to change.
 *
 * The measured shape being overridden is the package's `GoalBar.module.css`: `.bar { height: 36px; align-items: center }`
 * and `.objective { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; flex: 1 }`. So the expanded bar
 * becomes `height: auto` with a `min-height` of the host's own 36px, its children align to the TOP (a 28px button
 * centred on a tall bar floats in the middle of the text, which reads as a mistake), and the objective wraps with a
 * ceiling and a scrollbar so a very long goal cannot take the screen.
 *
 * The marker uses the bar's `::after` — `::before` is the host's plate — and is drawn with borders rather than a glyph,
 * for the reason the collapse control learned the hard way: a text chevron's weight and alignment belong to whatever
 * font is in force. `pointer-events: none` keeps it out of the way of the click, which lands on the bar underneath it.
 */
export function goalBarCss(): string {
  // Why the expanded geometry is what it is, recorded HERE rather than as comments inside the array below: a backtick
  // in one of those comments closes the template literal it lives in, and this file's build failed three times for
  // exactly that reason while two attempts at the fix each left a different backtick behind. Down here backticks are
  // ordinary characters.
  //
  //   · the host pins `.nLMEza_bar` to `height: 36px`, so the expanded state has to say `height: auto` — and, because
  //     the reader saw the objective WRAP while the bar stayed one line high, it says it with `!important` as well.
  //     There are only two ways that report can be true: something outranks this rule (in which case the wrap it
  //     plainly performed came from this same block, so the block IS applied — and `!important` settles it anyway), or
  //     the growth happens and is covered by the composer, which sits below the dock in the same seat. The first is
  //     what the `!important`s are for; the second is what releasing the DOCK's height is for.
  //   · the dock (`.nLMEza_dock`) carries no height today — width and margin only, measured — but it is created by the
  //     `conversation.input.dock` slot, whose wrapper belongs to the composer, and a fixed height anywhere up that
  //     chain would clip the growth to one line while the objective wrapped happily inside it. So the rule releases it
  //     defensively, scoped by `:has(> [data-goal-bar])` so no other dock in the app is touched.
  //   · the objective swaps `nowrap`/`ellipsis` for wrapping with a `40vh` ceiling and its own scrollbar, and the
  //     children align to the TOP: a 28px action button centred on a tall bar reads as a mistake.
  //   · the marker is drawn with borders rather than a glyph, for the reason the collapse control learned: a text
  //     chevron's weight and alignment belong to whatever font is in force.
  return [
    `/* Say it can be clicked, collapsed and expanded alike. */`,
    `${GOAL_BAR_SELECTOR} [class*="_objective"]:not([class*="_objectiveInput"]) { cursor: pointer; }`,
    `/* The marker: a flex item at the end of the bar, after the actions. */`,
    `${GOAL_BAR_SELECTOR}::after {`,
    `  content: '';`,
    `  flex: none;`,
    `  align-self: center;`,
    `  width: 6px;`,
    `  height: 6px;`,
    `  margin-left: 8px;`,
    `  border-right: 1.5px solid var(--dsw-alias-label-tertiary);`,
    `  border-bottom: 1.5px solid var(--dsw-alias-label-tertiary);`,
    `  transform: translateY(-2px) rotate(45deg);`,
    `  transition: transform 120ms ease;`,
    `  pointer-events: none;`,
    `}`,
    `html[${GOAL_EXPANDED_ATTRIBUTE}] ${GOAL_BAR_SELECTOR}::after { transform: translateY(2px) rotate(-135deg); }`,
    `/* Expanded: the bar grows, the objective wraps, and everything else stays on the first line. The DOCK is released
       too, and defensively: it carries no height today (measured — nLMEza_dock is width and margin only), but the
       bar is rendered into a slot (conversation.input.dock) whose wrapper belongs to the composer, and a fixed height
       anywhere up that chain would clip the growth to one line while the objective happily wrapped inside it. */`,
    `html[${GOAL_EXPANDED_ATTRIBUTE}] [class*="_dock"]:has(> ${GOAL_BAR_SELECTOR}) { height: auto; max-height: none; }`,
    `html[${GOAL_EXPANDED_ATTRIBUTE}] ${GOAL_BAR_SELECTOR} {`,
    `  height: auto !important;`,
    `  min-height: 36px !important;`,
    `  max-height: none !important;`,
    `  align-items: flex-start !important;`,
    `  padding-top: 6px;`,
    `  padding-bottom: 6px;`,
    `}`,
    `html[${GOAL_EXPANDED_ATTRIBUTE}] ${GOAL_BAR_SELECTOR} [class*="_objective"]:not([class*="_objectiveInput"]) {`,
    `  white-space: normal;`,
    `  text-overflow: clip;`,
    `  overflow: visible;`,
    `  overflow-wrap: anywhere;`,
    `  max-height: 40vh;`,
    `  overflow-y: auto;`,
    `}`,
    `/* The marker is the one animated thing here, and a reader who asked for less movement gets none of it. */`,
    `@media (prefers-reduced-motion: reduce) {`,
    `  ${GOAL_BAR_SELECTOR}::after { transition: none; }`,
    `}`,
  ].join('\n');
}

/**
 * Install the stylesheet and the delegated click, and hand back the disposer `ctx.effect` requires.
 *
 * Capture phase, like the composer wheel's guard: a host handler that stopped propagation must not be able to make the
 * control dead.
 */
export function installGoalBar(doc: Document): () => void {
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', GOAL_BAR_STYLE_ID);
  style.textContent = goalBarCss();
  doc.head.append(style);
  const view = doc.defaultView;
  if (view === null) return () => { style.remove(); };
  const onClick = (event: MouseEvent): void => {
    const selection = view.getSelection();
    // A drag that selects text ends in a click too, and the reader was copying the goal rather than folding it away.
    const collapsed = selection === null || selection.isCollapsed;
    if (!goalClickToggles(event.target, collapsed)) return;
    toggleGoalBar(doc.documentElement);
  };
  view.addEventListener('click', onClick, { capture: true });
  return () => {
    view.removeEventListener('click', onClick, { capture: true });
    style.remove();
  };
}
