/**
 * The `ask_user_question` card: what was asked, and what was answered.
 *
 * The two halves sit in different places — the questions in the call ARGUMENTS, the answers in the
 * result TEXT (a JSON object `{ answers: [{ id, selected, custom? }] }`, the payload the product's
 * own card parses) — so they are paired by question id. Pairing is strict: a question with no
 * answer of its own renders as unanswered rather than taking a neighbour's answer, and a repeated
 * id is dropped, because a mismatched pair would claim the reader chose something they did not.
 */

/** One answered question as the result carries it. */
interface AnswerEntry {
  readonly selected: readonly string[];
  readonly custom: string | undefined;
}

/** One question with the answers it owns; empty when it is still unanswered. */
export interface QuestionEntry {
  /** Call-supplied id, the key the answer is matched by. */
  readonly id: string;
  readonly question: string;
  /** Selected labels followed by a custom answer, in that order. */
  readonly answers: readonly string[];
}

/** The readable question set. */
export interface QuestionCard {
  readonly entries: readonly QuestionEntry[];
  /** Questions with at least one answer. */
  readonly answered: number;
  readonly total: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // An in-flight argument is normally incomplete; a result is normally JSON.
    return undefined;
  }
}

/** Questions carried by the call; null when the call is not a question set. */
function questions(argsRaw: string): readonly { id: string; question: string }[] | null {
  const list = record(parse(argsRaw))?.questions;
  if (!Array.isArray(list)) return null;
  const out: { id: string; question: string }[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const question = record(item);
    if (typeof question?.id !== 'string' || question.id === '' || typeof question.question !== 'string') continue;
    if (seen.has(question.id)) continue;
    seen.add(question.id);
    out.push({ id: question.id, question: question.question });
  }
  return out.length === 0 ? null : out;
}

/** Answers carried by the result text; empty when there is no answer payload yet. */
function answers(resultText: string): ReadonlyMap<string, AnswerEntry> {
  const list = record(parse(resultText))?.answers;
  const out = new Map<string, AnswerEntry>();
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const answer = record(item);
    if (typeof answer?.id !== 'string' || answer.id === '' || out.has(answer.id)) continue;
    out.set(answer.id, {
      selected: strings(answer.selected),
      custom: typeof answer.custom === 'string' && answer.custom !== '' ? answer.custom : undefined,
    });
  }
  return out;
}

/**
 * Derive the card from a frozen call/result pair.
 * @param argsRaw - the call's raw arguments.
 * @param resultText - flattened text of the settled result; empty while the question is pending.
 * @returns the card, or null when the call does not carry a question set.
 */
export function questionCardModel(argsRaw: string, resultText: string): QuestionCard | null {
  const asked = questions(argsRaw);
  if (asked === null) return null;
  const answered = answers(resultText);
  const entries = asked.map(({ id, question }): QuestionEntry => {
    const answer = answered.get(id);
    return {
      id,
      question,
      answers: answer === undefined
        ? []
        : [...answer.selected, ...(answer.custom === undefined ? [] : [answer.custom])],
    };
  });
  return { entries, answered: entries.filter(entry => entry.answers.length > 0).length, total: entries.length };
}
