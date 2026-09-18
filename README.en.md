# dsh-viewtune

[中文](./README.md)

A **reading** tab for DeepSeek Harness: while a turn runs you can see the process — thinking as it is written, tools as they run, which step it is on. When a turn finishes successfully the process folds away and the final answer stays.

Upstream's Chat / Trajectory tabs, the composer, the model picker, tools and approvals are all untouched; this plugin adds a reading view alongside them.

Targets DeepSeek Harness **0.1.5-rc.2**. Display only — it does not change agent execution, the SDK, or credentials. Node.js `^22.19.0 || >=24`.

## Features

- **The process is visible**: reasoning, tool calls, subagents and progress render live, so a long turn is never just a spinner.
- **Folds itself away when done**: a turn that ends successfully collapses its process and leaves the answer; running or unfinished turns stay open.
- **Short reasoning is framed like long reasoning**: the rule that dropped the border when a transcript did not overflow is gone, and short reasoning now shares the long form's heading and body padding.
- **Wheel handoff from the reasoning area**: once the transcript reaches the edge it is being pushed against, the wheel scrolls the conversation instead. A short transcript that does not overflow never intercepts the wheel at all.
- **Every user message renders first**: a turn may open with a system prompt and carry several user/steering messages (the system prompt, your message, injected context). All of them render, in source order, above the process disclosure — so turns read the same with or without a system prompt:

  ```
  the user's message → disclosure (用时 X 秒, clickable) → process (system prompt / reasoning / tools / answer)
  ```

- **Pinned toolbar**: the toolbar, carrying both switches (收起 and 动效), stays at the top of the reading column while the transcript scrolls under it.
- **收起 acts on one turn**: a "conversation" here is one turn (a question and its answer). The button folds the turn the reader is looking at rather than every open turn on the page, and it decides which turn that is with the same predicate the reading scroll uses for its anchor — so a viewport straddling two turns resolves to the upper one.
- **Steps pill**: the answer's action row shows which step the answer landed on out of the turn's total, and opens a readable process record rather than raw JSON.
- **Interactive mcp-app cards**: an ````mcp-app` fence in the answer mounts as an interactive card inside `<iframe sandbox="allow-scripts allow-forms">` — **without** `allow-same-origin`. A card can fill the next prompt over JSON-RPC. Skill pack: [`skills/generative-mcpapps/`](skills/generative-mcpapps/).

## Install

You need official `dsh` on PATH (otherwise `npx @deepseek-ai/dsh`) and **pnpm** — `dsh plugin add` runs pnpm inside `$DSH_HOME/profiles/web`.

```sh
# from GitHub
dsh plugin --profile web add github:Farewish/dsh-viewtune

# or from a local checkout / tarball
dsh plugin --profile web add ./dsh-viewtune
dsh plugin --profile web add ./dsh-viewtune-0.3.0-relayout.13.tgz
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

## Known limitations

- **Turns truncated by the history window** show no steps pill and no timing/usage. Harness pages by message count, so the topmost turn may be only partly loaded; its step count would then be a partial sum that cannot be compared with the absolute step in the process record. Rather than show a misleadingly small number, nothing is shown.
- **The usage pill is sometimes absent, by design.** The Host only reports usage when it can *prove* the turn's accounting exactly — for instance when one attempt of that turn carries no usable usage sample, or when the turn has not ended yet, it returns "not determinable" instead of an estimate. This plugin follows that stance: it does not guess.

## Development

### Why the build output is committed

The browser half is the prebuilt `lib/client.js`, which the Host loads directly. **Rebuilding it from source needs a full DSH monorepo** (it provides the client build adapter and the `packages/client` sources); this repo follows upstream's `tsdown.config.ts`. Because a build carries that requirement, the compiled output is committed — installing and sharing need no build at all.

Type checking needs the same monorepo (the client UI packages are not published standalone), so `npm run typecheck` cannot run without it. `lib/` holds only compiled output and the Host entry; this repo **does not publish type declarations** and `package.json` has no `types` field.

### Changing the code

When you change display behaviour, **the source in `src/` and the artifact `lib/client.js` have to change together** — the Host loads the artifact. Two identity markers in the artifact must match `package.json`'s `name` exactly, or the whole page fails with
`loaded without registering "<id>" via __ModuleLoader__.load`:

- the row id in `window.__ModuleLoader__.load({ id })` (the Host derives it from the installed manifest's package name);
- each CSS module's `tagId` prefix and its `data-plugin` on the injected `<style>` (HMR removes this plugin's styles by that id).

`tests/stock-install.test.ts` guards both, and also checks that this document's install commands name the package correctly.

> **Keep the checkout outside `node_modules`.** `dsh plugin add` runs pnpm inside the profile directory, and pnpm prunes directories under `node_modules` that `package.json` does not declare — the checkout, `.git` included, could be deleted with them.

### Verifying

`npm test` runs the repo's own tests. Beyond that, this project leans on verification at the artifact level: checking the artifact's structural markers, lifting compiled functions out of it to run behavioural cases against a fake DOM, and booting a throwaway Host to confirm the row id in the module graph matches the id the artifact registers.

One premise behind that is worth stating: **parsing is not correctness.** This repo edits minified output, so it has produced changes that were syntactically perfect and still threw at runtime, because a declaration was removed while a use of it stayed. Only a check of the "is this name declared" kind catches that class of mistake.

## License

MIT, see [LICENSE](LICENSE).

It started from [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display) (MIT), which is where the reading tab, the streaming motion and the Markdown rendering come from. Parts of the display and Markdown layers come from DeepSeek Harness (MIT). Motion is inspired by [Transitions.dev](https://transitions.dev/).
