/**
 * Reader-side wallpaper plumbing: the stored preference read defensively, the URL the root paints,
 * and the custom properties the stylesheet composes the backdrop from.
 *
 * The bytes live in the plugin's own folder (see the host half's `wallpaper-files.ts`) and reach the
 * page through the plugin's host routes — the client never learns a filesystem path it could ask for
 * anything else with.
 */
export interface WallpaperEntry {
  readonly name: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface WallpaperListing {
  readonly dir: string;
  readonly items: readonly WallpaperEntry[];
}

/**
 * The wallpaper this plugin ships, which is also what the settings default to.
 *
 * The host half copies this file into the reader's folder on activation (`seedDefaultWallpaper`), so a fresh install
 * has a picture rather than a reference to one nobody put there. The name is spelled twice — here and in
 * `wallpaper-files.ts`, because the two bundles cannot import each other — and the guard pins the two against each
 * other so a rename cannot leave the default pointing at nothing.
 */
export const DEFAULT_WALLPAPER = 'sample-gradient.png';
/** The scrim's shipped value: the reader's own setting, taken as the default so a fresh install looks like theirs. */
export const WALLPAPER_DIM_INITIAL = 35;
export const WALLPAPER_DIM_MAX = 100;
export const WALLPAPER_LIST_PATH = '/better-display/wallpapers';
export const WALLPAPER_REVEAL_PATH = '/better-display/wallpapers/reveal';

/**
 * The stored name, read defensively: persistence replaces the whole record, so an old one has no key.
 *
 * A STRING is taken as it stands — including `''`, which is exactly how a reader says "no wallpaper" with 清除 — and
 * anything that is not a string (a record written before the wallpaper existed, or a value that is not a name at all)
 * falls back to the one this plugin ships.
 */
export function wallpaperNameOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : DEFAULT_WALLPAPER;
}

export function wallpaperDimOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WALLPAPER_DIM_INITIAL;
  return Math.min(WALLPAPER_DIM_MAX, Math.max(0, Math.round(value)));
}

/**
 * The image URL, keyed by the folder entry's mtime.
 *
 * Replacing a wallpaper by dropping a new file under the name already chosen is the ordinary way to
 * do it, so the URL has to change with the file or the browser keeps showing the old bitmap. The name
 * is percent-encoded, which is also what keeps a `"` in a file name from escaping the `url("…")` the
 * stylesheet receives.
 *
 * The revision is optional because only the picker has one: it reads the folder listing, so it can key each thumbnail by
 * its entry's mtime. The reading page paints the CHOSEN wallpaper and never lists the folder, so it calls this without
 * a revision and depends on the host route's own revalidation instead (`no-cache` plus an `ETag` over size+mtime, see
 * `dsh-viewtune.ts`) — the two paths to freshness had to meet somewhere, and the route is the only place both see.
 */
export function wallpaperUrl(name: string, revision?: number): string {
  const path = `/better-display/wallpaper/${encodeURIComponent(name)}`;
  return revision === undefined || !Number.isFinite(revision) ? path : `${path}?v=${String(Math.round(revision))}`;
}

/** The list route's payload, read defensively: anything unexpected means "no wallpapers". */
export function wallpaperListingOf(value: unknown): WallpaperListing {
  const payload = value as { dir?: unknown; items?: unknown } | null | undefined;
  const items: WallpaperEntry[] = [];
  if (Array.isArray(payload?.items)) {
    for (const entry of payload.items) {
      const item = entry as { name?: unknown; bytes?: unknown; mtimeMs?: unknown } | null | undefined;
      if (typeof item?.name !== 'string' || item.name === '') continue;
      items.push({
        name: item.name,
        bytes: typeof item.bytes === 'number' && Number.isFinite(item.bytes) ? item.bytes : 0,
        mtimeMs: typeof item.mtimeMs === 'number' && Number.isFinite(item.mtimeMs) ? item.mtimeMs : 0,
      });
    }
  }
  return { dir: typeof payload?.dir === 'string' ? payload.dir : '', items };
}

/**
 * The inline custom properties for the chosen wallpaper, or nothing when none is chosen.
 *
 * Only the two values the reader can change are inline; the rest of the backdrop (fixed attachment,
 * cover sizing, the two-layer order) is stated once in the stylesheet, so there is one place to read
 * the mechanism from rather than a string built in JavaScript.
 */
export function wallpaperProperties(name: string, dim: number, revision?: number): Record<string, string> {
  if (name === '') return {};
  return {
    '--wallpaper-image': `url("${wallpaperUrl(name, revision)}")`,
    '--wallpaper-dim': `${String(wallpaperDimOf(dim))}%`,
  };
}

/** Where the reading page's own box sits, in viewport coordinates. */
export interface WallpaperTarget {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface WallpaperGeometry {
  /** `background-size` for the image layer. */
  readonly size: string;
  /** `background-position` for the image layer, in viewport coordinates (the layer is viewport-anchored). */
  readonly position: string;
}

/**
 * How the image is sized and placed.
 *
 * Both scopes FILL their area, so neither leaves an unfilled band: the MAX ratio is the smallest scale
 * that covers the box, and because the image is centred on it, the overflow is cropped equally on both
 * sides.
 *
 * They differ only in WHICH box. Window scope fills the window. View scope fills the READING PAGE —
 * that distinction is the point: a fixed layer is positioned against the viewport, so `cover` on the
 * viewport hands the reading column a viewport-shaped crop, which is what made the wallpaper look
 * both partial and off-centre. Covering the page's own box puts the crop where the reader is looking.
 *
 * An earlier cut of this used the MIN ratio ("fit inside") plus a cap of 1; the reader saw both
 * consequences at once — bands of bare theme around the image, and a small image left as a patch in
 * the middle instead of filling the page. Filling is the requirement; the cap was never asked for.
 *
 * The result is in viewport coordinates because every copy is `background-attachment: fixed` — that is
 * what keeps the transcript, the gutter and the composer's fade band showing one continuous image.
 */
export function wallpaperGeometry(args: {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly target: WallpaperTarget | null;
  readonly scope: 'view' | 'window';
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): WallpaperGeometry {
  const { imageWidth, imageHeight, target, scope } = args;
  if (scope === 'window' || target === null || imageWidth <= 0 || imageHeight <= 0) {
    return { size: 'cover', position: 'center' };
  }
  const scale = Math.max(target.width / imageWidth, target.height / imageHeight);
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  const x = Math.round(target.left + (target.width - width) / 2);
  const y = Math.round(target.top + (target.height - height) / 2);
  return { size: `${String(width)}px ${String(height)}px`, position: `${String(x)}px ${String(y)}px` };
}
