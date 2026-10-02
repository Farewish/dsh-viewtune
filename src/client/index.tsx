import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path';
import { dirname } from './deliverables.js';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { Reader } from './Reader.js';
import { createReaderStore } from './store.js';
import { installReaderEntry } from './entry.js';
import { fillComposerDom } from './mcp-app.js';
import { deliverableOpenModeOf, openDeliverableFile } from './open-file.js';
import { changesReviewAddress } from './deliverables.js';
import { replaceableGuide } from './sidebar-guide.js';
import type { SidebarTabLike } from './sidebar-guide.js';
import type { DeliverableOpenMode } from './open-file.js';
import { installWindowScope } from './wallpaper-scope.js';
import { installScrollbarStyle } from './scrollbar.js';
import { installComposerWheel } from './composer-wheel.js';
import { installResizerWheel } from './resizer-wheel.js';
import { installComposerGlass } from './composer-glass.js';
import { installAppBackdrop } from './app-backdrop.js';
import { installConversationGlass } from './conversation-glass.js';
import { installConversationSolid } from './conversation-solid.js';
import { installGoalBar } from './goal-bar.js';
import type { ReaderInjected } from './types.js';

/** Structural face of the sanctioned per-session composer writer. */
interface ComposerShell {
  setDraft: (text: string) => void;
}
interface ConversationFace {
  input?: { shell?: (id: SessionId) => ComposerShell };
}
/**
 * The right sidebar's resource opener.
 *
 * A runtime service, not a published type: this deployment DOES register it (and the product's own
 * tab actions call it with an address built by the same `fileAddressFor` this fork ports), but no
 * installed package declares it, so it is read defensively and a host without it falls back to the
 * system opener with a warning.
 */
interface SidebarRightFace {
  openResource?: (address: string, options?: { params?: { line?: number }; replaceTab?: string }) => void;
  /** The tab on top of the active pane, and every committed tab of a session — the reader's "only the guide" test. */
  active?: () => SidebarTabLike | undefined;
  tabsIn?: (sessionId: string) => readonly SidebarTabLike[];
}
interface RemoteSessionFace {
  openWorkspacePath: (arg: { path: string }) => Promise<{ ok: boolean; error?: { message: string } }>;
}

export type { ReaderBlockOwner } from './types.js';
export { McpAppFrame } from './McpAppFrame.js';
export const name = 'dsh-better-display-client';
export const inject = ['slots', 'sessions', 'conversation', 'remote', 'remote.session'];

