/** The scrollbar sheet's selectors, without a browser. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrollbarStyleCss } from '../src/client/scrollbar.ts';

test('arrow buttons are hidden only in the plugin’s own scroll containers', () => {
  const css = scrollbarStyleCss();
  // The host draws native arrows in every scrollbar on Windows. The plugin's groove has no use for
  // them, but a bare `::-webkit-scrollbar-button` also removed them from settings, menus and code
  // blocks it never styled.
  assert.ok(css.includes('[class*="_scrollBody"]::-webkit-scrollbar-button'));
  assert.ok(css.includes('[class*="composer" i] [class*="_scroll"]::-webkit-scrollbar-button'));
  assert.ok(!/\n::-webkit-scrollbar-button/m.test(css), 'the unscoped selector must be gone');
});
