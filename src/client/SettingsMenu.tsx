import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { IconSettingsOutline14, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './Reader.module.css';

/**
 * The reading view's settings, behind one toolbar button: "viewtune" and a gear.
 *
 * The toolbar is a pinned lane with a stated geometry — its clearance above and below 收起, its
 * divider and the pill's outline are all asserted — and every control added to it takes horizontal
 * room away from 「收起」. So a setting is a ROW in here rather than another control up there. The
 * motion preference, which used to be the toolbar's second control, is the first row; the next
 * preference is a `settingsRow` next to it, not a new thing in the lane.
 *
 * This is a disclosure, not a modal: a small popover under its own button, with the document
 * behind it still readable and nothing trapped. The button carries `aria-expanded`/`aria-controls`,
 * the panel follows DOM order so Tab reaches the row right after the button, Escape closes it and
 * hands focus back to the button, and a pointer down anywhere else closes it.
 */
export function SettingsMenu({ motion, preference, onChange, buttonRef }: {
  /** Whether animation actually runs: the preference with the system's request folded in. */
  motion: boolean;
  /** The stored preference, which is what the switch shows. */
  preference: boolean;
  onChange: (next: boolean) => void;
  buttonRef: RefObject<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Whether THIS opening animates, decided when it opens.
   *
   * A CSS gate on the animation property cannot be used here: `[data-motion=off] … { animation: none }`
   * re-applies the animation the instant that gate lifts, so turning 动效 on from inside this very
   * panel replayed its entrance as a flash. Freezing the decision per opening keeps the switch from
   * touching the panel at all, and it still respects the preference (and the system's request, which
   * `motion` already folds in) for the next time it opens.
   */
  const [reveal, setReveal] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // The two ways out. Escape also has to hand focus back: a pointer user leaves focus on the button
  // anyway, but a keyboard user can be inside the panel when it closes, and a removed element
  // cannot hold focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, buttonRef]);

  const toggle = () => {
    const next = !open;
    if (next) setReveal(motion);
    setOpen(next);
  };

  return <div className={css.settingsWrap} ref={wrap}>
    <button ref={buttonRef} type="button" className={`${css.textButton} ${css.settingsButton}`}
      aria-expanded={open} aria-controls={panelId} aria-label="viewtune 设置" title="viewtune 设置"
      onClick={toggle}>
      viewtune<IconSettingsOutline14 size={12} />
    </button>
    {open && <div id={panelId} className={reveal ? `${css.settingsPanel} ${css.settingsPanelIn}` : css.settingsPanel} role="group" aria-label="viewtune 设置" data-ud-check="reader-settings">
      <div className={css.settingsRow}>
        <span className={css.settingsCopy}>
          <span className={css.settingsLabel}>动效</span>
          <span className={css.settingsNote}>{preference && !motion
            ? '已按系统的「减少动态效果」关闭'
            : '新到文字柔和显现，过程平滑展开'}</span>
        </span>
        {/* The preference is what the switch shows; `motion` above is what the reader actually gets,
            which the note explains when the system overrides it. */}
        <Switch checked={preference} onChange={onChange} label="动效" />
      </div>
    </div>}
  </div>;
}
