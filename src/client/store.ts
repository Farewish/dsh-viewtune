import { defineStore } from '@deepseek-ai/dsh-client-store';
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import type { ShortcutAction } from './shortcuts.js';
import type { CollapseMode } from './collapse-mode.js';
import type { DeliverableOpenMode } from './open-file.js';
import { DEFAULT_WALLPAPER, WALLPAPER_DIM_INITIAL } from './wallpaper.js';
import { WALLPAPER_CHROME_INITIAL } from './wallpaper-scope.js';
import type { WallpaperScope } from './wallpaper-scope.js';

export interface ReaderState {
  expanded: Record<string, boolean>;
  motion: boolean;
  glass: boolean;
  /** The skin's per-surface opacities, recording only the ones the reader moved off their initial. */
  glassParts: Record<string, number>;
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
  /** How opaque the sidebar and the top bar stay while the window scope is on. */
  wallpaperChrome: number;
  shortcuts: Record<string, string>;
}
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
  setGlass: (draft: ReaderState, value: boolean) => void;
  setGlassPart: (draft: ReaderState, id: string, value: number) => void;
  setGlassConversation: (draft: ReaderState, value: boolean) => void;
  setConversationSolid: (draft: ReaderState, value: boolean) => void;
  setCollapseMode: (draft: ReaderState, value: CollapseMode) => void;
  setDeliverableOpenMode: (draft: ReaderState, value: DeliverableOpenMode) => void;
  setStripWheel: (draft: ReaderState, value: boolean) => void;
  setWallpaper: (draft: ReaderState, value: string) => void;
  setWallpaperDim: (draft: ReaderState, value: number) => void;
  setWallpaperScope: (draft: ReaderState, value: WallpaperScope) => void;
  setWallpaperChrome: (draft: ReaderState, value: number) => void;
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
      expanded: {}, motion: true, glass: true, glassParts: {}, deliverableOpenMode: 'external',
      // The handles forward the wheel until a reader says otherwise; see the field's own note for why that is the
      // default rather than an opt-in.
      stripWheel: true,
      // The skin reaches the conversation page too, which is the look a fresh install opens with.
      glassConversation: true,
      // …while the conversation page keeps whatever is behind it: a separate choice, and this one is off.
      conversationSolid: false,
      // The pair of buttons' behaviour, which is what a reader who never opens this setting keeps.
      collapseMode: 'both',
      // The wallpaper this plugin ships, and the scrim the reader settled on for it (see wallpaper.ts for both). The
      // window scope below means it carries the whole app rather than only the reading column.
      wallpaper: DEFAULT_WALLPAPER, wallpaperDim: WALLPAPER_DIM_INITIAL,
      wallpaperScope: 'window', wallpaperChrome: WALLPAPER_CHROME_INITIAL, shortcuts: {},
    }),
    persist: 'dsh.reader.v1',
    actions: {
      setExpanded: (draft, key: string, value: boolean) => { draft.expanded[key] = value; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
      setGlass: (draft, value: boolean) => { draft.glass = value; },
      setGlassPart: (draft, id: string, value: number) => {
        if (draft.glassParts === undefined) draft.glassParts = {};
        draft.glassParts[id] = value;
      },
      setGlassConversation: (draft, value: boolean) => { draft.glassConversation = value; },
      setConversationSolid: (draft, value: boolean) => { draft.conversationSolid = value; },
      setCollapseMode: (draft, value: CollapseMode) => { draft.collapseMode = value; },
      setDeliverableOpenMode: (draft, value: DeliverableOpenMode) => { draft.deliverableOpenMode = value; },
      setStripWheel: (draft, value: boolean) => { draft.stripWheel = value; },
      setWallpaper: (draft, value: string) => { draft.wallpaper = value; },
      setWallpaperDim: (draft, value: number) => { draft.wallpaperDim = value; },
      setWallpaperScope: (draft, value: WallpaperScope) => { draft.wallpaperScope = value; },
      setWallpaperChrome: (draft, value: number) => { draft.wallpaperChrome = value; },
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
       */
      hydrate: (draft, value) => {
        const target = draft as unknown as Record<string, unknown>;
        for (const key of Object.keys(value)) {
          if (Object.prototype.hasOwnProperty.call(target, key)) target[key] = value[key];
        }
      },
    },
  });
}
