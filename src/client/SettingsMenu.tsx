import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { IconSettingsOutline14, Switch, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  bindingFromEvent, shortcutLabel, shortcutProblem,
} from './shortcuts.js';
import type { ShortcutAction, ShortcutProblem } from './shortcuts.js';
import { GLASS_PARTS } from './glass.js';
import { COLLAPSE_MODES, collapseModeOf } from './collapse-mode.js';
import type { CollapseMode } from './collapse-mode.js';
import { TEXT_CADENCES, textCadenceOf } from './text-cadence.js';
import type { TextCadence } from './text-cadence.js';
import { FOLLOW_MODES, followModeOf } from './reading-scroll.js';
import type { FollowMode } from './reading-scroll.js';
import { REASONING_FOLLOW_MODES, REASONING_RATES, reasoningFollowModeOf, reasoningRateOf } from './reasoning-follow.js';
import type { ReasoningFollowMode } from './reasoning-follow.js';
import { WallpaperSection } from './WallpaperSection.js';
import type { WallpaperScope } from './wallpaper-scope.js';
import css from './Reader.module.css';

/** The panel's pages, in the order they are offered: what it looks like, what it does, and what the keys are. */
const PAGES = [['visual', '视效'], ['features', '功能'], ['shortcuts', '快捷键']] as const;
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

/** What 动效 does, carried as the row's own `title` rather than a line under the label. */
const MOTION_HINT = '新到文字柔和显现，过程平滑展开';
/** …unless the system's request is what is deciding, which is state and stays in line. */
const MOTION_OVERRIDE = '已按系统的「减少动态效果」关闭';
/** The button's accessible name and its hover box: the toolbar's other buttons carry a `title` too,
 * so this one keeps the browser's own box rather than growing a second kind of hover language. */
const BUTTON_HINT = 'viewtune 设置';
/** What the frosted-glass skin does, as the row's `title` box. */
const GLASS_HINT = '卡片、工具框与代码块透出壁纸；小标签悬停时才显形';
/** What the skin's reach into the conversation view means, as that row's `title` box. */
const GLASS_CONVERSATION_HINT = '「对话」页里的代码块与用户气泡也跟着变';
/** Where a delivered file opens, as the row's `title` box. */
const OPEN_MODE_HINT = '打开后点产物文件用右侧栏预览，而不是系统程序';
/** What the toolbar's two column handles do with a wheel, as that row's `title` box. */
const STRIP_WHEEL_HINT = '在阅读列两边的竖条上滚动，正文也会跟着滚动';
/** What the two reveal cadences cost and buy, as that row's `title` box. */
const CADENCE_HINT = '跟随屏幕刷新可能严重影响性能';
/** What turning the reveal's blur off changes, as that row's `title` box. */
const REVEAL_BLUR_HINT = '开启会带来微小的视觉提升与性能影响';
/** What turning the per-word reveal itself off changes, as that row's `title` box. */
const REVEAL_WORDS_HINT = '关掉后文字直接出现，不再逐词淡入';
/** What the direct tail write changes, as that row's `title` box. */
const FOLLOW_MODE_HINT = '直接贴底：不再逐帧滑动，画面更省';
/** How the reasoning card moves, as that row's `title` box. */
const REASONING_FOLLOW_HINT = '自动滚动按阅读速度走；跟随最新停在最新一行';
/** What the pace governs, as that row's `title` box. */
const REASONING_RATE_HINT = '自动滚动时每秒前进的行数';
/** What the focused expansion does, as that row's `title` box. */
const FOCUS_EXPAND_HINT = '正在写入的思考卡随内容长高，最多到展开阅读那么高';

/**
 * A settings page grouped by subject: a hairline above the group, and a caption when the group's subject is not
 * already the label of the row that opens it.
 *
 * The 功能 page names its groups (a reader arrives there with a question, and the caption answers it), while 视效 is
 * divided by the surface each block is about — 磨砂玻璃 and 壁纸 both open with the switch that names them, so a
 * caption there would only repeat the row below it. Same rule, same hairline, caption optional.
 */
function Group({ caption }: { caption?: string }) {
  return <div className={css.settingsGroup} data-ud-check={caption === undefined ? 'reader-settings-divider' : 'reader-settings-group'}>{caption}</div>;
}

