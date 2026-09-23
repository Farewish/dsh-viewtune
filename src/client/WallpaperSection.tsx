import { useCallback, useEffect, useState } from 'react';
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  WALLPAPER_DIM_MAX, WALLPAPER_LIST_PATH, WALLPAPER_REVEAL_PATH,
  wallpaperDimOf, wallpaperListingOf, wallpaperUrl,
} from './wallpaper.js';
import type { WallpaperEntry } from './wallpaper.js';
import { WALLPAPER_CHROME_MAX, wallpaperChromeOf } from './wallpaper-scope.js';
import type { WallpaperScope } from './wallpaper-scope.js';
import css from './Reader.module.css';

/**
 * The dials' own `title` boxes, and the rule they follow: a reader of this panel wants to know WHICH surface a slider
 * moves, not how the surface is built. Where the row's own label already says it — 「壁纸」 with a picker, a folder
 * button and a note that says what to do when the folder is empty — there is no box at all.
 */
const DIM_HINT = '越高越接近主题底色';
const SCOPE_HINT = '打开后铺满整个窗口，而不只是阅读视图';
const CHROME_HINT = '左侧栏与顶部栏的底色浓度';
const SOLID_HINT = '「对话」页改用主题纯色底，输入框上方保留淡出';

const LOADING = '正在读取文件夹…';
const EMPTY = '文件夹里还没有图片：把图片拖进去，再点「刷新」';
const FAILED = '读不到壁纸文件夹——宿主那半要重启一次才生效';

interface Listing {
  status: 'loading' | 'ready' | 'failed';
  dir: string;
  items: readonly WallpaperEntry[];
}

/**
 * The wallpaper row: the folder's images as thumbnails, plus the scrim dial for the chosen one.
 *
 * The thumbnails come from the plugin's own host route rather than from a path the reader types, so
 * what can be chosen is exactly what the folder holds. The folder is the reader's to fill — 「打开
 * 文件夹」 opens it, 「刷新」 re-reads it after they drop something in.
 */