export function apply(ctx: Context): void {
  const store = createReaderStore();
  /**
   * The window-wide wallpaper's stylesheet, installed once per activation.
   *
   * It is static and gated on an attribute the reading view writes onto `<html>`, so nothing here has
   * to read the reader's store — which it could not do anyway (`createReaderStore()` is a handle; the
   * live snapshot belongs to the framework's instance). Installing it from `apply` rather than from
   * the view is also what lets the backdrop outlive the reader switching away from this view.
   */
  ctx.effect(() => installWindowScope(document), 'dsh-viewtune: window wallpaper scope');
  // The scrollbar's groove is installed unconditionally; whether it paints anything is the dial's
  // business (0% is byte-for-byte the host's own transparent track).
  ctx.effect(() => installScrollbarStyle(document), 'dsh-viewtune: scrollbar groove');
  // The composer is the host's, and the element that scrolls it carries a hash-only class name, so there is nothing
  // stable to write a CSS selector against. The guard is therefore a capture-phase wheel listener on `window` that
  // walks up from the event's own target instead; see composer-wheel.ts for why the declarative route was dropped.
  ctx.effect(() => installComposerWheel(document), 'dsh-viewtune: composer wheel');
  // The column handles sit BESIDE the reading scroller rather than inside it, so a wheel over them had no scroll
  // container to reach and the gesture died there; this forwards it to the transcript. See resizer-wheel.ts.
  ctx.effect(() => installResizerWheel(document), 'dsh-viewtune: column handle wheel');
  // The host's input box, transparent like the rest of the skin — it follows the skin's master switch rather than the
  // conversation one, because it is on screen in both views. See composer-glass.ts for the two host facts it rests on.
  ctx.effect(() => installComposerGlass(document), 'dsh-viewtune: composer glass');
  /**
   * The backdrop's app-wide half, published once per activation rather than by the reading view.
   *
   * A new session opens on the host's conversation view, so that view is not mounted and everything it
   * publishes — the wallpaper on `<html>`, the groove's dial — was missing until the reader switched to
   * an older conversation. These are global preferences and belong to the plugin, not to one view; the
   * reading view still refines the geometry when it is the view that is open.
   */
  ctx.effect(() => installAppBackdrop(document), 'dsh-viewtune: app-wide backdrop');
  /**
   * The skin's reach into the host's conversation page, installed unconditionally and switched on by an
   * attribute on `<html>` (see conversation-glass.ts): nothing applies until the reader turns that switch
   * on, and turning it off is one attribute removal rather than an unpicking of rules.
   */
  ctx.effect(() => installConversationGlass(document), 'dsh-viewtune: conversation glass');
  /**
   * The conversation page's own solid backdrop, installed the same way and switched on by its own
   * attribute: a separate switch from the skin's, because it is about what that page is made of.
   */
  ctx.effect(() => installConversationSolid(document), 'dsh-viewtune: conversation solid page');
  /**
   * The host's goal bar, which is one ellipsised line with no affordance of its own.
   *
   * Two things about it are host facts rather than choices: the bar re-renders with its React tree, so a node this
   * plugin inserted would be dropped and would need re-attaching forever; and it does not exist when this runs. So the
   * control is a delegated click and ONE attribute on `<html>` that the installed stylesheet keys on (see goal-bar.ts).
   */
  ctx.effect(() => installGoalBar(document), 'dsh-viewtune: goal bar expand');
  /**
   * The right sidebar's resource opener, looked up per click rather than once at activation.
   *
   * Service resolution only answers for a provider whose fiber is already active, and this plugin can
   * well be mounted before the sidebar package's own is — a lookup captured during `apply()` would
   * answer "no sidebar" for the rest of the session, which is precisely the bug this replaces. A
   * registry read per click costs nothing worth hoisting for.
   *
   * It stays optional (never added to `inject`) so a host without it still boots, and `open-file.ts`
   * turns its absence into the system opener plus a warning rather than a click that does nothing.
   * Called from inside the handler — the guard pins that — so a late-mounted provider is found.
   */
  const sidebarRightFace = (): SidebarRightFace | undefined => {
    try {
      const face = ctx.get?.('sidebarRight') as SidebarRightFace | undefined;
      if (face !== undefined) return face;
    } catch {
      // A host that never provided it must not break the click.
    }
    try {
      return (ctx as unknown as { sidebarRight?: SidebarRightFace }).sidebarRight;
    } catch {
      return undefined;
    }
  };

  /**
   * 侧边栏只有「开始」页时，让这次打开**替换**掉它 ✓ —— 打开文件与打开审查页共用这一小段 ✓。
   *
   * `replaceTab` 是宿主文档里的"take this tab's place … and close it in the same step" ✓；任何不确定都不动 ✓（拿不到
   * tab 列表、多于一个、或那一个不是 guide ⇒ `replaceableGuide` 给 undefined ✓）。face 的方法按其文档"会响亮地失败" ✓，
   * 所以整段包在 try 里 ✓ —— 读不到状态绝不能挡住"打开"这件事本身 ✓。
   */
  const guideReplacement = (sessionId: string): { replaceTab?: string } | undefined => {
    try {
      const replaceTab = replaceableGuide(sidebarRightFace()?.tabsIn?.(sessionId), sidebarRightFace()?.active?.());
      return replaceTab === undefined ? undefined : { replaceTab };
    } catch (error) {
      console.warn('[dsh-better-display] sidebar guide check failed:', error);
      return undefined;
    }
  };
  ctx.slots.inject('conversation.view', function* () {
    yield ctx.slots.register({
    name: 'conversation.view',
    id: 'reader',
    order: -5,
    label: () => '阅读',
    locale: 'chat',
    children: { 'dsh-better-display.block': { kind: 'chain', scope: 'session' } },
    store,
    inject: (sessionId: SessionId): ReaderInjected => {
      const session = () => {
        const current = ctx.sessions.binding(sessionId)?.session;
        if (!current) throw new Error('阅读页对应的会话已关闭。');
        return current;
      };
      return {
        loadOlder: async () => { await session().loadOlder(); },
        loadImage: async attachment => {
          const receipt = await session().readAttachment(attachment.attachmentId);
          if (!receipt.ok) throw new Error(receipt.error.message);
          return { data: Uint8Array.from(receipt.value.data), mediaType: receipt.value.attachment.mediaType };
        },
        openFile: async (path: string, options?: { mode?: DeliverableOpenMode }) => {          try {
            const cwd = ctx.sessions?.list?.getSnapshot?.()?.byId[sessionId]?.cwd;
            // The system opener is the default and the fallback; the sidebar is opt-in per reader, and
            // the reader's own subscription hands the choice down as `options.mode` — this face cannot
            // read it for itself (`createReaderStore()` is a handle, not a live instance).
            const sidebar = sidebarRightFace();
            const openSidebar = typeof sidebar?.openResource === 'function'
              ? (address: string) => { sidebar.openResource!(address, guideReplacement(sessionId)); }
              : undefined;
            const openExternal = async (absolutePath: string) => {
              // `remote` and `remote.session` are services in 0.2.0 (`ctx.get`), and the plugin already declares both in
              // its `inject` list. What is gone is the typed `ctx.remote` PROPERTY 0.1.5 exposed: reading it as a
              // property is what the compiler rejects, and the two lookups below are the same service either way.
              const remote = ctx.get?.('remote') as unknown as { session?: RemoteSessionFace } | undefined;
              const remoteSession = (ctx.get?.('remote.session') as unknown as RemoteSessionFace | undefined)
                ?? remote?.session;
              if (remoteSession?.openWorkspacePath) {
                const result = await remoteSession.openWorkspacePath({ path: absolutePath });
                if (!result?.ok) {
                  console.warn('[dsh-better-display] openWorkspacePath failed:', result?.error?.message);
                }
              } else {
                console.warn('[dsh-better-display] remote.session is not available');
              }
            };
            await openDeliverableFile({
              path,
              mode: deliverableOpenModeOf(options?.mode),
              sessionId,
              cwd,
              resolveWorkspacePath,
              openExternal,
              openSidebar,
              warn: (message, extra) => { console.warn(message, extra); },
            });
          } catch (error) {
            console.warn('[dsh-better-display] openFile error:', error);
          }
        },
        /**
         * 打开**宿主自己的**「改动审查」页 ✓ —— 也就是对话页那张「已编辑 x 个文件」卡的点击所做的事 ✓。
         *
         * 卡片本体 import 不到 ✓（那些包只导出 `apply`/`inject` ✓，而且那张卡的 slot 占位需要它自己内部的 store ✓），
         * 但它的**资源地址**是公开约定 ✓：`dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>` ✓ ⇒ 交给
         * `openResource` 之后，**宿主自己**画出那份审查 ✓（原封不动 ✓）。读者用「小功能 → 差异在侧边栏审查」在它与本页
         * 面板之间切换 ✓（默认本页面板 ✓）。
         */
        openChangesReview: (coordinates: { sessionId: string; seq: number; turn: number }) => {
          try {
            const sidebar = sidebarRightFace();
            if (typeof sidebar?.openResource !== 'function') {
              console.warn('[dsh-better-display] sidebarRight is not available for the changes review');
              return;
            }
            sidebar.openResource(changesReviewAddress(coordinates), guideReplacement(coordinates.sessionId));
          } catch (error) {
            console.warn('[dsh-better-display] openChangesReview error:', error);
          }
        },
        revealFile: async (path: string) => {          try {
            const cwd = ctx.sessions?.list?.getSnapshot?.()?.byId[sessionId]?.cwd;
            const targetPath = resolveWorkspacePath(cwd, path);
            // 1. Try dedicated host endpoint for native file highlighting (open -R / explorer /select)
            try {
              const res = await fetch('/better-display/reveal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: targetPath }),
              });
              if (res.ok) {
                const data = await res.json();
                if (data.ok) return;
              }
            } catch {
              // Server endpoint not yet available, fallback to directory open
            }

            // 2. Fallback to official opener with parent directory
            const parentDir = dirname(targetPath);
            const remote = ctx.get?.('remote.session') as unknown as RemoteSessionFace | undefined;
            if (remote?.openWorkspacePath) {
              await remote.openWorkspacePath({ path: parentDir });
            }
          } catch (error) {
            console.warn('[dsh-better-display] revealFile error:', error);
          }
        },
        forkAt: (seq: number) => {
          // A missing anchor would silently fork the whole session instead of
          // the intended turn prefix, so refuse it loudly rather than guessing.
          if (typeof seq !== 'number' || !Number.isFinite(seq)) {
            console.warn('[dsh-better-display] fork refused: missing anchor seq');
            return;
          }
          try {
            const sessionsApi = ctx.sessions as unknown as {
              fork: (arg: { sessionId: string; atSeq: number; increaseTitle: boolean }) => Promise<string>;
              open: (sessionId: string) => void;
            } | undefined;
            if (sessionsApi?.fork) {
              sessionsApi.fork({ sessionId, atSeq: seq, increaseTitle: true })
                .then(childId => { sessionsApi.open?.(childId); })
                .catch(err => { console.warn('[dsh-better-display] fork failed:', err); });
            }
          } catch (error) {
            console.warn('[dsh-better-display] forkAt error:', error);
          }
        },
        loadThrough: async (seq: unknown) => {
          try {
            const current = session() as unknown as { loadThrough?: (seq: unknown) => Promise<void> };
            if (typeof current?.loadThrough === 'function') {
              await current.loadThrough(seq);
            } else {
              await session().loadOlder();
            }
          } catch (error) {
            console.warn('[dsh-better-display] loadThrough error:', error);
          }
        },
        fillComposer: (text: string) => {
          // Sanctioned path: the conversation input shell owns the Lexical
          // editor, so setDraft lands in the draft store deterministically.
          try {
            const conversation = (ctx as unknown as { conversation?: ConversationFace }).conversation;
            const shell = conversation?.input?.shell?.(sessionId);
            if (shell && typeof shell.setDraft === 'function') {
              shell.setDraft(text);
              return true;
            }
          } catch {
            // Fall through to the DOM path below.
          }
          try {
            return fillComposerDom(text);
          } catch {
            return false;
          }
        },
      };
    },
    }, Reader);
    yield installReaderEntry(ctx);
  });
}
