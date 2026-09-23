/**
 * What the toolbar's collapse button DOES.
 *
 * Two actions now live on one button, and the reason is arithmetic rather than taste: the reading column's
 * left edge is at most about one control's width from the window edge, so when the column is at its widest
 * there is room for exactly one control there. With two, the second ran off the edge (reported), and the
 * first had already been nudged outward as far as it could go — a translucent toolbar sitting over prose is
 * a nuisance, which is what started the nudging.
 *
 * `both` is the default and reproduces the pair of buttons exactly: a main action plus a caret, so nothing
 * becomes unreachable. The single-action modes are for a reader who only ever uses one — and even then the
 * other action stays on its keyboard binding, because those bindings are bound to the ACTIONS, not to this
 * button (see shortcuts.ts).
 */
export type CollapseMode = 'current' | 'all' | 'both';

/** The three modes, in the order the settings row offers them. */
export const COLLAPSE_MODES: readonly { readonly id: CollapseMode; readonly label: string }[] = [
  { id: 'current', label: '只收起本轮' },
  { id: 'all', label: '只收起全部' },
  { id: 'both', label: '二选一（收起 + 箭头）' },
];

/**
 * The mode a stored value means.
 *
 * Anything that is not one of the two single-action modes is `both`, which is also what a record written
 * before this setting existed carries: the pair of buttons was the behaviour then, and the merged button
 * must not silently take an action away from a reader who never asked.
 */
export function collapseModeOf(value: unknown): CollapseMode {
  return value === 'current' || value === 'all' ? value : 'both';
}
