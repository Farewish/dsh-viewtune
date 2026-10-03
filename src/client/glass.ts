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
 * that records nothing still gets it. The FROST's initials were re-read from their record last (all eight of them had
 * been dialled), so every number below is one reading of one settings file.
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
  /**
   * The FROST: how much this surface blurs what is behind it, as its own dial.
   *
   * Separate from the tint because they are separate looks: the tint decides how much of the wallpaper shows, the
   * frost decides whether what shows is the image or a wash of it — which is the difference between "glass" and
   * 「磨砂玻璃」, and the reader's report was that only the first half existed. `initial` is the px this surface
   * already shipped with, so a reader who never touches this row keeps the look they have: the surfaces that had no
   * blur open at 0, and moving them up is what frosts them.
   *
   * Absent for a surface that cannot carry a `backdrop-filter` at all — 「滚动条槽位」 paints its groove through a
   * scrollbar pseudo-element, where the property has no effect — because a row that cannot move anything is worse
   * than no row.
   */
  blur?: { property: string; initial: number };
}

export const GLASS_PARTS: readonly GlassPart[] = [
  {
    // The lane opens UNFROSTED (0) and the pill's own frost is small: these are the reader's own numbers, adopted as
    // the defaults, and their reading view runs a crisp toolbar over prose rather than a frosted one.
    id: 'lane', label: '工具栏', property: '--glass-lane', initial: 10,
    hint: '工具栏、「回到最新」胶囊、对话页「回到底部」',
    blur: { property: '--glass-blur-lane', initial: 0 },
  },
  {
    id: 'user', label: '用户气泡', property: '--glass-user', initial: 30,
    blur: { property: '--glass-blur-user', initial: 3 },
  },
  {
    id: 'card', label: '卡片与面板', property: '--glass-card', initial: 25,
    hint: '推理卡、工具框、系统提示词、备忘框、改动文件卡',
    // 8px is the reader's own: this is the surface their 「并不磨砂」 was most visibly about, and the one they frosted
    // first. It used to open at 0, which is why a fresh install now frosts the cards out of the box.
    blur: { property: '--glass-blur-card', initial: 8 },
  },
  {
    id: 'code', label: '代码块', property: '--glass-code', initial: 35,
    blur: { property: '--glass-blur-code', initial: 25 },
  },
  {
    id: 'diff', label: '差异面板', property: '--glass-diff', initial: 30,
    hint: '差异面板、文件标签，以及工具结果里的行内差异',
    blur: { property: '--glass-blur-diff', initial: 25 },
  },
  {
    // No frost: the groove is a scrollbar pseudo-element, where `backdrop-filter` does nothing.
    id: 'scrollbar', label: '滚动条槽位', property: '--glass-scrollbar', initial: 20,
  },
  {
    // 「产物栏」—— the reader renamed this dial (it was 「产物标签」) and ruled that it owns BOTH product rows: the reading
    // view's 编辑栏 and 交付栏 in all three display modes, and the conversation page's two product cards (the host's
    // changed-files list and its per-file deliverable cards). The id stays `chip` on purpose: it is the key in the stored
    // record, so renaming it would silently reset everyone's value to the initial.
    id: 'chip', label: '产物栏', property: '--glass-chip', initial: 35,
    hint: '阅读页的编辑栏与交付栏、对话页那两张产物卡',
    blur: { property: '--glass-blur-chip', initial: 5 },
  },
  {
    id: 'pill', label: '用量与步骤胶囊', property: '--glass-pill', initial: 30,
    blur: { property: '--glass-blur-pill', initial: 2 },
  },
  {
    id: 'input', label: '输入框', property: '--glass-input', initial: 35,
    hint: '阅读页与对话页都生效',
    blur: { property: '--glass-blur-input', initial: 10 },
  },
];

/** The frost's own ceiling, in px: past this the text behind a plate stops being legible as anything. */
export const GLASS_BLUR_MAX = 40;

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

/**
 * The reader's frost, resolved the same defensive way the tints are.
 *
 * Only the parts that HAVE a frost appear in the result: a part without one has no property to write, and inventing
 * a value for it would mean a row in the panel that moves a number nothing reads. A stored value that is not a
 * usable px — including one written before this setting existed, which is simply absent — falls back to that
 * surface's shipped blur, so an older record keeps exactly the look it had.
 */
export function glassBlurValues(stored: unknown): Record<string, number> {
  const source = typeof stored === 'object' && stored !== null ? stored as Record<string, unknown> : {};
  const values: Record<string, number> = {};
  for (const part of GLASS_PARTS) {
    if (part.blur === undefined) continue;
    const value = source[part.id];
    values[part.id] = typeof value === 'number' && Number.isFinite(value)
      ? Math.min(GLASS_BLUR_MAX, Math.max(0, Math.round(value)))
      : part.blur.initial;
  }
  return values;
}

/**
 * …and its half of the root's inline style: a LENGTH per surface, in px.
 *
 * The property is written only while that surface's frost is above zero, and the stylesheet reads it as
 * `blur(var(--glass-blur-<part>))` with NO fallback — because `backdrop-filter` is not a no-op at `blur(0px)`. Any
 * non-`none` value makes the element a stacking context, the containing block for its fixed descendants, and puts its
 * paint in the compositor — a construct this plugin has already been bitten by (see the scrim's own note in
 * `wallpaper-scope.ts`). An UNSET variable makes that declaration invalid at computed-value time, which leaves the
 * property at its initial value — `none` — so every surface that never blurred keeps exactly the rendering it had.
 * A length rather than a whole filter value, so a surface that floats at a fraction of its family's frost can still
 * scale it (`blur(calc(var(--glass-blur-lane) * 0.75))` is the pill's twelve), and so the panel and the stylesheet
 * read the same number.
 */
export function glassBlurProperties(values: Record<string, number>): Record<string, string> {
  const style: Record<string, string> = {};
  for (const part of GLASS_PARTS) {
    if (part.blur === undefined) continue;
    const px = values[part.id] ?? part.blur.initial;
    if (px > 0) style[part.blur.property] = `${String(px)}px`;
  }
  return style;
}

/** Every frost property the table knows — the names a publisher has to visit to WITHDRAW, not just to write. */
export function glassBlurPropertyNames(): readonly string[] {
  return GLASS_PARTS.flatMap(part => (part.blur === undefined ? [] : [part.blur.property]));
}

/**
 * Write the frost onto a style object: every name the table knows is either set or REMOVED.
 *
 * The removal is the point of having this at all (see `glassBlurProperties`): a surface dialled back to 0 has to stop
 * compositing, and leaving the previous value in place — or writing `0px` — would keep it. Both the reading view's
 * root and the document element are written through here, so the two cannot drift.
 */
export function applyGlassBlur(style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>, values: Record<string, number> | null): void {
  // `null` means "this gate is off", and it removes every name rather than resolving them to their initials: an
  // initial is what a RECORD that predates the setting means, while a withdrawn gate means the property should not be
  // on the element at all. Passing an empty record here instead would leave every shipped frost written onto the
  // document — a live setting after the switch was turned off, which the tests caught.
  const properties = values === null ? {} : glassBlurProperties(values);
  for (const name of glassBlurPropertyNames()) {
    const value = properties[name];
    if (value === undefined) style.removeProperty(name);
    else style.setProperty(name, value);
  }
}
