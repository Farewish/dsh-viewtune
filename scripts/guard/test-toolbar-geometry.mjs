/**
 * Geometry test for the pinned toolbar lane.
 *
 * Appearance choices are easy to state in CSS and easy to break silently: a label that grows
 * past the lane's height stops being centred (the lane is what clips nothing, but the two
 * switches would no longer line up), and "there is clearance above and below" is an
 * arithmetic claim, not a substring. So this reads the real rules out of the shipped CSS
 * literal and checks the numbers add up.
 *
 * Invariants asserted:
 *   - the 收起 control is shorter than the toolbar's inner height, so there is clearance
 *     above and below it and `align-items: center` can centre it;
 *   - the label is bigger than it used to be (12px/18px was the cramped version);
 *   - the toolbar carries a bottom divider;
 *   - the toolbar adds no inline padding, so the control's left edge is where it always was.
 *
 * Usage: node test-toolbar-geometry.mjs [bundlePath]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { moduleCssLiteral } from './bundle-anchors.mjs';

/**
 * The checkout this guard lives in. Ported from the authoring machine, where every guard named
 * an absolute install path; a guard that ships with the plugin has to resolve the tree it is in,
 * or it silently checks whatever happens to be installed elsewhere.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const bundlePath = process.argv[2] ?? join(ROOT, 'lib/client.js');
const text = readFileSync(bundlePath, 'utf8');

/**
 * The Reader stylesheet, located by the stylesheet it CAME FROM — not by `const css$4 = `.
 *
 * The ordinal is an emission-order artefact: add or reorder a CSS module and this guard measures a different stylesheet
 * while still reporting confident geometry. `moduleCssLiteral` pairs each literal with its owning
 * `tagId$N = "<package>/Reader.module.css"`, which is a fact about the file rather than about the build.
 */
function readReaderCss() {
  return moduleCssLiteral(text, 'Reader.module.css');
}

const css = readReaderCss();

