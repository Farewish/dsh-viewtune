import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { commitHashes } from './commit-hash.js';
import type { Context } from '@deepseek-ai/cordis';
import { contentTypeOf, listWallpapers, resolveWallpaperFile, seedDefaultWallpaper, wallpaperDirOf } from './wallpaper-files.js';
import { SETTINGS_MAX_BYTES, readSettings, settingsFileOf, writeSettings } from './viewtune-settings.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer?: {
      register: (route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
      }) => () => void;
      /** The bound listener's local origin, when the installed webserver exposes it. */
      getOrigin?: () => string;
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
 * The most a POST body may carry.
 *
 * The commit-hash lookup sends one working directory and a handful of subjects; the settings route
 * has its own bound. This one exists for the same reason: these routes are unauthenticated on
 * localhost, so a body nobody bounded is a body that can be made as large as the process's memory.
 */
const POST_MAX_BYTES = 4 * 1024;
/**
 * The wallpaper file this build ships, beside the manifest.
 *
 * Resolved off this module's own URL so it works wherever the plugin is installed from — a checkout, a packed
 * tarball, or the `link:`ed copy the profile loads — because in all three the asset sits one directory up from
 * `lib/`.
 */
const WALLPAPER_ASSET = fileURLToPath(new URL('../assets/sample-gradient.png', import.meta.url));

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
    let bytes = 0;
    let over = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (over) return;
      // The cap is counted from the CHUNK, not by measuring the string accumulated so far: `Buffer.byteLength(body)`
      // walks and encodes the whole body again on every chunk, so a request being refused for its size was also the
      // most expensive one to read — quadratic in the number of chunks, exactly while refusing it.
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > limit) {
        over = true;
        body = '';
        // Answer now rather than waiting for the rest of a body that has already been refused: a client that keeps
        // sending must not hold the route open, and the remaining chunks are dropped by the guard above either way.
        resolve(undefined);
        return;
      }
      body += chunk;
    });
    req.on('end', () => { resolve(over ? undefined : body); });
    req.on('error', () => { resolve(undefined); });
    // A client that dies mid-body used to leave this promise unsettled for ever, and with it the route's own promise:
    // neither `end` nor `error` is guaranteed on an aborted request. `close` also fires after a normal end, where the
    // resolve is a no-op because the promise has already settled.
    req.on('aborted', () => { resolve(undefined); });
    req.on('close', () => { resolve(undefined); });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Refuse a request that did not come from this listener's own page.
 *
 * These routes are unauthenticated on localhost. The old check compared Origin to the request's own
 * Host header, which a DNS-rebinding page passes trivially: the browser sends the attacker's hostname
 * in BOTH headers while the connection lands on 127.0.0.1. The Host is therefore checked against the
 * listener's own origin (or a loopback authority) first; Origin/Referer must still agree with it, and
 * a browser-declared cross-site request is refused outright.
 *
 * A missing Host is refused: every HTTP/1.1 browser request carries one, so only a malformed client
 * loses here.
 */
function hostnameOf(authority: string): string | undefined {
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isLoopbackName(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname);
}

