import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { FileTypeIcon, fileExtension } from '@deepseek-ai/dsh-client-ui-primitives';
import { formatBytes } from './path-preview.js';
import css from './Reader.module.css';

/**
 * A file the reader SENT — a PDF, a spreadsheet, a zip — as one card, whatever its format.
 *
 * The reading view showed 「此内容类型尚未接入阅读页，原始内容已保留」 for these, and the reason is worth stating plainly because the
 * reader asked whether every format needs its own handling: it does not. The host models any non-image attachment as ONE
 * `ContentBlock` — `'file': FileBlock`, whose ref carries only `{ attachmentId, name, bytes }` — so a single branch covers every
 * format that exists and every format added later. Our converter knew `text` and `image` and dropped the rest into its
 * "unknown" bucket, which is what that message really meant.
 *
 * Opening is deliberately generic too: the bytes go through the same session reader that images use, become a blob URL, and are
 * handed to the browser, which then does what it does best with a PDF (shows it), an image (shows it) or a zip (downloads it).
 * Nothing here needs to know which of those will happen.
 */
export const FileAttachmentCard = memo(function FileAttachmentCard({ attachment, loadFile }: {
  attachment: FileAttachmentRef;
  /** The session's attachment reader; typed for images upstream, but it is addressed by id alone. */
  loadFile: (attachment: FileAttachmentRef) => Promise<{ data: Uint8Array; mediaType: string }>;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const url = useRef<string | null>(null);
  useEffect(() => () => { if (url.current !== null) URL.revokeObjectURL(url.current); }, []);
  const open = useCallback(async () => {
    if (state === 'loading') return;
    setState('loading');
    try {
      const result = await loadFile(attachment);
      if (url.current !== null) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(new Blob([result.data.slice().buffer], { type: result.mediaType }));
      window.open(url.current, '_blank', 'noopener,noreferrer');
      setState('idle');
    } catch (error) {
      console.warn('[dsh-better-display] could not open a sent file:', error);
      setState('error');
    }
  }, [attachment, loadFile, state]);
  return (
    <div className={css.sentFile} data-reader-file={attachment.name}>
      <span className={css.sentFileIcon}>
        {/* The host's own FILE-TYPE glyph, not the link glyph: it is a category-coloured badge (a red PDF, a green spreadsheet,
            and so on), which is what the reader saw in the transcript and asked to match (「对话页里用户传的文件的图标有特殊规则」).
            `classifyFileType` never sees a path here — a `FileAttachmentRef` carries only a display name — so the name alone picks
            the category, exactly as it does for the host's own card. */}
        <FileTypeIcon path={attachment.name} className={css.sentFileGlyph} />
      </span>
      <span className={css.sentFileText}>
        <span className={css.sentFileName} title={attachment.name}>{attachment.name}</span>
        <span className={css.sentFileMeta}>
          {/* The host's meta line is 「TYPE 55KB」: the extension as written, then the size. Same here, with the error text taking
              the whole line when opening failed rather than a size that no longer matters. */}
          {state === 'error' ? '打开失败' : `${fileExtension(attachment.name).toUpperCase()} ${formatBytes(attachment.bytes)}`.trim()}
        </span>
      </span>
      <button type="button" className={css.sentFileOpen} onClick={() => { void open(); }} disabled={state === 'loading'}>
        {state === 'loading' ? '打开中…' : '打开'}
      </button>
    </div>
  );
});
