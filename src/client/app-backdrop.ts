/**
 * The backdrop, published for the WHOLE app rather than by whichever view happens to be open.
 *
 * Everything the wallpaper puts on `<html>` — the scope attribute, the image, the dim, the chrome — and
 * the scrollbar groove's dial were published from the reading view, because that view is where the
 * wallpaper is chosen and where the geometry gets measured. That is fine until a session opens on
 * another view, and a NEW session opens on the host's conversation view: the reader never mounts, so a
 * reader's saved wallpaper was simply absent until they switched to an older conversation — reported
 * as "a new session doesn't apply the saved settings; switch to an older conversation and it loads".
 * These are global preferences, so they are published from here, once per activation.
 *
 * What this half publishes is the record as it stands, WITHOUT a measurement: window scope wants
 * "cover, centred" anyway, and the view scope's own fit is a refinement the reading view republishes
 * when it is the view that is open. Both ends run; the refinement adds a size and a place to the same
 * values rather than replacing them.
 */
import { GLASS_PARTS, glassValues } from './glass.js';
import { applyScrollbarFill, scrollbarFillOf } from './scrollbar.js';
import { loadHostSettings, subscribeToHostSettings } from './settings-sync.js';
import { wallpaperDimOf, wallpaperNameOf, wallpaperUrl } from './wallpaper.js';
import { applyWindowScope, wallpaperChromeOf, wallpaperScopeOf } from './wallpaper-scope.js';
import type { WindowScopeValues } from './wallpaper-scope.js';

/**
 * What a record asks the document element to carry, or `null` when it holds no wallpaper.
 *
 * A missing or malformed record answers `null` rather than throwing: the same defensive readers the
 * reading view uses decide what each value means, and "no wallpaper" is a legitimate answer for all of
 * them. The image is a `url("…")` because that is what the stylesheet wants, and `wallpaperUrl` is what
 * encodes the name into the host's route.
 */
export function backdropOf(record: Record<string, unknown> | undefined): WindowScopeValues | null {
  const name = wallpaperNameOf(record?.wallpaper);
  if (name === '') return null;
  return {
    scope: wallpaperScopeOf(record?.wallpaperScope),
    image: `url("${wallpaperUrl(name)}")`,
    dim: wallpaperDimOf(record?.wallpaperDim),
    chrome: wallpaperChromeOf(record?.wallpaperChrome),
  };
}

/**
 * The groove's dial out of the same record: the absence of a groove, not a transparent one.
 *
 * The skin has to be ON for the groove to have a value at all, which is the reading view's own rule —
 * with the skin off the host's transparent track is handed straight back.
 */
export function scrollbarFillFrom(record: Record<string, unknown> | undefined): string {
  if (record?.glass !== true) return '';
  return scrollbarFillOf(glassValues(record.glassParts).scrollbar);
}

/** The attribute the document carries while the skin also reaches the host's conversation view. */
export const CONVERSATION_GLASS_ATTRIBUTE = 'data-viewtune-conversation-glass';

/**
 * The attribute the document carries while the conversation page is asked to be a SOLID page.
 *
 * A separate attribute from the skin's, because it is a separate switch: this one says what the page is
 * made of, the other says how much of it shows through. Both are facts about the document, published
 * here for the same reason — the elements they style are the host's, outside anything this view owns.
 */
export const CONVERSATION_SOLID_ATTRIBUTE = 'data-viewtune-conversation-solid';

/**
 * The skin's own gate on `<html>`: set whenever the skin is on, whatever the conversation switch says.
 *
 * It exists for host surfaces that belong to neither view in particular — the composer is the one — and it is an
 * attribute rather than a class for the same reason as the others: the rules that read it style HOST elements from an
 * always-installed stylesheet, so the switch has to be a fact about the document.
 */
export const GLASS_ATTRIBUTE = 'data-viewtune-glass';

/**
 * The dials the conversation rules read, published on the document like the wallpaper's values.
 *
 * Only these three: the conversation page has surfaces of its own — code paper (which every code-shaped
 * component on it paints from one token), the diff paper, and the user's bubble — and nothing else there
 * is ours to repaint. Publishing the rest would make every `--glass-*` in the app resolve from here,
 * which is how a dial grows a side effect nobody asked for.
 */
export const CONVERSATION_GLASS_PROPERTIES: readonly (readonly [string, string])[] = [
  ['--glass-code', 'code'],
  ['--glass-diff', 'diff'],
  ['--glass-user', 'user'],
];

/**
 * Whether the record asks the skin to reach the conversation view.
 *
 * BOTH switches, always: the conversation switch is a sub-option of the skin, so a record with it on and
 * the skin off means the reading view is the only place the skin exists — and the conversation page must
 * not be the one place it survives.
 */
