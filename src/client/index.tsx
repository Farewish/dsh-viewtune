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
import type { DeliverableOpenMode } from './open-file.js';
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
  openResource?: (address: string, options?: { params?: { line?: number } }) => void;
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
        openFile: async (path: string, options?: { mode?: DeliverableOpenMode }) => {
          try {
            const cwd = ctx.sessions?.list?.getSnapshot?.()?.byId[sessionId]?.cwd;
            // The system opener is the default and the fallback; the sidebar is opt-in per reader, and
            // the reader's own subscription hands the choice down as `options.mode` — this face cannot
            // read it for itself (`createReaderStore()` is a handle, not a live instance).
            const sidebar = sidebarRightFace();
            const openSidebar = typeof sidebar?.openResource === 'function'
              ? (address: string) => { sidebar.openResource!(address); }
              : undefined;
            const openExternal = async (absolutePath: string) => {
              const remote = ctx.remote as unknown as { session?: RemoteSessionFace } | undefined;
              const remoteSession = remote?.session
                ?? (ctx.get?.('remote.session') as unknown as RemoteSessionFace | undefined)
                ?? ((ctx.get?.('remote') as unknown as { session?: RemoteSessionFace } | undefined)?.session);
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
        revealFile: async (path: string) => {
          try {
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
            const remote = ctx.remote as unknown as { session?: { openWorkspacePath: (arg: { path: string }) => Promise<{ ok: boolean; error?: { message: string } }> } } | undefined;
            const remoteSession = remote?.session
              ?? (ctx.get?.('remote.session') as unknown as { openWorkspacePath: (arg: { path: string }) => Promise<{ ok: boolean; error?: { message: string } }> } | undefined);
            if (remoteSession?.openWorkspacePath) {
              await remoteSession.openWorkspacePath({ path: parentDir });
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
