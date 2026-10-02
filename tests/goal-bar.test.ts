/**
 * Expanding the host's goal bar: which clicks count, and what the toggle leaves on the document.
 *
 * The interesting cases are all the ones that must NOT toggle: a text selection ending in a click (the reader was
 * copying the goal, not folding it), a click on the edit field while it is open, a click on any of the four icon
 * actions, and a click anywhere outside the bar. The attribute itself is boring on purpose — one root attribute, which
 * is what the stylesheet keys on.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOAL_BAR_INTERACTIVE, GOAL_BAR_SELECTOR, GOAL_EXPANDED_ATTRIBUTE, goalClickToggles, toggleGoalBar } from '../src/client/goal-bar.ts';

/** A duck-typed stand-in for an element: `closest` answers from a fixed set of selectors. */
function targetMatching(...selectors: string[]): { closest: (selector: string) => unknown } {
  return { closest: (selector: string) => (selectors.includes(selector) ? {} : null) };
}

/** A duck-typed stand-in for the document element, recording what was asked of it. */
function fakeRoot() {
  // A Map, not a Set of `name=value` strings: the real interface is keyed by the BARE name for all three methods, and
  // a double that concatenated the value made `hasAttribute` miss what `setAttribute` had just written — which looked
  // like the module failing to flip back, and was the double's own bug.
  const attributes = new Map<string, string>();
  return {
    attributes,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  };
}

test('a click on the bar toggles, and anything outside it does not', () => {
  assert.equal(goalClickToggles(targetMatching(GOAL_BAR_SELECTOR), true), true);
  // The composer, the transcript, the toolbar — anything that is not the bar.
  assert.equal(goalClickToggles(targetMatching(), true), false);
  // Not an element at all (a text node, `window`, null).
  assert.equal(goalClickToggles(null, true), false);
  assert.equal(goalClickToggles(undefined, true), false);
  assert.equal(goalClickToggles('div', true), false);
});

test('the bar’s own controls are never the control', () => {
  // One of the four icon actions — the pause / resume / edit / clear buttons.
  assert.equal(goalClickToggles(targetMatching(GOAL_BAR_SELECTOR, 'button'), true), false);
  // The edit field, which replaces the objective while the reader is typing in it.
  assert.equal(goalClickToggles(targetMatching(GOAL_BAR_SELECTOR, 'input'), true), false);
  // Every kind on the list is excluded — a check that would pass with a list that had lost its entries is no check.
  for (const selector of GOAL_BAR_INTERACTIVE) {
    assert.equal(goalClickToggles(targetMatching(GOAL_BAR_SELECTOR, selector), true), false, selector);
  }
});

test('a text selection that ends in a click does not collapse the bar', () => {
  assert.equal(
    goalClickToggles(targetMatching(GOAL_BAR_SELECTOR), false),
    false,
    'copying the goal must not fold it away',
  );
});

test('the toggle flips one root attribute and reports where it landed', () => {
  const root = fakeRoot();
  assert.equal(toggleGoalBar(root), true);
  assert.deepEqual([...root.attributes.keys()], [GOAL_EXPANDED_ATTRIBUTE]);
  assert.equal(root.attributes.get(GOAL_EXPANDED_ATTRIBUTE), '');
  assert.equal(toggleGoalBar(root), false);
  assert.deepEqual([...root.attributes.keys()], []);
  // …and it can be set outright, which is what a caller restoring a known state would do.
  assert.equal(toggleGoalBar(root, true), true);
  assert.equal(toggleGoalBar(root, true), true, 'setting it twice is not a flip');
  assert.deepEqual([...root.attributes.keys()], [GOAL_EXPANDED_ATTRIBUTE]);
  assert.equal(toggleGoalBar(root, false), false);
  assert.deepEqual([...root.attributes.keys()], []);
});
