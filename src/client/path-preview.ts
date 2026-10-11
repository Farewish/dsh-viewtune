/**
 * What a hover preview can show for one file link.
 *
 * The host pairs a Markdown file link with an image preview supplied by the owner (`MarkdownDelegate.fileImages`). Ours can do the
 * same for images — the reader's own workspace path resolver is already in hand — and for anything else there is no file CONTENT
 * available here, so the card shows what is known rather than pretending: the file's name and its full path. Kept as pure
 * functions because this repository's suite has no DOM: the card itself cannot be tested here, its decisions can.
 */

/** Extensions the browser can render directly in an `<img>`. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);

/** The last path segment, under either separator. */
export function fileNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? path : path.slice(cut + 1);
}

/** The lowercased extension of the last path segment, without the dot, or an empty string. */
export function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Whether the preview can render this file's bytes, or only name it.
 * @param path - A local path, as `parseFileLink` decoded it.
 * @returns `image` when an `<img>` is meaningful, `file` otherwise.
 */
export function previewKindOf(path: string): 'image' | 'file' {
  return IMAGE_EXTENSIONS.has(extensionOf(path)) ? 'image' : 'file';
}

/**
 * A file's size as a short human label, for a card with no room for more.
 *
 * The reading view names an attachment the way the host's own transcript does — the file's name and its size — and a SENT FILE
 * needs exactly that, because `FileAttachmentRef` carries nothing else: no MIME type, no path, only `{ attachmentId, name, bytes }`.
 * Kept pure, and tested, because this suite has no DOM to test the card itself.
 * @param bytes - Exact byte length, as `FileAttachmentRef.bytes` reports it.
 * @returns A label such as `0 B`, `999 B`, `1.0 KB`, `2.5 MB`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${String(Math.round(bytes))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 10 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit] ?? 'TB'}`;
}
