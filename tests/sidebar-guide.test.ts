/**
 * The 「开始」 mechanism: recognising the guide tab, and replacing it only when it is the only thing in the column.
 *
 * The constant is the host's own published identity, so it is pinned here: if it ever changes, the sidebar's guide stops
 * being recognised and this mechanism silently stops working — a failure worth failing a test over.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIDEBAR_GUIDE_ID, isGuideTab, replaceableGuide } from '../src/client/sidebar-guide.ts';

test('the guide is identified by the host’s own published constant', () => {
  assert.equal(SIDEBAR_GUIDE_ID, '@deepseek-ai/dsh-client-ui-sidebar-right/guide');
  assert.equal(isGuideTab({ kind: SIDEBAR_GUIDE_ID, id: 'tab-1' }), true);
  assert.equal(isGuideTab({ id: SIDEBAR_GUIDE_ID }), true);
  assert.equal(isGuideTab({ kind: 'document', id: 'tab-2' }), false);
  assert.equal(isGuideTab(undefined), false);
  assert.equal(isGuideTab({}), false);
});

test('the guide is replaced only when it is the ONLY tab — the reader’s condition, word for word', () => {
  const guide = { kind: SIDEBAR_GUIDE_ID, id: 'guide-tab' };
  assert.equal(replaceableGuide([guide], guide), 'guide-tab');
  // Two tabs: the reader asked for the sole-guide case only, so the column is left exactly as it is.
  assert.equal(replaceableGuide([guide, { kind: 'document', id: 'doc-tab' }], guide), undefined);
  // One tab that is not the guide: nothing to take the place of.
  assert.equal(replaceableGuide([{ kind: 'document', id: 'doc-tab' }], { kind: 'document', id: 'doc-tab' }), undefined);
  // No list, or a list whose single tab cannot be identified: a face that cannot say what else is open is not trusted to
  // say that nothing else is.
  assert.equal(replaceableGuide(undefined, guide), undefined);
  assert.equal(replaceableGuide([{ kind: SIDEBAR_GUIDE_ID }], { kind: SIDEBAR_GUIDE_ID }), undefined);
  assert.equal(replaceableGuide([], guide), undefined);
});

test('a guide known only from the ACTIVE record is still recognised', () => {
  // The tab list may carry no id while `active()` does; either side may answer, and both must agree it is the guide.
  assert.equal(replaceableGuide([{ kind: SIDEBAR_GUIDE_ID }], { kind: SIDEBAR_GUIDE_ID, id: 'active-guide' }), 'active-guide');
  // …but if the active tab is something else, the single tab is not the guide the reader meant.
  assert.equal(replaceableGuide([{ kind: SIDEBAR_GUIDE_ID }], { kind: 'document', id: 'doc-tab' }), undefined);
});
