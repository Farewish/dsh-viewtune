/**
 * The DSH client-bundle preset, vendored so this repository can build its own artifact.
 *
 * Provenance: this is a trimmed port of the official preset
 * `<harness>/packages/client/tsdown.client.ts` (function `clientBundle`) at tag
 * `dsh-v0.1.5-rc.2` of `deepseek-ai/deepseek-harness`. That preset is what upstream's
 * `externalClientBundle` wrapped, and it is NOT published as a package, so an out-of-tree
 * plugin has to carry its own copy — the same conclusion an independent DSH plugin survey
 * reached ("仓外 browser plugin 需要自行复刻该构建").
 *
 * Why a copy rather than a dependency: the contract it emits is the browser module-table
 * handoff. `lib/client.js` must call `window.__ModuleLoader__.load({ id, factory })` with a
 * CJS factory, and it must inline every dependency except the platform modules the shell
 * shares. Getting that shape wrong does not degrade gracefully — the browser refuses a
 * bundle that registers the wrong id, and a `require()` the table cannot answer throws at
 * factory execution.
 *
 * Three harness-internal imports were replaced, and nothing else changed:
 *   - `PLATFORM_MODULES` / `PRELOADED_CLIENT_EXTERNALS` (was `packages/client/web/src/platform.ts`)
 *     are inlined below with the source tag recorded;
 *   - `clientBuildEnvironmentDefines()` (was `scripts/client-build-environment.ts`) is dropped:
 *     it stamps harness build metadata, which this repository does not consume;
 *   - `optionalStringArray()` (was `packages/client/modules/src/client/manifest.ts`) is inlined
 *     as a two-line validator.
 *
 * Two deliberate divergences from the ported source:
 *   - the client bundle is built from `src/client/index.tsx` instead of `lib/types/client/index.js`,
 *     so the sourcemap points at the TypeScript sources rather than at a tsc intermediate;
 *   - the tsc-map chaining plugin (`dsh-tsc-sourcemap`) exists only for that intermediate and is
 *     therefore absent.
 *
 * Verification: the emitted wrapper is line-for-line the same as the committed artifact's, and
 * the repository's guard suite (19 assertions over the built bytes) is the acceptance test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { transform } from 'lightningcss';

/** Module specifiers the shell shares into the frozen module table.
 *  Source: `packages/client/web/src/platform.ts` @ `dsh-v0.1.5-rc.2`. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

/** Client-bundle specifiers whose factories the parser preloads before the shell starts.
 *  Source: `packages/client/web/src/platform.ts` @ `dsh-v0.1.5-rc.2` (empty there too). */
const PRELOADED_CLIENT_EXTERNALS = [];

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. The suffix
 * matters: tsdown's guard matches ids ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:';
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:';
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:';
const CSS_VIRTUAL_SUFFIX = '.mjs';
const INLINE_CSS_QUERY = '?inline';

/**
 * Contract layers and pure folds a client bundle may inline: browser-safe values with no
 * runtime identity to share (no Symbol/instanceof/singleton state). Everything else under
 * `@deepseek-ai/*` is either a module-table entry (external) or a leak the purity gate rejects.
 */
const INLINE_SAFE =
  /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-agent-presets\/display$|@deepseek-ai\/dsh-spill-policy\/notice$)/;

/** Vendored framework libraries rescoped into `@deepseek-ai`, so the gate would read them as
 *  plugin packages: ordinary libraries a browser bundle inlines, with no shared identity. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/;

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/;

const REPOSITORY_ROOT = resolvePath(fileURLToPath(new URL('..', import.meta.url)));

/**
 * A repository-relative, forward-slashed id for a physical stylesheet.
 *
 * The region comment rolldown prints around each module is its virtual id, so an absolute
 * path here ends up in the committed artifact. Both alternatives are known-bad: the official
 * preset leaves the absolute path in, and this repository's committed `lib/client.js` leaks
 * the upstream author's checkout (`/Users/wu/Documents/DeepSeekHarness/plugins/...`). A
 * relative id keeps the artifact portable and the diff reviewable, and it is the reason the
 * ported config no longer needs a post-build path-rewriting plugin.
 */
function portableId(file) {
  const rel = relative(REPOSITORY_ROOT, file).split(sep).join('/');
  // A stylesheet outside the repository cannot be named portably; keep the absolute path so
  // the failure is visible in the diff instead of silently collapsing two files into one id.
  return rel.startsWith('..') ? file : rel;
}

/** Map a portable stylesheet id back to the file on disk. */
function portableIdFile(id) {
  return isAbsolute(id) ? id : resolvePath(REPOSITORY_ROOT, id);
}

