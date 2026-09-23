import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import { contentTypeOf, listWallpapers, resolveWallpaperFile, wallpaperDirOf } from './wallpaper-files.js';
import { SETTINGS_MAX_BYTES, readSettings, settingsFileOf, writeSettings } from './viewtune-settings.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer?: {
      register: (route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
      }) => () => void;
    };
  }
}

export const name = 'dsh-viewtune';
export const inject = ['webServer'];

/** Where the reader drops wallpapers (see `wallpaper-files.ts` for why it is the instance home). */
const WALLPAPER_DIR = wallpaperDirOf(process.env, homedir());
const WALLPAPER_LIST_PATH = '/better-display/wallpapers';
/**
 * The image route's prefix — with NO trailing slash.
 *
 * The webserver matches a prefix route with `pathname === prefix || pathname.startsWith(prefix + '/')`,
 * so registering `/better-display/wallpaper/` asks for a doubled slash and the route never matches at
 * all: the browser gets the server's bare 404 and the thumbnails silently do nothing. The name is
 * whatever follows this prefix.
 */
const WALLPAPER_ROUTE = '/better-display/wallpaper';
const WALLPAPER_FILE_PATH = `${WALLPAPER_ROUTE}/`;
const WALLPAPER_REVEAL_PATH = '/better-display/wallpapers/reveal';
/** The reader's settings record, kept by the host so a restart cannot lose it (see the settings module). */
export const READER_SETTINGS_PATH = '/better-display/settings';
const READER_SETTINGS_FILE = settingsFileOf(process.env, homedir());

/**
 * Read a request body, refusing anything past `limit` bytes.
 *
 * The cap is enforced WHILE the body arrives rather than after it is collected: these routes are
 * unauthenticated on localhost, so a body nobody bounded is a body that can be made as large as the
 * process's memory. Returns `undefined` when the cap is passed, and the request is left for the caller
 * to answer.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  return new Promise(resolve => {
    let body = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (over) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > limit) {
        over = true;
        body = '';
      }
    });
    req.on('end', () => { resolve(over ? undefined : body); });
    req.on('error', () => { resolve(undefined); });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Refuse a request that came from another page.
 *
 * These routes are unauthenticated on localhost, so without this a page the reader happens to have
 * open could list their wallpaper folder, read the files out of it, or ask the OS to reveal it. A
 * browser always sends `Origin` (cross-origin fetch) or `Referer` (image load) on such a request;
 * anything carrying neither is a local client rather than a page, and is left alone.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (host === undefined) return true;
  for (const header of [req.headers.origin, req.headers.referer]) {
    if (header === undefined) continue;
    try {
      if (new URL(header).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Reveal one folder in the platform's file manager, so the reader can drop images into it. */
