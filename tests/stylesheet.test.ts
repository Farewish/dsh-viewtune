/**
 * One stylesheet per plugin surface.
 *
 * A second activation used to append a second `<style>` with the same rules; HMR can leave the old one
 * in place until the disposer runs. The helper is the single place that replaces by the marker every
 * installer already writes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stylesheetElement } from '../src/client/stylesheet.ts';

function fakeDocument() {
  const styles: { attrs: Map<string, string>; textContent: string; remove: () => void }[] = [];
  const doc = {
    querySelector: (selector: string) => {
      const match = /^style\[data-viewtune-style="(.+)"\]$/.exec(selector);
      return styles.find(style => match !== null && style.attrs.get('data-viewtune-style') === match[1]) ?? null;
    },
    createElement: () => {
      const style = {
        attrs: new Map<string, string>(),
        textContent: '',
        setAttribute(name: string, value: string) { this.attrs.set(name, value); },
        getAttribute(name: string) { return this.attrs.get(name) ?? null; },
        remove() {
          const at = styles.indexOf(style);
          if (at >= 0) styles.splice(at, 1);
        },
      };
      return style;
    },
    head: { append: (style: { attrs: Map<string, string>; textContent: string; remove: () => void }) => { styles.push(style); } },
  } as unknown as Document;
  return { doc, styles };
}

test('installing the same id twice leaves one element, with the newer rules', () => {
  const { doc, styles } = fakeDocument();
  stylesheetElement(doc, 'dsh-viewtune-test', 'a');
  stylesheetElement(doc, 'dsh-viewtune-test', 'b');
  assert.equal(styles.length, 1);
  assert.equal(styles[0]?.textContent, 'b');
  assert.equal(styles[0]?.attrs.get('data-viewtune-style'), 'dsh-viewtune-test');
});

test('different ids are separate surfaces', () => {
  const { doc, styles } = fakeDocument();
  stylesheetElement(doc, 'one', 'a');
  stylesheetElement(doc, 'two', 'b');
  assert.equal(styles.length, 2);
});

test('the disposer removes only its own element', () => {
  const { doc, styles } = fakeDocument();
  const first = stylesheetElement(doc, 'one', 'a');
  const second = stylesheetElement(doc, 'two', 'b');
  first.remove();
  assert.deepEqual(styles.map(style => style.textContent), ['b']);
  second.remove();
  assert.deepEqual(styles, []);
});
