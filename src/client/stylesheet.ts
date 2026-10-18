/**
 * Install one plugin-owned stylesheet, replacing a previous copy with the same id.
 *
 * A second activation used to append a second `<style>` with the same rules, and HMR leaves the old
 * one in place until the host runs the disposer. The id is the one marker every installer already
 * writes, so the replacement is local to this plugin and never touches a host stylesheet.
 */
export function stylesheetElement(doc: Document, id: string, css: string): HTMLStyleElement {
  // Test documents are deliberately small; a document without `querySelector` has nothing stale yet.
  if (typeof doc.querySelector === 'function') {
    const stale = doc.querySelector(`style[data-viewtune-style="${id}"]`);
    (stale as { remove?: () => void } | null)?.remove?.();
  }
  const style = doc.createElement('style');
  style.setAttribute('data-viewtune-style', id);
  style.textContent = css;
  doc.head.append(style);
  return style;
}
