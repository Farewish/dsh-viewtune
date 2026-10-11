import { memo, useState } from 'react';
import { Blocks } from './Blocks.js';
import type { BlockRenderProps, ReaderBlockOwner } from './types.js';
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import css from './Reader.module.css';

/**
 * The files a reader SENT, in ONE frame above the message bubble, with a collapse control.
 *
 * The reader's ruling: the host's image-and-file mixing is not wanted, images are separated out, only the file cards are kept,
 * one big frame surrounds them all, and a collapse is added. Images keep the reading view's own path and stay where they are.
 *
 * THE SIZING IS THE HOST'S, read from its shipped stylesheet instead of invented: its attachment row is `max-width: 100%` inside
 * a column capped by `--dsh-chat-content-width`, and its cards are fixed `flex: 0 0 240px` and wrap. This frame reproduces that
 * shape — `width: fit-content` so it hugs its cards, the chat content width as the ceiling so it can never exceed the message
 * column, 240px cards that wrap. No discrete widths and no measurement: an earlier attempt added both, and every version of that
 * arithmetic was wrong, while a width that simply follows the column needs no arithmetic at all.
 *
 * The collapse shows ONE ROW of cards — a height the stylesheet clips to — and the label reports the real file count, because how
 * many cards fit in a row is a layout result this component cannot read.
 */
export const SentFiles = memo(function SentFiles({ blocks, ...render }: BlockRenderProps & {
  blocks: readonly AssistantBlock[];
  source?: ReaderBlockOwner['source'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={css.sentFiles} {...(open ? { 'data-open': '' } : {})}>
      <div className={css.sentFilesViewport}>
        <Blocks {...render} blocks={blocks} source="user" />
      </div>
      {blocks.length > 1 && <button
        type="button"
        className={css.sentFilesToggle}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value); }}
      >
        {open ? '收起' : `展开全部 ${String(blocks.length)} 个`}
      </button>}
    </div>
  );
});
