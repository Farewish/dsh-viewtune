/**
 * Source-derived anchors for the bundle-level guards.
 *
 * Every guard in this directory reads the *compiled* `lib/client.js`, but several of them
 * asserted the exact spelling one particular build happened to emit: hashed CSS class names
 * (`g2GnNq_toolbar`), hashed keyframe names (`readerCollapseOut`), the `css$N` ordinal of a
 * stylesheet, and minified unit forms (`140ms` vs `.14s`). None of that is part of the
 * plugin's contract — it is lightningcss and rolldown output, and it changes whenever the
 * artifact is rebuilt from source. When the repository gained a real build, ten guards went
 * red at once and every one of them was asserting the old spelling rather than the behaviour.
 *
 * So the guards resolve names the way the source names them:
 *   - a class by its LOCAL name from the `.module.css` file (`toolbar` -> `g2GnNq_toolbar`);
 *   - a keyframe by its local name (`readerCollapseOut` -> `_qbxEq_readerCollapseOut`);
 *   - a stylesheet by the MODULE FILE it came from (`Reader.module.css`), not by `css$4`;
 *   - a rule by its declarations as a set, so property order and unit spelling do not matter.
 *
 * Nothing here knows about a specific build. If a guard needs a new anchor, add it here rather
 * than spelling a hash into the guard.
 */

/** Declarations of one rule, as a Set — order-insensitive, duplicates merged. */
export function ruleDecls(css, selector) {
  const found = new Set();
  let from = 0;
  for (;;) {
    const at = css.indexOf(`${selector}{`, from);
    if (at === -1) break;
    const end = css.indexOf('}', at);
    for (const part of css.slice(at + selector.length + 1, end).split(';')) {
      const trimmed = part.trim();
      if (trimmed !== '') found.add(trimmed);
    }
    from = end;
  }
  return found;
}

/** Whether a rule declares every one of `declarations` (order-insensitive). */
export function hasDecls(css, selector, declarations) {
  const found = ruleDecls(css, selector);
  return declarations.every((declaration) => found.has(declaration));
}

/** The class name lightningcss generated for a local name in a `.module.css`. */
export function classOf(css, local) {
  const match = new RegExp(`\\.([A-Za-z0-9_]+)_${local}(?![\\w-])`).exec(css);
  if (match === null) throw new Error(`class for local name "${local}" not found in the stylesheet`);
  return `${match[1]}_${local}`;
}

/** `.` + {@link classOf}, ready to concatenate into a selector. */
export function classSel(css, local) {
  return `.${classOf(css, local)}`;
}

/** The keyframe name lightningcss generated for a local name (bare name if unscoped). */
export function keyframeOf(css, local) {
  const scoped = new RegExp(`([\\w-]+_${local})(?![\\w-])`).exec(css);
  return scoped === null ? local : scoped[1];
}

/**
 * One CSS-module literal from a client bundle, located by the stylesheet it came from.
 *
 * The guards used to read `const css$4 = …` — the Reader stylesheet's ordinal. That ordinal
 * is an emission order artefact: add or reorder a CSS module and every guard reads the wrong
 * stylesheet while still reporting a confident verdict. The bundle pairs every literal with
 * its owning stylesheet (`tagId$N = "<package>/Reader.module.css"`), so that pair is the
 * lookup key and the ordinal stops mattering.
 *
 * @param text - the whole bundle.
 * @param moduleFile - the stylesheet's file name, e.g. `Reader.module.css`.
 * @returns the CSS text.
 */
export function moduleCssLiteral(text, moduleFile) {
  const owners = [...text.matchAll(/const tagId(\$\d+)? = "([^"]+)"/g)];
  for (const owner of owners) {
    if (!owner[2].endsWith(`/${moduleFile}`)) continue;
    return cssLiteralFor(text, owner[1] ?? '');
  }
  throw new Error(`no stylesheet named ${moduleFile} in the bundle`);
}

