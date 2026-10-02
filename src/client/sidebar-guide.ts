/**
 * 「开始」 — the shipped guide tab — and when a deliverable opening into the sidebar may take its place.
 *
 * The reader asked for a mechanism: when a deliverable opens in the sidebar and the column holds ONLY the 开始 page,
 * close that page. The host has a proper face for this rather than a DOM trick, measured from the sidebar package's own
 * service types (`lib/types/client/service.d.ts`):
 *
 *   · `ctx.sidebarRight` — `ISidebarRight`: `active()`, `tabsIn(sessionId)`, `openResource(address, options?)`, `close`,
 *     `closeTarget`, … The column's navigation controller, and the same one the host's own file links use.
 *   · `openResource`'s `replaceTab` option — "Take this tab's place — its pane and its strip slot — and close it in the
 *     same step." That is this mechanism in one step, so nothing has to be closed and re-opened.
 *   · `GUIDE_ID` — the guide type's identity, a published constant in
 *     `lib/types/client/tabs/guide/definition.d.ts`: `@deepseek-ai/dsh-client-ui-sidebar-right/guide`.
 *
 * `close(tabId)` deliberately does NOT remove a sole guide ("the sole docked guide remains open" — it is the empty pane's
 * own placeholder), which is why replacing is the right verb here rather than closing.
 *
 * The condition is the reader's, word for word: ONLY the guide. So a face that cannot say what else is open is not
 * trusted to say that nothing else is — `replaceableGuide` does nothing without a tab list.
 */
export const SIDEBAR_GUIDE_ID = '@deepseek-ai/dsh-client-ui-sidebar-right/guide';

/** The fields of a tab record this module reads (the dock kit's own `TabRecord` carries more). */
export interface SidebarTabLike {
  readonly id?: string;
  readonly kind?: string;
}

/** Whether a tab record is the shipped 「开始」 guide. */
export function isGuideTab(tab: SidebarTabLike | undefined): boolean {
  return tab?.kind === SIDEBAR_GUIDE_ID || tab?.id === SIDEBAR_GUIDE_ID;
}

/**
 * The id of the guide tab a deliverable may replace, or `undefined` to leave the column alone.
 *
 * `tabs` is every committed tab of the session the column is drawing; `active` is the one on top. Both are consulted,
 * because a record with no `id` is still identifiable by `kind` through `active` — and `undefined` is returned whenever
 * anything is uncertain: no tab list, more than one tab, or a single tab that is not the guide.
 */
export function replaceableGuide(tabs: readonly SidebarTabLike[] | undefined, active: SidebarTabLike | undefined): string | undefined {
  if (tabs === undefined || tabs.length !== 1) return undefined;
  const only = tabs[0];
  if (!isGuideTab(only) || !isGuideTab(active ?? only)) return undefined;
  const id = only?.id ?? active?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}
