import type {} from '@deepseek-ai/dsh-session-turn-outline/types';
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { CSSProperties } from 'react';
import type { ChatConversationViewNode, ChatNode, ChatNodeKind } from '@deepseek-ai/dsh-client-ui-chat/client';
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { BlockBoundary, Blocks, contentBlocks, CopyAnswer, UserMessageActions } from './Blocks.js';
import { ReasoningCard } from './ReasoningCard.js';
import { ToolActivity, ToolMedia } from './ToolActivity.js';
import { preparingLabel, readerFlow } from './tool-activity.js';
import { Disclosure, ProcessFragment, RetiringContent, StatusText, useMotionAllowed, usePinnedSelection, useReadingScroll } from './motion.js';
import { StreamMotionContext } from './streaming.js';
import { assistantSegments, boundaryOf, forkAnchorSeq, groupNodes, hasProcessContent, hasVisibleBody, isEarlierNarration, processChoiceKey, processExpanded, terminalLabel } from './projection.js';
import { basename, createProducedFileMentions, dirname, getTurnDeliverables, showDeliverablesRow } from './deliverables.js';
import { ContextInjectionRow } from './native/ContextInjectionRow.js';
import { TimelineRail } from './TimelineRail.js';
import { SettingsMenu } from './SettingsMenu.js';
import { CollapseControl } from './CollapseControl.js';
import { collapseModeOf } from './collapse-mode.js';
import { glassProperties, glassValues } from './glass.js';
import { deliverableOpenModeOf } from './open-file.js';
import { textCadenceOf } from './text-cadence.js';
import { wallpaperDimOf, wallpaperGeometry, wallpaperNameOf, wallpaperProperties, wallpaperUrl } from './wallpaper.js';
import { applyWindowScope, wallpaperChromeOf, wallpaperScopeOf } from './wallpaper-scope.js';
import { applyScrollbarFill, scrollbarFillOf } from './scrollbar.js';
import { createSettingsWriter, loadHostSettings } from './settings-sync.js';
import { WaitClock } from './WaitClock.js';
import { handsBackToModel, waitingAnchor } from './waiting-clock.js';
import { DEFAULT_SHORTCUTS, matchesShortcut, shortcutLabel } from './shortcuts.js';
import { landTurn, scrollerOf } from './conversation-scroll.js';
import { firstRowPastIndex, firstRowWhere } from './reading-scroll.js';
import { mergeTimelineItems, type TimelineItem } from './timeline.js';
import type { ReaderGroup, TurnBoundary } from './projection.js';
import type { BlockRenderProps, ReaderProps, TurnProcessChatData } from './types.js';
import css from './Reader.module.css';
import { markdownLabels, truncatedJsonLabel } from './primitive-labels.js';

function isNode<K extends ChatNodeKind>(node: ChatConversationViewNode, kind: K): node is ChatNode<K> {
  return node.kind === kind;
}

function cleanErrorMessage(raw: string | undefined): string {
  if (!raw) return '模型服务暂时无响应或连接中断，请稍后重试。';
  let str = raw.trim();
  if (str.includes('"error"') || str.startsWith('{')) {
    try {
      const idx = str.indexOf('{');
      const parsed = JSON.parse(str.slice(idx));
      const msg = parsed?.error?.message || parsed?.message || parsed?.error;
      if (typeof msg === 'string') str = msg;
    } catch {
      // keep
    }
  }
  return str;
}

type SeatProps = BlockRenderProps & Pick<ReaderProps, 'useChat'> & {
  nodeKey: string; boundary: TurnBoundary; pinned?: boolean; processOpen?: boolean;
};

/**
 * The one empty key list, shared so its identity is stable.
 *
 * `mainKeys` is memoized on the array a turn's user/steering split produced, and a fresh `[]` on a turn
 * with no leading messages would defeat that memo on every render — the exact per-delta cost the
 * primitive-publishing subscription above exists to avoid.
 */
const NO_KEYS: readonly string[] = [];

/**
 * A JSON record card — 轮次过程记录 / 模型重试记录 / 命令记录 — with a handle the SKIN can reach.
 *
 * The card itself is the host primitive's, and its two plates (the toggle row and the body) wear that
 * package's own hashed class names, so there is nothing stable to select on inside it. The wrapper this
 * view puts around it is that handle: everything with a plate inside the wrapper is the card's. One
 * wrapper for all three, because they ARE the same card — a reader who dials 卡片与面板 means these,
 * and the model-retry one is simply the one that was open when it was noticed.
 */
const JsonRecord = memo(function JsonRecord({ label, payload }: { label: string; payload: unknown }) {
  return <div className={css.jsonCard}><JsonBlock label={label} payload={payload} truncatedLabel={truncatedJsonLabel} /></div>;
});

