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
  // `Number.isFinite`, not just `typeof === 'number'`: `NaN` IS a number and is NOT null, so it walked straight past the
  // guard that was added for exactly this class of leak and printed 「NaN/5 个步骤」. The `total` line below needs no
  // change — `NaN > 0` is false — which is why the two are spelled differently.
  const answerStep = typeof data.answerStep === 'number' && Number.isFinite(data.answerStep) ? data.answerStep : null;
  const total = typeof totalSteps === 'number' && Number.isFinite(totalSteps) && totalSteps > 0 ? totalSteps : null;
  const answer = answerStep;
  // The count covers only the steps that were loaded, while the answer's position is
  // absolute. A count that cannot reach the position is a partial sum: it is not used
  // as a denominator, and the turn is described as truncated.
  const truncated = answer !== null && total !== null && answer > total;
  // A turn whose start is outside the loaded history window cannot be described by this record:
  // the count is a partial sum while the answer's position is absolute, so the two are not
  // comparable. The number is still withheld — a partial denominator would mislead — but the pill
  // no longer disappears, because an absent control reads as a broken plugin rather than as a
  // limit of what is loaded. See README, "已知限制", and the guard that pins this decision.
  if (truncated) {
    return (
      <span className={css.container}>
        <span className={css.pillMuted} data-ud-check="steps-window" title="请完全加载该轮次记录后查看">
          <svg className={css.pillIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M3 3.4h10M3 8h10M3 12.6h6.4" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="12.4" cy="12.6" r="1.5" strokeWidth="1.2" />
          </svg>
          <span>步骤记录</span>
          {/* The reason as hidden text, not only a title: a title is not a reliable accessible name. */}
          <span className={css.srOnly}>请完全加载该轮次记录后查看</span>
        </span>
      </span>
    );
  }
  if (answer === null && total === null) return null;

  /**
   * The label has to cope with knowing the answer's step but not the turn's.
   *
   * `totalSteps` is optional and comes from the loaded turn record, while `answerStep` comes from the answer itself —
   * so a turn whose steps are not loaded yet has an answer step and no denominator. The old expression printed the
   * missing half as the word "null": `3/null 个步骤`, in the pill's own label and in its `aria-label`. A denominator
   * that is not known is not claimed.
   */
  const label = answer !== null && total !== null
    ? `${answer}/${total} 个步骤`
    : total !== null ? `${total} 个步骤` : `${answer} 步`;

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
              {answer !== null && (
                <>
                  <span className={css.popLabel}>
                    回答所在步骤
                    <span className={css.popBadge}>过程记录字段</span>
                  </span>
                  <span className={css.popValue}>第 {answer} 步</span>
                </>
              )}
              {total !== null && (
                <>
                  <span className={css.popLabel}>本轮总步骤</span>
                  <span className={css.popValue}>{total} 步</span>
                </>
              )}
            </div>
            {answer !== null && total !== null && (
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
