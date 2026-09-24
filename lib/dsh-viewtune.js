import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
//#region src/wallpaper-files.ts
/**
* The wallpaper folder: where it is, what may be served out of it, and what is in it.
*
* Host-side and deliberately free of HTTP. The routes in `dsh-viewtune.ts` are a thin shell over
* these functions, which is what makes the half that decides "may a browser name this file" testable
* without starting a server — the interesting refusals are all here.
*/
/** Extensions a wallpaper may have. Anything else in the folder is ignored rather than offered. */
const WALLPAPER_EXTENSIONS = [
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".avif",
	".bmp"
];
/**
* The wallpaper this plugin ships, and the name it is offered under.
*
* The shipped file's name IS the name the settings default to (see the client's `wallpaper.ts`), so a fresh
* install has a backdrop rather than a reference to a file nobody put there. The two spellings live in two
* bundles that cannot import each other, which is why the guard pins them against each other.
*/
const DEFAULT_WALLPAPER_NAME = "sample-gradient.png";
const CONTENT_TYPES = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
	".bmp": "image/bmp"
};
function isWallpaperName(name) {
	return WALLPAPER_EXTENSIONS.includes(extname(name).toLowerCase());
}
function contentTypeOf(name) {
	return CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
}
/**
* The folder wallpapers live in: `<instance home>/wallpapers` by default.
*
* `DSH_VIEWTUNE_WALLPAPERS` overrides it, which is the escape hatch for a folder that should outlive
* one harness version: the instance home is version-scoped (`homes/<version>`), so wallpapers dropped
* into the default folder belong to that version exactly as its profiles and sessions do. With no
* `DSH_HOME` at all the fallback is the conventional per-user `.dsh`.
*/
function wallpaperDirOf(env, homedir) {
	const override = env.DSH_VIEWTUNE_WALLPAPERS?.trim();
	if (override !== void 0 && override !== "") return resolve(override);
	const home = env.DSH_HOME?.trim();
	return join(home !== void 0 && home !== "" ? home : join(homedir, ".dsh"), "wallpapers");
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
function resolveWallpaperFile(dir, rawName) {
	let decoded;
	try {
		decoded = decodeURIComponent(rawName);
	} catch {
		return;
	}
	const name = decoded.trim();
	if (name === "" || !isWallpaperName(name)) return void 0;
	if (name !== basename(name)) return void 0;
	const root = resolve(dir);
	const target = resolve(root, name);
	return target.startsWith(root + sep) ? target : void 0;
}
/** Every image in the folder, newest first. A missing folder is an empty list, not an error. */
async function listWallpapers(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const found = [];
	for (const entry of entries) {
		if (!entry.isFile() || !isWallpaperName(entry.name)) continue;
		try {
			const info = await stat(join(dir, entry.name));
			found.push({
				name: entry.name,
				bytes: info.size,
				mtimeMs: Math.round(info.mtimeMs)
			});
		} catch {}
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
async function seedDefaultWallpaper(dir, source, name = DEFAULT_WALLPAPER_NAME) {
	const target = join(resolve(dir), name);
	try {
		await stat(target);
		return false;
	} catch {}
	try {
		await mkdir(resolve(dir), { recursive: true });
		await copyFile(source, target);
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/viewtune-settings.ts
/**
* Where a reader's settings live between runs.
*
* The client store persists to `localStorage`, and `localStorage` is keyed by ORIGIN — scheme, host and
* port. The GUI is served on an ephemeral port, so every launch is a new origin and every setting was
* gone by the next one: reported as "every time I quit DSH, all of viewtune's settings are reset",
* and true of anything else the app keeps there, not just this plugin. So the record gets a second
* home on the HOST, inside the instance home beside the wallpapers, and the client reads that copy at
* startup and writes it back on change. A different port, a different browser, a different origin —
* the record is the same file.
*
* Host-side and free of HTTP, like `wallpaper-files.ts`: the route in `dsh-viewtune.ts` is a thin shell
* over these, which is what makes the refusals ("is this a record we are willing to keep?") testable
* without starting a server.
*/
/**
* The largest record accepted, on the way in and on the way out.
*
* The route is unauthenticated on localhost, so the body is bounded before it is parsed rather than
* after: a settings record is a handful of numbers and names, and anything past this is not one.
*/
const SETTINGS_MAX_BYTES = 65536;
/**
* The record's file: `<instance home>/viewtune-settings.json` by default.
*
* `DSH_VIEWTUNE_SETTINGS` overrides it, the same escape hatch the wallpaper folder has — the instance
* home is version-scoped (`homes/<version>`), so a record that should outlive one harness version
* needs one. With no `DSH_HOME` at all the fallback is the conventional per-user `.dsh`.
*/
function settingsFileOf(env, homedir) {
	const override = env.DSH_VIEWTUNE_SETTINGS?.trim();
	if (override !== void 0 && override !== "") return resolve(override);
	const home = env.DSH_HOME?.trim();
	return join(home !== void 0 && home !== "" ? home : join(homedir, ".dsh"), "viewtune-settings.json");
}
/**
* The record we are willing to keep, or `undefined` for anything that is not one.
*
* A plain object only: an array, a bare number or a string is not a settings record, and storing one
* would only move the failure to whoever reads it next. It must also survive `JSON.stringify` (no
* cycles) and fit the bound. `JSON.stringify` returning `undefined` is its own refusal — that happens
* for a function or a symbol, which cannot be a value a reader ever set.
*/
function settingsRecordOf(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
	let text;
	try {
		text = JSON.stringify(value);
	} catch {
		return;
	}
	if (text === void 0 || Buffer.byteLength(text, "utf8") > 65536) return void 0;
	return value;
}
/**
* Read the stored record, or `undefined` when there is nothing usable to read.
*
* A missing file, a truncated one and a hand-edited one all answer the same way: the caller falls back
* to the reader's defaults. That is deliberate — a settings file is allowed to be absent on a first
* run, and a reader is not supposed to be locked out of their own app by one.
*/
async function readSettings(file) {
	let text;
	try {
		text = await readFile(file, "utf8");
	} catch {
		return;
	}
	try {
		return settingsRecordOf(JSON.parse(text));
	} catch {
		return;
	}
}
/**
* Store a record, answering whether it was one.
*
* Written to a sibling and renamed over the target, so a crash or a full disk mid-write leaves the
* previous record in place rather than a half-written one. The reader's settings are exactly the kind
* of thing that must not become unreadable because the write was interrupted.
*/
async function writeSettings(file, value) {
	const record = settingsRecordOf(value);
	if (record === void 0) return false;
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	await rename(temporary, file);
	return true;
}
//#endregion
//#region src/dsh-viewtune.ts
const name = "dsh-viewtune";
const inject = ["webServer"];
/** Where the reader drops wallpapers (see `wallpaper-files.ts` for why it is the instance home). */
const WALLPAPER_DIR = wallpaperDirOf(process.env, homedir());
const WALLPAPER_LIST_PATH = "/better-display/wallpapers";
/**
* The image route's prefix — with NO trailing slash.
*
* The webserver matches a prefix route with `pathname === prefix || pathname.startsWith(prefix + '/')`,
* so registering `/better-display/wallpaper/` asks for a doubled slash and the route never matches at
* all: the browser gets the server's bare 404 and the thumbnails silently do nothing. The name is
* whatever follows this prefix.
*/
const WALLPAPER_ROUTE = "/better-display/wallpaper";
const WALLPAPER_FILE_PATH = `${WALLPAPER_ROUTE}/`;
const WALLPAPER_REVEAL_PATH = "/better-display/wallpapers/reveal";
/** The reader's settings record, kept by the host so a restart cannot lose it (see the settings module). */
const READER_SETTINGS_PATH = "/better-display/settings";
const READER_SETTINGS_FILE = settingsFileOf(process.env, homedir());
/**
* The most a reveal request may carry.
*
* The payload is one path — a few hundred bytes at the outside — and the route is unauthenticated on localhost, which
* is the same reason the settings route has a cap. That route had one and this one did not: it accumulated whatever
* arrived and parsed it at the end, so the body could be made as large as the process's memory.
*/
const REVEAL_MAX_BYTES = 4096;
/**
* The wallpaper file this build ships, beside the manifest.
*
* Resolved off this module's own URL so it works wherever the plugin is installed from — a checkout, a packed
* tarball, or the `link:`ed copy the profile loads — because in all three the asset sits one directory up from
* `lib/`.
*/
const WALLPAPER_ASSET = fileURLToPath(new URL("../assets/sample-gradient.png", import.meta.url));
/**
* Read a request body, refusing anything past `limit` bytes.
*
* The cap is enforced WHILE the body arrives rather than after it is collected: these routes are
* unauthenticated on localhost, so a body nobody bounded is a body that can be made as large as the
* process's memory. Returns `undefined` when the cap is passed, and the request is left for the caller
* to answer.
*/
function readBody(req, limit) {
	return new Promise((resolve) => {
		let body = "";
		let over = false;
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			if (over) return;
			body += chunk;
			if (Buffer.byteLength(body, "utf8") > limit) {
				over = true;
				body = "";
				resolve(void 0);
			}
		});
		req.on("end", () => {
			resolve(over ? void 0 : body);
		});
		req.on("error", () => {
			resolve(void 0);
		});
		req.on("aborted", () => {
			resolve(void 0);
		});
		req.on("close", () => {
			resolve(void 0);
		});
	});
}
function json(res, status, body) {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
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
function sameOrigin(req) {
	const host = req.headers.host;
	if (host === void 0) return true;
	for (const header of [req.headers.origin, req.headers.referer]) {
		if (header === void 0) continue;
		try {
			if (new URL(header).host !== host) return false;
		} catch {
			return false;
		}
	}
	return true;
}
/** Reveal one folder in the platform's file manager, so the reader can drop images into it. */
function revealFolder(path) {
	if (process.platform === "darwin") spawn("open", [path], {
		detached: true,
		stdio: "ignore"
	});
	else if (process.platform === "win32") spawn("explorer.exe", [path], {
		detached: true,
		stdio: "ignore"
	});
	else spawn("xdg-open", [path], {
		detached: true,
		stdio: "ignore"
	});
}
function apply(ctx) {
	console.log("[my-plugins/dsh-viewtune] loaded");
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
		seedDefaultWallpaper(WALLPAPER_DIR, WALLPAPER_ASSET).catch(() => void 0);
		return () => void 0;
	}, "dsh-viewtune: shipped wallpaper");
	if (ctx.webServer) {
		ctx.effect(() => {
			return ctx.webServer.register({
				kind: "exact",
				path: "/better-display/reveal",
				handler: async (req, res) => {
					if (req.method !== "POST") {
						res.statusCode = 405;
						res.end();
						return;
					}
					if (!sameOrigin(req)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					const body = await readBody(req, REVEAL_MAX_BYTES);
					if (body === void 0) {
						json(res, 413, {
							ok: false,
							error: "payload too large"
						});
						return;
					}
					try {
						const data = JSON.parse(body);
						const targetPath = typeof data.path === "string" ? data.path.trim() : "";
						if (!targetPath) {
							json(res, 400, {
								ok: false,
								error: "Empty path"
							});
							return;
						}
						if (process.platform === "darwin") spawn("open", ["-R", targetPath], {
							detached: true,
							stdio: "ignore"
						});
						else if (process.platform === "win32") spawn("explorer.exe", [`/select,${targetPath}`], {
							detached: true,
							stdio: "ignore"
						});
						else spawn("xdg-open", [targetPath], {
							detached: true,
							stdio: "ignore"
						});
						json(res, 200, { ok: true });
					} catch (err) {
						json(res, 400, {
							ok: false,
							error: String(err)
						});
					}
				}
			});
		}, "dsh-viewtune: /api/better-display/reveal route");
		ctx.effect(() => {
			return ctx.webServer.register({
				kind: "exact",
				path: READER_SETTINGS_PATH,
				handler: async (req, res) => {
					if (!sameOrigin(req)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					if (req.method === "GET") {
						json(res, 200, {
							ok: true,
							settings: await readSettings(READER_SETTINGS_FILE) ?? {}
						});
						return;
					}
					if (req.method !== "PUT") {
						json(res, 405, {
							ok: false,
							error: "GET or PUT"
						});
						return;
					}
					const body = await readBody(req, SETTINGS_MAX_BYTES);
					if (body === void 0) {
						json(res, 413, {
							ok: false,
							error: "payload too large"
						});
						return;
					}
					let parsed;
					try {
						parsed = JSON.parse(body);
					} catch {
						json(res, 400, {
							ok: false,
							error: "invalid JSON"
						});
						return;
					}
					let written;
					try {
						written = await writeSettings(READER_SETTINGS_FILE, parsed);
					} catch (error) {
						console.warn(`[viewtune] the settings record could not be written: ${String(error)}`);
						json(res, 500, {
							ok: false,
							error: "write failed"
						});
						return;
					}
					if (!written) {
						json(res, 400, {
							ok: false,
							error: "not a settings record"
						});
						return;
					}
					json(res, 200, { ok: true });
				}
			});
		}, "dsh-viewtune: reader settings route");
		ctx.effect(() => {
			return ctx.webServer.register({
				kind: "exact",
				path: WALLPAPER_LIST_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") {
						json(res, 405, {
							ok: false,
							error: "GET only"
						});
						return;
					}
					if (!sameOrigin(req)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					json(res, 200, {
						ok: true,
						dir: WALLPAPER_DIR,
						items: await listWallpapers(WALLPAPER_DIR)
					});
				}
			});
		}, "dsh-viewtune: wallpaper list route");
		ctx.effect(() => {
			return ctx.webServer.register({
				kind: "prefix",
				path: WALLPAPER_ROUTE,
				handler: async (req, res) => {
					if (req.method !== "GET" && req.method !== "HEAD") {
						json(res, 405, {
							ok: false,
							error: "GET only"
						});
						return;
					}
					if (!sameOrigin(req)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					const name = new URL(req.url ?? "/", "http://localhost").pathname.slice(WALLPAPER_FILE_PATH.length);
					const file = resolveWallpaperFile(WALLPAPER_DIR, name);
					if (file === void 0) {
						json(res, 404, {
							ok: false,
							error: "not a wallpaper"
						});
						return;
					}
					try {
						const info = await stat(file);
						if (!info.isFile()) {
							json(res, 404, {
								ok: false,
								error: "not a file"
							});
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
							"Content-Type": contentTypeOf(file),
							"Content-Length": String(info.size),
							"Cache-Control": "private, no-cache",
							ETag: etag,
							"Last-Modified": new Date(info.mtimeMs).toUTCString()
						};
						if (req.headers["if-none-match"] === etag) {
							res.writeHead(304, headers);
							res.end();
							return;
						}
						res.writeHead(200, headers);
						if (req.method === "HEAD") {
							res.end();
							return;
						}
						createReadStream(file).pipe(res);
					} catch {
						json(res, 404, {
							ok: false,
							error: "gone"
						});
					}
				}
			});
		}, "dsh-viewtune: wallpaper file route");
		ctx.effect(() => {
			return ctx.webServer.register({
				kind: "exact",
				path: WALLPAPER_REVEAL_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") {
						json(res, 405, {
							ok: false,
							error: "POST only"
						});
						return;
					}
					if (!sameOrigin(req)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					try {
						await mkdir(WALLPAPER_DIR, { recursive: true });
					} catch (error) {
						json(res, 500, {
							ok: false,
							error: String(error)
						});
						return;
					}
					revealFolder(WALLPAPER_DIR);
					json(res, 200, {
						ok: true,
						dir: WALLPAPER_DIR
					});
				}
			});
		}, "dsh-viewtune: wallpaper folder route");
	}
}
//#endregion
export { READER_SETTINGS_PATH, apply, inject, name };
