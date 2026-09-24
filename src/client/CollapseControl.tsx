/**
 * One collapse control where there used to be two.
 *
 * The two buttons could not be laid out side by side at every width: the reading column's left edge sits at
 * most about one control's width from the window edge, so with the column at its widest the second button
 * ran off the edge — and the first had already been nudged outward as far as it would go, because a
 * translucent toolbar resting over prose is what started the nudging. One control is therefore the only
 * layout that fits, and it is also the one that stops either action being hidden behind the other.
 *
 * What it shows follows the SAME two conditions the pair used, not new ones: `data-reader-collapse` was
 * gated on the turn in view having something open, `data-reader-collapse-all` on other turns having
 * something open. When only one applies the button simply IS that action (no caret, nothing to choose);
 * when both apply the main action is 收起 — the narrower one — and the caret offers 收起全部 beside it.
 * The single-action modes pin the button to one of them and are the reader's own call in the settings.
 *
 * The second control is a DIRECT action, not a menu: the reader asked for the double chevron to collapse
 * everything on the first click (and for it to carry 收起全部's own tooltip word for word). That is one
 * click fewer and one piece of machinery fewer — no `aria-haspopup`, no menu roles, no Escape handling, no
 * dismissal watcher — and the two chevrons stacked on the button are what say which action it is, the same
 * way the main button's single chevron says 收起.
 *
 * The keyboard bindings are the actions' own and stay bound to the actions (collapseTurn / collapseAll),
 * which is why each control advertises the binding of what it will actually do.
 */
import type { CollapseMode } from './collapse-mode.js';
import css from './Reader.module.css';

export interface CollapseControlProps {
  mode: CollapseMode;
  /** Whether the turn in view has anything open — 收起本轮 applies. */
  currentOpen: boolean;
  /** Whether turns OTHER than the one in view have something open — 收起全部 applies. */
  othersOpen: boolean;
  /** The two bindings, as the reader has them, for the tooltips and `aria-keyshortcuts`. */
  turnKey: string;
  allKey: string;
  keyHint: (binding: string) => string;
  /** Called before either action: collapsing hides the button, so focus has to be handed on (Reader does). */
  remember: () => void;
  collapseCurrent: () => void;
  collapseAll: () => void;
}

export function CollapseControl({ mode, currentOpen, othersOpen, turnKey, allKey, keyHint, remember, collapseCurrent, collapseAll }: CollapseControlProps) {
  // The pair's conditions, narrowed by the mode. `all` and `current` mean "only this action", so the other
  // one's condition is not consulted at all — in those modes the button is that action or it is nothing.
  const showCurrent = mode !== 'all' && currentOpen;
  const showAll = mode !== 'current' && othersOpen;
  const on = showCurrent || showAll;
  // Which action the button IS. With neither applicable it stays 收起, which is invisible either way.
  const primary: 'current' | 'all' = showCurrent ? 'current' : 'all';
  // The second control exists only when there is a second action to take — that is exactly when both
  // conditions hold, and it never has to offer a choice of one.
  const both = on && primary === 'current' && showAll;
  const allLabel = `收起所有已展开的过程${keyHint(allKey)}`;
  const act = (): void => {
    remember();
    if (primary === 'current') collapseCurrent();
    else collapseAll();
  };
  const binding = primary === 'current' ? turnKey : allKey;
  // The label is CONSTANT, and that is the whole point of it: the gutter is about as wide as the two-glyph
  // 收起 pill, so a four-glyph 全部收起 could never fit there at the widest reading column (measured: it
  // ran over the prose). Which action the button is, therefore, rides the chevrons — one ˄ for 收起本轮,
  // two stacked for 收起全部, the same language the second control speaks — and the words live in the title
  // and the accessible name, where they cost no width.
  const title = primary === 'current'
    ? `收起当前这一轮的过程${keyHint(turnKey)}`
    : allLabel;

  return (
    <span className={css.collapseGroup}
      data-reader-collapse-split={both ? 'true' : 'false'}
      data-reader-collapse-action={primary}>
      {/* Always rendered, merely hidden when nothing applies — that is what keeps the enter/exit animation
          alive, and it is asserted (a button that unmounts cannot play its exit).
          The visible text is decoration and is hidden from assistive tech; the button's own label carries
          the words, because the three segments are animated independently and their reading order is not
          the sentence a screen reader should hear. */}
      <button type="button" className={css.collapseControl} hidden={!on}
        data-reader-collapse={on ? 'open' : 'idle'}
        aria-keyshortcuts={binding || undefined} aria-label={title} title={title} onClick={act}>
        <span aria-hidden="true" className={css.collapseStage}>
          <span className={css.collapseAllWord}>全部</span>
          <span className={css.collapseKeeping}>收起</span>
          <span className={css.collapseOneChevron}>˄</span>
        </span>
      </button>
      {/* The second control is a DIRECT action, not a menu (the reader asked for one click and for 收起全部's
          own tooltip, word for word). It is absolutely positioned over the right end of the fixed stage, so
          the pill is one width in every state — see the CSS. */}
      <button type="button" className={css.collapseMore} data-reader-collapse-more=""
        data-reader-collapse-more-active={both ? 'true' : 'false'}
        aria-hidden={both ? undefined : true} tabIndex={both ? undefined : -1}
        aria-keyshortcuts={both ? (allKey || undefined) : undefined}
        aria-label={allLabel} title={allLabel}
        onClick={() => { remember(); collapseAll(); }}>
        <span aria-hidden="true" className={css.collapseChevrons}><span>˄</span><span>˄</span></span>
      </button>
    </span>
  );
}
