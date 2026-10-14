import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
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
* The short hashes of the subjects asked for, in the repository at `cwd`.
*
* Answers only what it can prove: a subject the log does not carry is simply absent, and any failure (not a repository, git missing, a
* timeout, a directory that is not there) answers an empty record rather than throwing — a lane that cannot show a hash must never break the
* reading view.
*/
async function commitHashes(cwd, subjects) {
	if (subjects.length === 0) return {};
	try {
		if (!(await stat(cwd)).isDirectory()) return {};
	} catch {
		return {};
	}
	let stdout = "";
	try {
		stdout = (await run("git", [
			"-C",
			cwd,
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
	} catch {
		return {};
	}
	const bySubject = parseCommitLog(stdout);
	const wanted = {};
	for (const subject of subjects) {
		const found = bySubject[subject];
		if (found !== void 0) wanted[subject] = found;
	}
	return wanted;
}
//#endregion
//#region src/commit-record.ts
/**
* Recording what a session's tool calls actually said, so a commit can be answered by CALL ID.
*
* Why this exists. The reading view's 提交 lane reads a commit off the tool call that made it, and everything it can see is the UI projection of
* that call — which the host TRUNCATES. A long `-m` message arrives as `…`, and a truncated result carries no `[main 1a2b3c4] subject` line at
* all, so the lane ends up with a subject of `…` and no hash (the reader hit exactly that; the earlier fix looked a hash up by subject, which
* cannot work when the subject itself was cut away, and pairing by position would show someone else's hash under concurrent commits).
*
* The events the host publishes are the UNTRUNCATED originals, so this keeps them: `session/event` fires for every append, and the recorder
* holds a bounded window per session. Nothing needs to know the event type names — the detection below is the same shape-matching the client
* has always done, run over the recorded data — which is deliberate: a future event-type rename cannot silently break the lane.
*
* Bounded on purpose: this is a cache for the view, not an archive. A session keeps its newest EVENTS_PER_SESSION events and the store keeps
* SESSIONS sessions; both are small, so a long-running instance cannot grow without limit.
* @module
*/
/** How many of a session's newest events are kept. A turn's calls and their results sit well inside this. */
const EVENTS_PER_SESSION = 4e3;
/** How many sessions are kept. The reader looks at the open one; a few more cover recently visited tabs. */
const SESSIONS = 24;
/** How much of one event's serialized data is searched. A tool result can be large; a commit line sits near its start. */
const SEARCH_LIMIT = 2e4;
const sessions = /* @__PURE__ */ new Map();
function recordOf(sessionId) {
	const existing = sessions.get(sessionId);
	if (existing !== void 0) {
		sessions.delete(sessionId);
		sessions.set(sessionId, existing);
		return existing;
	}
	const created = {
		events: [],
		bySeq: /* @__PURE__ */ new Map()
	};
	sessions.set(sessionId, created);
	while (sessions.size > SESSIONS) {
		const oldest = sessions.keys().next();
		if (oldest.done === true) break;
		sessions.delete(oldest.value);
	}
	return created;
}
/** Serialize one event's data defensively: a circular or hostile value must not stop the recorder. */
function serialize(data) {
	try {
		const text = typeof data === "string" ? data : JSON.stringify(data);
		return typeof text === "string" ? text.slice(0, SEARCH_LIMIT) : "";
	} catch {
		return "";
	}
}
/**
* Record one appended event. Called for EVERY `session/event`, never throwing: a record that breaks must not take the host down with it.
*/
function recordSessionEvent(sessionId, seq, time, type, data) {
	try {
		const session = recordOf(sessionId);
		const event = {
			seq,
			time,
			type,
			text: serialize(data)
		};
		session.events.push(event);
		session.bySeq.set(seq, event);
		while (session.events.length > EVENTS_PER_SESSION) {
			const dropped = session.events.shift();
			if (dropped === void 0) break;
			session.bySeq.delete(dropped.seq);
		}
	} catch {}
}
/** How much of an event's own text is handed to the detector. */
const RECORD_SEARCH_LIMIT = SEARCH_LIMIT;
/** The recorded events of one session, oldest first, or empty when nothing was recorded. */
function recordedEvents(sessionId) {
	return sessions.get(sessionId)?.events ?? [];
}
//#endregion
//#region src/commit-parse.ts
/**
* Reading a commit out of a tool call — the two pure pieces, shared verbatim by the client and the host.
*
* Both sides need them and they must not drift: the CLIENT runs them over what the UI projection hands it (which the host truncates), and the
* HOST runs them over the untruncated events it records. One source means a commit the host can name is always a commit the client recognises.
* @module
*/
/** What a session's commit bubble shows when no message could be read at all. */
const UNKNOWN_COMMIT = "未读到提交信息";
/** `git commit` in COMMAND position, allowing the global options between the program and its subcommand, in a subshell, or with output captured. */
const GIT_COMMIT = /(?:^|[;&|(]|\$\(|\bthen\b)\s*git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+)*commit\b/;
/** The message's first line, from the command's own `-m`, or `UNKNOWN_COMMIT` when the command carries none. */
function commitSubject(command) {
	const quoted = /(?:^|\s)-{1,2}m(?:essage)?[= ](?:"([^"]+)"|'([^']+)'|([^\s"'&|;]+))/m.exec(command);
	const subject = (quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? "").split("\n")[0]?.trim() ?? "";
	return subject === "" ? UNKNOWN_COMMIT : subject;
}
/** Git's own summary line in a result: `[branch 1a2b3c4] the subject` — or the one-line log shape, `<hash> <subject>`. */
function commitSummary(text) {
	const match = /^\s*\[[^\]\s]+ ([0-9a-f]{7,40})\]\s*(.*)$/m.exec(text);
	if (match !== null) return {
		hash: match[1],
		subject: match[2]?.trim()
	};
	const bare = /^[^\S\n]*([0-9a-f]{7,40})[^\S\n]+(\S.*)$/m.exec(text);
	if (bare === null) return {};
	return {
		hash: bare[1],
		subject: bare[2]?.trim()
	};
}
//#endregion
//#region src/commit-calls.ts
/**
* The commits a session actually made, answered by CALL ID from the untruncated events.
*
* The client cannot always name a commit: the UI projection truncates a long call, so a subject can arrive as `…` and the result can lose git's
* own line. The events are the originals, so this walks the recorded ones in order, runs the shared parsing over each, and returns the commits it
* recognises keyed by the call they belong to. A caller with a `callId` then gets the RIGHT hash — no positional pairing and no time window,
* which is what a concurrent commit to the same repository would break.
*
* A call's id is looked for in the event's own data under the names the harness uses, and when no id can be found the commit is still reported,
* in order, so a caller that knows no ids either can pair positionally as a last resort. Nothing here throws: an event that cannot be read is
* skipped.
* @module
*/
const CALL_ID_FIELDS = [
	"callId",
	"callID",
	"id",
	"toolCallId",
	"tool_call_id"
];
/** The names a shell command travels under in this harness's tool calls, matching the client's own reader. */
const COMMAND_FIELDS = [
	"command",
	"cmd",
	"script",
	"input"
];
/**
* The command inside one recorded event, or undefined when the event is not a command-carrying call.
*
* The event arrives SERIALIZED, so the command is a string INSIDE JSON — and the client's quoting rule (which strips quoted spans so prose cannot
* look like a commit) must NOT be applied to the whole document: in JSON every string is quoted, so that would erase the command itself. That is
* exactly the bug the recorder's own test caught. This walks the parsed value for the fields a command can live under and hands back the raw
* string, which needs no unquoting at all.
*/
function commandIn(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	const seen = /* @__PURE__ */ new Set();
	const walk = (value, depth) => {
		if (depth > 6 || value === null || typeof value !== "object" || seen.has(value)) return void 0;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) {
				const found = walk(item, depth + 1);
				if (found !== void 0) return found;
			}
			return;
		}
		for (const [key, inner] of Object.entries(value)) if (COMMAND_FIELDS.includes(key) && typeof inner === "string" && inner !== "") return inner;
		for (const inner of Object.values(value)) {
			const found = walk(inner, depth + 1);
			if (found !== void 0) return found;
		}
	};
	return walk(parsed, 0);
}
/**
* Every string inside one recorded event, joined by real newlines.
*
* Git's summary line lives in a RESULT, which is a string inside the serialized event — and `commitSummary` anchors its patterns to a line start,
* so it has to see real newlines rather than the `\n` escapes of JSON. Joining the strings (and unescaping them) gives it exactly the text the
* tool printed.
*/
function textIn(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return "";
	}
	const parts = [];
	const seen = /* @__PURE__ */ new Set();
	const walk = (value, depth) => {
		if (depth > 6 || value === null || seen.has(value)) return;
		if (typeof value === "string") {
			parts.push(value);
			return;
		}
		if (typeof value !== "object") return;
		seen.add(value);
		for (const inner of Array.isArray(value) ? value : Object.values(value)) walk(inner, depth + 1);
	};
	walk(parsed, 0);
	return parts.join("\n");
}
/** A call id inside one serialized event, under any of the names the harness uses at its call sites. */
function callIdOf(text) {
	for (const field of CALL_ID_FIELDS) {
		const match = new RegExp(`"${field}"\\s*:\\s*"([^"]{1,200})"`).exec(text);
		if (match !== null && match[1] !== void 0 && match[1] !== "") return match[1];
	}
}
/** One recorded event paired with the id it names, if any. */
function idOf(event) {
	return callIdOf(event.text);
}
/**
* Every commit the recorded events prove, oldest first.
*
* The detection is the client's own: the command comes from an event whose text carries `git commit`, and git's line comes from the event that
* carries the matching id (the result). A commit is reported when either half is present, because either half is useful — a hash with no subject
* still pastes into `git show`.
*/
function recordedCommits(sessionId) {
	const events = recordedEvents(sessionId);
	const commits = [];
	const seen = /* @__PURE__ */ new Set();
	const summaries = /* @__PURE__ */ new Map();
	for (const event of events) {
		const summary = commitSummary(textIn(event.text).slice(0, RECORD_SEARCH_LIMIT));
		const id = idOf(event);
		if (id !== void 0 && summary.hash !== void 0) summaries.set(id, summary);
	}
	for (const event of events) {
		const command = commandIn(event.text);
		if (command === void 0 || !GIT_COMMIT.test(command)) continue;
		const id = idOf(event);
		const summary = id === void 0 ? void 0 : summaries.get(id);
		const fromCommand = commitSubject(command);
		const subject = fromCommand === "未读到提交信息" && summary?.subject !== void 0 && summary.subject !== "" ? summary.subject : fromCommand;
		const hash = summary?.hash;
		const key = `${id ?? ""}\u0000${hash ?? ""}\u0000${subject}`;
		if (seen.has(key)) continue;
		seen.add(key);
		commits.push(hash === void 0 ? {
			...id === void 0 ? {} : { callId: id },
			subject
		} : {
			...id === void 0 ? {} : { callId: id },
			hash,
			subject
		});
	}
	return commits;
}
/** The commits the recorded events prove, keyed by call id — what the route answers. */
function recordedCommitsByCall(sessionId, callIds) {
	const wanted = new Set(callIds);
	const byCall = {};
	for (const commit of recordedCommits(sessionId)) {
		if (commit.callId === void 0 || !wanted.has(commit.callId)) continue;
		byCall[commit.callId] = commit.hash === void 0 ? { subject: commit.subject } : {
			hash: commit.hash,
			subject: commit.subject
		};
	}
	return byCall;
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
	/**
	* Record every appended session event, so a commit can later be answered by CALL ID.
	*
	* `session/event` is the supported append hook (the synchronous `snapshotEvents` reads are deprecated for new callers), and it carries the
	* UNTRUNCATED event — which is the whole point: the UI projection cuts a long `-m` message down to `…` and can drop git's own output line,
	* so the reading view alone cannot always name the commit it is showing. The recorder keeps a bounded window per session; see its module for
	* the bounds and why it is deliberately shape-agnostic about event types.
	*/
	ctx.effect(() => {
		const on = ctx.on;
		const off = on("session/event", (session, event) => {
			recordSessionEvent(String(session.id), Number(event.seq), Number(event.time), String(event.type), event.data);
		});
		return () => {
			off();
		};
	}, "dsh-viewtune: session event recorder");
	if (ctx.webServer) {
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
						const cwd = typeof data.cwd === "string" ? data.cwd.trim() : "";
						const subjects = Array.isArray(data.subjects) ? data.subjects.filter((s) => typeof s === "string") : [];
						if (cwd === "") {
							json(res, 400, {
								ok: false,
								error: "Empty cwd"
							});
							return;
						}
						typeof data.recent === "number" && data.recent;
						json(res, 200, {
							ok: true,
							hashes: await commitHashes(cwd, subjects)
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
				/**
				* Commits, keyed by the tool call that made them, from the recorded (untruncated) events.
				*
				* `POST { sessionId, callIds }` → `{ ok, commits: { [callId]: { hash?, subject } } }`. Answering by call id is what removes every
				* guess: the reading view knows which call its bubble belongs to, so no pairing by order and no time window is involved, and a
				* second session committing to the same repository cannot move anyone's hash. Same shell as the other POSTs here: method,
				* same-origin, capped body, and an empty answer rather than an error when nothing can be read.
				*/
				kind: "exact",
				path: "/better-display/commit-calls",
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
						const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
						const callIds = Array.isArray(data.callIds) ? data.callIds.filter((id) => typeof id === "string" && id !== "") : [];
						if (sessionId === "") {
							json(res, 400, {
								ok: false,
								error: "Empty sessionId"
							});
							return;
						}
						json(res, 200, {
							ok: true,
							commits: recordedCommitsByCall(sessionId, callIds)
						});
					} catch (err) {
						json(res, 400, {
							ok: false,
							error: String(err)
						});
					}
				}
			});
		}, "dsh-viewtune: /better-display/commit-calls route");
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
		}, "dsh-viewtune: /better-display/wallpapers/reveal route");
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
