import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { createReaderStore } from './store.js';
import type { DeliverableOpenMode } from './open-file.js';

/**
 * The host's turn-process record, as published on the `turn-process` node.
 *
 * Declared here rather than imported: the host package does not export this type
 * (its field names appear only inside the implementation). The field set matches
 * what the host's own record comparison uses, so a change there is a real change
 * here. `answerStep` counts from 1 and is the step the final answer landed on.
 */
export interface TurnProcessChatData {
  readonly turn?: number;
  readonly controlAnchorSeq?: number;
  readonly processStartSeq?: number;
  readonly answerAnchorSeq?: number | null;
  readonly answerStep?: number | null;
  readonly inlineReasoning?: boolean;
  readonly messageCount?: number;
  readonly toolCallCount?: number;
  readonly subagentCount?: number;
}

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
