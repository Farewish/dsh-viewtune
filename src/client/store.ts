import { defineStore } from '@deepseek-ai/dsh-client-store';
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import type { ShortcutAction } from './shortcuts.js';
import type { CollapseMode } from './collapse-mode.js';
import type { DeliverableOpenMode } from './open-file.js';
import type { TextCadence } from './text-cadence.js';
import type { FollowMode } from './reading-scroll.js';
import type { ReasoningFollowMode } from './reasoning-follow.js';
import { DEFAULT_WALLPAPER, WALLPAPER_DIM_INITIAL } from './wallpaper.js';
import { CHROME_HEADER_KEY, CHROME_LEGACY_KEY, CHROME_SIDEBAR_KEY, WALLPAPER_CHROME_HEADER_BLUR_INITIAL, WALLPAPER_CHROME_INITIAL, WALLPAPER_CHROME_SIDEBAR_BLUR_INITIAL, chromeScrimsOf } from './wallpaper-scope.js';
import type { WallpaperScope } from './wallpaper-scope.js';

export interface ReaderState {
  expanded: Record<string, boolean>;
  /**
   * Whether this plugin's own movement runs at all — 「动效」.
   *
   * Read defensively (`!== false`) like the other switches that are ON by default: a record written before this
   * preference existed has no such key, and what it describes is a view that had no way to turn the movement off, so
   * an absent key means ON. Strictly it is not only a default: `undefined` reaching the settings switch makes React
   * treat it as an UNCONTROLLED `<Switch>`, which then stops reflecting the store on any later change.
   */
  motion: boolean;
  glass: boolean;
  /** The skin's per-surface opacities, recording only the ones the reader moved off their initial. */
  glassParts: Record<string, number>;
  /** …and its per-surface FROST, in px, recorded the same way (see `glass.ts`). */
  glassBlur: Record<string, number>;
  /**
   * Whether the skin also reaches the CONVERSATION view.
   *
   * ON by default, and still deliberately a SECOND switch rather than part of the skin: the reading view is
   * this plugin's own surface, while the conversation page belongs to the host, so a reader can have one without
   * the other. Both defaults are the reader's own settings, adopted so this plugin opens for anyone the way it opens
   * for them. Read the defensive way (`=== true`), like `glass` itself.
   */
  glassConversation: boolean;
  /**
   * Whether the conversation page is painted as a SOLID page — the theme's base (black in the dark
   * theme, white in the light one) instead of whatever the wallpaper put behind it, with the same
   * lifted fade above the composer the trajectory page has.
   *
   * Independent of the skin on purpose: it is about what the page is MADE of, not about how much of it
   * shows through. Read defensively (`=== true`), like the two switches above.
   */
  conversationSolid: boolean;
  /**
   * What the toolbar's single collapse button does: 收起本轮, 收起全部, or both behind one control.
   *
   * Read through `collapseModeOf`, which answers `both` for anything unrecognised — that is the shape the
   * pair of buttons had before they were merged, so a record written before this setting existed keeps the
   * behaviour it was written with.
   */
  collapseMode: CollapseMode;
  /** Where a delivered file opens: the system app by default, the right sidebar on request. */
  deliverableOpenMode: DeliverableOpenMode;
  /**
   * How often a streaming message publishes its revealed text.
   *
   * The steady 60Hz cadence is the DEFAULT, and `textCadenceOf` answers it for anything unrecognised: publishing once
   * per frame makes the reveal's cost follow the display's refresh rate — on a 240Hz screen that is four times the
   * work a reader can see — so the per-frame cadence is the one a reader has to ask for by name.
   */
  textCadence: TextCadence;
  /**
   * Whether a revealed word also resolves from a 1px blur, or only fades in.
   *
   * OFF by default — the reader's own setting, adopted like the rest of this file's defaults, and the one they settled
   * on after measuring what the per-frame repaint it causes was worth (see the note on the initial value below). This
   * comment claimed ON for a long time, which is what the README's table says it is not. It is a switch because the blur
   * is the expensive half of the reveal and the subtle one: a `filter` cannot be animated by the compositor, so every
   * animating word repaints its own area on every frame, and about a dozen of those overlap for as long as a message
   * streams. Read defensively (`=== true`), which is what an OFF default means: an absent key is off.
   */
  revealBlur: boolean;
  /**
   * Whether the reveal gives each word an identity at all — a per-word fade — or lets the text appear as it streams.
   *
   * ON by default: it is what every card in this plugin has always done, and the pacing a reader sees comes from the
   * stream buffer either way. Off, a growing message renders as plain text: no per-word elements, no per-word
   * animation, and no word identities to rebuild — the timeline is not even started. Read defensively (`!== false`),
   * so a record written before the switch existed keeps the per-word reveal.
   */
  revealWords: boolean;
  /**
   * How the reading view catches up with the tail: the per-frame glide, or writing the bottom directly.
   *
   * Read through `followModeOf`, which answers `glide` for anything unrecognised — that is the behaviour every reader
   * has had so far. It is a switch because the glide writes `scrollTop` on every frame and each write fires a scroll
   * event, which is what keeps the scroll spy, the anchor compensation and the measurements busy while a message
   * streams; a reader who would rather have that quiet can take the direct write.
   */
  followMode: FollowMode;
  /**
   * Whether a newly started turn folds the earlier processes away, leaving only the turn that is growing open.
   *
   * OFF by default: the reading view's own rule already folds a turn that finished cleanly, and this one goes further
   * — while something streams, every other turn's process starts folded (a turn that ended without completing
   * included), and a new turn CLEARS the stored expansion choices so the ones the reader had opened fold too. Their
   * click still wins over that default, which is what keeps the disclosure control answering. Read defensively
   * (`=== true`), so a record written before this switch existed keeps the behaviour it was written with.
   */
  autoCollapseEarlier: boolean;
  /**
   * How many of the newest turns keep their process open — 「自动折叠更早的轮次」.
   *
   * 0 is OFF, and OFF is the shipped default: this plugin does not fold a reader's history behind their back. Read
   * through `turnFoldOf`, which is also where the ceiling lives. Deliberately a SECOND setting rather than a widening
   * of `autoCollapseEarlier`: that one is a boolean that acts only WHILE a turn streams, while this one acts at rest
   * too — and since a folded process UNMOUNTS its content rather than hiding it, this is the one that lowers the cost
   * of a long conversation rather than only the cost of a running one.
   */
  collapseBefore: number;
  /**
   * How the reasoning card keeps up with what is being written into it: 自动滚动 (a reading pace), 跟随最新 (always
   * the newest line), or 手动滚动 (never move on its own).
   *
   * Independent of 「焦点思考展开」: it governs the card as it is NOW, small card included, so a reader who never turns
   * the expansion on still chooses how the text moves. Read through `reasoningFollowModeOf`, which answers `latest` for
   * anything unrecognised — 跟随最新 is the default, so an unrecognised value lands on the default rather than on a mode
   * nobody chose. (This sentence said `auto` until the defaults were flipped; the code has answered `latest` since.)
   */
  reasoningFollow: ReasoningFollowMode;
  /** The reading pace in lines per second, from `REASONING_RATES`; only 自动滚动 reads it. */
  reasoningRate: number;
  /**
   * Whether the reasoning card that is currently being written into grows to show its content — 「焦点思考展开」.
   *
   * OFF by default: with it off the card behaves exactly as it always has (a fixed 224px window whose content follows
   * by the mode above), so this is the one switch that changes the SHAPE of what a reader sees rather than how it
   * moves. Independent of `reasoningFollow`: the three modes act on the card as it is, grown or not. Read defensively
   * (`=== true`), so a record written before it existed keeps the preview card.
   */
  focusExpand: boolean;
  /**
   * Whether a wheel over the toolbar's two column handles is forwarded to the transcript.
   *
   * On by default, because that IS the behaviour the reader asked for and then tuned over many rounds: the handles
   * belong to the shell and sit BESIDE the scroller, so without this a notch over one of them does nothing at all.
   * It is a switch rather than a constant because it is the one thing in this plugin that changes how the app
   * scrolls, and a reader who would rather have the silence back is entitled to it. Read defensively
   * (`!== false`), so a record written before the switch existed keeps the forwarding it was written with.
   */
  stripWheel: boolean;
  /**
   * The wallpaper's file name inside the plugin's own folder; `''` means none, which the reader asks for with 清除.
   *
   * The default is the file this plugin ships and seeds into the folder (see `wallpaper-files.ts`), so a fresh
   * install has a picture rather than a reference to one nobody put there.
   */
  wallpaper: string;
  /** How far the wallpaper is mixed toward the theme's background, so prose stays readable on it. */
  wallpaperDim: number;
  /** Whether the wallpaper stops at the reading view or carries the whole window. */
  wallpaperScope: WallpaperScope;
  /** How opaque the LEFT COLUMN stays while the window scope is on. */
  wallpaperChromeSidebar: number;
  /**
   * …and the TOP BAR's own scrim.
   *
   * Separate from the sidebar's since the reader asked for the two surfaces to move apart: they face different
   * things (the column stands against the reading view, the bar above everything), so one number made moving one
   * move the other. A record written before the split carries the single `wallpaperChrome` instead — see `hydrate`.
   */
  wallpaperChromeHeader: number;
  /**
   * How much each of those two scrims BLURS what is behind it — the frost of the same two surfaces.
   *
   * Separate numbers rather than one, for the reason the tints are: the column and the bar face different things, and
   * the reader asked for them to move apart. 0 is where they open, which is the look they have always had (a scrim was
   * a plain wash), so raising one is what frosts it. Read through `wallpaperChromeBlurOf`.
   */
  wallpaperChromeSidebarBlur: number;
  wallpaperChromeHeaderBlur: number;
  shortcuts: Record<string, string>;
}
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
  setGlass: (draft: ReaderState, value: boolean) => void;
  setGlassPart: (draft: ReaderState, id: string, value: number) => void;
  setGlassBlur: (draft: ReaderState, id: string, value: number) => void;
  setGlassConversation: (draft: ReaderState, value: boolean) => void;
  setConversationSolid: (draft: ReaderState, value: boolean) => void;
  setCollapseMode: (draft: ReaderState, value: CollapseMode) => void;
  setDeliverableOpenMode: (draft: ReaderState, value: DeliverableOpenMode) => void;
  setTextCadence: (draft: ReaderState, value: TextCadence) => void;
  setRevealBlur: (draft: ReaderState, value: boolean) => void;
  setRevealWords: (draft: ReaderState, value: boolean) => void;
  setFollowMode: (draft: ReaderState, value: FollowMode) => void;
  setAutoCollapseEarlier: (draft: ReaderState, value: boolean) => void;
  /** The count behind 「自动折叠更早的轮次」; the caller passes what `turnFoldOf` already clamped. */
  setCollapseBefore: (draft: ReaderState, value: number) => void;
  setReasoningFollow: (draft: ReaderState, value: ReasoningFollowMode) => void;
  setReasoningRate: (draft: ReaderState, value: number) => void;
  setFocusExpand: (draft: ReaderState, value: boolean) => void;
  /** Drop every stored expansion choice, so each turn falls back to its default. */
  clearExpanded: (draft: ReaderState) => void;
  setStripWheel: (draft: ReaderState, value: boolean) => void;
  setWallpaper: (draft: ReaderState, value: string) => void;
  setWallpaperDim: (draft: ReaderState, value: number) => void;
  setWallpaperScope: (draft: ReaderState, value: WallpaperScope) => void;
  setWallpaperChromeSidebar: (draft: ReaderState, value: number) => void;
  setWallpaperChromeHeader: (draft: ReaderState, value: number) => void;
  setWallpaperChromeSidebarBlur: (draft: ReaderState, value: number) => void;
  setWallpaperChromeHeaderBlur: (draft: ReaderState, value: number) => void;
  setShortcut: (draft: ReaderState, action: ShortcutAction, value: string) => void;
  hydrate: (draft: ReaderState, value: Record<string, unknown>) => void;
};

