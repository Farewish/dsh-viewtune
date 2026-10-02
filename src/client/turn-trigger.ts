/**
 * The host's `turn-trigger` record in the reading view: what woke this turn up.
 *
 * The conversation page renders it as `TurnTriggerNodeView` — `section[data-turn-trigger]`, whose header is a button
 * carrying an icon, a title, the time and a chevron, and whose body (when open) explains that the notification started
 * this reply and then shows the notification. The reading view answered 「此记录类型暂未接入阅读页」 instead.
 *
 * Mirroring it is the honest route, and it is the only one: the host's component is NOT exported (`@deepseek-ai/
 * dsh-client-ui-deliverables` and its siblings publish nothing but `inject`/`apply`, measured), so what can be shared
 * is the vocabulary — the per-source titles, the same explanation sentence, and the SAME ICONS, which live in
 * `@deepseek-ai/dsh-client-ui-primitives`, the package this plugin already imports from.
 *
 * The titles are the host's own Chinese dictionary, read out of its bundle rather than paraphrased, so the two views
 * say the same thing about the same record. The mapping is the host's switch, including the two-level webhook case
 * (`provider === "github"`).
 */
export type TurnTriggerIcon =
  | 'request' | 'goal' | 'agent' | 'team' | 'subagent'
  | 'github' | 'webhook' | 'schedule' | 'job' | 'plugin';

/** The titles the host uses, kind for kind (`message.trigger.*` in its dictionary). */
const TITLES: Record<TurnTriggerIcon, string> = {
  request: '收到执行请求',
  goal: '继续执行目标',
  agent: '收到任务消息',
  team: '收到团队消息',
  subagent: '子任务状态更新',
  github: '收到 GitHub 事件',
  webhook: '收到外部事件',
  schedule: '自动化任务',
  job: '后台任务状态更新',
  plugin: '插件状态更新',
};

/** The host's own sentence for the open body (`message.trigger.explanation`), word for word. */
export const TURN_TRIGGER_EXPLANATION = '这条通知触发了本轮回复。';

/** Source kind → the icon family, exactly as the host's `turnTriggerDetails` switches it. */
const KIND_ICONS = new Map<string, TurnTriggerIcon>([
  ['goal', 'goal'],
  ['agent-message', 'agent'],
  ['team-message', 'team'],
  ['subagent-settled', 'subagent'],
  ['schedule', 'schedule'],
  ['tool-jobs', 'job'],
  ['cordis-host-runner', 'plugin'],
]);

/**
 * What this record means, from its own `source`.
 *
 * An unrecognised source is `request` with its title — the host's own default — rather than an empty row: the record
 * exists because SOMETHING woke the turn up, and 「收到执行请求」 is the honest thing to say when the client cannot
 * name it.
 */
export function turnTriggerReading(source: unknown): { title: string; icon: TurnTriggerIcon } {
  const record = typeof source === 'object' && source !== null ? source as Record<string, unknown> : {};
  const kind = typeof record.kind === 'string' ? record.kind : '';
  const provider = typeof record.provider === 'string' ? record.provider : '';
  if (kind === 'webhook') {
    return provider === 'github'
      ? { title: TITLES.github, icon: 'github' }
      : { title: TITLES.webhook, icon: 'webhook' };
  }
  const icon = KIND_ICONS.get(kind) ?? 'request';
  return { title: TITLES[icon], icon };
}

/** The epoch-ms the record carries, or `null` when it carries nothing usable. */
export function turnTriggerTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The notification's own text, out of whatever `content` shape the record carries.
 *
 * The host renders this with `ModelFacingContent` (the component it uses for model-facing context), which this plugin
 * cannot import. What it CAN do honestly is show the text blocks and keep the raw record one click away, which is what
 * the fallback row above already did for the whole record: the reader loses no information either way, and the common
 * case — a notification that is just text — reads exactly like the host's.
 */
export function turnTriggerText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === 'string' && text.trim() !== '') parts.push(text);
  }
  return parts.join('\n\n');
}