function revealFolder(path: string): void {
  if (process.platform === 'darwin') {
    spawn('open', [path], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    spawn('explorer.exe', [path], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [path], { detached: true, stdio: 'ignore' });
  }
}

export function apply(ctx: Context): void {
  console.log('[my-plugins/dsh-viewtune] loaded');
  console.log(`[my-plugins/dsh-viewtune] wallpaper folder: ${WALLPAPER_DIR}`);

  if (ctx.webServer) {
    ctx.effect(() => {
      return ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/reveal',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          if (!sameOrigin(req)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = typeof data.path === 'string' ? data.path.trim() : '';
              if (!targetPath) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Empty path' }));
                return;
              }

              if (process.platform === 'darwin') {
                // Exact file reveal in macOS Finder with selection highlight
                spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' });
              } else if (process.platform === 'win32') {
                // Exact file selection in Windows Explorer
                spawn('explorer.exe', [`/select,${targetPath}`], { detached: true, stdio: 'ignore' });
              } else {
                spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' });
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });
        },
      });
    }, 'dsh-viewtune: /api/better-display/reveal route');

    // The reader's settings, kept HERE rather than only in the browser. The client store persists to
    // localStorage, which is keyed by ORIGIN — and this server's port is ephemeral, so every launch is a
    // new origin with an empty store: "every time I quit DSH, all of viewtune's settings are reset".
    // GET hands the record back (or an empty one, which the client reads as "nothing stored yet"); PUT
    // replaces it. Both refuse another page's request, and the body is capped before it is parsed.
    ctx.effect(() => {
      return ctx.webServer!.register({
        kind: 'exact',
        path: READER_SETTINGS_PATH,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          if (req.method === 'GET') {
            json(res, 200, { ok: true, settings: (await readSettings(READER_SETTINGS_FILE)) ?? {} });
            return;
          }
          if (req.method !== 'PUT') {
            json(res, 405, { ok: false, error: 'GET or PUT' });
            return;
          }
          const body = await readBody(req, SETTINGS_MAX_BYTES);
          if (body === undefined) {
            json(res, 413, { ok: false, error: 'payload too large' });
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            json(res, 400, { ok: false, error: 'invalid JSON' });
            return;
          }
          // The record is refused rather than coerced: whatever is stored is what the next run reads
          // back, so a shape this half does not recognise must not be written over a good one.
          if (!(await writeSettings(READER_SETTINGS_FILE, parsed))) {
            json(res, 400, { ok: false, error: 'not a settings record' });
            return;
          }
          json(res, 200, { ok: true });
        },
      });
    }, 'dsh-viewtune: reader settings route');

    // What the wallpaper picker shows: the folder itself plus one entry per image in it.
    ctx.effect(() => {
      return ctx.webServer!.register({
        kind: 'exact',
        path: WALLPAPER_LIST_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: 'GET only' });
            return;
          }
          if (!sameOrigin(req)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          json(res, 200, { ok: true, dir: WALLPAPER_DIR, items: await listWallpapers(WALLPAPER_DIR) });
        },
      });
    }, 'dsh-viewtune: wallpaper list route');

    // The image itself. A prefix route, so the name is the rest of the path — and the only thing
    // that decides whether it may be served is `resolveWallpaperFile`, which never trusts it.
    ctx.effect(() => {
      return ctx.webServer!.register({
        kind: 'prefix',
        path: WALLPAPER_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            json(res, 405, { ok: false, error: 'GET only' });
            return;
          }
          if (!sameOrigin(req)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          const name = new URL(req.url ?? '/', 'http://localhost').pathname.slice(WALLPAPER_FILE_PATH.length);
          const file = resolveWallpaperFile(WALLPAPER_DIR, name);
          if (file === undefined) {
            json(res, 404, { ok: false, error: 'not a wallpaper' });
            return;
          }
          try {
            const info = await stat(file);
            if (!info.isFile()) {
              json(res, 404, { ok: false, error: 'not a file' });
              return;
            }
            res.writeHead(200, {
              'Content-Type': contentTypeOf(file),
              'Content-Length': String(info.size),
              // Short, because the reader replaces a wallpaper by dropping a new file under the same
              // name; the client also keys the URL by the folder entry's mtime (see wallpaper.ts).
              'Cache-Control': 'private, max-age=60',
            });
            if (req.method === 'HEAD') {
              res.end();
              return;
            }
            createReadStream(file).pipe(res);
          } catch {
            json(res, 404, { ok: false, error: 'gone' });
          }
        },
      });
    }, 'dsh-viewtune: wallpaper file route');

    // "Open the folder" — created on demand, so the button works before anything was ever dropped in.
    ctx.effect(() => {
      return ctx.webServer!.register({
        kind: 'exact',
        path: WALLPAPER_REVEAL_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: 'POST only' });
            return;
          }
          if (!sameOrigin(req)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          try {
            await mkdir(WALLPAPER_DIR, { recursive: true });
          } catch (error) {
            json(res, 500, { ok: false, error: String(error) });
            return;
          }
          revealFolder(WALLPAPER_DIR);
          json(res, 200, { ok: true, dir: WALLPAPER_DIR });
        },
      });
    }, 'dsh-viewtune: wallpaper folder route');
  }
}
