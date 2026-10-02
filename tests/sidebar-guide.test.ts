/**
 * The 「开始」 mechanism: recognising the guide tab, and replacing it only when it is the only thing in the column.
 *
 * The constant is the host's own published identity, so it is pinned here: if it ever changes, the sidebar's guide stops
 * being recognised and this mechanism silently stops working — a failure worth failing a test over.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIDEBAR_GUIDE_ID, SIDEBAR_GUIDE_KIND, isGuideTab, replaceableGuide } from '../src/client/sidebar-guide.ts';

test('the guide is identified by the KIND its tab actually carries', () => {
  // Measured from the sidebar package: `const GUIDE_KIND = "guide"`, and a guide tab is found with
  // `findPaneContentTab(layout, paneId, pageAddress(GUIDE_KIND), GUIDE_KIND)`. The first version of this module compared
  // the kind against GUIDE_ID — the BODY's registration key, never a tab kind — so nothing ever matched and the mechanism
  // silently did nothing. Both are pinned here: the kind because it is what a record carries, the id because the body
  // still registers under it.
  assert.equal(SIDEBAR_GUIDE_KIND, 'guide');
  assert.equal(SIDEBAR_GUIDE_ID, '@deepseek-ai/dsh-client-ui-sidebar-right/guide');
  assert.equal(isGuideTab({ kind: 'guide', id: 'tab-1' }), true);
  assert.equal(isGuideTab({ id: SIDEBAR_GUIDE_ID }), true);
  assert.equal(isGuideTab({ kind: 'document', id: 'tab-2' }), false);
  assert.equal(isGuideTab({ kind: SIDEBAR_GUIDE_ID, id: 'tab-3' }), false);
  assert.equal(isGuideTab(undefined), false);
  assert.equal(isGuideTab({}), false);
});

test('the guide is replaced only when it is the ONLY tab — the reader’s condition, word for word', () => {
  const guide = { kind: 'guide', id: 'guide-tab' };
  assert.equal(replaceableGuide([guide], guide), 'guide-tab');
  // Two tabs: the reader asked for the sole-guide case only, so the column is left exactly as it is.
  assert.equal(replaceableGuide([guide, { kind: 'document', id: 'doc-tab' }], guide), undefined);
  // One tab that is not the guide: nothing to take the place of.
  assert.equal(replaceableGuide([{ kind: 'document', id: 'doc-tab' }], { kind: 'document', id: 'doc-tab' }), undefined);
  // No list, or a list whose single tab cannot be identified: a face that cannot say what else is open is not trusted to
  // say that nothing else is.
  assert.equal(replaceableGuide(undefined, guide), undefined);
  assert.equal(replaceableGuide([{ kind: 'guide' }], { kind: 'guide' }), undefined);
  assert.equal(replaceableGuide([], guide), undefined);
});

test('a guide known only from the ACTIVE record is still recognised', () => {
  assert.equal(replaceableGuide([{ kind: 'guide' }], { kind: 'guide', id: 'active-guide' }), 'active-guide');
  assert.equal(replaceableGuide([{ kind: 'guide' }], { kind: 'document', id: 'doc-tab' }), undefined);
});
