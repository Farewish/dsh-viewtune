/**
 * The merged collapse button's mode.
 *
 * The interesting case is not the three names — it is what an UNRECOGNISED value means. The pair of buttons
 * was the behaviour before the merge, so `both` is the only answer that cannot take an action away from a
 * reader who never opened this setting.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLLAPSE_MODES, collapseModeOf } from '../src/client/collapse-mode.ts';

test('each mode reads back as itself, and anything else is the pair of buttons', () => {
  assert.equal(collapseModeOf('current'), 'current');
  assert.equal(collapseModeOf('all'), 'all');
  assert.equal(collapseModeOf('both'), 'both');
  // A record written before the merge carries no such key, and a hand-edited one can carry anything.
  assert.equal(collapseModeOf(undefined), 'both');
  assert.equal(collapseModeOf(null), 'both');
  assert.equal(collapseModeOf(''), 'both');
  assert.equal(collapseModeOf('everything'), 'both');
  assert.equal(collapseModeOf(42), 'both');
});

test('the three modes are the closed set the settings row offers', () => {
  assert.deepEqual(COLLAPSE_MODES.map(entry => entry.id), ['current', 'all', 'both']);
  // The default is the one that keeps both actions reachable, and it is also the pair's own behaviour.
  assert.equal(COLLAPSE_MODES[COLLAPSE_MODES.length - 1]?.id, 'both');
  for (const entry of COLLAPSE_MODES) {
    assert.ok(entry.label.length > 0, 'a mode with no label would render a blank option');
  }
});