const ProcessNode = memo(function ProcessNode({ useChat, t, nodeKey, open, motion, onRead, returnFocusTo }: Pick<ReaderProps, 'useChat' | 't'> & {
  nodeKey: string; open: boolean; motion: boolean; onRead: () => void; returnFocusTo: RefObject<HTMLButtonElement>;
}) {
  const node = useChat(snapshot => snapshot.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  let content: ReactNode = null;
  if (isNode(node, 'context')) content = <ContextInjectionRow {...node.data} t={t} />;
  else if (isNode(node, 'system-prompt')) content = <details className={css.detail}><summary>系统提示词</summary><pre className={`${css.toolRaw} ${css.systemPrompt}`}>{node.data.text}</pre></details>;
  else if (isNode(node, 'turn-process')) content = <JsonRecord label="轮次过程记录" payload={node.data} />;
  else if (isNode(node, 'model-retry')) content = <JsonRecord label="模型重试记录" payload={node.data.attempts} />;
  else if (isNode(node, 'command') || isNode(node, 'manual-compaction')) content = <JsonRecord label="命令记录" payload={node.data} />;
  return content && <ProcessFragment open={open} motion={motion} onRead={onRead} returnFocusTo={returnFocusTo} nodeKey={nodeKey} framed>{content}</ProcessFragment>;
});

const AssistantNode = memo(function AssistantNode({ useChat, nodeKey, boundary, processOpen = false, pinned = false, motion, onRead, returnFocusTo, ...render }: SeatProps & {
  motion: boolean; onRead: () => void; returnFocusTo: RefObject<HTMLButtonElement>;
}) {
  const node = useChat(snapshot => snapshot.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden' || !isNode(node, 'assistant-step')) return null;
  const data = node.data;
  const parts = assistantSegments(data.blocks);
  const earlier = isEarlierNarration(data, boundary);
  const hasToolCalls = data.blocks.some(block => block.kind === 'tool-call');
  const isProcessStep = earlier || hasToolCalls || (boundary.latestStep > 0 && data.step < boundary.latestStep);
  const body = data.blocks.filter(block => block.kind !== 'reasoning' && block.kind !== 'tool-call');
  return <>{parts.map((part, index) => part.kind === 'reasoning'
    ? <ProcessFragment key={part.start} open={processOpen} motion={motion} onRead={onRead} returnFocusTo={returnFocusTo} nodeKey={nodeKey} framed>
      <ReasoningCard step={data.step} active={processOpen && boundary.status === 'open' && data.step === boundary.latestStep} motion={motion} selected={pinned} onRead={onRead}>
        <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running' && index === parts.length - 1 && data.blocks.at(-1)?.kind === 'reasoning'}
          holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
      </ReasoningCard>
    </ProcessFragment>
    : isProcessStep ? <ProcessFragment key={part.start} open={processOpen} motion={motion} onRead={onRead} returnFocusTo={returnFocusTo} nodeKey={nodeKey}>
      <article className={css.processCommentary}>
        <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
      </article>
    </ProcessFragment>
    : hasVisibleBody(part.blocks) && <RetiringContent key={part.start} visible={pinned || processOpen || !earlier}>
      <article className={css.answer} data-reader-answer data-reader-anchor data-reader-key={nodeKey} data-reader-source-start={part.start} data-answer-status={data.status} data-answer-phase="body">
        <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
        {index === parts.length - 1 && data.status === 'interrupted' && <span className={css.stopped}>已停止</span>}
        {index === parts.length - 1 && !earlier && data.status !== 'running' && boundary.status === 'closed' && (
          <CopyAnswer blocks={body} onFork={(() => {
            // The fork anchor must be the durable closing message seq (same as
            // the official turn-tail branch). AssistantChatData carries no seq
            // of its own; passing it would fork the whole session instead.
            const anchor = forkAnchorSeq([data.finalNode, { seq: render.forkSeq }]);
            return render.forkAt && anchor !== undefined ? () => render.forkAt!(anchor) : undefined;
          })()} metrics={render.metrics} />
        )}
      </article>
    </RetiringContent>)}</>;
});

const CompactionDivider = memo(function CompactionDivider({ data }: {
  data: { summary?: string | null; shadowedItemCount?: number | null; shadowedTokenCount?: number | null } | null;
}) {
  const [open, setOpen] = useState(false);
  if (!data) return null;

  const hasSummary = typeof data.summary === 'string' && data.summary.trim().length > 0;
  const items = data.shadowedItemCount;
  const tokens = data.shadowedTokenCount;

  let label = '已压缩历史上下文';
  if (items && tokens) {
    const kTokens = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
    label = `已压缩 ${items} 条上下文 · 释放约 ${kTokens} tokens`;
  } else if (items) {
    label = `已压缩 ${items} 条上下文`;
  } else if (tokens) {
    const kTokens = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
    label = `已压缩上下文 · 释放约 ${kTokens} tokens`;
  }

  return (
    <div className={css.compactionRow} data-reader-compaction>
      <div className={css.compactionLine}>
        {hasSummary ? (
          <button
            type="button"
            className={`${css.compactionPill} ${css.compactionButton}`}
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            title={open ? '收起历史记忆摘要' : '展开查看此节点提炼的记忆摘要'}
          >
            <svg className={css.compactionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z" strokeWidth="1.2" />
              <path d="M8 5v3.2l2 1.8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{label}</span>
            <span className={css.compactionToggle}>{open ? '收起备忘' : '查看备忘'}</span>
          </button>
        ) : (
          <span className={css.compactionPill}>
            <svg className={css.compactionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z" strokeWidth="1.2" />
              <path d="M8 5v3.2l2 1.8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{label}</span>
          </span>
        )}
      </div>
      {open && hasSummary && (
        <div className={css.compactionSummaryBox} data-reader-anchor>
          <div className={css.compactionSummaryHeader}>前期对话要点备忘</div>
          <MarkdownText text={data.summary!} labels={markdownLabels} />
        </div>
      )}
    </div>
  );
});

const MainNode = memo(function MainNode({ useChat, nodeKey, boundary, pinned, processOpen = false, ...render }: SeatProps) {
  const node = useChat(snapshot => snapshot.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  if (isNode(node, 'user') || isNode(node, 'steering')) {
    const blocks = contentBlocks(node.data.content);
    const imageBlocks = blocks.filter(b => b.kind === 'image');
    const otherBlocks = blocks.filter(b => b.kind !== 'image');
    const text = otherBlocks.filter((block): block is Extract<typeof block, { kind: 'text' }> => block.kind === 'text').map(block => block.text).join('\n\n');
    const time = node.data.time;
    return <div className={css.userCluster} data-reader-anchor data-reader-key={nodeKey}>
      {node.kind === 'steering' && <p className={css.meta}>补充消息</p>}
      {imageBlocks.length > 0 && <div className={css.userImages}>
        <Blocks {...render} blocks={imageBlocks} source="user" />
      </div>}
      {otherBlocks.length > 0 && <div className={css.user}>
        <Blocks {...render} blocks={otherBlocks} source="user" />
      </div>}
      <UserMessageActions text={text} time={time} />
    </div>;
  }
  if (isNode(node, 'assistant-step')) return null;
  if (isNode(node, 'tool-call')) return <ToolMedia {...render} block={node.data.root} />;
  if (isNode(node, 'turn-error')) return <div className={css.error} role="alert" data-reader-anchor>
    <svg className={css.errorIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <circle cx="8" cy="8" r="6.5" strokeWidth="1.2" />
      <path d="M8 5v3.5M8 11.2h.01" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    <div className={css.errorCopy}>
      <div className={css.errorTitle}>
        <strong>本轮运行失败</strong>
        {node.data.code && <code className={css.errorCode}>{node.data.code}</code>}
      </div>
      <p className={css.errorMessage}>{cleanErrorMessage(node.data.message)}</p>
    </div>
  </div>;
  if (isNode(node, 'turn-max-tokens')) return <div className={css.notice}>已到达输出长度限制，回答尚未完整。</div>;
  if (isNode(node, 'model-retry')) return node.data.current.retryState === 'scheduled'
    ? <div className={css.notice} role="status">模型请求未成功，正在等待重试。详情保留在执行过程中。</div> : null;
  if (isNode(node, 'command')) {
    if (node.data.outcome?.kind === 'error') return <div className={css.error} role="alert">
      <svg className={css.errorIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
        <circle cx="8" cy="8" r="6.5" strokeWidth="1.2" />
        <path d="M8 5v3.5M8 11.2h.01" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div className={css.errorCopy}>
        <div className={css.errorTitle}><strong>命令执行未成功</strong></div>
        <p className={css.errorMessage}>{node.data.outcome.text ?? node.data.name ?? '查看原对话中的命令记录'}</p>
      </div>
    </div>;
    return node.data.outcome?.text ? <MarkdownText text={node.data.outcome.text} labels={markdownLabels} /> : null;
  }
  if (isNode(node, 'manual-compaction')) {
    if (node.data.command.outcome?.kind === 'error') return <div className={css.error} role="alert">
      <svg className={css.errorIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
        <circle cx="8" cy="8" r="6.5" strokeWidth="1.2" />
        <path d="M8 5v3.5M8 11.2h.01" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div className={css.errorCopy}>
        <div className={css.errorTitle}><strong>上下文压缩未成功</strong></div>
        <p className={css.errorMessage}>{node.data.command.outcome.text}</p>
      </div>
    </div>;
    return node.data.compaction ? <CompactionDivider data={node.data.compaction} /> : null;
  }
  if (isNode(node, 'compaction')) return <CompactionDivider data={node.data} />;
  if (node.kind === 'context' || node.kind === 'turn-tail' || node.kind === 'system-prompt' || node.kind === 'turn-process') return null;
  if ((node.kind as string) === 'command-input') {
    const data = node.data as { readonly text: string };
    return <div className={css.user} data-reader-anchor data-reader-key={nodeKey}>
      <p className={css.meta}>命令输入</p>
      <p className={css.commandInput}>{data.text}</p>
    </div>;
  }
  return <div className={css.unknown} data-reader-anchor>
    <p>此记录类型暂未接入阅读页：{node.kind}</p>
    <JsonBlock label="查看原始记录" payload={node.data} truncatedLabel={truncatedJsonLabel} />
  </div>;
});

function GroupStatus({ group, sessionId, useChat, useSession, useSessionPendingInteraction, motion }: Pick<ReaderProps, 'sessionId' | 'useChat' | 'useSession' | 'useSessionPendingInteraction'> & { group: ReaderGroup; motion: boolean }) {
  const pending = useSessionPendingInteraction(snapshot => snapshot.get(sessionId));
  const text = useChat(snapshot => {
    const turn = group.turn === null ? undefined : snapshot.timeline.turns.get(group.turn);
    if (turn?.status === 'closed') {
      if (turn.end?.data.reason.kind !== 'completed') return '执行过程';
      const elapsed = turn.start && turn.end ? Math.max(0, Math.round((turn.end.time - turn.start.time) / 1000)) : null;
      return elapsed === null ? '执行过程' : elapsed < 60 ? `用时 ${elapsed} 秒` : `用时 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`;
    }
    if (turn?.status !== 'open') return '执行过程';
    if (pending !== undefined) return '等待你的操作';
    const current = turn.steps.at(-1)?.data.get('assistant-step');
    const last = current?.blocks.at(-1);
    if (current?.status === 'running' && last?.kind === 'tool-call') return preparingLabel(last.name);
    for (let index = group.keys.length - 1; index >= 0; index--) {
      const node = snapshot.nodes.get(group.keys[index]);
      if (!node) continue;
      if (isNode(node, 'tool-call') && !('kind' in node.data.root)) return '正在使用工具';
      if (isNode(node, 'assistant-step') && node.data.status === 'running') {
        const last = node.data.blocks.at(-1);
        return last?.kind === 'reasoning' ? '正在思考' : last?.kind === 'text' ? '正在输出' : '正在准备回复';
      }
    }
    return '正在处理';
  });
  const busy = useChat(snapshot => group.turn !== null && snapshot.timeline.turns.get(group.turn)?.status === 'open' && pending === undefined);
  const nodes = useChat(snapshot => snapshot.nodes);
  const pendingSubmissions = useSession(snapshot => snapshot.pendingSubmissions);
  /**
   * Is the MODEL the one being waited on right now? Upstream 0.2.0's state machine, scoped to this
   * group, because this view's status is per turn rather than one line for the whole transcript:
   *
   *   - a closed turn has nothing to wait for;
   *   - a pending interaction is the reader's move, not the model's — that is 「等待你的操作」;
   *   - an assistant step that has produced nothing while still running is precisely the wait (the
   *     request is out and nothing has come back), while one that has produced a block ends it;
   *   - otherwise the ball is with the model when the newest node handed it back: the reader spoke,
   *     or a tool RETURNED, a context was injected, a command finished. A tool that is still running
   *     is not a wait — the tool is the one working — and `handsBackToModel` is what tells those two
   *     apart, by the settled `tool-result` a returned call carries.
   */
  const awaitingModel = useChat(snapshot => {
    const turn = group.turn === null ? undefined : snapshot.timeline.turns.get(group.turn);
    if (turn?.status !== 'open') return false;
    if (pending !== undefined) return false;
    const lastKey = group.keys.at(-1);
    const last = lastKey === undefined ? undefined : snapshot.nodes.get(lastKey);
    if (last === undefined) return false;
    if (isNode(last, 'assistant-step')) return last.data.blocks.length === 0 && last.data.status === 'running';
    return handsBackToModel(last);
  });
  // The anchor is the moment the current wait began — the last handover, never the start of the
  // turn — so a wait that has just begun does not inherit the minutes the tools already spent.
  const wait = useMemo(
    () => awaitingModel ? waitingAnchor(group.keys, key => nodes.get(key), pendingSubmissions ?? []) : null,
    [awaitingModel, group.keys, nodes, pendingSubmissions],
  );
  return <span className={css.statusLine}>
    <StatusText text={text} motion={motion} shimmer={busy} />
    {/* Keyed by the handover, so a new one gets a fresh clock rather than inheriting the elapsed
        time of the wait it replaced. */}
    {wait !== null && <WaitClock key={wait.key} startTime={wait.time} />}
  </span>;
}

const DeliverableChip = memo(function DeliverableChip({ path, openFile, revealFile }: {
  path: string;
  openFile?: (path: string) => Promise<void> | void;
  revealFile?: (path: string) => Promise<void> | void;
}) {
  const [status, setStatus] = useState<'idle' | 'opened' | 'copied' | 'revealed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const flash = (next: 'opened' | 'copied' | 'revealed') => {
    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 1600);
  };

  const onOpen = (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      openFile?.(path);
      flash('opened');
    } catch {
      // fallback
    }
  };

  const onReveal = (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      if (revealFile) {
        revealFile(path);
      } else {
        openFile?.(dirname(path));
      }
      flash('revealed');
    } catch {
      // fallback
    }
  };

  const onCopy = (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      void navigator.clipboard?.writeText(path);
      flash('copied');
    } catch {
      // fallback
    }
  };

  const name = basename(path);
  const folder = dirname(path);

  return (
    <div className={css.deliverableChip} data-status={status} title={path}>
      <button
        type="button"
        className={css.chipMain}
        onClick={onOpen}
        onDoubleClick={onOpen}
        aria-label={`直接在编辑器中打开 ${path}`}
      >
        {status === 'opened' ? (
          <svg className={css.statusIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <path d="M3.5 8.5l3 3 6-7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg className={css.deliverableIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <path d="M4 2.5h5l3 3V13.5H4V2.5z" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M9 2.5v3h3" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        )}
        <span className={css.deliverableName}>
          {status === 'opened' ? '已在外部打开' : name}
        </span>
      </button>

      <div className={css.chipActions} aria-label="文件操作">
        <button
          type="button"
          className={css.chipActionBtn}
          title={`在访达中定位所在目录 (${folder})`}
          aria-label="在访达中显示所在目录"
          onClick={onReveal}
        >
          {status === 'revealed' ? (
            <svg className={css.actionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M3.5 8.5l3 3 6-7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg className={css.actionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M2 4.5h4l1.5 2H14v6.5H2V4.5z" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={css.chipActionBtn}
          title="复制相对路径"
          aria-label="复制相对路径"
          onClick={onCopy}
        >
          {status === 'copied' ? (
            <svg className={css.actionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M3.5 8.5l3 3 6-7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg className={css.actionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" strokeWidth="1.2" />
              <path d="M4 10.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
});

function DeliverablesRow({ deliverables, openFile, revealFile }: {
  deliverables: readonly string[];
  openFile?: (path: string) => Promise<void> | void;
  revealFile?: (path: string) => Promise<void> | void;
}) {
  const [folderStatus, setFolderStatus] = useState<'idle' | 'opened'>('idle');
  const onOpenWorkspace = () => {
    try {
      openFile?.('.');
      setFolderStatus('opened');
      setTimeout(() => setFolderStatus('idle'), 1600);
    } catch {
      // ignore
    }
  };

  return (
    <div className={css.deliverablesRoot} data-reader-deliverables>
      <span className={css.deliverablesLabel}>产物</span>
      <div className={css.deliverablesLane}>
        <div className={css.deliverablesRow}>
          {deliverables.slice(0, 8).map(path => (
            <DeliverableChip key={path} path={path} openFile={openFile} revealFile={revealFile} />
          ))}
          {deliverables.length > 8 && (
            <span className={css.deliverablesMore}>
              + {deliverables.length - 8} 个文件
            </span>
          )}
          {deliverables.length > 1 && (
            <button
              type="button"
              className={css.deliverablesShowFolder}
              data-status={folderStatus}
              onClick={onOpenWorkspace}
              title="在访达中打开整个工作区目录"
            >
              {folderStatus === 'opened' && (
                <svg className={css.statusIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
                  <path d="M3.5 8.5l3 3 6-7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <span>{folderStatus === 'opened' ? '已打开访达' : '在文件夹中显示'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const TurnGroup = memo(function TurnGroup({ group, motion, pinnedKeys, selectedProcessKeys, ...props }: ReaderProps & { group: ReaderGroup; motion: boolean; pinnedKeys: readonly string[]; selectedProcessKeys: readonly string[] }) {
  const nodes = props.useChat(snapshot => snapshot.nodes);
  const turn = props.useChat(snapshot => group.turn === null ? undefined : snapshot.timeline.turns.get(group.turn));
  const boundary = useMemo(() => boundaryOf(turn), [turn]);
  const choiceKey = processChoiceKey(group.key, boundary);
  const expansionChoice = props.useStore(state => state.expanded[choiceKey]);
  const flowId = useId();
  const processButton = useRef<HTMLButtonElement>(null);
  const setExpanded = useCallback((value: boolean) => props.actions.setExpanded(choiceKey, value), [props.actions, choiceKey]);
  const pinProcess = useCallback(() => setExpanded(true), [setExpanded]);
  // A turn may open with a system prompt and carry several user/steering messages
  // (system prompt, the user's message, injected context, steering). Collect every
  // one of them so they all render in the turn's leading slot, above the process
  // disclosure, in source order.
  // A subscription must not allocate. The snapshot hook compares what the selector returns by identity
  // and is notified on every streamed chunk, so an array built in here is a new value every time — and
  // this turn then re-rendered on every delta of every OTHER turn: one full `readerFlow` pass, the
  // deliverables scan, and element creation for the whole transcript, per character. The selector
  // therefore publishes a primitive, and the array is derived from it below, so a chunk that does not
  // change this turn's classification costs nothing at all.
  const turnUserSignature = props.useChat(snapshot => group.keys.filter(key => {
    const kind = snapshot.nodes.get(key)?.kind;
    return kind === 'user' || kind === 'steering';
  }).join('\u0000'));
  const turnUserKeys = useMemo(
    () => turnUserSignature === '' ? NO_KEYS : turnUserSignature.split('\u0000'),
    [turnUserSignature],
  );
  // Memoized on the split above: `flow` and everything built from it keys on this identity, and a
  // rebuilt array here would put the rest of this component back on the per-delta path.
  const mainKeys = useMemo(() => group.keys.filter(key => !turnUserKeys.includes(key)), [group, turnUserKeys]);
  const flow = useMemo(() => readerFlow({ ...group, keys: mainKeys }, turn, key => nodes.get(key)), [nodes, group, mainKeys, turn]);
  const hasProcess = flow.some(item => item.kind === 'tool' || hasProcessContent(nodes.get(item.nodeKey), boundary));
  // Only a real, still-active text selection delays folding. Merely clicking,
  // focusing or scrolling the live card does not create a permanent override.
  const holdingSelection = flow.some(item => selectedProcessKeys.includes(item.key));
  const expanded = holdingSelection || processExpanded(expansionChoice, boundary);
  const deliverables = useMemo(() => getTurnDeliverables(turn, flow), [turn, flow]);
  // The open mode is read HERE, through the subscriber, and handed to the opener as an argument.
  // The injected `openFile` cannot read it: `createReaderStore()` returns a handle (spec + create)
  // and the live snapshot belongs to the framework's own instance, which only this hook sees.
  const openInSidebar = props.useStore(state => deliverableOpenModeOf(state.deliverableOpenMode)) === 'sidebar';
  const openFile = useCallback(
    (path: string) => { props.openFile(path, { mode: openInSidebar ? 'sidebar' : 'external' }); },
    [props.openFile, openInSidebar],
  );
  const fileMentions = useMemo(
    // `typeof` rather than a truthiness test: `openFile` is a required injected prop, so a bare
    // `&& props.openFile` is a check tsc rejects as always-true (TS2774) — but a host that injected
    // nothing still should not make inline paths throw when they are clicked.
    () => (deliverables.length > 0 && typeof props.openFile === 'function'
      ? createProducedFileMentions(deliverables, openFile)
      : undefined),
    [deliverables, props.openFile, openFile],
  );
  const tailData = useMemo(() => {
    for (const key of group.keys) {
      const n = nodes.get(key);
      if (n && isNode(n, 'turn-tail')) return n.data;
    }
    return undefined;
  }, [group.keys, nodes]);
  // The record is published on a `turn-process` node. It is not guaranteed to be
  // one of the group's own keys (the tail lookup above relies on that, and this
  // node is produced differently), so the turn's own steps are searched too.
  // Every step access is guarded: a step whose payload is missing or is not a Map
  // must degrade to "no record", never throw — a throw here takes down the whole
  // reading view, which is exactly what happened once.
    // The record is published on a `turn-process` node, which sits inside this turn
  // like the tail does — so it is read from this turn's own keys and nowhere else.
  // An earlier version also walked the turn's step payloads, which could pick up a
  // *different* turn's record and pair its `answerStep` with this turn's step count
  // (printing a negative remainder). Anything not consistently this turn's is
  // ignored rather than displayed.
  const turnProcess = useMemo(() => {
    for (const key of group.keys) {
      const n = nodes.get(key);
      if (!n || !isNode(n, 'turn-process')) continue;
      const data = n.data as TurnProcessChatData;
      if (typeof data.turn === 'number' && group.turn !== null && data.turn !== group.turn) continue;
      return data;
    }
    return undefined;
  }, [group.keys, nodes, group.turn]);
  const runMs = turn?.start && turn?.end ? Math.max(0, turn.end.time - turn.start.time) : undefined;
  const metrics = useMemo(() => ({
    usage: tailData?.tokenUsage,
    runMs,
    tokensPerSecond: tailData?.tokensPerSecond,
    ttftMs: tailData?.ttftMs,
    endedAt: tailData?.closing?.time ?? turn?.end?.time,
    steps: turnProcess ? { data: turnProcess, totalSteps: turn?.steps.length } : undefined,
  }), [tailData, runMs, turn?.end?.time, turnProcess, turn?.steps.length]);
  const forkSeq = forkAnchorSeq([tailData?.closing?.finalNode]);
  const shared = {
    useChat: props.useChat,
    renderSlotChain: props.renderSlotChain,
    loadImage: props.loadImage,
    fillComposer: props.fillComposer,
    openFile,
    revealFile: props.revealFile,
    forkAt: props.forkAt,
    forkSeq,
    fileMentions,
    metrics,
  };
  const terminal = terminalLabel(boundary.reason);
  const hasTurnError = flow.some(item => item.kind === 'node' && nodes.get(item.nodeKey)?.kind === 'turn-error');
  const showTerminalNotice = terminal && !hasTurnError && boundary.reason !== 'interrupted' && boundary.reason !== 'aborted';
  // The duration stays on the process disclosure rather than becoming its own
  // row: the disclosure label is what expands and folds the process.
  return <section className={css.turn} data-reader-turn={group.turn ?? 'unresolved'} data-reader-turn-state={boundary.status} data-reader-turn-result={boundary.reason ?? undefined}>
    {turnUserKeys.map(userKey => <BlockBoundary key={userKey}><MainNode {...shared} boundary={boundary} nodeKey={userKey} /></BlockBoundary>)}
    {hasProcess && <Disclosure open={expanded} onChange={setExpanded} controls={flowId} buttonRef={processButton}
      label={<GroupStatus group={group} sessionId={props.sessionId} useChat={props.useChat} useSession={props.useSession} useSessionPendingInteraction={props.useSessionPendingInteraction} motion={motion} />} status={turn?.steps.length ? `${turn.steps.length} 个步骤` : undefined} />}
    {!hasProcess && boundary.status === 'open' && <div className={css.disclosure} data-reader-status-only>
      <GroupStatus group={group} sessionId={props.sessionId} useChat={props.useChat} useSession={props.useSession} useSessionPendingInteraction={props.useSessionPendingInteraction} motion={motion} />
    </div>}
    <div id={flowId} className={css.mainFlow} data-reader-flow>
      {flow.map(item => item.kind === 'node' ? <Fragment key={item.key}>
        <BlockBoundary><ProcessNode useChat={props.useChat} t={props.t} nodeKey={item.nodeKey} open={expanded} motion={motion} onRead={pinProcess} returnFocusTo={processButton} /></BlockBoundary>
        <BlockBoundary><AssistantNode {...shared} boundary={boundary} nodeKey={item.nodeKey} pinned={pinnedKeys.includes(item.nodeKey)} processOpen={expanded} motion={motion} onRead={pinProcess} returnFocusTo={processButton} /></BlockBoundary>
        <BlockBoundary><MainNode {...shared} boundary={boundary} nodeKey={item.nodeKey} pinned={pinnedKeys.includes(item.nodeKey)} processOpen={expanded} /></BlockBoundary>
      </Fragment> : <Fragment key={item.key}>
        <BlockBoundary><ProcessFragment open={expanded} motion={motion} onRead={pinProcess} returnFocusTo={processButton} nodeKey={item.key} framed>
          <ToolActivity {...shared} entry={item} motion={motion} turnClosed={boundary.status === 'closed'} onRead={pinProcess} />
          {item.block && <ToolMedia {...shared} block={item.block} />}
        </ProcessFragment></BlockBoundary>
      </Fragment>)}
    </div>
    {showDeliverablesRow(boundary.status, deliverables) && <DeliverablesRow deliverables={deliverables} openFile={openFile} revealFile={props.revealFile} />}
    {showTerminalNotice && <div className={css.notice} data-reader-terminal>{terminal}</div>}
  </section>;
});

/**
 * The turn the reader is looking at: the uppermost one whose bottom edge has not yet passed
 * the scrollport's top, i.e. the first turn still visible. This is the predicate the reading
 * scroll already uses to pick its anchor, so "current" means the same thing in both places.
 * A viewport straddling two turns therefore resolves to the upper one, which is the rule the
 * collapse control is specified with.
 *
 * Takes the turn rows rather than querying them, so one scroll pass hands both readings the same
 * list instead of running the query twice, and stays a plain function over array-like rows so this
 * rule can be tested on its own.
 */
export function currentTurnOf(
  content: { querySelectorAll: (selector: string) => ArrayLike<HTMLElement> },
  viewportTop: number,
  rows?: ArrayLike<HTMLElement>,
): number | null {
  // Indexed rather than for..of: the parameter is typed ArrayLike, which is indexable but not
  // iterable, and a test hands it a plain array.
  const list = rows ?? content.querySelectorAll('[data-reader-turn]');
  // Start at the first row the reading line has passed, found by bisection instead of by measuring every row: this
  // runs once per frame while the reader scrolls, and the walk cost 10k–16k rect reads per second in a measured
  // build. The predicate is then re-tested per row from there on, so a list whose rects are NOT monotone still
  // resolves exactly as the walk did — bisection only decides where the scan may begin.
  for (let index = firstRowPastIndex(list, viewportTop, 8); index < list.length; index += 1) {
    const element = list[index]!;
    // `data-reader-turn` is the turn number, or the literal 'unresolved' for a group the
    // snapshot cannot place; only a real turn can own a process.
    const label = element.dataset.readerTurn;
    const turnNumber = label === undefined ? Number.NaN : Number(label);
    if (!Number.isInteger(turnNumber)) continue;
    if (element.getBoundingClientRect().bottom > viewportTop + 8) return turnNumber;
  }
  return null;
}

export function Reader(props: ReaderProps) {
  const root = useRef<HTMLDivElement>(null);
  const activatedAt = useRef(Date.now());
  const order = props.useChat(snapshot => snapshot.order);
  const nodes = props.useChat(snapshot => snapshot.nodes);
  const timeline = props.useChat(snapshot => snapshot.timeline);
  const pending = props.useSessionPendingInteraction(snapshot => snapshot.get(props.sessionId));
  const openError = props.useSession(snapshot => snapshot.openError);
  const loading = props.useSession(snapshot => snapshot.openState === 'loading');
  const hasMore = props.useSession(snapshot => snapshot.hasMore);
  const loadingOlder = props.useSession(snapshot => snapshot.loadingOlder);
  const pendingSubmissions = props.useSession(snapshot => snapshot.pendingSubmissions);
  const motionPreference = props.useStore(state => state.motion);
  // Read defensively, like `shortcuts` below: persistence replaces the whole record, so a record
  // written before this preference existed comes back with no `glass` key at all.
  const glassPreference = props.useStore(state => state.glass) === true;
  // Whether the skin also reaches the host's conversation view. Read defensively like `glass` itself:
  // a record written before this switch existed has no such key.
  const glassConversation = props.useStore(state => state.glassConversation) === true;
  // Whether the conversation page is painted as a solid page of its own — its own switch, independent of
  // the skin, read the same defensive way.
  const conversationSolid = props.useStore(state => state.conversationSolid) === true;
  // What the single collapse button does; `collapseModeOf` answers `both` for anything unrecognised, which
  // is the behaviour the pair of buttons had.
  const collapseMode = props.useStore(state => collapseModeOf(state.collapseMode));
  // The skin's per-surface opacities: stored as the parts the reader moved, resolved against each
  // part's initial here, and handed to the stylesheet as custom properties on the root.
  const glassStored = props.useStore(state => state.glassParts);
  const glassValuesResolved = useMemo(() => glassValues(glassStored), [glassStored]);
  // Where a delivered file opens. Read through the same fallback the skin uses: a record written
  // before this preference existed, or anything that is not `'sidebar'`, means the system app.
  const openInSidebar = props.useStore(state => deliverableOpenModeOf(state.deliverableOpenMode)) === 'sidebar';
  // The column handles' wheel, default ON and read defensively (`!== false`): a record written before this switch
  // existed keeps the forwarding it was written with. The listener is installed app-wide by index.tsx and reads this
  // root's attribute, so the switch takes effect on the next notch rather than at the next mount.
  const stripWheel = props.useStore(state => state.stripWheel) !== false;
  // How often a streaming message publishes its revealed text. Read through its own fallback reader, so a record
  // written before this preference existed keeps the per-frame cadence it was written with.
  const textCadence = props.useStore(state => textCadenceOf(state.textCadence));
  // Whether a revealed word also resolves from a blur. Default ON and read defensively (`!== false`): a record written
  // before the switch existed keeps the blur every card showed before it.
  const revealBlur = props.useStore(state => state.revealBlur) !== false;
  // Whether each word gets an identity and its own fade at all. Default ON and read defensively: a record written
  // before the switch existed keeps the per-word reveal every card showed before it.
  const revealWords = props.useStore(state => state.revealWords) !== false;
  const glassVars = useMemo(() => glassProperties(glassValuesResolved), [glassValuesResolved]);
  // The wallpaper, read the same defensive way and handed over the same way: two custom properties
  // on the root, with the rest of the backdrop stated in the stylesheet. `wallpaperNameOf` is what
  // makes a record written before this preference existed mean "no wallpaper" rather than a crash.
  const wallpaperName = props.useStore(state => wallpaperNameOf(state.wallpaper));
  const wallpaperDim = props.useStore(state => wallpaperDimOf(state.wallpaperDim));
  const wallpaperScope = props.useStore(state => wallpaperScopeOf(state.wallpaperScope));
  const wallpaperChrome = props.useStore(state => wallpaperChromeOf(state.wallpaperChrome));
  // The whole-window scope is the frame's job (see wallpaper-scope.ts): the same image on the reading
  // view's own root would be a SECOND copy under a second scrim, which is what makes one region
  // visibly darker than the one beside it. So the view paints its own backdrop only in view scope.
  const windowScope = wallpaperScope === 'window' && wallpaperName !== '';
  const wallpaperVars = useMemo(
    () => (windowScope ? {} : wallpaperProperties(wallpaperName, wallpaperDim)),
    [windowScope, wallpaperName, wallpaperDim],
  );
  // The settings record, read WHOLE so it can be handed to the host. The browser's own copy lives in
  // localStorage, and localStorage is keyed by origin — this GUI is served on an ephemeral port, so that
  // copy is a new, empty one on every launch, which is exactly why the reader's settings kept vanishing.
  // The host keeps the copy that survives (see settings-sync.ts): read once here, written back whenever
  // anything settles.
  const readerState = props.useStore(state => state);
  const settingsWriter = useMemo(() => createSettingsWriter(), []);
  // Nothing is sent before that read has ANSWERED. Pushing on mount would write this browser's (possibly
  // empty) state over the record that outlived the last launch — the read has to win that race, and the
  // ref is what keeps the debounced writer quiet until it does.
  const settingsLoaded = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void loadHostSettings().then(hostRecord => {
      if (cancelled) return;
      settingsLoaded.current = true;
      if (hostRecord !== undefined) props.actions.hydrate(hostRecord);
      // Nothing stored yet: THIS browser's copy becomes the record. That is also the migration for
      // settings a reader made before the host kept any.
      else settingsWriter.push(readerState);
    });
    return () => { cancelled = true; };
    // Once per activation: the record is read on the way in, and every later change flows the other way.
  }, []);
  useEffect(() => {
    if (settingsLoaded.current) settingsWriter.push(readerState);
  }, [settingsWriter, readerState]);
  // Flushed on the way out, and on `pagehide` as well: a reader who changes something and closes the tab
  // inside the debounce window would otherwise lose precisely the change they just made.
  useEffect(() => {
    const flush = (): void => { settingsWriter.flush(); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      settingsWriter.flush();
    };
  }, [settingsWriter]);

  // Published on `<html>` from here because the sidebar and the top bar are not descendants of this
  // view — a custom property set on the view's root could never reach them. Deliberately not withdrawn
  // when this component unmounts: the reader may only be switching views, and the backdrop belongs to
  // the window until the preference changes.
  //
  // Published as soon as a wallpaper is chosen, in EITHER scope: the conversation column below the
  // header — the space under the transcript, the gutter, the composer's fade band — is part of the
  // reading view, and leaving it to the theme's colour kept those blocks black with the window switch
  // off. The scope value is what the stylesheet gates the chrome on.
  //
  // In view scope the image is then sized to the READING PAGE (min ratio: the whole picture, never
  // enlarged) rather than covering the window, which is only expressible in viewport coordinates —
  // hence the measured size and place published as two more custom properties. The measurement is a
  // refinement on top of the immediate publication, never a precondition: a resize or a composer that
  // grows changes the page's box, and both are re-measured.
  useEffect(() => {
    if (wallpaperName === '') {
      applyWindowScope(document, null);
      return;
    }
    const image = `url("${wallpaperUrl(wallpaperName)}")`;
    const publish = (geometry: { size: string; position: string } | null): void => {
      applyWindowScope(document, {
        scope: wallpaperScope,
        image,
        dim: wallpaperDim,
        chrome: wallpaperChrome,
        ...(geometry ?? {}),
      });
    };
    publish(null);
    if (wallpaperScope === 'window') return;

    const source = new Image();
    let frame = 0;
    const measure = (): void => {
      if (source.naturalWidth === 0) return;
      const box = document.querySelector('[class*="_scrollBody"]');
      if (box === null) return;
      const rect = box.getBoundingClientRect();
      publish(wallpaperGeometry({
        imageWidth: source.naturalWidth,
        imageHeight: source.naturalHeight,
        target: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        scope: wallpaperScope,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }));
    };
    // One measurement per frame at most: dragging a divider fires far more events than layout settles.
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => { frame = 0; measure(); });
    };
    source.addEventListener('load', schedule);
    source.src = wallpaperUrl(wallpaperName);
    if (source.complete) schedule();
    window.addEventListener('resize', schedule);
    const box = document.querySelector('[class*="_scrollBody"]');
    const observer = typeof ResizeObserver === 'undefined' || box === null ? null : new ResizeObserver(schedule);
    if (observer !== null && box !== null) observer.observe(box);
    return () => {
      source.removeEventListener('load', schedule);
      window.removeEventListener('resize', schedule);
      if (observer !== null) observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [wallpaperName, wallpaperScope, wallpaperDim, wallpaperChrome]);

  // The gutter's groove rides the skin's dial like the other surfaces, and like them it is published
  // only while the skin is on: with it off the host's own transparent track is left untouched, which is
  // the look that existed before this dial did.
  useEffect(() => {
    applyScrollbarFill(document, glassPreference ? scrollbarFillOf(glassValuesResolved.scrollbar) : '');
  }, [glassPreference, glassValuesResolved]);
  const motion = useMotionAllowed(motionPreference);
  // The two collapse verbs and the bindings they answer to. A record written before the field
  // existed has no `shortcuts` at all, so the defaults are resolved here rather than assumed; a
  // CLEARED slot is the empty string and stays cleared.
  const storedShortcuts = props.useStore(state => state.shortcuts);
  const collapseTurnKey = storedShortcuts?.collapseTurn ?? DEFAULT_SHORTCUTS.collapseTurn;
  const collapseAllKey = storedShortcuts?.collapseAll ?? DEFAULT_SHORTCUTS.collapseAll;
  /** The advertised key, or nothing at all when the reader cleared the slot. */
  const keyHint = (binding: string) => binding === '' ? '' : `（${shortcutLabel(binding)}）`;
  const streamMotion = useMemo(() => ({ enabled: motion, activatedAt: activatedAt.current, cadence: textCadence, blur: revealBlur, words: revealWords }), [motion, textCadence, revealBlur, revealWords]);
  const groups = useMemo(() => groupNodes(order, key => nodes.get(key)), [order, nodes, timeline]);
  // A "conversation" here is one turn (the question plus its answer), so "收起" folds the
  // turn the reader is currently looking at — not every open turn on the page. The current
  // turn is the uppermost one in the viewport, decided by the same predicate the reading
  // scroll uses to pick its anchor: the first turn whose bottom edge has not yet passed the
  // scrollport's top. When the viewport straddles two turns, that is the upper one.
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  // Expansion is read here exactly as TurnGroup reads it, so a turn held open by the
  // reader's own text selection counts too.
  const expansionChoices = props.useStore(state => state.expanded);
  const openTurnKeys = useMemo(() => {
    const open = new Set<string>();
    for (const group of groups) {
      if (group.turn === null || group.turn !== currentTurn) continue;
      const turn = timeline.turns.get(group.turn);
      const boundary = boundaryOf(turn);
      const choice = expansionChoices[processChoiceKey(group.key, boundary)];
      if (processExpanded(choice, boundary)) open.add(processChoiceKey(group.key, boundary));
    }
    return open;
  }, [groups, timeline, expansionChoices, currentTurn]);
  const currentTurnOpen = openTurnKeys.size > 0;
  // Every turn the reader has expanded, not just the one in view. The toolbar button stays scoped to
  // the current turn (that was a deliberate narrowing), but a reader who has opened several turns
  // needs a way back in one step, and a keyboard path to both.
  const allOpenKeys = useMemo(() => {
    const open = new Set<string>();
    for (const group of groups) {
      if (group.turn === null) continue;
      const turn = timeline.turns.get(group.turn);
      const boundary = boundaryOf(turn);
      const choice = expansionChoices[processChoiceKey(group.key, boundary)];
      if (processExpanded(choice, boundary)) open.add(processChoiceKey(group.key, boundary));
    }
    return open;
  }, [groups, timeline, expansionChoices]);
  const otherTurnsOpen = allOpenKeys.size > openTurnKeys.size;
  const collapseCurrentTurn = useCallback(() => {
    for (const key of openTurnKeys) props.actions.setExpanded(key, false);
  }, [openTurnKeys, props.actions]);
  const collapseEveryTurn = useCallback(() => {
    for (const key of allOpenKeys) props.actions.setExpanded(key, false);
  }, [allOpenKeys, props.actions]);
  // Collapsing hides the button that was just used, and a hidden element cannot hold focus: the
  // keyboard reader would be dropped to <body> and have to tab back in from the top of the page.
  // Remember where focus was, and hand it to the toolbar's other control once the wrap is empty.
  const collapseWrapRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const focusWasInCollapseWrap = useRef(false);
  const rememberCollapseFocus = useCallback(() => {
    focusWasInCollapseWrap.current = collapseWrapRef.current?.contains(document.activeElement) ?? false;
  }, []);
  useEffect(() => {
    if (!focusWasInCollapseWrap.current) return;
    // Something is still visible in the wrap (another button, or another expanded turn).
    if (currentTurnOpen || otherTurnsOpen) return;
    focusWasInCollapseWrap.current = false;
    settingsRef.current?.focus();
  }, [currentTurnOpen, otherTurnsOpen]);
  // The two collapse verbs, on whatever bindings the reader chose (Alt+C and Alt+Shift+C by
  // default). Alt keeps them out of the composer's way — a bare letter would be swallowed while
  // typing, and the reader should be able to collapse without abandoning a half-written message,
  // which is why the panel refuses a binding without Alt, Ctrl or Cmd. Nothing is prevented when
  // the shortcut would be a no-op, so the browser keeps its own bindings everywhere else.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (matchesShortcut(event, collapseTurnKey)) {
        if (!currentTurnOpen) return;
        event.preventDefault();
        rememberCollapseFocus();
        collapseCurrentTurn();
        return;
      }
      if (!matchesShortcut(event, collapseAllKey)) return;
      if (!currentTurnOpen && !otherTurnsOpen) return;
      event.preventDefault();
      rememberCollapseFocus();
      collapseEveryTurn();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentTurnOpen, otherTurnsOpen, collapseTurnKey, collapseAllKey, collapseEveryTurn, collapseCurrentTurn, rememberCollapseFocus]);
  // One scroll spy feeds both readings, because both need the same measurement: the turn in
  // view ("收起" scope, and the header the shortcut targets) and the turn the rail marks
  // active. Measuring them in one pass matters — the first getBoundingClientRect() flushes
  // layout, and two listeners meant two rAF ticks, two queries and two flushes per scroll,
  // which is what made a handoff stutter while the pointer stayed over the transcript. One tick
  // now queries the rows once and reads both thresholds inside the same flush.
  // What the effect below actually depends on is the SET OF ROWS, not the array that carries them. `groups` is
  // rebuilt on structural publication — a new node anywhere, including one appended to a turn that is already on
  // screen — and this effect would then tear down and re-run a forced measurement (a getBoundingClientRect, a
  // querySelectorAll and two setStates) for a row set that did not move. A turn that grows does not move the rows
  // ABOVE it, and those are the ones the reading line is measured against; position changes arrive through the scroll
  // listener and the ResizeObserver on the scroller, both of which this effect installs and neither of which depends
  // on the dependency list. (Text deltas alone do not rebuild `groups` at all: its deps — the node store, the order
  // array and the timeline — keep their identity across a delta, so only the growing node itself is replaced.)
  const turnSignature = useMemo(() => groups.map(group => group.turn).join('|'), [groups]);
  useLayoutEffect(() => {
    const content = root.current;
    if (!content) return;
    const scroller = content.closest<HTMLElement>('[data-conversation-scroll]') ?? content;
    // One query per ROW SET, not per frame. This effect re-runs whenever `turnSignature` changes — a turn being added
    // is the only thing that can add, remove or re-key a row element (keys are the turn numbers, and a node arriving
    // inside a turn leaves its row element alone) — so the list stays valid for the life of the effect. Querying
    // inside `measure` allocated a whole NodeList on every scroll frame.
    const rows = content.querySelectorAll<HTMLElement>('[data-reader-turn]');
    const measure = () => {
      const viewportTop = scroller.getBoundingClientRect().top;
      // The reading line is 35% down the scrollport, measured from the scrollport's own top edge
      // rather than the window's, so it means the same thing wherever the transcript sits on
      // screen. currentTurnOf uses the same origin, so both readings share one coordinate system.
      const line = scroller.clientHeight * 0.35;
      // Both readings bisect the same row list, so both are logarithmic in the number of turns: the rail's "last row
      // that reached the line" used to be an indexed walk that measured every row ABOVE the reading line, once per
      // frame. `firstRowWhere` and this predicate are documented together in `reading-scroll.ts`.
      let firstVisible = currentTurnOf(content, viewportTop, rows);
      const past = firstRowWhere(rows, row => row.getBoundingClientRect().top > viewportTop + line);
      // The rail marks the last turn that has reached the reading line, i.e. the one being
      // read rather than merely visible. Every row before `past` is at or above the line, so the
      // label is the last labelled one among them — and unresolved rows carry no label.
      let active: number | null = null;
      for (let index = past - 1; index >= 0; index -= 1) {
        const value = Number(rows[index]!.dataset.readerTurn);
        if (Number.isSafeInteger(value)) { active = value; break; }
      }
      let first: number | null = null;
      for (let index = 0; index < rows.length; index += 1) {
        const value = Number(rows[index]!.dataset.readerTurn);
        if (Number.isSafeInteger(value)) { first = value; break; }
      }
      setCurrentTurn(previous => previous === firstVisible ? previous : firstVisible);
      setActiveTurn(previous => {
        const next = active ?? first;
        return previous === next ? previous : next;
      });
    };
    measure();
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(scroller);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      observer?.disconnect();
    };
  }, [turnSignature]);
  // Whether any turn is still RUNNING — the same `status === 'open'` the status line and the wait clock read. It gates
  // the tail-follow (see `useReadingScroll`): with nothing arriving, following the bottom is not keeping up with
  // anything, it is only fighting the reader's own scrolling.
  const live = props.useChat(snapshot => {
    for (const turn of snapshot.timeline.turns.values()) if (turn.status === 'open') return true;
    return false;
  });
  const scroll = useReadingScroll(root, motion, live);
  const pinnedKeys = usePinnedSelection(root);
  const selectedProcessKeys = usePinnedSelection(root, '[data-reader-process]');
  const [historyError, setHistoryError] = useState(false);
  // 1. Navigation items from Chat snapshot
  const turnNavigationItems = props.useChat(snapshot => snapshot.navigation?.items ? snapshot.navigation.items() : undefined);
  // 2. Whole-log turn outline projection
  const turnOutline = props.useProjection?.('turnOutline');
  // 3. Track turns with deliverables
  const turnsWithDeliverables = useMemo(() => {
    const set = new Set<number>();
    for (const [turnNum, loc] of timeline.turns) {
      const deliv = (loc.data as { get(key: string): unknown } | undefined)?.get('deliverables') as { produced?: unknown[] } | undefined;
      if (Array.isArray(deliv?.produced) && deliv.produced.length > 0) {
        set.add(turnNum);
      }
    }
    return set;
  }, [timeline]);

  // 4. Merged timeline items for the rail
  const timelineItems = useMemo(
    () => mergeTimelineItems(turnNavigationItems, turnOutline, turnsWithDeliverables),
    [turnNavigationItems, turnOutline, turnsWithDeliverables],
  );

  // 5. Active & busy turn tracking
  // Both are written by the single scroll spy above, so there is deliberately no second
  // listener here: a duplicate spy measured every turn row again on every scroll.
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const [busyTurn, setBusyTurn] = useState<number | null>(null);

  // Navigation handler (supports loaded jump & unloaded loadThrough).
  // Land on the conversation scroller only — scrollIntoView also moves
  // ancestor boxes and can lift the sticky composer after a top→bottom jump.
  const onNavigateTurn = useCallback(async (item: TimelineItem) => {
    const el = root.current;
    if (!el) return;
    const port = scrollerOf(el);
    const reveal = (turn: number) => {
      const targetRow = el.querySelector<HTMLElement>(`[data-reader-turn="${turn}"]`);
      if (!targetRow) return;
      const last = timelineItems.at(-1);
      if (last !== undefined && last.turn === turn) {
        scroll.jump();
      } else {
        scroll.release();
        landTurn(targetRow, port);
      }
      setActiveTurn(turn);
    };

    if (item.anchor.kind === 'loaded') {
      reveal(item.turn);
      return;
    }

    setBusyTurn(item.turn);
    try {
      if (props.loadThrough) {
        await props.loadThrough(item.anchor.seq);
      } else {
        await props.loadOlder();
      }
      setTimeout(() => { reveal(item.turn); }, 50);
    } finally {
      setBusyTurn(null);
    }
  }, [props.loadThrough, props.loadOlder, scroll.jump, scroll.release, timelineItems]);

  const lastKey = order.at(-1);
  const lastNode = lastKey ? nodes.get(lastKey) : undefined;
  const lastSubmissionId = pendingSubmissions?.length ? pendingSubmissions[pendingSubmissions.length - 1].requestId : null;
  const lastOrderKeyRef = useRef<string | undefined>(lastKey);
  const lastSubmissionRef = useRef<string | null>(lastSubmissionId);

  useLayoutEffect(() => {
    const appendedUser = lastKey !== lastOrderKeyRef.current && (lastNode?.kind === 'user' || lastNode?.kind === 'steering');
    const appendedSubmission = lastSubmissionId !== null && lastSubmissionId !== lastSubmissionRef.current;
    lastOrderKeyRef.current = lastKey;
    lastSubmissionRef.current = lastSubmissionId;

    if (appendedUser || appendedSubmission) {
      scroll.jump();
    }
  }, [lastKey, lastNode?.kind, lastSubmissionId, scroll]);

  const visibleSubmissions = useMemo(() => {
    if (!pendingSubmissions || pendingSubmissions.length === 0) return [];
    return pendingSubmissions.filter(sub => sub.placement !== 'queued');
  }, [pendingSubmissions]);

  return <StreamMotionContext.Provider value={streamMotion}><div ref={root} className={css.root} style={{ ...glassVars, ...wallpaperVars } as CSSProperties} data-dsh-better-display="0.1.0" data-motion={motion ? 'on' : 'off'} data-reader-strip-wheel={stripWheel ? 'on' : 'off'} data-reader-glass={glassPreference ? '' : undefined} data-reader-wallpaper={wallpaperName === '' || windowScope ? undefined : ''}>
    <TimelineRail items={timelineItems} activeTurn={activeTurn} busyTurn={busyTurn} onNavigate={onNavigateTurn} />
    {/* ChatView publishes data-chat-flow="" on its column. Skins treat a
        scrollport without that hook as inspect-only and hide [data-composer-seat]. */}
    <div className={css.column} data-chat-flow="">
      <div className={css.toolbar} data-ud-check="reader-toolbar">
        <div className={css.collapseWrap} ref={collapseWrapRef} data-ud-check="collapse-wrap">
          <CollapseControl mode={collapseMode} currentOpen={currentTurnOpen} othersOpen={otherTurnsOpen}
            turnKey={collapseTurnKey} allKey={collapseAllKey} keyHint={keyHint}
            remember={rememberCollapseFocus} collapseCurrent={collapseCurrentTurn} collapseAll={collapseEveryTurn} />
        </div>
        <SettingsMenu motion={motion} preference={motionPreference} onChange={props.actions.setMotion}
          glass={glassPreference} onGlass={props.actions.setGlass}
          glassConversation={glassConversation} onGlassConversation={props.actions.setGlassConversation}
          conversationSolid={conversationSolid} onConversationSolid={props.actions.setConversationSolid}
          collapseMode={collapseMode} onCollapseMode={props.actions.setCollapseMode}
          glassParts={glassValuesResolved} onGlassPart={props.actions.setGlassPart}
          openInSidebar={openInSidebar} onOpenInSidebar={on => { props.actions.setDeliverableOpenMode(on ? 'sidebar' : 'external'); }}
          stripWheel={stripWheel} onStripWheel={props.actions.setStripWheel}
          textCadence={textCadence} onTextCadence={props.actions.setTextCadence}
          revealBlur={revealBlur} onRevealBlur={props.actions.setRevealBlur}
          revealWords={revealWords} onRevealWords={props.actions.setRevealWords}
          wallpaper={wallpaperName} wallpaperDim={wallpaperDim}
          onWallpaper={props.actions.setWallpaper} onWallpaperDim={props.actions.setWallpaperDim}
          wallpaperScope={wallpaperScope} wallpaperChrome={wallpaperChrome}
          onWallpaperScope={props.actions.setWallpaperScope} onWallpaperChrome={props.actions.setWallpaperChrome}
          shortcuts={{ collapseTurn: collapseTurnKey, collapseAll: collapseAllKey }} onShortcut={props.actions.setShortcut} buttonRef={settingsRef} />
      </div>
      {hasMore && <button type="button" className={css.historyButton} disabled={loadingOlder} onClick={async () => {
        setHistoryError(false);
        try { await props.loadOlder(); } catch { setHistoryError(true); }
      }}>{loadingOlder ? '正在加载更早记录' : '加载更早记录'}</button>}
      {historyError && <div className={css.notice}>历史记录加载失败，可再次尝试；现有内容未改变。</div>}
      {openError && <div className={css.error} role="alert">会话暂时无法读取：{openError.message}</div>}
      {loading && groups.length === 0 && <p className={css.empty} role="status">正在读取会话…</p>}
      {groups.map(group => <TurnGroup key={group.key} {...props} group={group} motion={motion} pinnedKeys={pinnedKeys} selectedProcessKeys={selectedProcessKeys} />)}
      {visibleSubmissions.map(submission => (
        <div key={submission.requestId} className={css.userCluster} data-reader-pending-submission>
          {submission.attachments.some(item => item.type === 'image') && (
            <div className={css.userImages}>
              {submission.attachments.map((item, idx) => item.type === 'image' ? (
                <figure key={idx} className={css.imageFigure}>
                  <div className={css.imageFrame} style={{ aspectRatio: `${item.value.width || 4} / ${item.value.height || 3}` }}>
                    <img src={item.value.previewUrl} alt={item.value.name ?? '发送的图片'} className={css.pendingImage} />
                  </div>
                </figure>
              ) : null)}
            </div>
          )}
          {submission.text ? (
            <div className={css.user}>
              <div className={css.blocks}>{submission.text}</div>
            </div>
          ) : null}
          <UserMessageActions text={submission.text} time={submission.time} />
        </div>
      ))}
      {pending !== undefined && <div className={css.attention} role="alert" data-reader-attention>
        <strong>{pending.kind === 'question' ? '需要你回答一个问题' : '需要你的确认'}</strong>
        <span>请在下方原生操作区处理。此提示不会收进执行过程。</span>
      </div>}
      {scroll.detached && <div className={css.jumpDock}><button type="button" className={css.jump} onClick={scroll.jump}>↓ 回到最新</button></div>}
    </div>
  </div></StreamMotionContext.Provider>;
}