/** Emit one plugin-owned style injector and an optional CSS Modules export. */
function styleInjectionModule(id, fileId, css, classMap) {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ];
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`);
  return source.join('\n');
}

/** Validate an optional `string[]` manifest field (inlined `optionalStringArray`). */
function optionalStringArray(subject, field, value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`client bundle: ${subject}'s ${field} must be an array of strings`);
  }
  return value;
}

/** Module-table specifiers one `dsh.client` declaration requests. Matching is exact, never
 *  normalized: a package declares the specifier its own code imports. */
export function requestedExternals(subject, declaration) {
  return new Set(optionalStringArray(subject, 'dsh.client.external', declaration.external) ?? []);
}

const manifestCache = new Map();
const clientExternalCache = new Map();

/** Read this repository's own manifest (the ported source globbed a workspace instead). */
function repositoryManifest() {
  const cached = manifestCache.get('self');
  if (cached !== undefined) return cached;
  const manifest = JSON.parse(readFileSync(resolvePath(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  manifestCache.set('self', manifest);
  return manifest;
}

/** Module-table specifiers one package requests: the shell baseline plus its own declaration. */
function clientExternals(id) {
  const cached = clientExternalCache.get(id);
  if (cached !== undefined) return cached;
  const externals = new Set([
    ...PLATFORM_MODULES,
    ...PRELOADED_CLIENT_EXTERNALS,
    ...requestedExternals(id, repositoryManifest().dsh?.client ?? {}),
  ]);
  clientExternalCache.set(id, externals);
  return externals;
}

/** Whether an import specifier is the package a pattern names, or one of its subpaths. */
function escapeSpecifier(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesSpecifier(patterns, specifier) {
  return patterns.some((pattern) => pattern.test(specifier));
}

/** External patterns for the Node half: its own production sections, subpaths included. */
function productionExternals(id) {
  const manifest = repositoryManifest();
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  return [...names].sort().map((name) => new RegExp(`^${escapeSpecifier(name)}(/|$)`));
}

/** The Node half: a real ESM entry the Host Loader imports from the installed package. */
function clientLibraryConfig(id, libEntry, overrides = {}) {
  const patterns = productionExternals(id);
  const isProductionDependency = (specifier) => matchesSpecifier(patterns, specifier);
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      // The Node half runs from a real install: a production dependency is on disk there and
      // stays an import, everything else inlines. Stating both halves takes the artifact off
      // tsdown's getProductionDeps fallback, where moving a dependency between npm sections
      // would silently re-bundle it. Builtins keep tsdown's own handling.
      neverBundle: isProductionDependency,
      alwaysBundle: (specifier) => !isBuiltin(specifier) && !isProductionDependency(specifier),
    },
    ...overrides,
  };
}

/** The browser half: the lazy-CJS factory the module table registers. */
function clientConfig(id, entry) {
  const isRequested = (specifier) => clientExternals(id).has(specifier);
  return {
    name: `${id}/client`,
    entry: { client: entry },
    // Browser bundle lands next to the node half (single lib/ artifact dir; the
    // entryFileNames pin keeps it exactly lib/client.js). clean must stay off — a default
    // clean would wipe the node-half output emitted above.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Types ship from lib/types (tsc); dts here would wrap the banner/footer into .d.cts and
    // break parsing.
    dts: false,
    // Plugin code is fetched outside Vite's module graph, so its own bundle must carry the
    // TS/TSX mapping consumed by browser profiling tools.
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isRequested,
      // Anything NOT requested from the loader module table must inline (wire/type layers,
      // zod, clsx — every non-shared dep). A require() the table cannot answer is a guaranteed
      // runtime throw, so the rule is the package's own request list: requested specifiers stay
      // imports, everything else is bundled.
      alwaysBundle: (specifier) => !isRequested(specifier),
    },
    // Dual-mode libraries resolve their static flavor matching the NODE_ENV the defines below
    // bake in; a CJS bundle cannot carry a top-level await.
    inputOptions: {
      resolve: {
        conditionNames: [
          (process.env.NODE_ENV ?? 'production') === 'development' ? 'development' : 'production',
          'browser', 'import', 'module', 'default',
        ],
      },
    },
    // Browser bundles inline node-idiom deps (zustand/immer read process.env.NODE_ENV;
    // zustand's esm build also probes import.meta.env.MODE, which a CJS output cannot carry —
    // rolldown flags EMPTY_IMPORT_META). The bare `import.meta.env` key is required alongside
    // the precise MODE key, because a truthiness probe would otherwise survive as an empty
    // import.meta.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [
      {
        // Bundle purity gate (build-time mirror of the module-edge rules): the baseline and
        // package-specific requests stay external, inline-safe wire layers inline, and every
        // other @deepseek-ai value import is a build error — a cross-plugin value import either
        // inlines a duplicate runtime instance or requires a specifier the module table cannot
        // answer for this package. Cross-plugin collaboration goes through cordis services.
        name: 'dsh-client-bundle-purity',
        resolveId(source) {
          if (!source.startsWith('@deepseek-ai/')) return null;
          if (isRequested(source)) return null; // requested module-table row: external wins
          if (VENDORED_LIBRARY.test(source)) return null; // vendored library: inline, no shared identity
          if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null; // wire contribution
          throw new Error(
            `client bundle purity: "${source}" is not in the default client externals or ${id}'s `
            + 'dsh.client.external, an inline-safe wire layer, or a generated /remote contribution — '
            + 'cross-plugin value imports are forbidden; declare a non-default module request or '
            + 'collaborate through cordis services (type-only imports are erased and never reach this gate)',
          );
        },
      },
      {
        name: 'dsh-css-modules-inline',
        resolveId(source, importer) {
          if (!source.endsWith('.module.css')) return null;
          const abs = importer !== undefined ? sourceAssetPath(source, importer) : source;
          return CSS_VIRTUAL_PREFIX + portableId(abs) + CSS_VIRTUAL_SUFFIX;
        },
        async load(virtualId) {
          if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null;
          const fileId = portableIdFile(virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length));
          // The virtual id otherwise hides the physical stylesheet from Rolldown's watch graph.
          this.addWatchFile(fileId);
          const source = await readFile(fileId);
          const { code, exports: cssExports } = transform({
            filename: fileId,
            code: source,
            cssModules: { pattern: '[hash]_[local]' },
            minify: true,
          });
          const classMap = {};
          const exportEntries = Object.entries(cssExports ?? {})
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
          for (const [local, exp] of exportEntries) classMap[local] = exp.name;
          return styleInjectionModule(id, fileId, code.toString(), classMap);
        },
      },
      {
        name: 'dsh-css-text-inline',
        resolveId(source, importer) {
          if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null;
          const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length);
          const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet;
          return INLINE_CSS_VIRTUAL_PREFIX + portableId(abs) + CSS_VIRTUAL_SUFFIX;
        },
        async load(virtualId) {
          if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null;
          const fileId = portableIdFile(virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length));
          this.addWatchFile(fileId);
          const source = await readFile(fileId);
          const { code } = transform({ filename: fileId, code: source, minify: true });
          return `export default ${JSON.stringify(code.toString())};`;
        },
      },
      {
        name: 'dsh-css-global-inline',
        resolveId(source, importer) {
          if (!source.endsWith('.css') || source.endsWith('.module.css')) return null;
          const abs = importer !== undefined ? sourceAssetPath(source, importer) : source;
          return GLOBAL_CSS_VIRTUAL_PREFIX + portableId(abs) + CSS_VIRTUAL_SUFFIX;
        },
        async load(virtualId) {
          if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null;
          const fileId = portableIdFile(virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length));
          this.addWatchFile(fileId);
          const source = await readFile(fileId);
          const { code } = transform({ filename: fileId, code: source, minify: true });
          return styleInjectionModule(id, fileId, code.toString());
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  };
}

