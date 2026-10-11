import { memo } from 'react';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { FileTypeIcon, fileExtension, fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './Reader.module.css';

/**
 * A file the reader SENT, drawn as the HOST draws it — a 1:1 copy of its `fileCard` from the conversation page.
 *
 * The reader asked for exactly this: 「完完全全照搬宿主，包括图片，文件卡样式行为等等也照搬。1:1复刻」. So the markup is the host's
 * (`MessageItem.tsx`: one `span.fileCard` holding `FileTypeIcon` + a column of `fileName` and `fileMeta`) and every style value below
 * comes from its shipped stylesheet (`MessageItem.module.css`): a fixed 240px card, `min-height: 64px`, `padding: 8px 12px`, a 0.5px
 * border, `--dsw-radius-xl`, `--dsw-specific-input-major` as the background, a 28px glyph, a 14px/500 name and a 12px tertiary meta
 * line — and the meta text is built with the host's own `fileSizeText` rather than a helper of ours.
 *
 * The card carries NO action: a `FileAttachmentRef` holds `{ attachmentId, name, bytes }` and the host's only client-side reader
 * refuses anything that is not an image ("Image is not referenced by this session."), which is why the host's own card has no button
 * either. An earlier version added one here; it could only fail, and the reader removed it.
 */
export const FileAttachmentCard = memo(function FileAttachmentCard({ attachment }: { attachment: FileAttachmentRef }) {
  return (
    <span className={css.fileCard} data-reader-file={attachment.name} title={attachment.name}>
      <FileTypeIcon path={attachment.name} className={css.fileIcon} />
      <span className={css.fileContent}>
        <span className={css.fileName}>{attachment.name}</span>
        <span className={css.fileMeta}>
          {[fileExtension(attachment.name).toUpperCase().slice(0, 8), fileSizeText(attachment.bytes)].filter(Boolean).join(' ')}
        </span>
      </span>
    </span>
  );
});
