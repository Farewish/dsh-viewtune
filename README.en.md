# dsh-better-display-reforged

[中文](./README.md)

> Based on [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display) (MIT),
> with a few display details in the reading view adjusted. Turn order and the
> elapsed-time pill stay as upstream. See [changes vs upstream](#changes-vs-upstream).
>
> The package name is `dsh-better-display-reforged`, distinct from upstream, so the two
> can coexist in `node_modules` — but never install both into one profile: their bundle
> patches insert the same entry id `dsh-better-display`, which would mount twice.

```sh
# from a local checkout (development; pnpm links a local directory)
dsh plugin --profile web add D:\DSH\Plugin\dsh-better-display-reforged

# or from GitHub
dsh plugin --profile web add github:YOUR_NAME/dsh-better-display-reforged
```

You need official `dsh` (or `npx @deepseek-ai/dsh`) and **pnpm** on PATH. `dsh plugin add` runs pnpm in `$DSH_HOME/profiles/web`. This repo commits built `lib/`, so a git install does not need `prepare` or a profile `allowBuilds` entry.

Then restart that Host and reload the page. `dsh plugin add` writes the profile. It does not hot-load a running process.

Adds a **阅读** tab to DeepSeek Harness. While a turn runs you see steps, thinking, and progress. After a successful turn those collapse and the final answer stays. Native Chat / Trajectory, the composer, model picker, tools, and approvals stay.

A ````mcp-app` fence in the final answer mounts as an interactive card in the reading view, inside `<iframe sandbox="allow-scripts allow-forms">` without `allow-same-origin`. The card can fill the next prompt via JSON-RPC. The skill pack is [`skills/generative-mcpapps/`](skills/generative-mcpapps/).

Targets DeepSeek Harness **0.1.5-rc.2**. Display only. It does not change Agent execution, the SDK, or credentials. Node.js `^22.19.0 || >=24`. New sessions default to reading.

From a local checkout or tarball:

```sh
dsh plugin --profile web add ./dsh-better-display-reforged
dsh plugin --profile web add ./dsh-better-display-reforged-0.3.0-relayout.2.tgz
```

`dsh.bundle` is captured at Host boot. Do not also insert the same row by hand in the profile `cordis.patch.yml`, or it will mount twice.

```sh
dsh plugin --profile web remove dsh-better-display
```

> **Developing this repo, or pushing it to GitHub? Keep it outside `node_modules`**,
> e.g. clone to `D:\repos\dsh-better-display`. When pnpm reinstalls dependencies it
> removes directories under `node_modules` that the profile does not declare, which
> can take the checkout (and its `.git`) with it.

## Changes vs upstream

1. **Short thinking is framed too**: the rule that dropped the border/background when
   the transcript does not overflow is gone, so short reasoning uses the same frame as
   long reasoning. The box still sizes to its content, never scrolls, and has no
   fold/expand control.
2. **Frame padding**: heading `10px 16px 0`, text `8px 16px 16px`, matching long
   reasoning so nothing touches the border.
3. **Wheel handoff from the reasoning area**: once the transcript sits on the edge it is
   being pushed against, the wheel scrolls the conversation instead. A
   non-overflowing (short) transcript never intercepts the wheel.
4. **Every user/context message renders above the process disclosure**: a real turn may
   open with a system prompt and carry several user/steering messages (system prompt,
   the user's message, injected context). They now all render before the disclosure, so
   turns with and without a system prompt read the same:

   ```
   用户的话 → 折叠开关（用时 X 秒，可点击）→ 流程（系统提示词 / 思考卡 / 工具 / 回答正文）
   ```

   The answer's action row (copy / fork / elapsed-time pill / clock) is unchanged.

## Develop

```sh
npm test
npm run typecheck
```

Building the browser half needs a DSH monorepo (the `tools/dshx` client-build adapter
plus `packages/client` sources); this repo keeps upstream's `tsdown.config.ts`.
**The built `lib/` is committed, so installing never builds.**

## License

Display and Markdown pieces come from DeepSeek Harness (MIT). The upstream plugin is
[`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display) (MIT).
Motion is based on [Transitions.dev](https://transitions.dev/). This repo is [MIT](LICENSE).
