import { memo } from 'react';
import type { ReactNode } from 'react';
import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives';
import { fileNameOf, previewKindOf } from './path-preview.js';
import css from './markdown/MarkdownText.module.css';

/**
 * The hover card the host shows over a file link — the host's own component, not a lookalike.
 *
 * The first version of this was hand-rolled with `position: fixed` and the reader saw it land far from the link
 * (「预览框应该在路径链接旁边啊，现在怎么离的这么远」): the reading view's ancestors carry `transform` and `filter` (the per-word
 * reveal is `filter: blur(…)`), and a fixed box resolves against the nearest such ancestor. The host's primitives already
 * export `HoverCard`, which is PORTALED to the body and documents exactly the placement wanted — `variant: 'compact'`, "compact
 * card beside the anchor" — and which also hides itself while a tooltip inside the anchor is showing. Using it removes the
 * guesswork, the extra dependency (`react-dom` is not in this package's dependencies) and the second idea of what a card is.
 *
 * The content is still ours and still honest: an image renders through the owner's workspace resolver, everything else is named
 * rather than previewed, because nothing here can read a file's bytes.
 */
export const PathPreview = memo(function PathPreview({ path, line, resolveImageUrl, children }: {
  path: string;
  line?: number | undefined;
  resolveImageUrl?: ((url: string) => string | undefined) | undefined;
  children: ReactNode;
}) {
  const kind = previewKindOf(path);
  const source = kind === 'image' ? resolveImageUrl?.(path) : undefined;
  return (
    <HoverCard
      anchor={children}
      inline
      variant="compact"
      openDelayMs={260}
      content={
        <span className={css.pathPreviewBody}>
          {source !== undefined && <img className={css.pathPreviewImage} src={source} alt="" />}
          <span className={css.pathPreviewName}>{line === undefined ? fileNameOf(path) : `${fileNameOf(path)}:${String(line)}`}</span>
          <span className={css.pathPreviewPath}>{path}</span>
        </span>
      }
    />
  );
});
