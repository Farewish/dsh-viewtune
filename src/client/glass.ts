/**
 * The frosted-glass skin's adjustable parts.
 *
 * One master switch, and one opacity per kind of surface behind it. The skin's whole point is how
 * much of the host's wallpaper shows through the reading view, and that is a matter of taste rather
 * than a constant — so every surface the skin touches is expressed as `color-mix(in srgb, <its own
 * colour> <part>%, transparent)`, and each part is a number the reader owns.
 *
 * The scale runs the way the surfaces do: `0` is "the reader paints nothing here" (the chrome is
 * gone and the host shows through), `100` is the opaque plate this view paints when the skin is off.
 *
 * The initials are the reader's OWN settings, adopted as the defaults so this plugin opens for anyone
 * the way it opens for them — which is also why `glassParts` starts empty: a part is only recorded once
 * someone moves it OFF its initial, and these initials already are the chosen look, so a fresh install
 * that records nothing still gets it.
 */
export interface GlassPart {
  /** Stable key in the store. */
  id: string;
  label: string;
  /**
   * The row's `title`, and only where the label does not already say it: one short phrase naming what moves, or the
   * one thing about it that is not visible on the row. A reader of this panel is not a reader of this file, so nothing
   * here explains how a surface is dialled or why it is dialled that way. Absent for most parts — 「用户气泡」,
   * 「代码块」 and 「滚动条槽位」 are the whole description.
   */
  hint?: string;
  /** The custom property the stylesheet reads, set on the reading view's root. */
  property: string;
  /** Initial percentage, and the fallback whenever a stored value is missing or unusable. */
  initial: number;
}

export const GLASS_PARTS: readonly GlassPart[] = [
  {
    id: 'lane', label: '工具栏', property: '--glass-lane', initial: 20,
    hint: '工具栏与「回到最新」胶囊的底板',
  },
  {
    id: 'user', label: '用户气泡', property: '--glass-user', initial: 30,
  },
  {
    id: 'card', label: '卡片与面板', property: '--glass-card', initial: 30,
    hint: '推理卡、工具框、系统提示词、备忘框等面板',
  },
  {
    id: 'code', label: '代码块', property: '--glass-code', initial: 35,
  },
  {
    id: 'diff', label: '差异面板', property: '--glass-diff', initial: 30,
    hint: '差异面板、文件标签，以及工具结果里的行内差异',
  },
  {
    id: 'scrollbar', label: '滚动条槽位', property: '--glass-scrollbar', initial: 15,
  },
  {
    id: 'chip', label: '产物标签', property: '--glass-chip', initial: 45,
  },
  {
    id: 'pill', label: '用量与步骤胶囊', property: '--glass-pill', initial: 50,
  },
  {
    id: 'input', label: '输入框', property: '--glass-input', initial: 35,
    hint: '阅读页与对话页都生效',
  },
];

const BY_ID = new Map(GLASS_PARTS.map(part => [part.id, part]));

/** Whether a key names a part this build knows. */
export function isGlassPart(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * The stored map resolved into every part's value.
 *
 * A record written before a part existed (or with a value that is not a usable percentage) falls
 * back to that part's initial, the same defensive rule `shortcuts` follows: persistence replaces
 * the whole record, so the reader of it cannot assume any key is present.
 */
export function glassValues(stored: unknown): Record<string, number> {
  const source = typeof stored === 'object' && stored !== null ? stored as Record<string, unknown> : {};
  const values: Record<string, number> = {};
  for (const part of GLASS_PARTS) {
    const value = source[part.id];
    values[part.id] = typeof value === 'number' && Number.isFinite(value)
      ? Math.min(100, Math.max(0, Math.round(value)))
      : part.initial;
  }
  return values;
}

/** The root's inline style: one custom property per part, as a percentage. */
export function glassProperties(values: Record<string, number>): Record<string, string> {
  const style: Record<string, string> = {};
  for (const part of GLASS_PARTS) style[part.property] = `${String(values[part.id] ?? part.initial)}%`;
  return style;
}
