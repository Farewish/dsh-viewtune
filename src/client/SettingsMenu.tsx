import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { IconSettingsOutline14, Switch, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  bindingFromEvent, parseShortcut, shortcutLabel, shortcutProblem,
} from './shortcuts.js';
import type { ShortcutAction, ShortcutProblem } from './shortcuts.js';
import css from './Reader.module.css';

/** The panel's pages, in the order they are offered. */
const PAGES = [['visual', '视效'], ['shortcuts', '快捷键']] as const;
type SettingsPage = (typeof PAGES)[number][0];

/**
 * One row per bindable action. `other` is the binding a new combination must not collide with, and
 * `note` is what the row carries as its `title`, so it describes the action rather than the keys.
 */
const SHORTCUT_ROWS: readonly { action: ShortcutAction; label: string; note: string; other: ShortcutAction }[] = [
  { action: 'collapseTurn', label: '收起本轮的过程', note: '折起你正在看的那一轮', other: 'collapseAll' },
  { action: 'collapseAll', label: '收起全部过程', note: '把所有展开的轮次一起折起', other: 'collapseTurn' },
];

/** Why a combination was refused, in the reader's words rather than the model's. */
const PROBLEM_COPY: Record<ShortcutProblem, string> = {
  modifier: '需要至少一个修饰键：Alt / Ctrl / Cmd',
  reserved: '这个组合被浏览器占用，换一个吧',
  taken: '这个组合已经给了另一个动作',
};

/** A binding shown after the action it runs, or nothing when the slot is cleared. */
const keyHint = (binding: string): string => parseShortcut(binding) === null ? '' : `（${shortcutLabel(binding)}）`;

/** What 动效 does, carried as the row's own `title` rather than a line under the label. */
const MOTION_HINT = '新到文字柔和显现，过程平滑展开';
/** …unless the system's request is what is deciding, which is state and stays in line. */
const MOTION_OVERRIDE = '已按系统的「减少动态效果」关闭';
/** The button's accessible name and its hover box: the toolbar's other buttons carry a `title` too,
 * so this one keeps the browser's own box rather than growing a second kind of hover language. */
const BUTTON_HINT = 'viewtune 设置';

/**
 * The reading view's settings, behind one toolbar button: "viewtune" and a gear.
 *
 * The toolbar is a pinned lane with a stated geometry — its clearance above and below 收起, its
 * divider and the pill's outline are all asserted — and every control added to it takes horizontal
 * room away from 「收起」. So a setting is a ROW in here rather than another control up there, and a
 * new subject is a PAGE rather than a longer scroll.
 *
 * This is a disclosure, not a modal: a small popover under its own button, with the document
 * behind it still readable and nothing trapped. The button carries `aria-expanded`/`aria-controls`,
 * the panel follows DOM order so Tab reaches it right after the button, Escape closes it and hands
 * focus back to the button, and a pointer down anywhere else closes it.
 *
 * Every row carries a one-line description, and that description rides on the row's own `title` —
 * the browser's box, the same mechanism the button and 「收起」 use, so the whole view has ONE hover
 * language and there is no second box to draw, position, theme or animate. A row is a control, not
 * an explanation: the label says what the row is, the explaining copy takes no line of its own, and
 * a row is one line tall whether or not it has a description. It is the ROW that carries it rather
 * than its label, so the pointer anywhere on the row raises it.
 *
 * What that trades away, since it is a choice rather than a free lunch: the browser's box arrives on
 * its own delay, wears the browser's style rather than the theme's, appears reliably only for a
 * pointer (whether keyboard focus shows it is the browser's call, and touch has no hover), and does
 * not reach assistive technology — a row is not a focusable element, so a screen reader has nothing
 * to describe.
 *
 * Lines that are NOT descriptions stay in line: the switch being overridden by the system, what to
 * press while recording, why a combination was refused. Those are states the reader is acting on,
 * and a hover box is the wrong place for them. Such a row carries no `title` at all while its state
 * line is showing: the sentence is already on screen, and a tooltip repeating it would only cover
 * what the reader is answering.
 *
 * The pages are a real tablist — `role="tab"` with a roving tabindex, the arrows and Home/End
 * moving focus and selection together — which is the same shape the tool ledger uses for its own
 * tabs. A settings panel with two pages should not be the one place in this view where a keyboard
 * reader has to guess.
 */
