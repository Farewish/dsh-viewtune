# dsh-viewtune

[中文](./README.md)

A **reading** tab for DeepSeek Harness: while a turn runs you can see the process — thinking as it is written, tools as they run, which step it is on. When a turn finishes successfully the process folds away and the final answer stays.

Upstream's Chat / Trajectory tabs, the composer, the model picker, tools and approvals are all untouched; this plugin adds a reading view alongside them.

Targets DeepSeek Harness **0.1.5-rc.2**. Display only — it does not change agent execution, the SDK, or credentials. Node.js `^22.19.0 || >=24`.

## Features

- **The process is visible**: reasoning, tool calls, subagents and progress render live, so a long turn is never just a spinner.
- **Folds itself away when done**: a turn that ends successfully collapses its process and leaves the answer; running or unfinished turns stay open.
- **Short reasoning is framed like long reasoning**: the rule that dropped the border when a transcript did not overflow is gone, and short reasoning now shares the long form's heading and body padding.
- **The reasoning area's wheel belongs to the browser**: the card scrolls natively, and once it is on its edge the whole notch chains up to the conversation, natively. Whatever part of an overshooting notch the card cannot take is dropped (at most one notch, once per gesture) — the price of never taking a notch away from the browser. A short transcript that does not overflow never intercepts the wheel at all.
- **Every user message renders first**: a turn may open with a system prompt and carry several user/steering messages (the system prompt, your message, injected context). All of them render, in source order, above the process disclosure — so turns read the same with or without a system prompt:

  ```
  the user's message → disclosure (用时 X 秒, clickable) → process (system prompt / reasoning / tools / answer)
  ```

- **Wait clock**: while the model is thinking or writing, the status line shows how long this turn has been in its hands — nothing at all for the first three seconds, not even a reserved slot, since a blank gap is worse than the one movement withholding it saves — and past ten seconds a 「暂未响应」 badge. The anchor is the **last handover** — a returned tool, an injected context, a finished command, your own message — never the start of the turn, so a wait that has just begun does not inherit the minutes the tools already spent; a tool that is still running is not a wait, because then the tool is the one working.

- **Toolbar**: 「收起」 and the viewtune settings button sit in one lane at the top of the reading view, spanning it edge to edge like the shell's own header rule while both controls stay at the text's left edge. It **pins directly under the shell's top bar** — part of the outer band rather than something floating over the conversation — so it stays reachable at any scroll depth, and the shortcuts (**Alt+C**, **Alt+Shift+C**) still work.
- **Wallpaper**: the 视效 page's 壁纸 row puts one of your own images behind the reading view. Images live in the plugin's own folder (「打开文件夹」 creates and opens it — drop files in, then 「刷新」 turns them into a thumbnail list); click one to use it, 清除 to go back to none. **The browser is never told where that folder is**: it asks for a name, and the host half answers only for image extensions inside that one folder (no svg). A 压暗 dial beside it mixes the image toward the theme's own background so prose stays readable on top — and with 磨砂玻璃 on, the cards blur exactly this image. The wallpaper covers the **whole window** by default — the transcript, the space beneath it, the scrollbar gutter, and the composer's **fade band** (whose host gradient becomes a mask over the same backdrop, so content still fades out smoothly, just into your picture instead of into a colour), so none of those are left as black blocks. In the reading-column-only scope the image FILLS the reading page: the MAX ratio of image ÷ target — the smallest scale that leaves no unfilled area — centred on the page, with the overflow cropped; a small image is scaled up to fill it, with no cap. **「铺满整个窗口」 is ON by default**: it is what spreads the image to the **left column and the top bar** (whose own plates step aside), switching to `cover` to fill the window — the switch decides whether the image spreads to the other columns and fills, not whether it is painted at all. A **界面遮罩** dial then appears, setting how opaque those two columns stay over their copy of the image — they carry nothing but text, so `0%` is prose straight on a photograph. The image is painted once and the scrim is counted once for the window, so the reading area is never darker than the columns beside it.
- **Settings panel**: the viewtune gear opens a small panel with three pages, 视效 / 功能 / 快捷键 (the arrows, Home and End move between them). 视效 holds one row per preference — 动效, which also reports when the system's reduced-motion setting overrides it, and 磨砂玻璃 (ON by default — these defaults ARE the reader's own settings; the toolbar, cards, tool frames and code blocks stop painting plates of their own so a host wallpaper or skin shows through, and labels like paths and counts stay transparent until hovered or focused — **nine sliders under the switch** set each surface's opacity: toolbar / user bubble / cards and panels / code blocks / diff panel / scrollbar gutter / product chips / usage-and-steps pills / input box — the scrollbar-gutter one gives the rightmost scrollbar a track of its own, where 0% is the host's original transparent track, where `0%` paints nothing at all and `100%` is the opaque plate of the skin-off look, with the reader's own values as the initials. They are grouped by what a surface IS rather than where it sits (diff paper follows the diff-panel slider whether it is drawn in the panel or inline in a tool's result tab), and only surfaces that HAVE a plate are dialled: 「产物标签」 covers the product-file chips at the end of a turn — the one chip that is always present and has a resting plate — the compaction pill rides with the cards, and the usage/steps counters have a dial of their own, and the tool-state label and the `+N -M` count are wired to no dial at all, since neither has a resting background for a transparency control to let through), ; the 功能 page holds **「竖条滚轮」** (on by default: a wheel over the two strips beside the reading column is forwarded to the transcript) and 产物用右侧栏打开 (off by default: delivered files open in the system app; turning it on previews them in the right sidebar through the official `dsh-resource://file/session/<id>/<path>` address and its sidebar service, while folders and reveal-in-folder stay on the OS opener — a host without that service falls back to the system app with a note in the console); 快捷键 records new bindings for this plugin's own two shortcuts (click the key to record, Escape cancels, clearing drops it), refusing combinations without a modifier or ones the browser already owns. A preference is a row, so the lane never grows a control wider. A row whose label does not say it all carries a one-line description on the row's `title` — the browser's own hover box, the same mechanism the button and 收起 use — while genuine state (a system override, a recording in progress, a refused combination) stays written in the row.
- **收起 acts on one turn**: a "conversation" here is one turn (a question and its answer). The button folds the turn the reader is looking at rather than every open turn on the page, and it decides which turn that is with the same predicate the reading scroll uses for its anchor — so a viewport straddling two turns resolves to the upper one.
  **Alt+C** is the keyboard equivalent. If other turns are expanded too, a **「全部收起」** control appears in the toolbar (**Alt+Shift+C**, only while there really is another expanded turn), so you need not scroll back to each one.
  When collapsing makes the button itself disappear, focus moves to **the toolbar's other control** rather than to `<body>`: a keyboard reader is not dropped back to the top of the document for pressing it.
