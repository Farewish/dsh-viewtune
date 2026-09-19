import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SHORTCUTS, bindingFromEvent, formatShortcut, matchesShortcut, parseShortcut,
  shortcutLabel, shortcutProblem,
} from '../src/client/shortcuts.ts';

/** A key event with everything released except what the case sets. */
const press = (key: string, modifiers: Partial<Record<'alt' | 'control' | 'meta' | 'shift', boolean>> = {}) => ({
  key, altKey: modifiers.alt === true, ctrlKey: modifiers.control === true,
  metaKey: modifiers.meta === true, shiftKey: modifiers.shift === true,
});

test('the defaults are what the buttons advertise, and they round-trip', () => {
  assert.equal(DEFAULT_SHORTCUTS.collapseTurn, 'Alt+C');
  assert.equal(DEFAULT_SHORTCUTS.collapseAll, 'Alt+Shift+C');
  assert.equal(formatShortcut(parseShortcut(DEFAULT_SHORTCUTS.collapseTurn)!), 'Alt+C');
  assert.equal(formatShortcut(parseShortcut(DEFAULT_SHORTCUTS.collapseAll)!), 'Alt+Shift+C');
});

test('a recorded combination is normalised, whatever the event spells', () => {
  assert.equal(bindingFromEvent(press('c', { alt: true })), 'Alt+C');
  assert.equal(bindingFromEvent(press('C', { alt: true })), 'Alt+C');
  assert.equal(bindingFromEvent(press(' ', { alt: true })), 'Alt+Space');
  assert.equal(bindingFromEvent(press('ArrowLeft', { control: true })), 'Control+ArrowLeft');
  // Modifier order is the attribute's, not the order the flags happened to be set in.
  assert.equal(bindingFromEvent(press('c', { shift: true, alt: true })), 'Alt+Shift+C');
  assert.equal(bindingFromEvent(press('k', { meta: true })), 'Meta+K');
});

test('a combination that cannot be owned is refused at the event', () => {
  assert.equal(bindingFromEvent(press('c')), null, 'a bare letter would be swallowed while typing');
  assert.equal(bindingFromEvent(press('c', { shift: true })), null, 'shift alone still types');
  assert.equal(bindingFromEvent(press('Alt', { alt: true })), null, 'a modifier is not a key');
  assert.equal(bindingFromEvent(press('Shift', { shift: true })), null);
});

test('matching is exact on every modifier, so a near miss stays a near miss', () => {
  assert.equal(matchesShortcut(press('c', { alt: true }), 'Alt+C'), true);
  assert.equal(matchesShortcut(press('c', { alt: true, shift: true }), 'Alt+C'), false);
  assert.equal(matchesShortcut(press('c', { alt: true, control: true }), 'Alt+C'), false);
  assert.equal(matchesShortcut(press('C', { alt: true }), 'alt+c'), true, 'a hand-edited record still matches');
  assert.equal(matchesShortcut(press('c', { alt: true }), ''), false, 'a cleared slot fires nothing');
  assert.equal(matchesShortcut(press('c', { alt: true }), undefined), false);
  assert.equal(matchesShortcut(press('c', { alt: true }), 'Hyper+C'), false, 'an unknown modifier is not a match');
});

test('the problems a recording can hit are named, not guessed', () => {
  assert.equal(shortcutProblem('Alt+C', null), null);
  assert.equal(shortcutProblem('C', null), 'modifier');
  assert.equal(shortcutProblem('Shift+C', null), 'modifier');
  assert.equal(shortcutProblem('', null), 'modifier');
  assert.equal(shortcutProblem('Alt', null), 'modifier');
  assert.equal(shortcutProblem('Control+C', null), 'reserved', 'binding copy would take copy away');
  assert.equal(shortcutProblem('Meta+V', null), 'reserved');
  assert.equal(shortcutProblem('Alt+C', 'Alt+C'), 'taken');
  assert.equal(shortcutProblem('alt+c', 'Alt+C'), 'taken', 'the comparison is on the canonical form');
  assert.equal(shortcutProblem('Alt+C', 'Alt+Shift+C'), null);
  assert.equal(shortcutProblem('Alt+C', ''), null, 'a cleared neighbour cannot collide');
});

test('parsing rejects what it cannot represent', () => {
  assert.equal(parseShortcut(undefined), null);
  assert.equal(parseShortcut(''), null);
  assert.equal(parseShortcut('Hyper+C'), null);
  assert.equal(parseShortcut('Control'), null);
  assert.deepEqual(parseShortcut('control+alt+k'), { key: 'K', alt: true, control: true, meta: false, shift: false });
  assert.equal(formatShortcut(parseShortcut('alt+c')!), 'Alt+C', 'a hand-written record is canonicalised');
});

test('a binding reads as keys, not as an attribute value', () => {
  assert.equal(shortcutLabel('Alt+Shift+C'), 'Alt + Shift + C');
  assert.equal(shortcutLabel('Control+K'), 'Ctrl + K');
  assert.equal(shortcutLabel('Meta+K'), 'Cmd + K');
  assert.equal(shortcutLabel(''), '未设置');
});

test('the number of keys is not fixed: any modifier stack, either action', () => {
  // The two defaults happen to be two and three keys. Nothing pins that: an event contributes every
  // modifier it carries, and none of the checks below counts keys — so a shorter binding can
  // replace a longer default and the other way round.
  assert.equal(bindingFromEvent(press('K', { alt: true })), 'Alt+K', 'two keys');
  assert.equal(bindingFromEvent(press('K', { alt: true, control: true, shift: true })), 'Alt+Control+Shift+K', 'four keys');
  assert.equal(shortcutProblem('Alt+K', 'Alt+Shift+C'), null, 'a shorter binding may replace the longer default');
  assert.equal(shortcutProblem('Alt+Control+Shift+K', 'Alt+C'), null, 'and a longer one may replace the shorter');
  assert.equal(shortcutLabel('Alt+Control+Shift+K'), 'Alt + Ctrl + Shift + K');
});
