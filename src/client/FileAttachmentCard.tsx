import { memo } from 'react';
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
 * format that exists and every format added later.
 *
 * THE CARD HAS NO OPEN ACTION, and that is the host's own design rather than an omission here. Its only client-side reader,
 * `readAttachment`, is typed `{ attachment: ImageAttachmentRef; data: Uint8Array }` and refuses anything else with
 * 「Image is not referenced by this session.」 — an id is *"never a filesystem path or bearer URL"*, so serving arbitrary stored
 * bytes to the page by id would turn one leaked id into a file read. A sent file's bytes went to the model, which is what sending
 * it was for; the page only reports that it was sent. An earlier version of this card had a 「打开」 button, it could only fail,
 * and the reader removed it (「算了，那就A吧」).
 *
 * Reading the file by NAME from the workspace was considered and rejected on the same grounds of honesty: a name is not a path, so
 * it would sometimes open a different file with the same name and look like success.
 */
export const FileAttachmentCard = memo(function FileAttachmentCard({ attachment }: { attachment: FileAttachmentRef }) {
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
          {/* The host's meta line is 「TYPE 55KB」: the extension as written, then the size. */}
          {`${fileExtension(attachment.name).toUpperCase()} ${formatBytes(attachment.bytes)}`.trim()}
        </span>
      </span>
    </div>
  );
});
