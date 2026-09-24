import { readFileSync } from 'node:fs';
import type { TsdownPlugin, UserConfig } from 'tsdown';
import { externalClientBundle } from './scripts/client-bundle.mjs';

/**
 * The bundle id must be the *package* name: the Host derives the client row id from this
 * package's manifest, and the browser loader rejects a bundle whose
 * `__ModuleLoader__.load({ id })` differs from that row (every injected <style> is also
 * tagged with it, so HMR can remove this plugin's styles by id). Reading it here keeps a
 * rename from silently breaking the boot again.
 */
const packageName = (JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string }).name;

/**
 * Where the client-bundle preset comes from
 * -----------------------------------------
 * Upstream imported `externalClientBundle` from a prepared Harness checkout
 * (`<harness>/tools/dshx/src/client-build.js`), which is not published anywhere — so a fresh
 * clone could not build. `scripts/client-bundle.mjs` is a vendored port of the official
 * preset that wrapper wrapped (`packages/client/tsdown.client.ts` → `clientBundle`, at tag
 * `dsh-v0.1.5-rc.2`), with its three harness-internal imports inlined. The emitted artifact
 * keeps the same contract, so the guard suite over `lib/client.js` stays valid.
 */
const bundle = externalClientBundle(packageName, ['src/dsh-viewtune.ts'], {
  clientEntry: 'src/client/index.tsx',
}) as UserConfig[];

/**
 * The portability assertion — which, as shipped, could never fail.
 *
 * Upstream rewrote each CSS module's region comment from an absolute path to a relative one and then asserted that none
 * was left. The vendored preset hands lightningcss a repository-relative virtual id in the first place
 * (`scripts/client-bundle.mjs`, `portableId`), so there is nothing left to rewrite; the rewrite is gone and the
 * assertion stays. It could not fire, though: it looked for `\0dshx-css-module:`, the prefix of the build it was ported
 * from, while this one emits `\0dsh-css:` — visible in `lib/client.js` as
 * `//#region \0dsh-css:src/client/McpAppFrame.module.css.mjs`. A check that cannot fail is the one thing this
 * repository's own notes call worse than no check, so the pattern now matches what is emitted (all three CSS virtual
 * prefixes) and fails the build if a stylesheet id ever comes back absolute.
 */
const portableOutput: TsdownPlugin = {
  name: 'dsh-better-display-portable-output',
  generateBundle(_options, output) {
    const client = output['client.js'];
    if (client?.type !== 'chunk') this.error('client.js was not emitted');
    // After the prefix: a drive letter followed by either slash, or a bare leading slash. A relative id starts with a
    // directory name, so neither shape can appear by accident.
    if (/^[ \t]*\/\/#region \\0dsh-(?:css|global-css|inline-css):(?:[A-Za-z]:[\\/]|\/)/mu.test(client.code)) {
      this.error('client.js contains a non-portable CSS module path');
    }
  },
};

export default bundle.map((config) => {
  if (config.name !== `${packageName}/client`) return config;
  const plugins = Array.isArray(config.plugins)
    ? config.plugins
    : config.plugins === undefined
      ? []
      : [config.plugins];
  return { ...config, plugins: [...plugins, portableOutput] };
});
