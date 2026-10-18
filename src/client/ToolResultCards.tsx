import type { ReactNode } from 'react';
import css from './ToolResultCards.module.css';
import { toolTitleOf } from './native/tool-call-model.js';

type ToolArgs = Record<string, unknown> | undefined;

function stringOf(args: ToolArgs, ...keys: string[]): string | undefined {
  if (args === undefined) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** The last `[status: …]` the host appends to a job read. */
function statusOf(text: string): string | undefined {
  const matches = [...text.matchAll(/\[status:\s*([^\]]+)\]/gi)];
  return matches.at(-1)?.[1]?.trim();
}

function withoutStatus(text: string): string {
  return text.replace(/\n?\[status:[^\]]*\]\s*$/i, '').trimEnd();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value, null, 2) ?? '';
}

function FactGrid({ value }: { value: Record<string, unknown> }): ReactNode {
  const entries = Object.entries(value);
  if (entries.length === 0) return <p className={css.note}>没有可展示的字段。</p>;
  return <dl className={css.facts}>
    {entries.map(([key, item]) => <div key={key} className={css.factRow}>
      <dt className={css.factKey}>{key}</dt>
      <dd className={css.factValue}>{displayValue(item)}</dd>
    </div>)}
  </dl>;
}

function Body({ text, name }: { text: string; name: string }): ReactNode {
  const body = name.startsWith('job_') ? withoutStatus(text) : text;
  const parsed = parseJson(body);
  if (parsed !== undefined && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return <FactGrid value={parsed as Record<string, unknown>} />;
  }
  if (parsed !== undefined && Array.isArray(parsed)) {
    return <pre className={css.output}>{JSON.stringify(parsed, null, 2)}</pre>;
  }
  if (body.trim() === '') return <p className={css.note}>没有可展示的内容。</p>;
  return <pre className={css.output}>{body}</pre>;
}

/**
 * A structured result card for the 0.2.1 tools whose payload is richer than one text line.
 *
 * The host's tool results are text; several of these tools put a JSON object or a job transcript in
 * that text. Parsing it is a display decision only — anything that does not parse stays verbatim.
 */
export function ToolResultCard({ name, text, args }: { name: string; text: string; args: ToolArgs }): ReactNode {
  const title = toolTitleOf(name) ?? name;
  const status = statusOf(text);
  const jobId = name.startsWith('job_') ? stringOf(args, 'job_id') : undefined;
  const inspectTarget = name === 'cordis_inspect_query'
    ? [stringOf(args, 'platform'), stringOf(args, 'provider'), stringOf(args, 'method')].filter((part): part is string => part !== undefined).join(' · ')
    : undefined;
  return <div className={css.card} data-reader-tool-result-card data-tool-card={name}>
    <div className={css.head}>
      <span className={css.title}>{title}</span>
      {jobId !== undefined && <span className={css.meta}>任务 {jobId}</span>}
      {inspectTarget !== undefined && inspectTarget !== '' && <span className={css.meta}>{inspectTarget}</span>}
      {status !== undefined && <span className={css.status}>{status}</span>}
    </div>
    <div className={css.body}>
      <Body text={text} name={name} />
    </div>
  </div>;
}
