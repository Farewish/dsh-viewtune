/**
 * One assistant step's latency and throughput facts, as 0.2.0 derives them.
 *
 * WHY THIS IS A COPY, stated plainly because a copy is a liability: the platform computes exactly this in
 * `@deepseek-ai/dsh-client-ui-chat` (`client/chat/turn-metrics.ts`, `assistantStepReading`), and the `TurnTailChatData`
 * record this view used to read (`tokensPerSecond`, `ttftMs`) no longer carries those numbers at all. The helper is not
 * reachable from a plugin: it is absent from that package's public client entry, and the package's `exports` map admits
 * no deep import. So the choice is between showing no throughput at all and deriving it here — and deriving it is what
 * the record's own fields (`timing`, `usage`) are for.
 *
 * The formulas below are the platform's, character for character, including its guards: TTFT is
 * `firstTokenTime - stepStartTime`, decode time is `completedTime - firstTokenTime`, output tokens must be a finite
 * non-negative number, and every part is `null` rather than a guess when its input was not recorded. A rate is only
 * computed where `decodeMs > 0` (see the caller), which is the same condition the host's stats pill uses, so the two
 * views cannot disagree about the same turn.
 */
import type { AssistantMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client';

/** One assistant step's derivable latency facts; `null` marks an unrecorded part. */
export interface StepReading {
  /** step/start → first token delta, in ms. */
  ttftMs: number | null;
  /** First token delta → final message, in ms. */
  decodeMs: number | null;
  /** Provider-reported completion tokens. */
  outputTokens: number | null;
}

/** The provider's completion-token count, or null when the usage record does not carry a usable one. */
function outputTokensOf(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null;
  const value = (usage as { outputTokens?: unknown }).outputTokens;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Read one settled assistant node's TTFT, decode wall time, and output tokens.
 * @param node - A settled assistant node.
 * @returns Per-part readings with `null` for unrecorded values.
 */
export function stepReading(node: AssistantMessageNode): StepReading {
  const timing = node.timing;
  return {
    ttftMs: timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
      ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
      : null,
    decodeMs: timing !== undefined && timing.firstTokenTime !== null
      ? Math.max(0, timing.completedTime - timing.firstTokenTime)
      : null,
    outputTokens: outputTokensOf(node.usage),
  };
}

/**
 * The turn's decode rate in tokens per second, or undefined when it cannot be derived.
 *
 * `decodeMs > 0` rather than `>= 0`: a decode window of zero milliseconds is not an infinite rate, it is a turn whose
 * tokens arrived in the same millisecond as the first one — the host draws the same line.
 */
export function tokensPerSecondOf(reading: StepReading | undefined): number | undefined {
  if (reading === undefined) return undefined;
  if (reading.decodeMs === null || reading.decodeMs <= 0) return undefined;
  if (reading.outputTokens === null) return undefined;
  return reading.outputTokens / (reading.decodeMs / 1000);
}
