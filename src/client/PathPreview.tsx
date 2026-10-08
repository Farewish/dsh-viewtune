import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fileNameOf, previewKindOf } from './path-preview.js';
import css from './markdown/MarkdownText.module.css';

/**
 * The hover card the host shows over a file link, in the reading view's own shape.
 *
 * The host pairs its Markdown file links with an image preview supplied by the owner (`MarkdownDelegate.fileImages`), and its own
 * component is not importable here — these packages export `apply`/`inject`, not their internals. So this is a lookalike that
 * asks the ONE thing we can answer: the owner's workspace resolver, which renders an image. For every other file the card names
 * the file instead of pretending to know its contents — nothing here can read a file's bytes.
 *
 * Deliberately small: it appears after a short delay, disappears immediately, never swallows a click, and is decorative
 * (`aria-hidden`) because the link it hangs from already carries the same information in its `title`.
 */
export const PathPreview = memo(function PathPreview({ path, line, resolveImageUrl, children }: {
  path: string;
  line?: number | undefined;
  resolveImageUrl?: ((url: string) => string | undefined) | undefined;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const show = useCallback((host: HTMLElement) => {
    if (timer.current !== null) clearTimeout(timer.current);
    // A short delay so a pointer crossing the text on its way somewhere else never flashes a card.
    timer.current = setTimeout(() => {
      const rect = host.getBoundingClientRect();
      setAnchor({ top: rect.top, left: rect.left });
    }, 260);
  }, []);
  const hide = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setAnchor(null);
  }, []);
  const kind = previewKindOf(path);
  const source = kind === 'image' ? resolveImageUrl?.(path) : undefined;
  return (
    <span
      className={css.pathLinkHost}
      onMouseEnter={event => { show(event.currentTarget); }}
      onMouseLeave={hide}
      onFocus={event => { show(event.currentTarget); }}
      onBlur={hide}
    >
      {children}
      {anchor !== null && (
        <span
          className={css.pathPreview}
          style={{ top: `${String(anchor.top)}px`, left: `${String(anchor.left)}px` }}
          data-path-preview={kind}
          aria-hidden="true"
        >
          {source !== undefined && <img className={css.pathPreviewImage} src={source} alt="" />}
          <span className={css.pathPreviewName}>{line === undefined ? fileNameOf(path) : `${fileNameOf(path)}:${String(line)}`}</span>
          <span className={css.pathPreviewPath}>{path}</span>
        </span>
      )}
    </span>
  );
});
