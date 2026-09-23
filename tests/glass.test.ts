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
  assert.equal(values.code, 25);
  assert.equal(values.diff, 20);
  assert.equal(values.chip, 0);
});

test('the properties the stylesheet reads are one per part, in percent', () => {
  const style = glassProperties(glassValues({ lane: 40, chip: 15 }));
  assert.deepEqual(Object.keys(style).sort(), GLASS_PARTS.map(part => part.property).sort());
  assert.equal(style['--glass-lane'], '40%');
  assert.equal(style['--glass-chip'], '15%');
  assert.equal(style['--glass-card'], '0%');
  // The counting pills got a dial of their own rather than riding 产物标签: they are the two counters a
  // reader sees on EVERY turn, while the chips are one turn's deliverables. Checked by name because the
  // stylesheet in TurnMetrics.module.css is what reads it, and that module is not this one.
  assert.ok(isGlassPart('pill'));
  assert.equal(style['--glass-pill'], '20%');
});

test('the part ids are the closed set the settings rows and the store agree on', () => {
  assert.equal(new Set(GLASS_PARTS.map(part => part.id)).size, GLASS_PARTS.length);
  assert.ok(isGlassPart('lane'));
  assert.ok(!isGlassPart('toolbar'));
  // Every part carries the words the panel shows, so a row cannot render blank.
  for (const part of GLASS_PARTS) {
    assert.ok(part.label.length > 0 && part.hint.length > 0);
    assert.match(part.property, /^--glass-[a-z]+$/);
  }
});