export function isTrustedRequest(req: IncomingMessage, originHost: string | undefined): boolean {
  const host = req.headers.host;
  if (host === undefined || host === '') return false;
  const hostname = hostnameOf(host);
  if (hostname === undefined) return false;
  const expected = originHost === undefined ? undefined : hostnameOf(originHost);
  if (!isLoopbackName(hostname) && (expected === undefined || hostname !== expected)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  for (const header of [req.headers.origin, req.headers.referer]) {
    if (header === undefined) continue;
    try {
      if (new URL(header).host.toLowerCase() !== host.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Start a platform opener and settle once the process really exists.
 *
 * `spawn` reports ENOENT and other launch failures as an asynchronous `'error'` event; without a
 * listener that is an `uncaughtException`, and this host exits the whole process on one. `unref()`
 * is what lets the opener outlive this request without keeping the Host's event loop alive.
 */
function launchDetached(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** Reveal one folder in the platform's file manager, so the reader can drop images into it. */
async function revealFolder(path: string): Promise<void> {
  if (process.platform === 'darwin') await launchDetached('open', [path]);
  else if (process.platform === 'win32') await launchDetached('explorer.exe', [path]);
  else await launchDetached('xdg-open', [path]);
}

export function apply(ctx: Context): void {
  console.log('[my-plugins/dsh-viewtune] loaded');
  console.log(`[my-plugins/dsh-viewtune] wallpaper folder: ${WALLPAPER_DIR}`);

  /**
   * The wallpaper this plugin ships, put in the reader's folder before anything can ask for it.
   *
   * At ACTIVATION rather than on the first listing: the reading view paints the stored name the moment it mounts, so
   * a seed that waited for the picker to open would leave the first look broken — which is the one case this exists
   * for. Fire-and-forget, and it never overwrites, so a reader's own picture under that name stays theirs; the
   * function answers false instead of throwing, because a bitmap must not be able to stop the plugin from mounting.
   */
  ctx.effect(() => {
    void seedDefaultWallpaper(WALLPAPER_DIR, WALLPAPER_ASSET).catch(() => undefined);
    return () => undefined;
  }, 'dsh-viewtune: shipped wallpaper');

  if (ctx.webServer) {
    /**
     * This listener's own authority, used by every route's request fence. `getOrigin()` throws before
     * the listener binds or when the bind address has no URL form; in that case only loopback
     * authorities are trusted, which is the local-desktop case this plugin is installed for.
     */
    const webOriginHost = (() => {
      try {
        const origin = ctx.webServer!.getOrigin?.();
        return origin === undefined ? undefined : new URL(origin).host;
      } catch {
        return undefined;
      }
    })();
    /**
     * Commit subjects → short hashes, for the reading view's 提交 lane.
     *
     * The lane's hash can only come from git's own output line at the moment of the commit, so a commit made with `-F <file>` (this project's
     * own habit) or one whose output was piped away arrives with a subject and no hash. The repository still knows it; this answers it. Body is
     * capped like every other POST here, same-origin is required, and the work is one `git log` in the directory the reader's session already
     * works in. Failures answer an empty record: a missing hash is a cosmetic loss, and the lane must never break over one.
     */
    ctx.effect(() => {
      return ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/commit-hashes',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          if (!isTrustedRequest(req, webOriginHost)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          const body = await readBody(req, POST_MAX_BYTES);
          if (body === undefined) {
            json(res, 413, { ok: false, error: 'payload too large' });
            return;
          }
          try {
            const data = JSON.parse(body);
            const cwd = typeof data.cwd === 'string' ? data.cwd.trim() : '';
            const subjects = Array.isArray(data.subjects) ? data.subjects.filter((s: unknown): s is string => typeof s === 'string') : [];
            if (cwd === '') {
              json(res, 400, { ok: false, error: 'Empty cwd' });
              return;
            }
            const recent = typeof data.recent === 'number' ? data.recent : 0;
            json(res, 200, { ok: true, hashes: await commitHashes(cwd, subjects) });
          } catch (err) {
            json(res, 400, { ok: false, error: String(err) });
          }
        },
      });
    }, 'dsh-viewtune: /better-display/commit-hashes route');


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
          if (!isTrustedRequest(req, webOriginHost)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          if (req.method === 'GET') {
            const read = await readSettings(READER_SETTINGS_FILE);
            if (read.kind === 'invalid') {
              // A file that exists but cannot be read or parsed is not "no record": answering `{}` would
              // let the client seed its defaults over the record it failed to read. The client's
              // `unavailable` branch already keeps its hands off the host record.
              json(res, 500, { ok: false, error: 'settings unreadable' });
              return;
            }
            json(res, 200, { ok: true, settings: read.kind === 'ok' ? read.record : {} });
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
          let written: boolean;
          try {
            written = await writeSettings(READER_SETTINGS_FILE, parsed);
          } catch (error) {
            // The write itself threw: a full disk, a read-only instance home, a file another process holds. The host
            // webserver answers a bare 400 for a rejected handler, which the client cannot tell apart from the
            // deliberate refusal below — so this answers for itself, and says which of the two happened.
            console.warn(`[viewtune] the settings record could not be written: ${String(error)}`);
            json(res, 500, { ok: false, error: 'write failed' });
            return;
          }
          if (!written) {
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
          if (!isTrustedRequest(req, webOriginHost)) {
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
          if (!isTrustedRequest(req, webOriginHost)) {
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
            // `lstat`, not `stat`: a symlink inside the wallpaper folder must not become a way to serve any
            // local image through this route. The listing already ignores symlinks (`Dirent.isFile` does not
            // follow them), so the route has to agree with it rather than offer a file the list never showed.
            const info = await lstat(file);
            if (!info.isFile() || info.isSymbolicLink()) {
              json(res, 404, { ok: false, error: 'not a file' });
              return;
            }
            /**
             * Revalidate every time, and give the browser something to revalidate WITH.
             *
             * `max-age=60` was the wrong half of the fix for "a replacement must show up": the client keys the URL by
             * mtime only for the thumbnails, which read the folder listing — the wallpaper the reading page paints has
             * no listing in hand, so it asked for the same URL and got the cached bytes for up to a minute. The etag is
             * the file's identity, so an unchanged file costs one conditional request and answers 304, while a replaced
             * one answers 200 immediately. `no-cache` does not mean "do not store"; it means "ask before using".
             */
            const etag = `W/"${String(info.size)}-${String(Math.round(info.mtimeMs))}"`;
            const headers = {
              'Content-Type': contentTypeOf(file),
              'Content-Length': String(info.size),
              'Cache-Control': 'private, no-cache',
              ETag: etag,
              'Last-Modified': new Date(info.mtimeMs).toUTCString(),
            };
            if (req.headers['if-none-match'] === etag) {
              res.writeHead(304, headers);
              res.end();
              return;
            }
            res.writeHead(200, headers);
            if (req.method === 'HEAD') {
              res.end();
              return;
            }
            /**
             * `pipeline` owns both ends: an `'error'` on the read stream (the file vanished or became
             * unreadable between `lstat` and `open`) is caught here instead of surfacing as an
             * uncaughtException that would end the whole Host. The headers are already out at this
             * point, so the only honest answer left is to close this one response.
             */
            try {
              await pipeline(createReadStream(file), res);
            } catch {
              res.destroy();
            }
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
          if (!isTrustedRequest(req, webOriginHost)) {
            json(res, 403, { ok: false, error: 'cross-origin' });
            return;
          }
          try {
            await mkdir(WALLPAPER_DIR, { recursive: true });
            await revealFolder(WALLPAPER_DIR);
          } catch (error) {
            console.warn(`[viewtune] could not reveal the wallpaper folder: ${String(error)}`);
            json(res, 500, { ok: false, error: String(error) });
            return;
          }
          json(res, 200, { ok: true, dir: WALLPAPER_DIR });
        },
      });
    }, 'dsh-viewtune: wallpaper folder route');
  }
}
