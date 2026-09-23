import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLASS_PARTS, glassProperties, glassValues, isGlassPart } from '../src/client/glass.ts';

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
  }
});
