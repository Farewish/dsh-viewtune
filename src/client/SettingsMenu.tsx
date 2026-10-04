import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
// `IconSettingsOutline14` → `…Medium`: 0.2.0 renamed the icon set from drawn size to stroke weight (see ReferenceIcon).
// This is the one place in the plugin that keeps the heavier variant, and for a reason that is measured rather than
// stylistic: the platform's own settings surfaces (`dsh-client-ui-settings-general` / `-settings-account`) render
// `IconSettingsOutlineMedium` at 16px, and this gear is 12px — at that size the 1.3px stroke on a 16-viewBox lands at
// ~0.98px, which is exactly the weight of the `…Regular` glyph at the platform's 16px.
import { IconSettingsOutlineMedium, Switch, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  bindingFromEvent, shortcutLabel, shortcutProblem,
} from './shortcuts.js';
import type { ShortcutAction, ShortcutProblem } from './shortcuts.js';
import { GLASS_BLUR_MAX, GLASS_PARTS } from './glass.js';
import { COLLAPSE_MODES, collapseModeOf } from './collapse-mode.js';
import type { CollapseMode } from './collapse-mode.js';
import { TURN_FOLD_MAX, turnFoldOf } from './turn-fold.js';
import { DELIVERABLE_DISPLAYS, deliverableDisplayOf } from './deliverables.js';
import type { DeliverableDisplay } from './deliverables.js';
import { entryViewOf } from './entry-policy.js';
import type { EntryView } from './entry-policy.js';
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
/** What a wheel on the two strips does now that the App forwards it itself, as that row's `title` box. */
const STRIP_WHEEL_HINT = '开启时用缓动带走正文，关闭时用 App 原生的即时滚动';
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
/** What the turn window buys, as that row's `title` box: behaviour only, and short (the copy check caps it at 28). */
const FOLD_BEFORE_HINT = '只留最近这几轮，更早的用按钮取；0 是全部保留';
/** How the three ways of showing a turn's files differ, in the reader's own terms. */
const DELIVERABLE_DISPLAY_HINT = '简略更紧凑，详细更像原生卡片';
/** What the entry row changes, in the reader's own terms. */
const ENTRY_VIEW_HINT = '新会话先打开哪一页';
/** What the extra line buys, and that it only ever appears for a turn that committed. */
const RECORD_COMMITS_HINT = '顺带列出这一轮的 git 提交';
/** What the other switch changes, in the reader's own terms. */
const REVIEW_IN_SIDEBAR_HINT = '点差异时改在侧边栏打开审查页';
/** The frost rows, one per surface. Short because the row above it already says which surface is meant. */
const FROST_HINT = '0px 只有玻璃，往上才是磨砂';

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
export function SettingsMenu({ motion, preference, onChange, glass, onGlass, glassConversation, onGlassConversation, conversationSolid, onConversationSolid, collapseMode, onCollapseMode, glassParts, onGlassPart, glassBlur, onGlassBlur, openInSidebar, onOpenInSidebar, deliverableDisplay, onDeliverableDisplay, entryView, onEntryView, recordCommits, onRecordCommits, reviewInSidebar, onReviewInSidebar, stripWheel, onStripWheel, textCadence, onTextCadence, revealBlur, onRevealBlur, revealWords, onRevealWords, followMode, onFollowMode, autoCollapseEarlier, onAutoCollapseEarlier, collapseBefore, onCollapseBefore, reasoningFollow, onReasoningFollow, reasoningRate, onReasoningRate, focusExpand, onFocusExpand, wallpaper, wallpaperDim, onWallpaper, onWallpaperDim, wallpaperScope, wallpaperChromeSidebar, wallpaperChromeHeader, wallpaperChromeSidebarBlur, wallpaperChromeHeaderBlur, onWallpaperScope, onWallpaperChromeSidebar, onWallpaperChromeHeader, onWallpaperChromeSidebarBlur, onWallpaperChromeHeaderBlur, shortcuts, onShortcut, buttonRef }: {
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
  /** …and its FROST, in px: how much that surface blurs what is behind it. */
  glassBlur: Readonly<Record<string, number>>;
  onGlassBlur: (id: string, value: number) => void;
  /** Whether a delivered file opens in the right sidebar rather than the system app. */
  openInSidebar: boolean;
  onOpenInSidebar: (next: boolean) => void;
  /** How a turn's files are shown: 简略气泡 / 平衡 / 详细卡片. */
  deliverableDisplay: DeliverableDisplay;
  onDeliverableDisplay: (next: DeliverableDisplay) => void;
  /** Which page a brand new session opens on; the caller passes what `entryViewOf` resolved. */
  entryView: EntryView;
  onEntryView: (next: EntryView) => void;
  /** Whether the reading view also lists the turn's git commits; off by default. */
  recordCommits: boolean;
  onRecordCommits: (next: boolean) => void;
  /** Whether 「共 x 项编辑」 opens the host's changes review in the sidebar instead of the in-page panel. */
  reviewInSidebar: boolean;
  onReviewInSidebar: (next: boolean) => void;
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
  /** How many of the newest turns keep their process open; already clamped by the caller (0 is OFF). */
  collapseBefore: number;
  onCollapseBefore: (next: number) => void;
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
  /** How opaque the LEFT COLUMN stays while the window scope is on. */
  wallpaperChromeSidebar: number;
  /** …and the TOP BAR's own scrim, which is a separate dial. */
  wallpaperChromeHeader: number;
  /** The same two surfaces' FROST, in px: how much each scrim blurs the photograph behind it. */
  wallpaperChromeSidebarBlur: number;
  wallpaperChromeHeaderBlur: number;
  onWallpaperScope: (scope: WallpaperScope) => void;
  onWallpaperChromeSidebar: (value: number) => void;
  onWallpaperChromeHeader: (value: number) => void;
  onWallpaperChromeSidebarBlur: (value: number) => void;
  onWallpaperChromeHeaderBlur: (value: number) => void;
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
  /**
   * The fold count, held as TEXT while it is being edited.
   *
   * A controlled field bound straight to the preference would write on every keystroke: typing 12 would store 1 first
   * and fold the whole page on the way, and deleting the field would store 0 without the reader having said so. So the
   * draft is local, it follows the preference whenever that changes from anywhere else, and `commitFoldDraft` below is
   * the only writer — on blur and on Enter.
   */
  const [foldDraft, setFoldDraft] = useState(String(collapseBefore));
  useEffect(() => { setFoldDraft(String(collapseBefore)); }, [collapseBefore]);
  const commitFoldDraft = () => {
    const text = foldDraft.trim();
    // Empty means OFF — a reader who cleared the field is asking for no folding, and that is also what the store's own
    // default is. Anything that is not a number is a typo: revert to what the preference holds rather than quietly
    // turning the feature off, and let the field show the real value again.
    if (text === '') { onCollapseBefore(0); return; }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) { setFoldDraft(String(collapseBefore)); return; }
    // The parent clamps through `turnFoldOf`, and the effect above then writes the clamped number back into the field,
    // so what the reader sees after a commit is exactly what they will get.
    onCollapseBefore(turnFoldOf(parsed));
  };
  /**
   * …and a third writer: the panel CLOSING.
   *
   * A panel dismissed by an outside pointer never delivers a `blur` to the field it removes — the element is gone
   * before anything could fire — so a number typed and then abandoned by clicking elsewhere was silently lost. That is
   * the reader's report (「直接点击外面…填完的数字不会被应用」), and closing IS an exit: an exit applies what is in the
   * field, which is the same rule the Enter key follows, for the reader who never presses it. Escape while the field
   * has focus still means "revert" — the field's own handler writes the stored value back first, and this commit then
   * writes that same value — so the two never disagree.
   *
   * The `!==` guard keeps a close that changed nothing from writing to the store at all, and `foldDraft` is
   * deliberately not a dependency: this must fire when the panel closes, not on every keystroke.
   */
  useEffect(() => {
    if (open) return;
    if (foldDraft !== String(collapseBefore)) commitFoldDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above: the draft is read, never depended on.
  }, [open]);

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
      viewtune<IconSettingsOutlineMedium size={12} />
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
                starts for the surfaces that have no plate of their own anyway.
                ONE BOX PER SURFACE, which is the reader's own layout: the name on its own line, then a line per dial
                with the dial NAMED on it (透明度 / 模糊值). It replaces the pair of rows this used to be, where the
                second bar was labelled only 「模糊」 and which surface it belonged to had to be read off the row above.
                A part with no frost (the scrollbar groove) gets one line, not two. */}
            {glass && GLASS_PARTS.map(part => (
              <div key={part.id} className={css.settingsBox} data-ud-check={`reader-settings-glass-${part.id}`}>
                <span className={css.settingsBoxLabel} title={part.hint}>{part.label}</span>
                <div className={css.settingsDial} title={part.hint}>
                  <span className={css.settingsDialLabel}>透明度</span>
                  <span className={css.settingsRange}>
                    <input type="range" min={0} max={100} step={5} value={glassParts[part.id] ?? part.initial}
                      aria-label={`${part.label}的透明度`}
                      onChange={event => { onGlassPart(part.id, Number(event.currentTarget.value)); }} />
                    <span className={css.settingsRangeValue}>{glassParts[part.id] ?? part.initial}%</span>
                  </span>
                </div>
                {part.blur !== undefined && <div className={css.settingsDial} title={FROST_HINT}
                  data-ud-check={`reader-settings-glass-blur-${part.id}`}>
                  <span className={css.settingsDialLabel}>模糊值</span>
                  <span className={css.settingsRange}>
                    <input type="range" min={0} max={GLASS_BLUR_MAX} step={1} value={glassBlur[part.id] ?? part.blur.initial}
                      aria-label={`${part.label}的模糊值`}
                      onChange={event => { onGlassBlur(part.id, Number(event.currentTarget.value)); }} />
                    <span className={css.settingsRangeValue}>{glassBlur[part.id] ?? part.blur.initial}px</span>
                  </span>
                </div>}
              </div>
            ))}
            <Group />
            {/* The wallpaper: the folder's own images, then the scrim that keeps prose readable on
                one. It reads its list from the host half, so the row owns that fetch rather than
                taking a list through props nobody else needs. */}
            <WallpaperSection name={wallpaper} dim={wallpaperDim} onPick={onWallpaper} onDim={onWallpaperDim}
              scope={wallpaperScope} chromeSidebar={wallpaperChromeSidebar} chromeHeader={wallpaperChromeHeader}
              onScope={onWallpaperScope} onChromeSidebar={onWallpaperChromeSidebar} onChromeHeader={onWallpaperChromeHeader}
              chromeSidebarBlur={wallpaperChromeSidebarBlur} chromeHeaderBlur={wallpaperChromeHeaderBlur}
              onChromeSidebarBlur={onWallpaperChromeSidebarBlur} onChromeHeaderBlur={onWallpaperChromeHeaderBlur}
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
                <span className={css.settingsLabel}>竖条滚轮缓动</span>
              </span>
              <Switch checked={stripWheel} onChange={onStripWheel} label="竖条滚轮缓动" />
            </div>
            <div className={css.settingsRow} title={OPEN_MODE_HINT} data-ud-check="reader-settings-openmode">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>产物用侧边栏打开</span>
              </span>
              <Switch checked={openInSidebar} onChange={onOpenInSidebar} label="产物用侧边栏打开" />
            </div>
            {/* How a turn's files are SHOWN, beside where they open: 简略 is the row this view has always had, 详细 is the
                host's own 60px card, and 平衡 keeps the row's density while telling the two lists apart — edited files and
                delivered files are different claims about a turn, and the fallback that built the first used to be shown
                under the second's label. A select rather than a switch because it is three named states. */}
            <div className={css.settingsRow} title={DELIVERABLE_DISPLAY_HINT} data-ud-check="reader-settings-deliverable-display">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>产物展示</span>
              </span>
              <select className={css.settingsSelect} value={deliverableDisplay} aria-label="产物展示方式"
                onChange={event => { onDeliverableDisplay(deliverableDisplayOf(event.currentTarget.value)); }}>
                {DELIVERABLE_DISPLAYS.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            {/* Which page a BRAND NEW session opens on. Its own row because it is not about the reading view's contents but
                about whether the reading view is entered at all: a session that has recorded no view yet is switched to
                阅读页 (what this plugin has always done), and this is the switch that stops it. 阅读页 first so the shipped
                default is the first option. */}
            <div className={css.settingsRow} title={ENTRY_VIEW_HINT} data-ud-check="reader-settings-entry-view">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>新会话默认视图</span>
              </span>
              <select className={css.settingsSelect} value={entryView} aria-label="新会话默认视图"
                onChange={event => { onEntryView(entryViewOf(event.currentTarget.value)); }}>
                <option value="reader">阅读页</option>
                <option value="conversation">对话页</option>
              </select>
            </div>
            {/* Its own feature, off by default: a commit is not a file, and the client only sees one when a tool call's
                command really runs `git commit` — so this adds a line to turns that commit, and nothing otherwise. */}
            <div className={css.settingsRow} title={RECORD_COMMITS_HINT} data-ud-check="reader-settings-record-commits">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>记录 git 提交</span>
              </span>
              <Switch checked={recordCommits} onChange={onRecordCommits} label="记录 git 提交" />
            </div>
            {/* Where 「共 x 项编辑」's click leads, beside the line it changes: this view's own diff panel (the default, and
                what the reader has now) or the host's own changes review in the sidebar — the same resource the
                conversation page's 「已编辑 x 个文件」 card opens. Two states because both are wanted. */}
            <div className={css.settingsRow} title={REVIEW_IN_SIDEBAR_HINT} data-ud-check="reader-settings-review-in-sidebar">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>差异在侧边栏审查</span>
              </span>
              <Switch checked={reviewInSidebar} onChange={onReviewInSidebar} label="差异在侧边栏审查" />
            </div>
            {/* No description on purpose: the label is the whole of it. */}
            <div className={css.settingsRow} data-ud-check="reader-settings-auto-collapse">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>自动收起更早流程</span>
              </span>
              <Switch checked={autoCollapseEarlier} onChange={onAutoCollapseEarlier} label="自动收起更早流程" />
            </div>
            {/* The COUNT-based folding, right next to the boolean one because the two answer the same question at
                different times: that one acts while a turn streams, this one at rest as well — and since a folded
                process UNMOUNTS its content rather than hiding it, this is the dial that lowers the cost of a LONG
                conversation.
                The panel's only text field, and a field rather than a dial on purpose: the value is a count of turns,
                whose useful range (a handful) is narrower than a slider expresses comfortably, and a reader who knows
                what they want should be able to type it. It commits on blur or Enter and NEVER per keystroke — a
                half-typed number is not a setting (writing 12 through 1 would fold the page on the way), and an empty
                field is the reader clearing it, which means OFF rather than a value the store has to guess at. Text
                that is not a number at all reverts, so a typo cannot silently turn the feature off. */}
            <div className={css.settingsRow} title={FOLD_BEFORE_HINT} data-ud-check="reader-settings-collapse-before">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>自动折叠更早的轮次</span>
              </span>
              <span className={css.settingsField}>
                <input className={css.settingsNumber} type="text" inputMode="numeric" value={foldDraft}
                  aria-label={`自动折叠更早的轮次：只渲染最近几轮，最多 ${String(TURN_FOLD_MAX)}`}
                  onChange={event => { setFoldDraft(event.currentTarget.value); }}
                  onBlur={commitFoldDraft}
                  onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    else if (event.key === 'Escape') setFoldDraft(String(collapseBefore));
                  }} />
                <span className={css.settingsUnit}>轮</span>
              </span>
            </div>
            {/* What the toolbar's collapse button DOES — a behaviour, so it sits with the other behaviours on this page.
                It used to live on the SHORTCUTS page, next to the two bindings, where it read as one of them; the
                bindings bind ACTIONS, not this button, and even a single-action mode here leaves the other action
                reachable from its key (see collapse-mode.ts). The panel's only select, because the choice is three
                named states rather than a degree — and the third of them is 「默认」, the reader's word for the shipped
                behaviour. */}
            <div className={css.settingsRow} data-ud-check="reader-settings-collapse-mode">
              <span className={css.settingsCopy}>
                <span className={css.settingsLabel}>收起按钮</span>
              </span>
              <select className={css.settingsSelect} value={collapseMode} aria-label="收起按钮的行为"
                onChange={event => { onCollapseMode(collapseModeOf(event.currentTarget.value)); }}>
                {COLLAPSE_MODES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
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
