import { useLayoutEffect } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsRuntime, PropsStore, StoreDecl } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { entryViewOf, ReaderEntryPolicy, readerEntryRequested } from './entry-policy.js';
import type { EntryView } from './entry-policy.js';
import { loadHostSettings, subscribeToHostSettings } from './settings-sync.js';

function isConversationStore(store: StoreDecl | undefined): store is ConversationStore {
  return typeof store === 'object' && store !== null
    && store.spec.persist === 'dsh.conversation'
    && typeof store.spec.actions.setView === 'function';
}

type EntryProps = PropsRuntime<'conversation.input.dock'> & PropsStore<ConversationStore> & {
  policy: ReaderEntryPolicy;
  /** The reader's 新会话默认视图, as the host record currently has it. */
  entryView: () => EntryView;
};

function ReaderEntry({ useStore, actions, policy, entryView }: EntryProps) {
  const view = useStore(state => state.view);
  useLayoutEffect(() => {
    const next = policy.select(view, entryView());
    if (next) actions.setView(next);
  }, [view, actions, policy, entryView]);
  return null;
}

/** Reuse the native store handle; its framework-owned instance preserves drafts. */
export function installReaderEntry(ctx: Context): () => void {
  const native = ctx.slots.entriesOfSlot('conversation.session')[0]?.store;
  if (!isConversationStore(native)) throw new Error('DSH Reader cannot bind the native conversation view store.');
  const policy = new ReaderEntryPolicy(readerEntryRequested(location.search), () => {
    const url = new URL(location.href);
    url.searchParams.delete('reader');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  });
  // 新会话默认视图 lives in the HOST's settings record, and this component cannot read the reader's store: the slot it
  // occupies is bound to the host's conversation store, which is what `state.view` comes from. So the value is read the way
  // the app-wide wallpaper reads its own — the record once at activation, then every accepted save through the
  // subscription — and handed to the component as a getter, because the effect must see the CURRENT value when a new
  // session mounts.
  //
  // Until that first read answers, the shipped default stands (`阅读页`), which is exactly the behaviour this plugin had
  // before the setting existed: a slow or failed read can therefore only ever leave a reader with what they already had.
  let entryView: EntryView = 'reader';
  void loadHostSettings().then(read => {
    entryView = entryViewOf(read.kind === 'stored' ? read.record.entryView : undefined);
  }, () => undefined);
  const unsubscribe = subscribeToHostSettings(record => { entryView = entryViewOf(record.entryView); });
  const unregister = ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-better-display-entry',
    store: native,
    inject: () => ({ policy, entryView: () => entryView }),
  }, ReaderEntry);
  return () => { unsubscribe(); unregister(); };
}