/** Resolve an import specifier against the importing module, honouring the `.js` -> `.ts`
 *  rewrite this repository's sources use for ESM-style relative imports. */
function sourceAssetPath(source, importer) {
  const resolved = resolvePath(dirname(importer), source);
  if (existsSync(resolved)) return resolved;
  // Sources import `./x.js` while the file on disk is `./x.ts`/`./x.tsx`.
  if (resolved.endsWith('.js')) {
    for (const extension of ['.ts', '.tsx']) {
      const candidate = `${resolved.slice(0, -3)}${extension}`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return resolved;
}

/**
 * Build both halves of one client plugin package.
 *
 * Signature matches this repository's `tsdown.config.ts` call site. The ported preset
 * selected between them through `DSH_BUILD_FACE` and a workspace layout; this repository
 * builds one package, so both configs are returned together and tsdown runs them in order.
 *
 * @param id - package name, stamped into the module-table handoff and the style tags.
 * @param libEntry - Node-half entries (the Host Loader imports these).
 * @param options - `clientEntry` for the browser half.
 * @returns tsdown configs for the Node half followed by the browser half.
 */
export function externalClientBundle(id, libEntry, options = {}) {
  const lib = clientLibraryConfig(id, libEntry, options.lib);
  const client = clientConfig(id, options.clientEntry ?? 'src/client/index.tsx');
  return [lib, client];
}
