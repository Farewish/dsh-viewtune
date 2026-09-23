/**
 * The wallpaper folder: where it is, what may be served out of it, and what is in it.
 *
 * Host-side and deliberately free of HTTP. The routes in `dsh-viewtune.ts` are a thin shell over
 * these functions, which is what makes the half that decides "may a browser name this file" testable
 * without starting a server — the interesting refusals are all here.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

/** Extensions a wallpaper may have. Anything else in the folder is ignored rather than offered. */
export const WALLPAPER_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'];

/**
 * The wallpaper this plugin ships, and the name it is offered under.
 *
 * The shipped file's name IS the name the settings default to (see the client's `wallpaper.ts`), so a fresh
 * install has a backdrop rather than a reference to a file nobody put there. The two spellings live in two
 * bundles that cannot import each other, which is why the guard pins them against each other.
 */
export const DEFAULT_WALLPAPER_NAME = 'sample-gradient.png';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

export interface WallpaperEntry {
  readonly name: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export function isWallpaperName(name: string): boolean {
  return WALLPAPER_EXTENSIONS.includes(extname(name).toLowerCase());
}

export function contentTypeOf(name: string): string {
  return CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * The folder wallpapers live in: `<instance home>/wallpapers` by default.
 *
 * `DSH_VIEWTUNE_WALLPAPERS` overrides it, which is the escape hatch for a folder that should outlive
 * one harness version: the instance home is version-scoped (`homes/<version>`), so wallpapers dropped
 * into the default folder belong to that version exactly as its profiles and sessions do. With no
 * `DSH_HOME` at all the fallback is the conventional per-user `.dsh`.
 */
export function wallpaperDirOf(env: Readonly<Record<string, string | undefined>>, homedir: string): string {
  const override = env.DSH_VIEWTUNE_WALLPAPERS?.trim();
  if (override !== undefined && override !== '') return resolve(override);
  const home = env.DSH_HOME?.trim();
  return join(home !== undefined && home !== '' ? home : join(homedir, '.dsh'), 'wallpapers');
}

/**
 * The file a request may be served from, or `undefined` when it may not.
 *
 * The name arrives from the browser, so it is treated as hostile rather than as a path: it has to
 * survive `basename` unchanged (no separators either way, no `..`, no drive letter), it has to carry
 * an image extension, and the resolved path has to still sit inside the folder. The listing is not
 * evidence — a request stands on its own, so a name no listing ever mentioned is decided by these
 * same rules rather than by having been seen before.
 */
export function resolveWallpaperFile(dir: string, rawName: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    return undefined; // A malformed escape is a refusal, not an exception out of the route.
  }
  const name = decoded.trim();
  if (name === '' || !isWallpaperName(name)) return undefined;
  if (name !== basename(name)) return undefined;
  const root = resolve(dir);
  const target = resolve(root, name);
  return target.startsWith(root + sep) ? target : undefined;
}

/** Every image in the folder, newest first. A missing folder is an empty list, not an error. */
export async function listWallpapers(dir: string): Promise<WallpaperEntry[]> {  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: WallpaperEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isWallpaperName(entry.name)) continue;
    try {
      const info = await stat(join(dir, entry.name));
      found.push({ name: entry.name, bytes: info.size, mtimeMs: Math.round(info.mtimeMs) });
    } catch {
      // A file that vanished between the listing and the stat is simply not offered.
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

/**
 * Put the shipped wallpaper in the reader's folder, once, and answer whether it was put there.
 *
 * A fresh install has an EMPTY folder while the settings' own default names this file, so without this the first
 * thing a reader would see is a reference to something nobody put there — a backdrop that silently is not one. It
 * copies only when the name is ABSENT: a reader who replaced the picture, or deleted it on purpose, keeps their
 * folder exactly as they left it, and this never runs twice over the same file.
 *
 * Every failure answers `false` rather than throwing. The caller is plugin activation, and a bitmap — missing from
 * a half-finished install, or unwritable because the folder belongs to another user — must not be able to stop the
 * plugin from mounting.
 */
export async function seedDefaultWallpaper(dir: string, source: string, name: string = DEFAULT_WALLPAPER_NAME): Promise<boolean> {
  const target = join(resolve(dir), name);
  try {
    await stat(target);
    return false; // Already there, whoever put it there.
  } catch {
    // Absent, which is the only case this function has any business acting on.
  }
  try {
    await mkdir(resolve(dir), { recursive: true });
    await copyFile(source, target);
    return true;
  } catch {
    return false;
  }
}