- **Steps pill**: the answer's action row shows which step the answer landed on out of the turn's total, and opens a readable process record rather than raw JSON.
- **Changed-line counts**: a row whose call changed files shows `+N -M` (green added, red removed) at its end, and clicking it opens an in-flow panel with one tab per file, each rendered by the same `DiffBlock` the official tool row uses. The counts prefer the host's own `meta.diffs`, falling back to the call's arguments only for the three tools that actually mutate a file — several unrelated tools carry a field named `content`, and reading that as a file body would invent additions for calls that changed nothing. Files changed by a call's children count toward its row too.
- **Interactive mcp-app cards**: an ````mcp-app` fence in the answer mounts as an interactive card inside `<iframe sandbox="allow-scripts allow-forms">` — **without** `allow-same-origin`. A card can fill the next prompt over JSON-RPC. Skill pack: [`skills/generative-mcpapps/`](skills/generative-mcpapps/).

## Install

You need official `dsh` on PATH (otherwise `npx @deepseek-ai/dsh`) and **pnpm** — `dsh plugin add` runs pnpm inside `$DSH_HOME/profiles/web`.

```sh
# from GitHub
dsh plugin --profile web add github:Farewish/dsh-viewtune

# or from a local checkout / tarball
dsh plugin --profile web add ./dsh-viewtune
dsh plugin --profile web add ./dsh-viewtune-0.4.0.tgz
```

Then **restart the Host** and reload the page: `dsh plugin add` only writes the profile, it does not hot-load a running process.

Remove:

```sh
dsh plugin --profile web remove dsh-viewtune
```

Three things worth knowing:

- `dsh.bundle` is captured at boot. Do not also insert the same row by hand in the profile's `cordis.patch.yml`, or it mounts twice.
- This repo **commits its compiled `lib/`**, so an install needs no `prepare` step and no `allowBuilds` entry.
- Do not run this plugin and upstream `dsh-better-display` at the same time: both bundle patches insert the same entry id, so the two would mount twice. Removing this one with the command above first is what makes going back to upstream clean.

## Known limitations (and what it shows instead)

- **Turns truncated by the history window** show no step *number*. Harness pages by message count, so
  the topmost turn may be only partly loaded; its step count is then a partial sum that cannot be
  compared with the absolute step in the process record, and a misleadingly small denominator is
  worse than none. What appears instead is a **「步骤记录」** marker whose tooltip reads
  **请完全加载该轮次记录后查看** ("load this turn's record fully to see it").
- **Usage is sometimes unavailable, by design**, and it is left absent. The Host reports usage only
  when it can *prove* the turn's accounting exactly (one attempt of that turn carrying no usable
  sample, or the turn sitting in a compacted context, makes it answer "not determinable"). This
  plugin does not guess — and deliberately adds no marker for it: a missing number is a missing
  number, and a second 「用量 —」 marker was judged to be noise rather than information. The
  truncation marker earns its place because it explains *why no number can exist here*; an
  unavailable usage figure has no such position to explain.

The 「步骤记录」 marker is an explanation, not a control: no click target, no hover highlight, and
never an estimated number.

One more thing, **by decision rather than by omission**: **the interface strings are Chinese only.**
The Host offers a locale seat, and this plugin already borrows it to translate two strings the Host
owns (`message.contextRecall` / `message.contextInjection`), but the plugin's *own* strings are not
localized — a full zh/en pass would first need a locale provider edge (and a Host restart). It was
weighed and left out.

## Development

### Building

The browser half is the prebuilt `lib/client.js`, which the Host loads directly. The compiled output is committed, so **installing and sharing need no build** — but **building from source does work**:

```sh
npm ci                # install from the checked-in package-lock.json
npm run build         # src/ -> lib/client.js and lib/dsh-viewtune.js
```

Use `npm ci` rather than `npm install`: `tsdown`, `lightningcss` and `typescript` are all declared in `^`
ranges, so only the lockfile guarantees that another machine installs the same toolchain that
**reproduces the committed `lib/`** — which is exactly what `npm run guard`'s `verify-build` does: it
rebuilds for real and reports `REBUILD REPRODUCES THE SHIPPED SHAPE`. Reach for `npm install` only when
you change a dependency in `package.json`, to write the lockfile back.

Upstream's `tsdown.config.ts` imported `externalClientBundle` from a Harness adapter
(`<harness>/tools/dshx/src/client-build.js`) that is published nowhere, which is why its build could
not run from a clone. This repo vendors that adapter's real body — the official preset
`packages/client/tsdown.client.ts` → `clientBundle()`, Harness tag `dsh-v0.1.5-rc.2` — as
[`scripts/client-bundle.mjs`](scripts/client-bundle.mjs), with its three Harness-internal imports
inlined. The artifact contract is unchanged, so the artifact-level guards below still apply.

Commit `lib/` together with the source: an installer receives the committed artifact and is not asked
to build.

**Type checking does not need that monorepo.** The client UI packages are published standalone on npm, and installing dependencies pulls them in through `peerDependencies` — including `dsh-client-store`, `dsh-client-ui-primitives` and `dsh-client-ui-slots`, which the launcher itself does not carry:

```sh
npm run typecheck     # tsc -p tsconfig.json --noEmit, against the real declarations
```

`lib/` holds only compiled output and the Host entry; this repo **does not publish type declarations** and `package.json` has no `types` field.

### Changing the code

Change `src/`, then `npm run build`. Two identity markers in the artifact must match `package.json`'s `name` exactly, or the whole page fails with
`loaded without registering "<id>" via __ModuleLoader__.load`:

- the row id in `window.__ModuleLoader__.load({ id })` (the Host derives it from the installed manifest's package name);
- each CSS module's `tagId` prefix and its `data-plugin` on the injected `<style>` (HMR removes this plugin's styles by that id).

`tests/stock-install.test.ts` guards both, and also checks that this document's install commands name the package correctly. (`tsdown.config.ts` reads the name from `package.json`, so a rename cannot drift again.)

> **Keep the checkout outside `node_modules`.** `dsh plugin add` runs pnpm inside the profile directory, and pnpm prunes directories under `node_modules` that `package.json` does not declare — the checkout, `.git` included, could be deleted with them.

### Verifying

Two layers, because they answer different questions:

```sh
npm test        # source level: 15 test files through Node's test runner
npm run guard   # artifact level: 19 assertions, all against the built lib/client.js
```

`npm run guard` asserts the **artifact**: the module-table registration id and the `require()` set, that
each injected CSS literal is whole, turn render order, the collapse control's scope and fade, the
toolbar lane shape, that the steps pill declares every identifier it uses — plus the correspondence
between `src/` and the artifact (`compare-source-and-bundle`, `audit-source-edits`) and **"a fresh
build still reproduces the committed shape"** (`verify-build`). That last one is the only form of
source/artifact agreement available here: byte equality is not (the compiler's output is not stable),
so it compares the contract-bearing parts and the stylesheet's rules.

One premise behind all of it is worth stating: **parsing is not correctness.** Much of this repo's
history was editing minified output directly, which produced changes that were syntactically perfect
and still threw at runtime, because a declaration was removed while a use of it stayed. Only a check of
the "is this name declared" kind catches that (`check-pill-scope`) — or building once, which exposes
drift between the sources and the artifact. Both run under `npm run guard`.

## License

MIT, see [LICENSE](LICENSE).

It started from [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display) (MIT), which is where the reading tab, the streaming motion and the Markdown rendering come from. Parts of the display and Markdown layers come from DeepSeek Harness (MIT). Motion is inspired by [Transitions.dev](https://transitions.dev/).
