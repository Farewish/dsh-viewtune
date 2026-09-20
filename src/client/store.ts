import { defineStore } from '@deepseek-ai/dsh-client-store';
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import type { ShortcutAction } from './shortcuts.js';

export interface ReaderState {
  expanded: Record<string, boolean>;
  motion: boolean;
  glass: boolean;
  /** The skin's per-surface opacities, recording only the ones the reader moved off their initial. */
  glassParts: Record<string, number>;
  shortcuts: Record<string, string>;
}
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
  setGlass: (draft: ReaderState, value: boolean) => void;
  setGlassPart: (draft: ReaderState, id: string, value: number) => void;
  setShortcut: (draft: ReaderState, action: ShortcutAction, value: string) => void;
};

export function createReaderStore(): EngineStoreHandle<ReaderState, ReaderActions> {
  return defineStore({
    /**
     * `shortcuts` starts empty because it records only changes: a missing action means "the
     * default" and an empty string means "cleared". That matters here — persistence hydrates with
     * `setState` rather than merging into `init`, so a record written before this field existed
     * comes back without it, and every reader of the map has to fall back rather than trust the
     * shape. `glass` is read the same defensive way (`=== true`), because a record written before
     * the skin existed has no such key at all.
     */
    init: (): ReaderState => ({ expanded: {}, motion: true, glass: false, glassParts: {}, shortcuts: {} }),
    persist: 'dsh.reader.v1',
    actions: {
      setExpanded: (draft, key: string, value: boolean) => { draft.expanded[key] = value; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
      setGlass: (draft, value: boolean) => { draft.glass = value; },
      setGlassPart: (draft, id: string, value: number) => {
        if (draft.glassParts === undefined) draft.glassParts = {};
        draft.glassParts[id] = value;
      },
      setShortcut: (draft, action: ShortcutAction, value: string) => {
        if (draft.shortcuts === undefined) draft.shortcuts = {};
        draft.shortcuts[action] = value;
      },
    },
  });
}
