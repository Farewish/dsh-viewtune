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
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
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
 * What a read of the stored record established.
 *
 * A missing file is safe to treat as "nothing stored yet" — the client may seed it. A file that exists
 * but cannot be read, parsed or bounded is NOT the same fact: reporting it as empty would let the client
 * overwrite a record it never managed to read, so the route answers 5xx for this case instead.
 */
export type SettingsRead =
  | { readonly kind: 'ok'; readonly record: Record<string, unknown> }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' };

/**
 * Read the stored record, distinguishing an absent file from one that cannot be trusted.
 *
 * A file is checked against the same bound the write path enforces BEFORE it is read, so a hand-edited
 * or oversized file is refused without first allocating it in memory.
 */
export async function readSettings(file: string): Promise<SettingsRead> {
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' };
  }
  if (!info.isFile() || info.size > SETTINGS_MAX_BYTES) return { kind: 'invalid' };
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' };
  }
  try {
    const record = settingsRecordOf(JSON.parse(text));
    return record === undefined ? { kind: 'invalid' } : { kind: 'ok', record };
  } catch {
    return { kind: 'invalid' };
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
