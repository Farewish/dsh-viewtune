import { fileMediaUrl, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path';

export type DeliverableOpenMode = 'external' | 'sidebar';

/**
 * The stored value, read defensively: only the exact string asks for the sidebar.
 *
 * There is deliberately no "read the mode off the store handle" helper here. `defineStore` returns a
 * `StoreHandle` — a spec plus `create(scopeKey)` — and the live snapshot belongs to the instance the
 * framework mints and hands to components as `useStore`; the handle has no `getSnapshot()`. An
 * earlier version of this module offered `modeFromSnapshot(store)` for that job, and the one caller
 * that had a handle to pass it read `undefined` on every click, which silently meant "the system
 * app" (see the changelog's「sidebar open fixed」entry). The mode is an argument now: whoever renders
 * the click subscribes to the preference and hands the answer down.
 */
export function deliverableOpenModeOf(value: unknown): DeliverableOpenMode {
  return value === 'sidebar' ? 'sidebar' : 'external';
}

/** Workspace-folder affordances stay on the OS opener, not the Sidebar switch. */
export function isFolderOpenPath(path: string): boolean {
  return path === '.' || path === '';
}

function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
}

function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || isWindowsStylePath(path);
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':');
}

function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/');
}

/**
 * Session-scoped `dsh-resource://file/session/<id>/…` address.
 *
 * Matches the official `fileAddressFor` / `sessionFileAddress` (0.1.5) — the same scheme the product's
 * own tab actions build before calling the sidebar's opener, which is why this fork can reuse it
 * rather than inventing an address of its own.
 */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const address = (relative: string): string => {
    const cleaned = relative.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
    return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encodePath(cleaned)}`;
  };
  if (!isAbsoluteWorkspacePath(normalized)) return address(normalized);
  const root = cwd === undefined ? '' : cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root !== '' && normalized === root) return address('');
  if (root !== '' && normalized.startsWith(`${root}/`)) return address(normalized.slice(root.length + 1));
  return address(normalized);
}

export function resolveOpenWorkspacePath(
  cwd: string | undefined,
  path: string,
  resolveWorkspacePath: (cwd: string | undefined, path: string) => string,
): string {
  return isFolderOpenPath(path) ? (cwd ?? '.') : resolveWorkspacePath(cwd, path);
}

/**
 * The URL that serves one workspace file, or `undefined` when a destination needs no resolution.
 *
 * An answer's image is often authored as a path INSIDE the session workspace, which the browser cannot fetch as written — the
 * host's own transcript turns exactly those into its file route, and the reading view showed only the image's alt text because
 * it did not perform that step. This is the step, kept out of the renderer so it can be tested without a DOM (the suite has none).
 *
 * Only workspace-relative destinations are touched. Anything absolute — `/…`, `//host/…`, or any `scheme:` — is left to the
 * markdown renderer's own protocol allowlist, unchanged.
 *
 * @param cwd - The session's workdir as the host reports it; undefined leaves the destination alone.
 * @param url - The destination exactly as authored.
 * @param origin - The app's own origin; defaults to the page's.
 * @returns The file route for a workspace path, else undefined.
 */
export function workspaceImageUrl(
  cwd: string | undefined,
  url: string,
  origin: string | undefined = globalThis.location?.origin,
): string | undefined {
  if (cwd === undefined || url === '' || origin === undefined || origin === '') return undefined;
  if (isAbsoluteWorkspacePath(url) || url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined;
  try {
    const absolute = resolveWorkspacePath(cwd, decodeURIComponent(url));
    // The HOST's own builder, not a hand-rolled string: it also covers the desktop transport (`dsh-app://app/`) and any
    // deployment prefix, and the upstream document preview uses it for exactly this job
    // (`ui-sidebar-documentpreview/src/client/markdown/path-images.ts`). A base must end in a slash to resolve against.
    return fileMediaUrl(origin.endsWith('/') ? origin : `${origin}/`, absolute);
  } catch {
    // A malformed escape sequence is not something this can serve; the renderer falls back to the alt text.
    return undefined;
  }
}

/**
 * Open one delivered file the way the reader asked for.
 *
 * Two rules are the whole of the mode: a workspace FOLDER always goes to the system opener (the
 * sidebar previews files, not directories), and a missing or throwing sidebar opener falls back to
 * the system app with a warning rather than leaving the click doing nothing. Returns which of the two
 * actually happened, so a caller can report it.
 */
export async function openDeliverableFile(args: {
  path: string;
  mode: DeliverableOpenMode;
  sessionId: string;
  cwd: string | undefined;
  resolveWorkspacePath: (cwd: string | undefined, path: string) => string;
  openExternal: (absolutePath: string) => Promise<void>;
  openSidebar?: (address: string) => void;
  fileAddressFor?: (sessionId: string, cwd: string | undefined, path: string) => string;
  warn?: (message: string, extra?: unknown) => void;
}): Promise<'sidebar' | 'external'> {
  const targetPath = resolveOpenWorkspacePath(args.cwd, args.path, args.resolveWorkspacePath);
  const useSidebar = args.mode === 'sidebar' && !isFolderOpenPath(args.path);
  if (useSidebar) {
    if (typeof args.openSidebar !== 'function') {
      args.warn?.('[dsh-better-display] sidebarRight.openResource is not available; falling back to system app');
    } else {
      try {
        const address = (args.fileAddressFor ?? fileAddressFor)(args.sessionId, args.cwd, args.path);
        args.openSidebar(address);
        return 'sidebar';
      } catch (error) {
        args.warn?.('[dsh-better-display] sidebar open failed; falling back to system app', error);
      }
    }
  }
  await args.openExternal(targetPath);
  return 'external';
}