export function conversationGlassOf(record: Record<string, unknown> | undefined): boolean {
  return record?.glass === true && record?.glassConversation === true;
}

/**
 * Publish (or withdraw) the conversation page's gate and its two dials.
 *
 * The gate is an attribute rather than a class on purpose: the rules live in an always-installed
 * stylesheet that styles HOST elements outside this view, so what it switches on has to be a fact about
 * the document, exactly like the wallpaper's own attribute.
 */
export function applyConversationGlass(doc: Document, record: Record<string, unknown> | undefined): void {
  const root = doc.documentElement;
  if (!conversationGlassOf(record)) {
    root.removeAttribute(CONVERSATION_GLASS_ATTRIBUTE);
    for (const [name] of CONVERSATION_GLASS_PROPERTIES) root.style.removeProperty(name);
    return;
  }
  const values = glassValues(record?.glassParts);
  root.setAttribute(CONVERSATION_GLASS_ATTRIBUTE, '');
  for (const [name, part] of CONVERSATION_GLASS_PROPERTIES) {
    root.style.setProperty(name, `${String(values[part])}%`);
  }
}

/**
 * Publish (or withdraw) the conversation page's solid backdrop.
 *
 * One switch, one attribute, and no values of its own: the page is painted in the theme's base colour,
 * which the stylesheet reads directly. Independent of the skin — a reader can have either, both, or
 * neither.
 */
export function applyConversationSolid(doc: Document, record: Record<string, unknown> | undefined): void {
  const root = doc.documentElement;
  if (record?.conversationSolid === true) root.setAttribute(CONVERSATION_SOLID_ATTRIBUTE, '');
  else root.removeAttribute(CONVERSATION_SOLID_ATTRIBUTE);
}

/**
 * Publish (or withdraw) the skin's own gate, and the one dial a host surface outside this view reads from it.
 *
 * `CONVERSATION_GLASS_ATTRIBUTE` also requires the conversation switch; this one is simply "the skin is on", which is
 * what the composer follows — it belongs to the host and is on screen in BOTH views, so neither of the two switches
 * describes it on its own. The dial's value has to live on `<html>` for the same reason it is published at all: the
 * composer is not inside this view, so the reading view's own root variables are not in scope there.
 */
export function applyGlassGate(doc: Document, record: Record<string, unknown> | undefined): void {
  const root = doc.documentElement;
  const part = GLASS_PARTS.find(entry => entry.id === 'input');
  if (record?.glass !== true || part === undefined) {
    root.removeAttribute(GLASS_ATTRIBUTE);
    if (part !== undefined) root.style.removeProperty(part.property);
    return;
  }
  root.setAttribute(GLASS_ATTRIBUTE, '');
  root.style.setProperty(part.property, `${String(glassValues(record?.glassParts)[part.id] ?? part.initial)}%`);
}

/**
 * Publish the app-wide backdrop, and hand back the disposer.
 *
 * The record is read once at activation — BEFORE any view is mounted, which is the whole point — and
 * again after every save, so a reader who changes the wallpaper in the reading view sees the window
 * follow the save rather than the next view switch.
 */
export function installAppBackdrop(doc: Document): () => void {
  const publish = (record: Record<string, unknown> | undefined): void => {
    const values = backdropOf(record);
    // The view scope's fit is MEASURED, by the reading view — which is not mounted in every session. When
    // it has measured, the two properties are already on the document, and this half keeps them: it has
    // no way to take its own measurement, and publishing without them would snap the conversation column
    // back to `cover` on every save. Window scope carries no measurement at all, so nothing is lost there.
    const size = doc.documentElement.style.getPropertyValue('--viewtune-wallpaper-size').trim();
    const position = doc.documentElement.style.getPropertyValue('--viewtune-wallpaper-position').trim();
    applyWindowScope(doc, values === null ? null : {
      ...values,
      ...(size === '' ? {} : { size }),
      ...(position === '' ? {} : { position }),
    });
    applyScrollbarFill(doc, scrollbarFillFrom(record));
    applyConversationGlass(doc, record);
    applyConversationSolid(doc, record);
    applyGlassGate(doc, record);
  };
  // The resting state, stated rather than assumed: with nothing read yet there is no wallpaper, and the
  // host's own track is what the groove hands back.
  publish(undefined);
  // Only a record that was actually read is published; `empty` and a failed read both leave the resting state, which
  // is what the line above already stated.
  void loadHostSettings().then(read => { publish(read.kind === 'stored' ? read.record : undefined); });
  const unsubscribe = subscribeToHostSettings(publish);
  return () => {
    unsubscribe();
    applyWindowScope(doc, null);
    applyScrollbarFill(doc, '');
    applyConversationGlass(doc, undefined);
    applyConversationSolid(doc, undefined);
    applyGlassGate(doc, undefined);
  };
}