export function SettingsMenu({ motion, preference, onChange, shortcuts, onShortcut, buttonRef }: {
  /** Whether animation actually runs: the preference with the system's request folded in. */
  motion: boolean;
  /** The stored motion preference, which is what the switch shows. */
  preference: boolean;
  onChange: (next: boolean) => void;
  /** The bindings in force, defaults already resolved by the caller. */
  shortcuts: Readonly<Record<ShortcutAction, string>>;
  /** Record a new binding, or clear one with an empty string. */
  onShortcut: (action: ShortcutAction, value: string) => void;
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
  /** Which page is showing. Navigation state, not a preference: it is not persisted. */
  const [page, setPage] = useState<SettingsPage>('visual');
  /** The action whose combination is being recorded, if any. */
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  /** The last refusal, so the row can say why instead of silently ignoring the keys. */
  const [problem, setProblem] = useState<{ action: ShortcutAction; code: ShortcutProblem } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = useId();

  // The two ways out. Outside-pointer dismissal is the product's own hook; Escape needs its own
  // handler because it also has to hand focus back — a keyboard reader can be inside the panel when
  // it goes away, and a removed element cannot hold focus. A recording swallows its own Escape.
  useDismissOnOutsidePointer(wrap, open, setOpen);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, buttonRef]);

  const toggle = () => {
    const next = !open;
    if (next) setReveal(motion);
    setOpen(next);
  };

  /** Select a page and move focus with it (the automatic-activation pattern the ledger tabs use). */
  const activate = (index: number) => {
    const at = (index + PAGES.length) % PAGES.length;
    setPage(PAGES[at]![0]);
    tabs.current[at]?.focus();
  };

  const stopRecording = () => { setRecording(null); setProblem(null); };

  /** Whether the system's request, not this preference, is what decides the motion. */
  const overridden = preference && !motion;

  /**
   * The recording owns the keyboard while it runs: the combination being typed must not also fire
   * the combination already in force, and Escape here means "cancel" rather than "close the panel".
   * Backspace and Delete clear the slot, which is the same thing the row's own 清除 does.
   */
  const capture = (action: ShortcutAction, other: ShortcutAction) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stopRecording(); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { stopRecording(); onShortcut(action, ''); return; }
    const text = bindingFromEvent(event);
    if (text === null) { setProblem({ action, code: 'modifier' }); return; }
    const refusal = shortcutProblem(text, shortcuts[other] ?? null);
    if (refusal !== null) { setProblem({ action, code: refusal }); return; }
    stopRecording();
    onShortcut(action, text);
  };

  return <div className={css.settingsWrap} ref={wrap}>
    <button ref={buttonRef} type="button" className={`${css.textButton} ${css.settingsButton}`}
      aria-expanded={open} aria-controls={panelId} aria-label={BUTTON_HINT} title={BUTTON_HINT}
      onClick={toggle}>
      viewtune<IconSettingsOutline14 size={12} />
    </button>
    {open && <div id={panelId} className={reveal ? `${css.settingsPanel} ${css.settingsPanelIn}` : css.settingsPanel} role="group" aria-label="viewtune 设置" data-ud-check="reader-settings">
      <div className={css.settingsTabs} role="tablist" aria-label="设置分类" data-ud-check="reader-settings-tabs" data-settings-page={page}
        onKeyDown={event => {
          const index = PAGES.findIndex(item => item[0] === page);
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); activate(index + (event.key === 'ArrowRight' ? 1 : -1)); }
          else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); activate(event.key === 'Home' ? 0 : PAGES.length - 1); }
        }}>
        {PAGES.map(([id, title], index) => <button key={id} ref={element => { tabs.current[index] = element; }} type="button" role="tab"
          id={`${panelId}-${id}`} aria-selected={page === id} aria-controls={`${panelId}-page`} tabIndex={page === id ? 0 : -1}
          className={css.settingsTab} onClick={() => { stopRecording(); setPage(id); }}>{title}</button>)}
      </div>
      <div id={`${panelId}-page`} role="tabpanel" aria-labelledby={`${panelId}-${page}`}>
        {page === 'visual'
          ? <div className={css.settingsRow} title={overridden ? undefined : MOTION_HINT}>
            <span className={css.settingsCopy}>
              <span className={css.settingsLabel}>动效</span>
              {overridden && <span className={css.settingsNote}>{MOTION_OVERRIDE}</span>}
            </span>
            {/* The preference is what the switch shows; `motion` above is what the reader actually
                gets, which the note explains when the system overrides it. */}
            <Switch checked={preference} onChange={onChange} label="动效" />
          </div>
          : <div className={css.settingsShortcuts} data-ud-check="reader-settings-shortcuts">
            {SHORTCUT_ROWS.map(({ action, label, note, other }) => {
              const binding = shortcuts[action] ?? '';
              const refusal = problem?.action === action ? problem.code : null;
              const isRecording = recording === action;
              /** The state line this row is showing, if it has one. */
              const state = isRecording
                ? '按下新的组合…（Esc 取消，Backspace 清除）'
                : refusal === null ? null : PROBLEM_COPY[refusal];
              return <div key={action} className={css.settingsRow} title={state === null ? note : undefined}>
                <span className={css.settingsCopy}>
                  <span className={css.settingsLabel}>{label}</span>
                  {state !== null && <span className={css.settingsNote}>{state}</span>}
                </span>
                <span className={css.settingsKeys}>
                  <button type="button" className={css.shortcutKey} data-recording={isRecording || undefined}
                    aria-label={`${label}的快捷键：${shortcutLabel(binding)}，按下可修改`}
                    onKeyDown={isRecording ? capture(action, other) : undefined}
                    onBlur={() => { if (isRecording) stopRecording(); }}
                    onClick={() => { if (isRecording) stopRecording(); else { setProblem(null); setRecording(action); } }}>
                    {isRecording ? '按下…' : shortcutLabel(binding)}
                  </button>
                  {binding !== '' && <button type="button" className={css.shortcutClear} aria-label={`清除${label}的快捷键`}
                    onClick={() => { stopRecording(); onShortcut(action, ''); }}>清除</button>}
                </span>
              </div>;
            })}
          </div>}
      </div>
    </div>}
  </div>;
}