export function createReaderStore(): EngineStoreHandle<ReaderState, ReaderActions> {
  return defineStore({
    /**
     * `shortcuts` starts empty because it records only changes: a missing action means "the
     * default" and an empty string means "cleared". That matters here — persistence hydrates with
     * `setState` rather than merging into `init`, so a record written before this field existed
     * comes back without it, and every reader of the map has to fall back rather than trust the
     * shape. `glass` is read the same defensive way (`=== true`), because a record written before
     * the skin existed has no such key at all — and `deliverableOpenMode` goes through
     * `deliverableOpenModeOf`, which reads anything but `'sidebar'` as the default. The wallpaper is
     * the same story again: `wallpaperNameOf` and `wallpaperDimOf` own its fallbacks.
     */
    init: (): ReaderState => ({
      expanded: {}, motion: true, glass: true, glassParts: {}, glassBlur: {}, deliverableOpenMode: 'external',
      // The handles forward the wheel until a reader says otherwise; see the field's own note for why that is the
      // default rather than an opt-in.
      stripWheel: true,
      // The skin reaches the conversation page too, which is the look a fresh install opens with.
      glassConversation: true,
      // …while the conversation page keeps whatever is behind it: a separate choice, and this one is off.
      conversationSolid: false,
      // The pair of buttons' behaviour, which is what a reader who never opens this setting keeps.
      collapseMode: 'both',
      // The reveal's cadence: the steady one, which is what this plugin now opens with — per-frame publication makes
      // the reveal's work follow the display's refresh rate, so it is the explicit choice rather than the default.
      textCadence: 'steady',
      // …and its blur, OFF by default: the reader's own setting, adopted like the rest of this file's defaults, and
      // the one they settled on after measuring what the per-frame repaint it causes was worth.
      revealBlur: false,
      // …and the per-word reveal itself, which is what a fresh install (and an older record) opens with.
      revealWords: true,
      // …and the follower writes the bottom DIRECTLY rather than gliding to it: the reader's own setting, adopted with
      // the rest (they measured the glide's per-frame `scrollTop` writes and took the quiet path).
      followMode: 'snap',
      // …and the earlier turns' processes are put away while something streams: the reader's setting, adopted here, so
      // a fresh install opens the way they run it.
      autoCollapseEarlier: true,
      // …and nothing is folded by COUNT to begin with: the reader asked for this dial, not for a history that folds
      // itself. It is the one setting whose shipped default is not taken from their record, because their record has
      // no such key yet — 0 is OFF, and OFF is the behaviour every earlier build had (see `turnFoldOf`).
      collapseBefore: 0,
      // The reasoning card's own movement: the reader's setting — 跟随最新, i.e. stay on the newest line rather than
      // walk down at a reading pace — at the pace they chose (3 lines/s; `reasoningRateOf`'s own fallback stays at the
      // old standard 2, which is what a record with an unusable value keeps).
      reasoningFollow: 'latest', reasoningRate: 3,
      // …and the focused card grows, which is what the reader who asked for all of these opens with.
      focusExpand: true,
      // The wallpaper this plugin ships, and the scrim the reader settled on for it (see wallpaper.ts for both). The
      // window scope below means it carries the whole app rather than only the reading column.
      wallpaper: DEFAULT_WALLPAPER, wallpaperDim: WALLPAPER_DIM_INITIAL,
      wallpaperScope: 'window',
      // Both scrims open at the shipped value; the reader moves them apart from there (see the fields' notes).
      wallpaperChromeSidebar: WALLPAPER_CHROME_INITIAL, wallpaperChromeHeader: WALLPAPER_CHROME_INITIAL,
      // …and both scrims open FROSTED, at the two values the reader settled on (15px behind the sidebar, 5px behind
      // the top bar): one number each, because they face different things.
      wallpaperChromeSidebarBlur: WALLPAPER_CHROME_SIDEBAR_BLUR_INITIAL,
      wallpaperChromeHeaderBlur: WALLPAPER_CHROME_HEADER_BLUR_INITIAL,
      shortcuts: {},
    }),
    persist: 'dsh.reader.v1',
    actions: {
      // `??= {}` for the same reason the actions below do it: persistence replaces the WHOLE state rather than merging
      // into `init`, so a record written by a build without this key arrives with `expanded` missing and this write
      // would throw on `undefined[key]` — inside a store update, which takes the reading view down with it.
      setExpanded: (draft, key: string, value: boolean) => { (draft.expanded ??= {})[key] = value; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
      setGlass: (draft, value: boolean) => { draft.glass = value; },
      setGlassPart: (draft, id: string, value: number) => {
        if (draft.glassParts === undefined) draft.glassParts = {};
        draft.glassParts[id] = value;
      },
      // The frost's own record, with the same `??= {}` guard and for the same reason: persistence replaces the whole
      // state, so a record written before this setting existed arrives with the key missing rather than empty.
      setGlassBlur: (draft, id: string, value: number) => {
        if (draft.glassBlur === undefined) draft.glassBlur = {};
        draft.glassBlur[id] = value;
      },
      setGlassConversation: (draft, value: boolean) => { draft.glassConversation = value; },
      setConversationSolid: (draft, value: boolean) => { draft.conversationSolid = value; },
      setCollapseMode: (draft, value: CollapseMode) => { draft.collapseMode = value; },
      setDeliverableOpenMode: (draft, value: DeliverableOpenMode) => { draft.deliverableOpenMode = value; },
      setTextCadence: (draft, value: TextCadence) => { draft.textCadence = value; },
      setRevealBlur: (draft, value: boolean) => { draft.revealBlur = value; },
      setRevealWords: (draft, value: boolean) => { draft.revealWords = value; },
      setFollowMode: (draft, value: FollowMode) => { draft.followMode = value; },
      setAutoCollapseEarlier: (draft, value: boolean) => { draft.autoCollapseEarlier = value; },
      setCollapseBefore: (draft, value: number) => { draft.collapseBefore = value; },
      setReasoningFollow: (draft, value: ReasoningFollowMode) => { draft.reasoningFollow = value; },
      setReasoningRate: (draft, value: number) => { draft.reasoningRate = value; },
      setFocusExpand: (draft, value: boolean) => { draft.focusExpand = value; },
      clearExpanded: (draft) => { draft.expanded = {}; },
      setStripWheel: (draft, value: boolean) => { draft.stripWheel = value; },
      setWallpaper: (draft, value: string) => { draft.wallpaper = value; },
      setWallpaperDim: (draft, value: number) => { draft.wallpaperDim = value; },
      setWallpaperScope: (draft, value: WallpaperScope) => { draft.wallpaperScope = value; },
      setWallpaperChromeSidebar: (draft, value: number) => { draft.wallpaperChromeSidebar = value; },
      setWallpaperChromeHeader: (draft, value: number) => { draft.wallpaperChromeHeader = value; },
      setWallpaperChromeSidebarBlur: (draft, value: number) => { draft.wallpaperChromeSidebarBlur = value; },
      setWallpaperChromeHeaderBlur: (draft, value: number) => { draft.wallpaperChromeHeaderBlur = value; },
      setShortcut: (draft, action: ShortcutAction, value: string) => {
        if (draft.shortcuts === undefined) draft.shortcuts = {};
        draft.shortcuts[action] = value;
      },
      /**
       * Take the host's record as this run's starting state.
       *
       * Only the keys this store OWNS, and only the ones the record actually carries: a record written
       * by an older build — or by one with fewer settings — is the normal case, and replacing the whole
       * state with it would drop the keys it never heard of. What an odd VALUE means is deliberately not
       * decided here: every preference already has a defensive reader (`wallpaperNameOf`, `glassValues`,
       * the `=== true` on `glass`, …) that has to cope with the same thing coming out of the browser's
       * own copy.
       *
       * WHAT HAPPENS TO A KEY THIS BUILD DOES NOT KNOW, stated because the loop above makes it invisible: it is
       * ignored on the way in, and then it is GONE from the host's file, because the next change pushes this store's
       * whole state and the host replaces the record wholesale. So a key written by a newer build is destroyed by an
       * older one, not preserved. Kept that way on purpose: this plugin's record is one reader's own, in an instance
       * home scoped to one harness version (`homes/<version>`), so the downgrade it would take to lose a setting is
       * not a path anyone is on. Preserving them would mean carrying a pass-through bag of unknown keys through the
       * store and re-sending it, which is machinery to protect a reader from a build they do not run.
       */
      hydrate: (draft, value) => {
        const target = draft as unknown as Record<string, unknown>;
        for (const key of Object.keys(value)) {
          // The per-turn expansion choices are never taken from the shared record. They are this session's memory of
          // what the reader opened, keyed by bare turn numbers that another session is free to mean something else by,
          // and the host record is one file for every session at once. `hostRecordOf` keeps them out on the way back.
          if (key === 'expanded') continue;
          if (Object.prototype.hasOwnProperty.call(target, key)) target[key] = value[key];
        }
        // …and the ONE key this state no longer owns, MIGRATED rather than dropped. The chrome scrim was a single
        // dial (`wallpaperChrome`) before the surfaces were split, so a record that carries it — and not the surface's
        // own key — is a reader who had set both surfaces to that number. The loop above cannot carry it: the key is
        // not a field of this state any more, so it would be ignored and both scrims would quietly open at the shipped
        // default — a setting lost by an upgrade rather than by the reader, which is the kind of loss this store is
        // built to avoid. Decided per surface, because a record may carry one of the two (see `chromeScrimsOf`).
        const legacy = Object.prototype.hasOwnProperty.call(value, CHROME_LEGACY_KEY) ? value[CHROME_LEGACY_KEY] : undefined;
        if (legacy !== undefined) {
          const scrims = chromeScrimsOf(value);
          if (!Object.prototype.hasOwnProperty.call(value, CHROME_SIDEBAR_KEY)) draft.wallpaperChromeSidebar = scrims.sidebar;
          if (!Object.prototype.hasOwnProperty.call(value, CHROME_HEADER_KEY)) draft.wallpaperChromeHeader = scrims.header;
        }
      },
    },
  });
}
