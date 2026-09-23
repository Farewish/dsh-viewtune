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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * The largest record accepted, on the way in and on the way out.
 *
 * The route is unauthenticated on localhost, so the body is bounded before it is parsed rather than
 * after: a settings record is a handful of numbers and names, and anything past this is not one.
 */
export const SETTINGS_MAX_BYTES = 64 * 1024;

/**
 * The record's file: `<instance home>/viewtune-settings.json` by default.
 *
 * `DSH_VIEWTUNE_SETTINGS` overrides it, the same escape hatch the wallpaper folder has — the instance
 * home is version-scoped (`homes/<version>`), so a record that should outlive one harness version
 * needs one. With no `DSH_HOME` at all the fallback is the conventional per-user `.dsh`.
 */
export function settingsFileOf(env: Readonly<Record<string, string | undefined>>, homedir: string): string {
  const override = env.DSH_VIEWTUNE_SETTINGS?.trim();
  if (override !== undefined && override !== '') return resolve(override);
  const home = env.DSH_HOME?.trim();
  return join(home !== undefined && home !== '' ? home : join(homedir, '.dsh'), 'viewtune-settings.json');
}

/**
 * The record we are willing to keep, or `undefined` for anything that is not one.
 *
 * A plain object only: an array, a bare number or a string is not a settings record, and storing one
 * would only move the failure to whoever reads it next. It must also survive `JSON.stringify` (no
 * cycles) and fit the bound. `JSON.stringify` returning `undefined` is its own refusal — that happens
 * for a function or a symbol, which cannot be a value a reader ever set.
 */
export function settingsRecordOf(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return undefined; // A cycle is not a record.
  }
  if (text === undefined || Buffer.byteLength(text, 'utf8') > SETTINGS_MAX_BYTES) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Read the stored record, or `undefined` when there is nothing usable to read.
 *
 * A missing file, a truncated one and a hand-edited one all answer the same way: the caller falls back
 * to the reader's defaults. That is deliberate — a settings file is allowed to be absent on a first
 * run, and a reader is not supposed to be locked out of their own app by one.
 */
export async function readSettings(file: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return settingsRecordOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Store a record, answering whether it was one.
 *
 * Written to a sibling and renamed over the target, so a crash or a full disk mid-write leaves the
 * previous record in place rather than a half-written one. The reader's settings are exactly the kind
 * of thing that must not become unreadable because the write was interrupted.
 */
export async function writeSettings(file: string, value: unknown): Promise<boolean> {
  const record = settingsRecordOf(value);
  if (record === undefined) return false;
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
  return true;
}