export function WallpaperSection({ name, dim, scope, chrome, solid, onPick, onDim, onScope, onChrome, onSolid }: {
  name: string;
  dim: number;
  scope: WallpaperScope;
  chrome: number;
  /** Whether the CONVERSATION page is painted as a solid page of its own. */
  solid: boolean;
  onPick: (name: string) => void;
  onDim: (value: number) => void;
  onScope: (scope: WallpaperScope) => void;
  onChrome: (value: number) => void;
  onSolid: (next: boolean) => void;
}) {
  const [listing, setListing] = useState<Listing>({ status: 'loading', dir: '', items: [] });
  const load = useCallback(() => {
    setListing(current => ({ ...current, status: 'loading' }));
    fetch(WALLPAPER_LIST_PATH, { headers: { accept: 'application/json' } })
      .then(response => response.json() as Promise<unknown>)
      .then(payload => { setListing({ status: 'ready', ...wallpaperListingOf(payload) }); })
      .catch(() => { setListing({ status: 'failed', dir: '', items: [] }); });
  }, []);
  // Read once when the visual page is opened, and again only when the reader says so: the folder
  // changes on their time, and 「刷新」 is how they announce it.
  useEffect(() => { load(); }, [load]);
  const reveal = useCallback(() => {
    // The folder is created host-side on demand, so this works before anything was ever dropped in.
    void fetch(WALLPAPER_REVEAL_PATH, { method: 'POST' }).catch(() => undefined);
  }, []);
  const state = listing.status === 'loading' ? LOADING
    : listing.status === 'failed' ? FAILED
      : listing.items.length === 0 ? EMPTY : null;
  const dimValue = wallpaperDimOf(dim);
  return <>
    <div className={css.settingsRow} data-ud-check="reader-settings-wallpaper">
      <span className={css.settingsCopy}>
        <span className={css.settingsLabel}>壁纸</span>
        {state !== null && <span className={css.settingsNote}>{state}</span>}
      </span>
      <span className={css.miniButtons}>
        {name !== '' && <button type="button" className={css.miniButton} onClick={() => { onPick(''); }}>清除</button>}
        <button type="button" className={css.miniButton} onClick={load}>刷新</button>
        <button type="button" className={css.miniButton} onClick={reveal}>打开文件夹</button>
      </span>
    </div>
    {listing.items.length > 0 && <div className={css.wallpaperGrid} data-ud-check="reader-settings-wallpaper-list">
      {listing.items.map(item => <button key={item.name} type="button" className={css.wallpaperThumb}
        aria-pressed={item.name === name} title={item.name} onClick={() => { onPick(item.name); }}>
        {/* The mtime in the URL is what makes a re-dropped file show up instead of the cached bitmap. */}
        <img src={wallpaperUrl(item.name, item.mtimeMs)} alt={item.name} loading="lazy" />
      </button>)}
    </div>}
    {/* The scrim, offered with the image it belongs to. It went missing from this panel for a while —
        the state, the props and the hint were all still here, and the row simply was not rendered, so a
        reader who had set a dim could no longer move it — which is why the guard now pins the row as
        well as the values behind it. */}
    {name !== '' && <div className={`${css.settingsRow} ${css.settingsSubRow}`} title={DIM_HINT}
      data-ud-check="reader-settings-wallpaper-dim">
      <span className={css.settingsCopy}>
        <span className={css.settingsLabel}>压暗</span>
      </span>
      <span className={css.settingsRange}>
        <input type="range" min={0} max={WALLPAPER_DIM_MAX} step={5} value={dimValue}
          aria-label="壁纸压暗"
          onChange={event => { onDim(Number(event.currentTarget.value)); }} />
        <span className={css.settingsRangeValue}>{dimValue}%</span>
      </span>
    </div>}
    {/* The window's own scrim, then the switch that reveals it: the reader asked for these two in this
        order. Note what it costs — the scrim's row is gated on the window scope being ON, so it comes and
        goes above the switch that turns that scope on. */}
    {name !== '' && scope === 'window' && <div className={`${css.settingsRow} ${css.settingsSubRow}`} title={CHROME_HINT}
      data-ud-check="reader-settings-wallpaper-chrome">
      <span className={css.settingsCopy}>
        <span className={css.settingsLabel}>界面遮罩</span>
      </span>
      <span className={css.settingsRange}>
        <input type="range" min={0} max={WALLPAPER_CHROME_MAX} step={5} value={wallpaperChromeOf(chrome)}
          aria-label="左侧栏与顶部栏的遮罩浓度"
          onChange={event => { onChrome(Number(event.currentTarget.value)); }} />
        <span className={css.settingsRangeValue}>{wallpaperChromeOf(chrome)}%</span>
      </span>
    </div>}
    {name !== '' && <div className={`${css.settingsRow} ${css.settingsSubRow}`} title={SCOPE_HINT}
      data-ud-check="reader-settings-wallpaper-scope">
      <span className={css.settingsCopy}>
        <span className={css.settingsLabel}>铺满整个窗口</span>
      </span>
      {/* Only offered once there IS a wallpaper: the scope alone paints nothing. */}
      <Switch checked={scope === 'window'} label="铺满整个窗口"
        onChange={on => { onScope(on ? 'window' : 'view'); }} />
    </div>}
    {/* The exception, last, and NOT gated on a wallpaper being chosen: the two rows above only mean
        something with an image, while this one also gives the conversation page its lifted fade with no
        wallpaper at all. It is a statement about what that page is MADE of, which is why it lives beside
        the backdrop rather than beside the skin. */}
    <div className={`${css.settingsRow} ${css.settingsSubRow}`} title={SOLID_HINT}
      data-ud-check="reader-settings-conversation-solid">
      <span className={css.settingsCopy}>
        <span className={css.settingsLabel}>对话页用纯色底</span>
      </span>
      <Switch checked={solid} onChange={onSolid} label="对话页用纯色底" />
    </div>
  </>;
}