/**
 * The reading view's settings, behind one toolbar button: "viewtune" and a gear.
 *
 * The toolbar is a lane with a stated geometry — its clearance above and below 收起, its
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
 * tabs. A settings panel with more than one page should not be the one place in this view where a
 * keyboard reader has to guess.
 */
export function SettingsMenu({ motion, preference, onChange, glass, onGlass, glassConversation, onGlassConversation, conversationSolid, onConversationSolid, collapseMode, onCollapseMode, glassParts, onGlassPart, openInSidebar, onOpenInSidebar, stripWheel, onStripWheel, textCadence, onTextCadence, revealBlur, onRevealBlur, revealWords, onRevealWords, followMode, onFollowMode, autoCollapseEarlier, onAutoCollapseEarlier, reasoningFollow, onReasoningFollow, reasoningRate, onReasoningRate, focusExpand, onFocusExpand, wallpaper, wallpaperDim, onWallpaper, onWallpaperDim, wallpaperScope, wallpaperChrome, onWallpaperScope, onWallpaperChrome, shortcuts, onShortcut, buttonRef }: {
  /** Whether animation actually runs: the preference with the system's request folded in. */
  motion: boolean;
  /** The stored motion preference, which is what the switch shows. */
  preference: boolean;
  onChange: (next: boolean) => void;
  /** Whether the frosted-glass skin is on. */
  glass: boolean;
  onGlass: (next: boolean) => void;
  /** Whether that skin also reaches the host's conversation view. */
  glassConversation: boolean;
  onGlassConversation: (next: boolean) => void;
  /** Whether the conversation page is painted as a solid page of its own. */
  conversationSolid: boolean;
  onConversationSolid: (next: boolean) => void;
  /** What the merged collapse button does. */
  collapseMode: CollapseMode;
  onCollapseMode: (next: CollapseMode) => void;
  /** The skin's opacities, every part already resolved against its initial by the caller. */
  glassParts: Readonly<Record<string, number>>;
  /** Move one surface's opacity. */
  onGlassPart: (id: string, value: number) => void;
  /** Whether a delivered file opens in the right sidebar rather than the system app. */
  openInSidebar: boolean;
  onOpenInSidebar: (next: boolean) => void;
  /** Whether a wheel over the toolbar's two column handles is forwarded to the transcript. */
  stripWheel: boolean;
  onStripWheel: (next: boolean) => void;
  textCadence: TextCadence;
  onTextCadence: (next: TextCadence) => void;
  revealBlur: boolean;
  onRevealBlur: (next: boolean) => void;
  revealWords: boolean;
  onRevealWords: (next: boolean) => void;
  followMode: FollowMode;
  onFollowMode: (next: FollowMode) => void;
  autoCollapseEarlier: boolean;
  onAutoCollapseEarlier: (next: boolean) => void;
  reasoningFollow: ReasoningFollowMode;
  onReasoningFollow: (next: ReasoningFollowMode) => void;
  reasoningRate: number;
  onReasoningRate: (next: number) => void;
  focusExpand: boolean;
  onFocusExpand: (next: boolean) => void;
  /** The chosen wallpaper's file name in the plugin's folder, or `''` for none. */
  wallpaper: string;
  /** How far the wallpaper is mixed toward the theme's background. */
  wallpaperDim: number;
  onWallpaper: (name: string) => void;
  onWallpaperDim: (value: number) => void;
  /** Whether the wallpaper carries the whole window, or only the reading view. */
  wallpaperScope: WallpaperScope;
  /** How opaque the sidebar and the top bar stay while the window scope is on. */
  wallpaperChrome: number;
  onWallpaperScope: (scope: WallpaperScope) => void;
  onWallpaperChrome: (value: number) => void;
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
      <div id={`${panelId}-page`} role="tabpanel" aria-labelledby={`${panelId}-${page}`} className={css.settingsBody}>
        {page === 'visual'
          ? <>
            <div className={css.settingsRow} title={overridden ? undefined : MOTION_HINT}>
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>动效</span>
                {overridden && <span className={css.settingsNote}>{MOTION_OVERRIDE}</span>}
              </span>
              {/* The preference is what the switch shows; `motion` above is what the reader actually
                  gets, which the note explains when the system overrides it. */}
              <Switch checked={preference} onChange={onChange} label="动效" />
            </div>
            <Group />
            <div className={css.settingsRow} title={GLASS_HINT} data-ud-check="reader-settings-glass">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>磨砂玻璃</span>
              </span>
              {/* A skin, not a behaviour: it changes what the reader's surfaces are made of, so it
                  has nothing to report and no state line — the description is the row's `title`. */}
              <Switch checked={glass} onChange={onGlass} label="磨砂玻璃" />
            </div>
            {/* Where the skin REACHES, before how much it paints: the reading view is this plugin's own
                surface, the conversation page is the host's. Shown only while the skin is on, like the
                dials below — with the skin off there is nothing for it to decide. */}
            {glass && (
              <div className={`${css.settingsRow} ${css.settingsSubRow}`} title={GLASS_CONVERSATION_HINT}
                data-ud-check="reader-settings-glass-conversation">
                <span className={css.settingsCopy}>
                  <span className={css.settingsLabel}>为对话页启用</span>
                </span>
                <Switch checked={glassConversation} onChange={onGlassConversation} label="为对话页启用" />
              </div>
            )}
            {/* The skin's own dials, shown only while it is on: a surface's opacity means nothing
                with the skin off, and six dead rows would push everything below the fold. Each dial
                is one custom property on the root (see glass.ts), so the stylesheet stays
                declarative — and 0 is "the reader paints nothing here", which is where the skin
                starts for the surfaces that have no plate of their own anyway. */}
            {glass && GLASS_PARTS.map(part => (
              <div key={part.id} className={`${css.settingsRow} ${css.settingsSubRow}`} title={part.hint}
                data-ud-check={`reader-settings-glass-${part.id}`}>
                <span className={css.settingsCopy}>
                  <span className={css.settingsLabel}>{part.label}</span>
                </span>
                <span className={css.settingsRange}>
                  <input type="range" min={0} max={100} step={5} value={glassParts[part.id] ?? part.initial}
                    aria-label={`${part.label}的不透明度`}
                    onChange={event => { onGlassPart(part.id, Number(event.currentTarget.value)); }} />
                  <span className={css.settingsRangeValue}>{glassParts[part.id] ?? part.initial}%</span>
                </span>
              </div>
            ))}
            <Group />
            {/* The wallpaper: the folder's own images, then the scrim that keeps prose readable on
                one. It reads its list from the host half, so the row owns that fetch rather than
                taking a list through props nobody else needs. */}
            <WallpaperSection name={wallpaper} dim={wallpaperDim} onPick={onWallpaper} onDim={onWallpaperDim}
              scope={wallpaperScope} chrome={wallpaperChrome} onScope={onWallpaperScope} onChrome={onWallpaperChrome}
              solid={conversationSolid} onSolid={onConversationSolid} />
          </>
          : page === 'features'
          ? <>
            {/* This page is grouped by WHAT A SETTING AFFECTS, not by what it costs. A reader arrives with a question
                ("why does the card move?", "why does the text appear like that?") and finds the row under that
                heading; a 功能/性能 split would file the wallpaper and the reasoning card together and separate the two
                halves of one behaviour. A heading is a divider plus a caption, and a setting that only means something
                under another one is indented under it and greyed out while it does not apply. */}
            <Group caption="小功能" />
            <div className={css.settingsRow} title={STRIP_WHEEL_HINT} data-ud-check="reader-settings-strip-wheel">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>竖条滚轮</span>
              </span>
              <Switch checked={stripWheel} onChange={onStripWheel} label="竖条滚轮" />
            </div>
            <div className={css.settingsRow} title={OPEN_MODE_HINT} data-ud-check="reader-settings-openmode">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>产物用右侧栏打开</span>
              </span>
              <Switch checked={openInSidebar} onChange={onOpenInSidebar} label="产物用右侧栏打开" />
            </div>
            {/* No description on purpose: the label is the whole of it. */}
            <div className={css.settingsRow} data-ud-check="reader-settings-auto-collapse">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>自动收起更早流程</span>
              </span>
              <Switch checked={autoCollapseEarlier} onChange={onAutoCollapseEarlier} label="自动收起更早流程" />
            </div>
            <Group caption="正文显示" />
            <div className={css.settingsRow} title={REVEAL_WORDS_HINT} data-ud-check="reader-settings-reveal-words">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>逐词显现</span>
              </span>
              <Switch checked={revealWords} onChange={onRevealWords} label="逐词显现" />
            </div>
            {/* A sub-setting in the literal sense: the blur is part of the per-word reveal, so it is indented under it
                and greyed out while there is no per-word reveal to blur. */}
            <div className={`${css.settingsRow} ${css.settingsSubRow}`} title={REVEAL_BLUR_HINT} data-ud-check="reader-settings-reveal-blur"
              data-inactive={!revealWords}>
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>逐词显现的模糊</span>
              </span>
              <Switch checked={revealBlur} disabled={!revealWords} onChange={onRevealBlur} label="逐词显现的模糊" />
            </div>
            {/* How often a streaming message updates. It is about how the text is written out, which is why it sits in
                this group rather than with the behaving switches above. */}
            <div className={css.settingsRow} title={CADENCE_HINT} data-ud-check="reader-settings-cadence">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>正文更新节奏</span>
              </span>
              <select className={css.settingsSelect} value={textCadence} aria-label="正文更新节奏"
                onChange={event => { onTextCadence(textCadenceOf(event.currentTarget.value)); }}>
                {TEXT_CADENCES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            <Group caption="流程展示设置" />
            <div className={css.settingsRow} title={FOLLOW_MODE_HINT} data-ud-check="reader-settings-follow-mode">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>跟随到最新</span>
              </span>
              <select className={css.settingsSelect} value={followMode} aria-label="跟随到最新的方式"
                onChange={event => { onFollowMode(followModeOf(event.currentTarget.value)); }}>
                {FOLLOW_MODES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            {/* How the reasoning card moves. Independent of the focus expansion: both act on the card as it is now. */}
            <div className={css.settingsRow} title={REASONING_FOLLOW_HINT} data-ud-check="reader-settings-reasoning-follow">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>思考卡自动跟随</span>
              </span>
              <select className={css.settingsSelect} value={reasoningFollow} aria-label="思考卡的自动跟随方式"
                onChange={event => { onReasoningFollow(reasoningFollowModeOf(event.currentTarget.value)); }}>
                {REASONING_FOLLOW_MODES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            {/* The other literal sub-setting: a pace only exists for the mode that follows a pace. */}
            <div className={`${css.settingsRow} ${css.settingsSubRow}`} title={REASONING_RATE_HINT} data-ud-check="reader-settings-reasoning-rate"
              data-inactive={reasoningFollow !== 'auto'}>
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>自动滚动速度</span>
              </span>
              <select className={css.settingsSelect} value={reasoningRate} aria-label="自动滚动的速度" disabled={reasoningFollow !== 'auto'}
                onChange={event => { onReasoningRate(reasoningRateOf(Number(event.currentTarget.value))); }}>
                {REASONING_RATES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            {/* The one switch here that changes the SHAPE of the reading view rather than how something moves. */}
            <div className={css.settingsRow} title={FOCUS_EXPAND_HINT} data-ud-check="reader-settings-focus-expand">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>焦点思考展开</span>
              </span>
              <Switch checked={focusExpand} onChange={onFocusExpand} label="焦点思考展开" />
            </div>
          </>
          : <>
            {/* The collapse button's mode lives on the SHORTCUTS page rather than with the visual settings:
                it is about the control, and its two actions are the two bindings right below it. A native
                select because the choice is three named states, not a degree — and the one control here that
                is not a switch or a dial. No `title`: the three options are their own description, and the
                paragraph that used to ride here was an argument for merging the buttons in the first place. */}
            <div className={css.settingsRow} data-ud-check="reader-settings-collapse-mode">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>收起按钮</span>
              </span>
              <select className={css.settingsSelect} value={collapseMode} aria-label="收起按钮的行为"
                onChange={event => { onCollapseMode(collapseModeOf(event.currentTarget.value)); }}>
                {COLLAPSE_MODES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            <div className={css.settingsShortcuts} data-ud-check="reader-settings-shortcuts">
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
          </div>
          </>}
      </div>
    </div>}
  </div>;
}
