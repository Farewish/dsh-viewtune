import { memo, useRef } from 'react';
import css from './markdown/MarkdownText.module.css';
import readerCss from './Reader.module.css';

/**
 * An answer-body image that opens into the reading view's own image dialog.
 *
 * The reader pointed out that a USER's image can already be clicked open here and suggested reusing that instead of adopting the
 * host's `ImageLightbox` — and they are right, for a reason worth writing down: the enlarged view is a `<dialog>` this view
 * already owns (`ImageBlock` in `Blocks.tsx`, styled by `Reader.module.css`), so reusing its classes makes an answer's image and
 * a sent image behave and LOOK identical when opened, instead of two different lightboxes in one view.
 *
 * The thumbnail keeps the markdown sheet's frame (the hugging card tuned in the previous rounds); only the DIALOG is shared.
 */
export const LightboxImage = memo(function LightboxImage({ src, alt }: { src: string; alt: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <span className={css.imageFrame}>
      <button
        ref={opener}
        type="button"
        className={css.imageOpenButton}
        aria-label={`放大图片${alt === '' ? '' : `：${alt}`}`}
        onClick={() => { dialog.current?.showModal(); }}
      >
        <img className={css.image} src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      </button>
      <dialog
        ref={dialog}
        className={readerCss.imageDialog}
        aria-label="图片预览"
        onClose={() => { opener.current?.focus(); }}
        onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}
      >
        <button type="button" autoFocus className={readerCss.dialogClose} aria-label="关闭图片预览" onClick={() => { dialog.current?.close(); }}>×</button>
        <img src={src} alt={alt} />
      </dialog>
    </span>
  );
});