/** Expand a 1-4 value box shorthand the way CSS does, so callers can read sides directly. */
function sides(value) {
  const parts = (value ?? '0').split(/\s+/).filter(Boolean);
  const [top, right = top, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
}

const px = (value) => Number.parseFloat(value ?? '');

/** The declarations of one flat rule, as a property map plus resolved box sides.
 *
 * Matched by an EXACT selector, not by the first rule that CONTAINS one: a compound (`…[data-x=true]
 * .control`) or a state (`:hover`, `[hidden]`) is a different rule, and taking the first containing match
 * measured whichever happened to be written first — a split-shape rule placed above the base one had no
 * font-size at all, and the check read NaN for it.
 */
function rule(selector) {
  for (const chunk of css.split('}')) {
    const brace = chunk.indexOf('{');
    if (brace === -1 || chunk.slice(0, brace).trim() !== selector) continue;
    const body = chunk.slice(brace + 1);
    const out = { box: {} };
    for (const part of body.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
    }
    if (out.padding) out.box.padding = sides(out.padding);
    // `border: 1px solid <colour>` / `border-bottom: …` — the first token is the width.
    for (const [key, value] of Object.entries(out)) {
      if (key.startsWith('border')) out.box[key] = px(value.split(/\s+/)[0]);
    }
    return out;
  }
  throw new Error(`rule ${selector} not found in the literal`);
}

/**
 * Resolve a CSS-module class by its LOCAL name.
 *
 * lightningcss re-hashes the prefix on every build (`[hash]_[local]`), so a checker that
 * spells out `g2GnNq_toolbar` is asserting one build's artifact rather than a property of
 * the stylesheet: it passes on the committed bundle and fails on a byte-fresh rebuild that
 * is otherwise identical. The local name is the stable half — it comes from the source
 * `.module.css` — so resolve through it and keep the assertions about geometry.
 */
function classOf(local) {
  const match = new RegExp(`\\.([A-Za-z0-9_]+)_${local}(?![\\w-])`).exec(css);
  if (match === null) throw new Error(`class for local name "${local}" not found in the literal`);
  return `.${match[1]}_${local}`;
}

const TOOLBAR = classOf('toolbar');
const COLLAPSE = classOf('collapseControl');
const JUMP = classOf('jump');

const toolbar = rule(TOOLBAR);
const control = rule(COLLAPSE);
const jump = rule(JUMP);

const failures = [];
function check(name, pass, detail) {
  if (!pass) failures.push(`${name} — ${detail}`);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

// --- the label carries the SAME type as the 「回到最新」 pill
// What is pinned is the AGREEMENT, not a size in isolation: the reader asked for one small size in the lane
// instead of two. (This check used to hold the label at 14px/22px, the size it had been moved up to after a
// complaint about 12px — a decision the reader has since reversed, in favour of consistency.)
const controlLine = px(control['line-height']);
const controlFont = px(control['font-size']);
check('label font is the 回到最新 pill\'s', controlFont === px(jump['font-size']), `font-size ${controlFont}px vs ${px(jump['font-size'])}px`);
check('label line-height is the 回到最新 pill\'s', controlLine === px(jump['line-height']), `line-height ${controlLine}px vs ${px(jump['line-height'])}px`);

// --- clearance and centring
const toolbarLine = px(toolbar['line-height']);
const toolbarPad = toolbar.box.padding;
// The lane states its height; the padding is only a floor (a wrapped toolbar may exceed it).
const toolbarInner = Math.max(px(toolbar['min-height']) || 0, toolbarLine + px(toolbarPad.top) + px(toolbarPad.bottom));
const controlPad = control.box.padding;
const controlBorder = control.box.border ?? 0;
const controlHeight = px(control['line-height']) + px(controlPad.top) + px(controlPad.bottom) + 2 * controlBorder;
const clearance = (toolbarInner - controlHeight) / 2;

check('toolbar states a lane height', px(toolbar['min-height']) > 0, `min-height ${toolbar['min-height']}`);
check('toolbar lane is taller than one control line', toolbarInner > toolbarLine, `inner ${toolbarInner}px`);
check(
  'control leaves clearance above and below',
  clearance >= 4,
  `control ${controlHeight}px in ${toolbarInner}px -> ${clearance}px each side`,
);
check(
  'clearance is symmetric, so centring is not a magic margin',
  controlPad.top === controlPad.bottom,
  `control padding-block ${controlPad.top}/${controlPad.bottom}`,
);

// --- divider under the lane, and the pill outline matching it
const toolbarDivider = toolbar['border-bottom'] ?? '';
const pillBorder = control.border ?? '';
check('toolbar has a bottom divider', /^[\d.]+px solid /.test(toolbarDivider), toolbarDivider);
// The shell draws its own dividers as `.5px solid var(--dsw-alias-border-l2)`; tier l1
// (#0000000a) is the faintest available and read as no line at all.
check('divider uses the shell\'s divider tier', toolbarDivider.includes('border-l2'), toolbarDivider);
check('divider uses the shell\'s line weight', /^\.5px solid /.test(toolbarDivider), toolbarDivider);
// The pill's outline must read as strongly as the divider it sits above.
check(
  'pill outline matches the divider weight and tier',
  pillBorder.replace(/\s+/g, ' ').trim() === toolbarDivider.replace(/\s+/g, ' ').trim(),
  `pill "${pillBorder}" vs divider "${toolbarDivider}"`,
);
check('pill has a resting fill', (control.background ?? '').includes('var('), control.background);
// Hover must NOT touch the fill. It used to step up to the solid sibling of the resting token — which was the
// only way to show a hover while the resting fill IS `interactive-bg-hover` — but the reader asked for the label
// to be the only thing that answers the pointer, so what is asserted is the ABSENCE of a background here.
const hoverFill = (() => {
  const at = css.indexOf(`${COLLAPSE}:hover{`);
  if (at === -1) return undefined;
  const end = css.indexOf('}', at);
  const body = css.slice(at, end);
  return /background:([^;}]+)/.exec(body)?.[1];
})();
check('hover leaves the fill alone', hoverFill === undefined, `hover background ${hoverFill ?? '(none)'}`);
check('…and highlights the label instead', /color:var\(--dsw-alias-label-primary\)/.test(css.slice(css.indexOf(`${COLLAPSE}:hover{`), css.indexOf('}', css.indexOf(`${COLLAPSE}:hover{`)))));

// --- horizontal position unchanged
// The lane now spans the view, and it does so by cancelling its own inline padding with an equal
// negative margin — so the divider reaches the edges while 收起 stays exactly where the text starts.
// Stated as that relation rather than as "no padding", which was the shape this replaced.
// A sticky lane rests at its natural position until the scroll passes its offset: without cancelling
// the view's top padding the lane hangs one padding below the header until the reader scrolls that far.
check(
  'toolbar cancels the view\'s top padding, so it sits flush under the header',
  String(toolbar['margin-top'] ?? '').includes('var(--reader-top-pad)'),
  `margin-top ${toolbar['margin-top']}`,
);
check(
  "toolbar spans the view, its right control pinned to the lane's end",
  String(toolbar['margin-inline'] ?? '').includes('var(--reader-inline-pad)')
    && String(toolbar['padding-left'] ?? '').includes('var(--reader-inline-pad)')
    && String(toolbar['padding-left'] ?? '').includes('var(--reader-toolbar-shift-left)')
    // The right end is a different shape on purpose: the viewtune button sits at the LANE's end less the
    // gap, which is what the reader asked for after the outward shift had gone as far as it could.
    && String(toolbar['padding-right'] ?? '').includes('var(--reader-toolbar-gap-right'),
  `margin-inline ${toolbar['margin-inline']} / padding ${toolbar['padding-left']} · ${toolbar['padding-right']}`,
);
check('control keeps a pill shape', control['border-radius'] === '999px', control['border-radius']);
check('control padding-right is the larger axis', px(controlPad.right) >= px(controlPad.top), `${controlPad.right} vs ${controlPad.top}`);

console.log(`\n${failures.length === 0 ? 'TOOLBAR GEOMETRY OK' : 'TOOLBAR GEOMETRY WRONG'}`);
for (const failure of failures) console.log(`  - ${failure}`);
if (failures.length) process.exit(1);