/** The `css` / `css$N` literal bound to one `tagId` suffix. */
function cssLiteralFor(text, suffix) {
  const marker = `const css${suffix} = `;
  const at = text.indexOf(marker);
  if (at === -1) throw new Error(`literal ${marker.trim()} not found`);
  let i = at + marker.length;
  if (text[i] !== '"') throw new Error(`${marker.trim()} does not open with a quote`);
  const start = i;
  i += 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '"') break;
    i += 1;
  }
  return JSON.parse(text.slice(start, i + 1));
}

/**
 * The class name of the error boundary wrapping the steps pill.
 *
 * The source calls it `QuietBoundary`; the published artifact was compiled when it was called
 * `StepsPillBoundary`, and guards asserted that name. The boundary is whatever class inside
 * the pill's source region extends `react.Component`, so find that instead of either name.
 *
 * @param text - the whole bundle.
 * @returns the class name, or undefined when the boundary is absent.
 */
export function pillBoundaryClass(text) {
  const region = sourceRegion(text, 'StepsPill.tsx');
  if (region === undefined) return undefined;
  return /(?:class|var)\s+([A-Za-z_$][\w$]*)\s+(?:extends|= class extends)\s+react\.Component/.exec(region)?.[1];
}

/**
 * The compiled text of one source module, delimited by its rolldown region.
 *
 * Rolldown writes `//#region <path>` / `//#endregion` around every module in every build, so
 * the source path survives both minifiers and renames. Guards that need to run or inspect a
 * compiled function should slice by region rather than by a symbol name.
 *
 * @param text - the whole bundle.
 * @param sourceFile - the module file name, e.g. `StepsPill.tsx`.
 * @returns the region text, or undefined when the module is not in the bundle.
 */
export function sourceRegion(text, sourceFile) {
  const match = new RegExp(`//#region \\S*${sourceFile.replace('.', '\\.')}\\s*\\n`).exec(text);
  if (match === null) return undefined;
  const end = text.indexOf('//#endregion', match.index);
  return end === -1 ? undefined : text.slice(match.index, end);
}

/** Milliseconds from an `animation`/`transition` shorthand, whichever unit it uses. */
export function durationMs(shorthand) {
  const match = /(\d*\.?\d+)(ms|s)\b/.exec(shorthand ?? '');
  if (match === null) return 0;
  return match[2] === 's' ? Number.parseFloat(match[1]) * 1000 : Number.parseFloat(match[1]);
}

/**
 * Strip everything a build is free to rewrite from a stylesheet, so two builds can be compared.
 *
 * Removed: class-name hashes, keyframe-name hashes, `from`/`to` aliases, time units, and the
 * token order of the `animation`/`transition` shorthands. What is left is the stylesheet's
 * content — which is what "the rebuild still ships the same rules" has to mean, because none of
 * the removed parts is stable across a build.
 *
 * @param css - a CSS module literal.
 * @returns the comparable form.
 */
export function normaliseCss(css) {
  return css
    // The generated prefix is derived from the stylesheet's own name, so it varies in shape
    // between builds: `g2GnNq`, `zln1-a` (hyphen), `_2v6iGa` (leading underscore). Allowing
    // hyphen and underscore in the prefix is what keeps this independent of that.
    .replace(/\.([A-Za-z0-9_-]+)_([A-Za-z][A-Za-z0-9_]*)/g, '.$2')
    .replace(
      /([A-Za-z0-9_-]+)_(readerCollapse[A-Za-z]*|thinkShimmer|slideUp|pulse|popIn|markBusyPulse|previewFadeIn)/g,
      '$2',
    )
    .replace(/(\d*\.\d+)s\b/g, (_, seconds) => `${String(Math.round(Number.parseFloat(seconds) * 1000))}ms`)
    .replace(/\b(animation|transition):([^;}]+)/g, (_, property, value) =>
      `${property}:${value.trim().split(/\s+/).sort().join(' ')}`)
    .replace(/(^|[{}])(from|to)\{/g, (_, lead) => `${lead}${_ === 'from' ? '0%' : '100%'}{`);
}
