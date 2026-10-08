import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TurnProcessChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { createReaderStore } from './store.js';
import type { DeliverableOpenMode } from './open-file.js';

/**
 * The host's turn-process record.
 *
 * This used to be declared HERE, with every field optional, because 0.1.5 did not export the type and its field names
 * appeared only inside the implementation. 0.2.0 publishes it (`TurnProcessChatData` from the chat package's client
 * entry) with the same nine fields, all required — so the local copy is gone and the platform's type is re-exported
 * under the name the rest of this view already imports. `TurnMetrics`/`StepsPill` keep their defensive reads: the fields
 * are required in the TYPE, and a record that arrives without one is still a record this view must not crash on.
 */
export type { TurnProcessChatData };

export interface ReaderBlockOwner {
  block: AssistantBlock;
  streaming: boolean;
  source: 'assistant' | 'user' | 'tool';
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Trusted installed renderers may opt in; unknown model payloads never execute code. */
    'dsh-better-display.block': { kind: 'chain'; scope: 'session'; owner: ReaderBlockOwner };
  }
}

export interface ReaderInjected {
  loadOlder: () => Promise<void>;
  loadImage: (attachment: ImageAttachmentRef) => Promise<{ data: Uint8Array; mediaType: string }>;
  /**
   * The session this view is showing, its workdir as the host knows it. Read by the reader only to turn an image destination
   * written as a workspace path into a URL the browser can fetch — the same resolution the host's transcript performs, which is
   * why an answer's images showed there and fell back to alt text here. Absent leaves every destination as authored.
   */
  cwd?: string;
  /**
   * Writes text into this session's composer draft via the sanctioned
   * conversation input face, with a DOM fallback. Returns true when the
   * composer accepted the text.
   */
  fillComposer: (text: string) => boolean;
  /**
   * Open a workspace file or directory: the system app, or the right sidebar when `options.mode`
   * asks for it (the default is the system app). The mode is an argument because this face has no
   * live store to read — see `open-file.ts` on why `createReaderStore()` cannot answer that question.
   */
  openFile: (path: string, options?: { mode?: DeliverableOpenMode }) => Promise<void> | void;
  /** Reveal and highlight a workspace file in macOS Finder or Windows Explorer. */
  revealFile?: (path: string) => Promise<void> | void;
  /**
   * Open the HOST'S changes review for one turn in the sidebar — the same resource the conversation page's 「已编辑 x 个
   * 文件」 card opens. Used when the reader turns on 「差异在侧边栏审查」; without it (or without a sidebar) the reading view
   * keeps its own in-page panel.
   */
  openChangesReview?: (coordinates: { sessionId: string; seq: number; turn: number }) => void;
  /** Fork the conversation at a specific message sequence into a new branch session. */
  forkAt?: (seq: number) => void;
  /** Load session history through a target sequence number. */
  loadThrough?: (seq: unknown) => Promise<void>;
}
export type ReaderProps = PropsRuntime<'conversation.view'>
  & PropsLocale<'chat'>
  & PropsRenderSlots<'dsh-better-display.block'>
  & PropsStore<ReturnType<typeof createReaderStore>>
  & ReaderInjected;
export type BlockRenderProps = Pick<ReaderProps, 'renderSlotChain' | 'loadImage' | 'fillComposer'> & {
  openFile?: (path: string) => Promise<void> | void;
  revealFile?: (path: string) => Promise<void> | void;
  forkAt?: (seq: number) => void;
  /** Durable closing-message seq of this turn (turn-tail closing), used as the fork anchor. */
  forkSeq?: number;
  fileMentions?: MarkdownFileMentions;
  /**
   * Reader addition: resolve an image destination written as a path inside the session's WORKSPACE into a URL the browser can
   * fetch (the host's own file route). The host's transcript does this and the reading view did not, so an answer's images
   * rendered there and fell back to alt text here. Optional: an owner that cannot resolve leaves every URL as authored.
   */
  resolveImageUrl?: (url: string) => string | undefined;
  /**
   * Reader addition: open a local file destination from a Markdown link — the same capability the host's own
   * MarkdownDelegate exposes, and the reason a workspace path in the transcript is a link while the reading view showed
   * plain text. Absent leaves the destination as text. Optional: an owner with no opener simply omits it.
   */
  openFileLink?: (path: string, line?: number) => void;
  metrics?: {
    usage?: NonNullable<import('@deepseek-ai/dsh-client-ui-chat/client').TurnTailChatData['tokenUsage']>;
    runMs?: number;
    tokensPerSecond?: number;
    ttftMs?: number;
    /** Closing assistant-message time (turn-tail `closing.time`). */
    endedAt?: number;
    /**
     * The turn's process record plus its total step count, for the steps pill.
     * `data` is the host's `turn-process` node payload; `totalSteps` is the count
     * the process disclosure shows and is not part of that record.
     */
    steps?: { data?: TurnProcessChatData; totalSteps?: number };
  };
};
