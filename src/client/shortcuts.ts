/**
 * The reading view's own keyboard shortcuts: which actions can be bound, and the rules for
 * changing one.
 *
 * Pure on purpose. The document listener, the settings row that records a new combination and the
 * persisted record all have to agree on what a binding IS, and this is the only place that decides.
 * A binding is stored in the `aria-keyshortcuts` syntax ("Alt+Shift+C"), so the attribute a button
 * advertises is the same string the listener matches — there is no second spelling to keep in step,
 * and no code/label mapping in the middle of either.
 *
 * Two rules keep a binding safe to own at the document level: a modifier is required (a bare letter
 * would be swallowed while the reader types in the composer), and a small set of combinations the
 * browser or the OS already owns is refused (binding copy or paste would break the page).
 */

/** The actions a reader can bind. */
export type ShortcutAction = 'collapseTurn' | 'collapseAll';

/** The defaults, in the order `aria-keyshortcuts` writes modifiers. */
export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutAction, string>> = {
  collapseTurn: 'Alt+C',
  collapseAll: 'Alt+Shift+C',
};

/** A binding split into its parts; `key` is normalised (see {@link normaliseKey}). */
export interface ShortcutBinding {
  readonly key: string;
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

/** The part of a keyboard event this module needs; native and React events both satisfy it. */
export interface ShortcutEvent {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/** Why a combination cannot be used. The panel owns the wording; this owns the judgement. */
export type ShortcutProblem = 'modifier' | 'reserved' | 'taken';

/** Keys that are only modifiers, plus the ones that never complete a combination. */
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Dead', 'Meta', 'Shift']);

/**
 * Combinations the browser or the operating system owns. A document-level listener that prevents
 * the default on one of these takes copy, paste, find or the window's own close away from the page,
 * which is a far worse trade than a shortcut that has to pick another letter.
 */
const RESERVED = new Set([
  'Alt+F4', 'Alt+Tab',
  'Control+A', 'Control+C', 'Control+F', 'Control+N', 'Control+P', 'Control+S', 'Control+T', 'Control+V', 'Control+W', 'Control+X', 'Control+Z',
  'Meta+A', 'Meta+C', 'Meta+F', 'Meta+N', 'Meta+P', 'Meta+Q', 'Meta+S', 'Meta+T', 'Meta+V', 'Meta+W', 'Meta+X', 'Meta+Z',
]);

/** Normalise one event key into the spelling a binding stores; null when it cannot be a binding. */
export function normaliseKey(key: string): string | null {
  if (key === '' || MODIFIER_KEYS.has(key)) return null;
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The canonical string for a binding: modifiers in the attribute's order, the key last. */
export function formatShortcut(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.alt) parts.push('Alt');
  if (binding.control) parts.push('Control');
  if (binding.meta) parts.push('Meta');
  if (binding.shift) parts.push('Shift');
  parts.push(binding.key);
  return parts.join('+');
}

/** Parse a stored binding; null when it is not one (a hand-edited record, or a cleared slot). */
export function parseShortcut(text: string | undefined): ShortcutBinding | null {
  if (text === undefined || text === '') return null;
  const parts = text.split('+').map(part => part.trim()).filter(part => part !== '');
  const raw = parts.at(-1);
  if (raw === undefined) return null;
  // The key goes through the same normalisation an event does, so a hand-written "alt+c" is the
  // same binding as "Alt+C" — otherwise it would display in lower case AND slip past the collision
  // check that compares canonical strings.
  const key = normaliseKey(raw);
  if (key === null) return null;
  const modifiers = new Set(parts.slice(0, -1).map(part => part.toLowerCase()));
  for (const modifier of modifiers) {
    if (modifier !== 'alt' && modifier !== 'control' && modifier !== 'meta' && modifier !== 'shift') return null;
  }
  return {
    key,
    alt: modifiers.has('alt'),
    control: modifiers.has('control'),
    meta: modifiers.has('meta'),
    shift: modifiers.has('shift'),
  };
}

/**
 * The binding a key event asks for, or null when it cannot be one.
 *
 * A combination needs Alt, Control or Meta: Shift alone still types (it is how capitals are made),
 * and a bare key would be swallowed wherever the reader is typing.
 */
export function bindingFromEvent(event: ShortcutEvent): string | null {
  const key = normaliseKey(event.key);
  if (key === null) return null;
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return null;
  return formatShortcut({ key, alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey });
}

/** Does this event fire that binding? Exact on every modifier, so a near miss stays a near miss. */
export function matchesShortcut(event: ShortcutEvent, text: string | undefined): boolean {
  const binding = parseShortcut(text);
  if (binding === null) return false;
  const key = normaliseKey(event.key);
  return key === binding.key
    && event.altKey === binding.alt
    && event.ctrlKey === binding.control
    && event.metaKey === binding.meta
    && event.shiftKey === binding.shift;
}

/**
 * Why this combination cannot be used, or null when it can.
 * @param text - the binding as recorded.
 * @param taken - the other action's binding, when the two must not collide.
 */
export function shortcutProblem(text: string, taken: string | null): ShortcutProblem | null {
  const binding = parseShortcut(text);
  if (binding === null || (!binding.alt && !binding.control && !binding.meta)) return 'modifier';
  if (RESERVED.has(formatShortcut(binding))) return 'reserved';
  const other = parseShortcut(taken ?? undefined);
  if (other !== null && formatShortcut(other) === formatShortcut(binding)) return 'taken';
  return null;
}

/** How a binding reads in the panel: `Alt + Shift + C`. */
export function shortcutLabel(text: string): string {
  const binding = parseShortcut(text);
  if (binding === null) return '未设置';
  return formatShortcut(binding).split('+').map(part => part === 'Control' ? 'Ctrl' : part === 'Meta' ? 'Cmd' : part).join(' + ');
}
