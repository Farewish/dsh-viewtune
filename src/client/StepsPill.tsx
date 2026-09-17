import { Component, memo, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { TurnProcessChatData } from './types.js';
import css from './TurnMetrics.module.css';

/**
 * The turn's process record, surfaced in the answer's action row.
 *
 * Which numbers come from where, kept deliberately separate:
 *   - `answerStep` — the step the final answer landed on, straight from the host's
 *     turn-process record;
 *   - `totalSteps` — how many steps the turn ran, i.e. the same number the process
 *     disclosure shows. It is not part of that record.
 *
 * The record carries no protocol-level names for the individual phases, so the
 * popover lists what the fields do describe and says so, rather than inventing
 * step titles.
 *
 * An optional extra, so it is wrapped in its own error boundary: the record is
 * published by the host and its shape can differ from what is assumed here. Without
 * the boundary a surprise in this decoration takes down the whole reading view —
 * which is exactly what happened once, and cost a blank page.
 */
export interface StepsPillProps {
  data?: TurnProcessChatData;
  totalSteps?: number;
}

class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the failure visible in the console but out of the reader's way.
    console.warn('[dsh-better-display] steps pill failed to render:', error, info.componentStack);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const Pill = memo(function Pill({ data, totalSteps }: StepsPillProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!data) return null;
  const answerStep = typeof data.answerStep === 'number' ? data.answerStep : null;
  const total = typeof totalSteps === 'number' && totalSteps > 0 ? totalSteps : null;
  const answer = answerStep;
  // The count covers only the steps that were loaded, while the answer's position is
  // absolute. A count that cannot reach the position is a partial sum: it is not used
  // as a denominator, and the turn is described as truncated.
  const truncated = answer !== null && total !== null && answer > total;
  // A turn whose start is outside the history window cannot be described by this
  // record: the count is a partial sum while the position is absolute. Nothing is
  // shown for it, matching how the usage/duration pills already behave here.
  if (truncated) return null;
  if (answerStep === null && total === null) return null;

  const label = answer !== null ? `${answer}/${total} 个步骤` : `${answer ?? total} 个步骤`;

  return (
    <span ref={containerRef} className={css.container}>
      <button
        type="button"
        className={css.pillButton}
        data-active={open}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`轮次过程记录：${label}`}
        title="查看轮次过程记录"
      >
        <svg className={css.pillIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <path d="M3 3.4h10M3 8h10M3 12.6h6.4" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="12.4" cy="12.6" r="1.5" strokeWidth="1.2" />
        </svg>
        <span>{label}</span>
      </button>

      {open && (
        <div className={css.metricsPop} role="dialog" aria-label="轮次过程记录">
          <div className={css.popHeader}>
            <span>{typeof data.turn === 'number' ? `轮次过程记录 · 第 ${data.turn} 轮` : '轮次过程记录'}</span>
          </div>

          <div className={css.popSection}>
            <div className={css.popSectionTitle}>步骤</div>
            <div className={css.popGrid}>
              {answerStep !== null && (
                <>
                  <span className={css.popLabel}>
                    回答所在步骤
                    <span className={css.popBadge}>过程记录字段</span>
                  </span>
                  <span className={css.popValue}>第 {answerStep} 步</span>
                </>
              )}
              {total !== null && (
                <>
                  <span className={css.popLabel}>本轮总步骤</span>
                  <span className={css.popValue}>{total} 步</span>
                </>
              )}
            </div>
            {answerStep !== null && total !== null && (
              <p className={css.popNote}>
                {answer === total
                  ? '回答落在最后一步：本轮的思考与工具都在它之前。'
                  : `回答落在第 ${answer} 步，其后还有 ${total - answer} 步（收尾、产出文件或状态更新）。`}
              </p>
            )}
          </div>

          <div className={css.popSection}>
            <div className={css.popSectionTitle}>回答之前的过程</div>
            <div className={css.popGrid}>
              <span className={css.popLabel}>消息</span>
              <span className={css.popValue}>{data.messageCount ?? 0} 条</span>

              <span className={css.popLabel}>工具调用</span>
              <span className={css.popValue}>{data.toolCallCount ?? 0} 次</span>

              <span className={css.popLabel}>子代理</span>
              <span className={css.popValue}>{data.subagentCount ?? 0} 个</span>

              <span className={css.popLabel}>思考位置</span>
              <span className={css.popValue}>{data.inlineReasoning ? '与回答同一步（内联）' : '独立步骤'}</span>
            </div>
          </div>

          <div className={css.popSection}>
            <div className={css.popSectionTitle}>过程起点</div>
            <div className={css.popGrid}>
              <span className={css.popLabel}>过程起始事件</span>
              <span className={css.popValue}>#{data.processStartSeq ?? '—'}</span>

              <span className={css.popLabel}>控制锚点事件</span>
              <span className={css.popValue}>#{data.controlAnchorSeq ?? '—'}</span>

              <span className={css.popLabel}>回答锚点事件</span>
              <span className={css.popValue}>
                {typeof data.answerAnchorSeq === 'number' ? `#${data.answerAnchorSeq}` : '—'}
              </span>
            </div>
          </div>

        </div>
      )}
    </span>
  );
});

export function StepsPill(props: StepsPillProps) {
  return <QuietBoundary><Pill {...props} /></QuietBoundary>;
}
