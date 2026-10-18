import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
//#region src/commit-hash.ts
/**
* Looking a commit's short hash up by its SUBJECT.
*
* Why this exists, host-side: the reading view's 提交 lane reads a commit off the tool call that made it, and the only place a hash is ever
* visible there is git's own output line (`[main 70beff5] subject`). A commit made with `-F <file>` has no `-m` to read, and when the call's
* output is piped or truncated that line never reaches the plugin, so the lane shows a subject with no hash — which is what the reader
* reported (「之前的百条提交都不显示哈希」). The repository still knows the answer, so the host answers it: one `git log` per working
* directory, matched by subject.
*
* Host-side and free of HTTP, like `wallpaper-files.ts`: the route in `dsh-viewtune.ts` is a thin shell over this, and the parsing — the part
* worth testing — is a pure function.
* @module
*/
const run = promisify(execFile);
/** How far back to look. Deep enough for any turn this reader will open, shallow enough to stay instant. */
const LOG_DEPTH = 3e3;
/** The most directories one lookup will stat, so a huge workspace cannot turn a lane render into a filesystem crawl. */
const REPO_CANDIDATES = 60;
/** Directories never worth walking into: build output, dependencies, and version control's own storage. */
const SKIP_DIRS = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	"dist",
	"lib",
	"build",
	".next",
	"out",
	"coverage"
]);
/** What git prints between the short hash and the subject (`%x1f`, a unit separator — a subject may contain anything else). */
const FIELD_SEPARATOR = "";
/**
* `git log --format=%h%x1f%s` output, as subject → short hash.
*
* The FIRST hash wins for a repeated subject: `git log` is newest-first, so the newest commit with that subject is the one a turn just made.
* Subjects are matched whole and case-sensitively — the subject is what the reader sees in the lane, and a fuzzy match would put a hash on a
* commit that is not the one shown.
*/
function parseCommitLog(text) {
	const bySubject = {};
	for (const line of text.split("\n")) {
		const separator = line.indexOf(FIELD_SEPARATOR);
		if (separator <= 0) continue;
		const hash = line.slice(0, separator).trim();
		const subject = line.slice(separator + 1).trim();
		if (hash === "" || subject === "" || bySubject[subject] !== void 0) continue;
		bySubject[subject] = hash;
	}
	return bySubject;
}
/**
* The directories worth asking `git log` about, given where the session says it works.
*
* The session's own `cwd` is the WORKSPACE ROOT, and that is not always the repository: this project keeps the plugin in a git WORKTREE
* (`worktree/dsh-viewtune`), so `git log` in the root fails with `fatal: not a git repository` and every subject lookup answered nothing —
* while a hand-typed worktree path worked. Rather than trust one directory, this offers the candidates that can hold the commit: the directory
* itself, its ancestors (a repository above the session's folder is a real layout), and its immediate and second-level children (a worktree is
* exactly that). Bounded on purpose: at most REPO_CANDIDATES directories are stat-ed, so a huge workspace cannot turn one lane render into a
* filesystem crawl.
*/
async function candidateDirs(cwd) {
	const found = [];
	const push = (dir) => {
		if (found.length < REPO_CANDIDATES && !found.includes(dir)) found.push(dir);
	};
	push(resolve(cwd));
	let current = resolve(cwd);
	for (let up = 0; up < 4; up += 1) {
		const parent = dirname(current);
		if (parent === current) break;
		push(parent);
		current = parent;
	}
	const list = async (dir) => {
		try {
			return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name)).map((entry) => join(dir, entry.name));
		} catch {
			return [];
		}
	};
	for (const dir of found.slice(0, 2)) for (const child of await list(dir)) {
		push(child);
		for (const grandchild of await list(child)) push(grandchild);
	}
	return found;
}
/**
* The short hashes of the subjects asked for, in whichever repository under `cwd` actually carries them.
*
* Answers only what it can prove: a subject no repository carries is simply absent, and any failure (not a repository, git missing, a timeout)
* answers an empty record rather than throwing — a lane that cannot show a hash must never break the reading view. Discovery is safe by
* construction: a candidate is accepted only because a WANTED SUBJECT matched inside it, so a wrong directory cannot produce a wrong hash.
*
* `queried` separates "the host looked and did not find it" from "the host could not look": the client
* may cache the first answer and must retry the second.
*/
async function commitHashesResult(cwd, subjects) {
	if (subjects.length === 0) return {
		hashes: {},
		queried: true
	};
	try {
		if (!(await stat(cwd)).isDirectory()) return {
			hashes: {},
			queried: false
		};
	} catch {
		return {
			hashes: {},
			queried: false
		};
	}
	const wanted = new Set(subjects);
	const found = {};
	let queried = false;
	for (const dir of await candidateDirs(cwd)) {
		let stdout = "";
		try {
			stdout = (await run("git", [
				"-C",
				dir,
				"log",
				"--all",
				"--no-merges",
				`-n${String(LOG_DEPTH)}`,
				"--format=%h%x1f%s"
			], {
				timeout: 5e3,
				maxBuffer: 8388608,
				windowsHide: true
			})).stdout;
			queried = true;
		} catch {
			continue;
		}
		const bySubject = parseCommitLog(stdout);
		for (const subject of subjects) {
			if (found[subject] !== void 0) continue;
			const hash = bySubject[subject];
			if (hash !== void 0) found[subject] = hash;
		}
		if (Object.keys(found).length === wanted.size) break;
	}
	return {
		hashes: found,
		queried
	};
}
//#endregion
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
/**
* Every image in the folder, newest first. A missing folder is an empty list, not an error.
*
* The `stat`s run together rather than one after another: a folder with a few hundred pictures was a few hundred
* sequential awaits, each one a round trip to the filesystem for a number the listing could not carry. The results are
* collected in the listing's order and sorted afterwards, so the answer does not depend on which stat finished first.
*/
async function listWallpapers(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files = entries.filter((entry) => entry.isFile() && isWallpaperName(entry.name)).map((entry) => entry.name);
	return (await Promise.all(files.map(async (name) => {
		try {
			const info = await stat(join(dir, name));
			return {
				name,
				bytes: info.size,
				mtimeMs: Math.round(info.mtimeMs)
			};
		} catch {
			return;
		}
	}))).filter((entry) => entry !== void 0).sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
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
* Read the stored record, distinguishing an absent file from one that cannot be trusted.
*
* A file is checked against the same bound the write path enforces BEFORE it is read, so a hand-edited
* or oversized file is refused without first allocating it in memory.
*/
async function readSettings(file) {
	let info;
	try {
		info = await stat(file);
	} catch (error) {
		return error.code === "ENOENT" ? { kind: "missing" } : { kind: "invalid" };
	}
	if (!info.isFile() || info.size > 65536) return { kind: "invalid" };
	let text;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		return error.code === "ENOENT" ? { kind: "missing" } : { kind: "invalid" };
	}
	try {
		const record = settingsRecordOf(JSON.parse(text));
		return record === void 0 ? { kind: "invalid" } : {
			kind: "ok",
			record
		};
	} catch {
		return { kind: "invalid" };
	}
}
/**
* Store a record, answering whether it was one.
*
* Written to a unique sibling and renamed over the target, so a crash or a full disk mid-write leaves
* the previous record in place rather than a half-written one. Writes are serialized: concurrent PUTs
* from two tabs used to share one `<file>.tmp`, and a later rename could fail (or an older body could
* land last) while both requests reported their own outcome.
*/
let writeQueue = Promise.resolve();
function writeSettings(file, value) {
	const record = settingsRecordOf(value);
	if (record === void 0) return Promise.resolve(false);
	const write = async () => {
		await mkdir(dirname(file), { recursive: true });
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
			await rename(temporary, file);
			return true;
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => void 0);
			throw error;
		}
	};
	const queued = writeQueue.then(write, write);
	writeQueue = queued.then(() => void 0, () => void 0);
	return queued;
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
* The most a POST body may carry.
*
* The commit-hash lookup sends one working directory and a handful of subjects; the settings route
* has its own bound. This one exists for the same reason: these routes are unauthenticated on
* localhost, so a body nobody bounded is a body that can be made as large as the process's memory.
*/
const POST_MAX_BYTES = 4096;
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
		let bytes = 0;
		let over = false;
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			if (over) return;
			bytes += Buffer.byteLength(chunk, "utf8");
			if (bytes > limit) {
				over = true;
				body = "";
				resolve(void 0);
				return;
			}
			body += chunk;
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
function hostnameOf(authority) {
	try {
		return new URL(`http://${authority}`).hostname.toLowerCase();
	} catch {
		return;
	}
}
function isLoopbackName(hostname) {
	return hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || /^127\./.test(hostname);
}
function isTrustedRequest(req, originHost) {
	const host = req.headers.host;
	if (host === void 0 || host === "") return false;
	const hostname = hostnameOf(host);
	if (hostname === void 0) return false;
	const expected = originHost === void 0 ? void 0 : hostnameOf(originHost);
	if (!isLoopbackName(hostname) && (expected === void 0 || hostname !== expected)) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	for (const header of [req.headers.origin, req.headers.referer]) {
		if (header === void 0) continue;
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
function launchDetached(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			detached: true,
			stdio: "ignore"
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}
/** Reveal one folder in the platform's file manager, so the reader can drop images into it. */
async function revealFolder(path) {
	if (process.platform === "darwin") await launchDetached("open", [path]);
	else if (process.platform === "win32") await launchDetached("explorer.exe", [path]);
	else await launchDetached("xdg-open", [path]);
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
		/**
		* This listener's own authority, used by every route's request fence. `getOrigin()` throws before
		* the listener binds or when the bind address has no URL form; in that case only loopback
		* authorities are trusted, which is the local-desktop case this plugin is installed for.
		*/
		const webOriginHost = (() => {
			try {
				const origin = ctx.webServer.getOrigin?.();
				return origin === void 0 ? void 0 : new URL(origin).host;
			} catch {
				return;
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
			return ctx.webServer.register({
				kind: "exact",
				path: "/better-display/commit-hashes",
				handler: async (req, res) => {
					if (req.method !== "POST") {
						res.statusCode = 405;
						res.end();
						return;
					}
					if (!isTrustedRequest(req, webOriginHost)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					const body = await readBody(req, POST_MAX_BYTES);
					if (body === void 0) {
						json(res, 413, {
							ok: false,
							error: "payload too large"
						});
						return;
					}
					try {
						const data = JSON.parse(body);
						const cwd = typeof data.cwd === "string" ? data.cwd.trim() : "";
						const subjects = Array.isArray(data.subjects) ? data.subjects.filter((s) => typeof s === "string") : [];
						if (cwd === "") {
							json(res, 400, {
								ok: false,
								error: "Empty cwd"
							});
							return;
						}
						const result = await commitHashesResult(cwd, subjects);
						json(res, 200, {
							ok: true,
							hashes: result.hashes,
							queried: result.queried
						});
					} catch (err) {
						json(res, 400, {
							ok: false,
							error: String(err)
						});
					}
				}
			});
		}, "dsh-viewtune: /better-display/commit-hashes route");
		ctx.effect(() => {
			return ctx.webServer.register({
				kind: "exact",
				path: READER_SETTINGS_PATH,
				handler: async (req, res) => {
					if (!isTrustedRequest(req, webOriginHost)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					if (req.method === "GET") {
						const read = await readSettings(READER_SETTINGS_FILE);
						if (read.kind === "invalid") {
							json(res, 500, {
								ok: false,
								error: "settings unreadable"
							});
							return;
						}
						json(res, 200, {
							ok: true,
							settings: read.kind === "ok" ? read.record : {}
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
					if (!isTrustedRequest(req, webOriginHost)) {
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
					if (!isTrustedRequest(req, webOriginHost)) {
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
						const info = await lstat(file);
						if (!info.isFile() || info.isSymbolicLink()) {
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
					if (!isTrustedRequest(req, webOriginHost)) {
						json(res, 403, {
							ok: false,
							error: "cross-origin"
						});
						return;
					}
					try {
						await mkdir(WALLPAPER_DIR, { recursive: true });
						await revealFolder(WALLPAPER_DIR);
					} catch (error) {
						console.warn(`[viewtune] could not reveal the wallpaper folder: ${String(error)}`);
						json(res, 500, {
							ok: false,
							error: String(error)
						});
						return;
					}
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
export { READER_SETTINGS_PATH, apply, inject, isTrustedRequest, name };
