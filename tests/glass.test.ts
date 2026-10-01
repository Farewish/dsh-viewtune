import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLASS_BLUR_MAX, GLASS_PARTS, applyGlassBlur, glassBlurProperties, glassBlurPropertyNames, glassBlurValues, glassProperties, glassValues, isGlassPart } from '../src/client/glass.ts';

test('every part falls back to its initial when the record has nothing to say', () => {
  // Persistence replaces the whole record, so a reader written before the skin existed sees `{}`,
  // `undefined`, or a record carrying only some of the parts.
  const empty = glassValues(undefined);
  const partial = glassValues({ lane: 60 });
  for (const part of GLASS_PARTS) {
    assert.equal(empty[part.id], part.initial);
    assert.equal(partial[part.id], part.id === 'lane' ? 60 : part.initial);
  }
});

test('a stored value is clamped to the scale and rounded, and junk falls back', () => {
  const values = glassValues({ lane: 140, user: -20, card: 33.4, code: 'lots', diff: null, chip: Number.NaN });
  assert.equal(values.lane, 100);
  assert.equal(values.user, 0);
  assert.equal(values.card, 33);
  // Junk falls back to the part's INITIAL, which is the reader's own setting rather than a number this file chose —
  // consulted through the table so that moving a default moves this assertion with it.
  const initialOf = (id: string): number => GLASS_PARTS.find(part => part.id === id)?.initial ?? -1;
  assert.equal(values.code, initialOf('code'));
  assert.equal(values.diff, initialOf('diff'));
  assert.equal(values.chip, initialOf('chip'));
});

test('the properties the stylesheet reads are one per part, in percent', () => {
  const style = glassProperties(glassValues({ lane: 40, chip: 15 }));
  assert.deepEqual(Object.keys(style).sort(), GLASS_PARTS.map(part => part.property).sort());
  assert.equal(style['--glass-lane'], '40%');
  assert.equal(style['--glass-chip'], '15%');
  // …and a part the record says nothing about carries the initial the shipped defaults are made of.
  assert.equal(style['--glass-card'], `${String(GLASS_PARTS.find(part => part.id === 'card')?.initial ?? -1)}%`);
  // The counting pills got a dial of their own rather than riding 产物标签: they are the two counters a
  // reader sees on EVERY turn, while the chips are one turn's deliverables. Checked by name because the
  // stylesheet in TurnMetrics.module.css is what reads it, and that module is not this one.
  assert.ok(isGlassPart('pill'));
  assert.equal(style['--glass-pill'], `${String(GLASS_PARTS.find(part => part.id === 'pill')?.initial ?? -1)}%`);
});

test('the part ids are the closed set the settings rows and the store agree on', () => {
  assert.equal(new Set(GLASS_PARTS.map(part => part.id)).size, GLASS_PARTS.length);
  assert.ok(isGlassPart('lane'));
  assert.ok(!isGlassPart('toolbar'));
  // Every part carries a label, so a row cannot render blank. A `hint` is OPTIONAL, and most parts have none: the
  // reader of this panel is not the reader of this file, and 「用户气泡」 or 「代码块」 beside a dial says everything
  // there is to say. Where one exists it stays a phrase rather than a paragraph. (That the copy describes what an
  // option does and never how it is built is checked against the source by the guard, which can read it.)
  for (const part of GLASS_PARTS) {
    assert.ok(part.label.length > 0);
    assert.match(part.property, /^--glass-[a-z]+$/);
    if (part.hint !== undefined) assert.ok(part.hint.length > 0 && part.hint.length <= 28, part.hint);
    // …and the frost's property, where a surface has one: a name of its own per part, so two surfaces cannot end up
    // sharing a dial by accident.
    if (part.blur !== undefined) assert.match(part.blur.property, /^--glass-blur-[a-z]+$/);
  }
});

test('the frost is a dial per surface, and a surface at 0 is left UNSET rather than written as zero', () => {
  // Every surface that can carry a `backdrop-filter` has one; 「滚动条槽位」 deliberately does not, because its groove
  // is a scrollbar pseudo-element where the property does nothing, and a row that moves nothing is worse than no row.
  assert.deepEqual(
    GLASS_PARTS.filter(part => part.blur !== undefined).map(part => part.id),
    ['lane', 'user', 'card', 'code', 'diff', 'chip', 'pill', 'input'],
  );
  // A record that never moved one takes that surface's shipped blur, so an older record keeps the look it had. The
  // 0-initial surface is the LANE now: the defaults are one reading of the reader's own settings file, and they run a
  // crisp toolbar (frost 0) over frosted cards (8), chips (5) and an input (10) — the first cut of this feature had it
  // the other way round, which is why the two examples below moved together with the table.
  const blurred = glassBlurValues({ code: 20, card: 4 });
  assert.equal(blurred.code, 20);
  assert.equal(blurred.card, 4);
  assert.equal(glassBlurValues({}).lane, GLASS_PARTS.find(part => part.id === 'lane')?.blur?.initial);
  assert.equal(glassBlurValues({}).lane, 0);
  // Clamped to the ceiling, floored at zero and rounded like every other dial in this file.
  assert.equal(glassBlurValues({ lane: 999 }).lane, GLASS_BLUR_MAX);
  assert.equal(glassBlurValues({ lane: -5 }).lane, 0);
  assert.equal(glassBlurValues({ lane: 12.6 }).lane, 13);
  assert.equal(glassBlurValues({ lane: Number.NaN }).lane, GLASS_PARTS.find(part => part.id === 'lane')?.blur?.initial);
  // The properties: a px LENGTH where there is frost, and NO KEY AT ALL where there is none — because
  // `backdrop-filter: blur(0px)` is not `none`, so writing it would make every un-frosted surface a stacking context
  // and a composited layer, the construct this plugin has already been bitten by.
  const properties = glassBlurProperties({ card: 8, chip: 0 });
  assert.equal(properties['--glass-blur-card'], '8px');
  // A surface the record does not mention takes its shipped frost (the user bubble's 3px), and the two surfaces whose
  // shipped frost is 0 — the lane and the chip — are the ones that must NOT appear at all.
  assert.equal(properties['--glass-blur-user'], '3px');
  assert.equal(properties['--glass-blur-lane'], undefined);
  assert.equal(properties['--glass-blur-chip'], undefined);
  assert.equal(glassBlurPropertyNames().length, 8);
  // …and the withdrawal REMOVES rather than re-resolves: `null` takes every name off, where an empty record would
  // write the shipped initials back on. The conversation gate depends on that difference when it is switched off.
  const style = {
    values: new Map<string, string>(),
    setProperty(name: string, value: string) { this.values.set(name, value); },
    removeProperty(name: string) { this.values.delete(name); },
  };
  applyGlassBlur(style, { card: 8 });
  assert.equal(style.values.get('--glass-blur-card'), '8px');
  assert.equal(style.values.get('--glass-blur-user'), '3px');
  assert.equal(style.values.get('--glass-blur-lane'), undefined);
  applyGlassBlur(style, null);
  assert.deepEqual([...style.values.keys()], []);
});
