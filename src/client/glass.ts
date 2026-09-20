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
 * The initials are therefore the values the skin shipped with, so turning it on looks the same as it
 * did before these controls existed.
 */
export interface GlassPart {
  /** Stable key in the store. */
  id: string;
  label: string;
  /** The row's `title`: what this surface is and what moving it does. */
  hint: string;
  /** The custom property the stylesheet reads, set on the reading view's root. */
  property: string;
  /** Initial percentage, and the fallback whenever a stored value is missing or unusable. */
  initial: number;
}

export const GLASS_PARTS: readonly GlassPart[] = [
  {
    id: 'lane', label: '工具栏', property: '--glass-lane', initial: 25,
    hint: '阅读列顶部那条「收起 / viewtune」的底板，以及浮动在正文上的「回到最新」胶囊（后者有个下限，不会被调没）。调低它，滚过来的正文就从下面透出来。',
  },
  {
    id: 'user', label: '用户气泡', property: '--glass-user', initial: 25,
    hint: '你自己那条消息的底色。调低它，气泡变成一层薄薄的雾。',
  },
  {
    id: 'card', label: '卡片与面板', property: '--glass-card', initial: 0,
    hint: '推理卡、工具框、系统提示词、备忘框与它的压缩胶囊、图片框、注意条这一类的底板。出厂是 0：完全透明，只留边框。',
  },
  {
    id: 'code', label: '代码块', property: '--glass-code', initial: 25,
    hint: '围栏代码块的底色。它要压住背后的文字，所以出厂留一点。',
  },
  {
    id: 'diff', label: '差异面板', property: '--glass-diff', initial: 20,
    hint: '面板底板、它上面的文件标签，以及工具「结果」页里那份行内差异块——差异纸无论画在哪里都归这一个旋钮（面板内部那块会被刻意重置成透明，所以面板里看到的是面板这一层）。',
  },
  {
    id: 'chip', label: '产物标签', property: '--glass-chip', initial: 0,
    hint: '一轮末尾那一栏产物文件（交付 chip）的底色。它是唯一一个常驻、且静止时就自带底板的小标签；工具状态与行数计数在基础样式里本来没有底，所以不归任何旋钮。',
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
