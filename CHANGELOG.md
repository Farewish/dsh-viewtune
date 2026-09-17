# Changelog

## 0.3.0-relayout.4

- **吸顶泳道**：阅读页的工具栏（「阅读 · 原始记录完整保留」+ 开关）固定在阅读列顶部；每一轮的过程状态行（「正在使用工具」/「用时 X 秒」那个折叠开关）在该轮范围内固定在工具栏**下方**，滚过长轮次时始终能看到当前状态。两行都带底色，内容从下方滚过而不是穿透；状态行的偏移量取工具栏的**实测高度**（`--reader-toolbar-height`），所以标签换行时不会重叠。同一条链上的 `.root` / `.turn` / `.mainFlow` 取消裁剪——祖先一旦形成裁剪盒，`sticky` 就失效。

  与上游的差别：上游的吸顶是叠在它那次「工具栏整行、无分割线、右对齐」的布局改版上的；本仓库**只取吸顶**，保留原有的工具栏外观与那行说明文字。

- **修复：步骤胶囊消失**。上一条清理把死分支里的 `const loaded` 一起删掉，却漏了标签条件里对它的引用（`answer !== null && loaded !== null`），于是渲染时抛 `ReferenceError`；而胶囊自带错误边界把这个异常吞掉、只在控制台留一条 warning，症状就成了「胶囊直接不见了」。两处引用已改为 `total`，并新增 `check-pill-scope.mjs`（配有 `selftest-pill-scope.mjs` 自证有效）来挡住这一类「声明被删、使用还在」。

- **步骤气泡的弹层不再有那句免责说明**（「这里只有事件序号与计数：当前协议不为单个步骤提供名称或时间…」）。同一次清理还移除了三处不可达分支：截断即不渲染之后，`loaded` 别名与两个仍在测试 `truncated` 的标签永远不会走到，留着只会让人以为还有「部分计数」这条路。

- **历史补全已移除**：它在当前 DSH 上不可实现——分页只能走 `Session.prependWindow`，而宿主自己的 `system-message` 定义在该路径上对一个已产出过的目标返回 `null`，装配器据此抛错（`withdrew materialized target`）。插件侧只有 `loadOlder()` / `loadThrough()` 两个入口，调用即触发。三次尝试（单页 / 循环到看起来完整 / 循环到第 1 步出现）都只是换一种方式踩同一个缺陷，实现已全部删除，只保留手动「加载更早记录」按钮；被截断的轮次按原样呈现。详见 README。

- **The steps pill stays away for a truncated turn**: the history window cuts into
  older turns, so their step count is a partial sum while the process record reports the
  absolute step the answer landed on. The two are not comparable, and rather than show a
  number with a caveat the pill renders nothing for those turns — the same treatment the
  usage/duration pills already get. Complete turns are unchanged.

- **Steps pill in the answer's action row**: between the usage/duration pills and the
  closing clock, a `N/M 个步骤` pill opens the turn's process record rendered in
  Chinese — the answer's step and the turn's total steps, what came before the answer
  (messages, tool calls, subagents, whether thinking sat inline), and the process
  start/answer anchor event numbers.

## 0.3.0-relayout.3

Relayout fork of [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display) (MIT).

- **Short thinking is framed too**: dropped the rule that removed the border/background for a non-overflowing transcript; the box still sizes to its content and has no fold/expand control.
- **Frame padding** for the short-reasoning card: heading `10px 16px 0`, text `8px 16px 16px`, matching long reasoning.
- **Wheel handoff from the reasoning area**: once the transcript reaches the edge it is being pushed against, the wheel scrolls the conversation; a short transcript never intercepts the wheel.
- **Every user/context message renders above the process disclosure**: a turn may open with a system prompt and carry several user/steering messages; they now all render before the disclosure, so turns read `用户的话 → 用时（可点击）→ 思考/回答` with or without a system prompt.
- Unchanged from upstream: turn child order, the elapsed-time pill in the answer's action row, and the disclosure label's `用时 X 秒` text.
- **Installs under its own name**: `cordis.patch.yml` resolved its loader row to upstream's package name, which this profile no longer installs, so the Host refused to boot (`Cannot find package 'dsh-better-display' imported from …/profiles/web/`). The row now resolves `dsh-better-display-reforged`.
- **Boots under the fork's own package name**: the client bundle still registered itself as `dsh-better-display`, while the Host derives the client row id from the installed manifest (`dsh-better-display-reforged`) and refuses a bundle that registers anything else — DeepSeek Harness 0.1.5-rc.1/rc.2 failed the whole page with `bundle … loaded without registering "dsh-better-display-reforged" via __ModuleLoader__.load`. The bundle (and its CSS-ownership tags, which HMR matches by plugin id) now carry the package name; `tsdown.config.ts` reads it from `package.json` so a rebuild cannot drift again.

## Upstream releases

Stock DeepSeek Harness install: `dsh plugin --profile web add github:aa2246740/dsh-better-display`, then restart that Host and reload. Ships `dsh.bundle.patch` → `cordis.patch.yml` and committed `lib/`. No `prepare`.

### 0.2.1

- **Rail jump no longer lifts the composer**: the right-hand turn rail lands on `[data-conversation-scroll]` the same way official ChatView does. `scrollIntoView` was also scrolling ancestor boxes, so jumping to the top of history and then back to the latest turn left the sticky input card stranded up the column.

## 0.2.0

Adds native generative MCP Apps (SEP-1865) support and rich interactive rendering.

- **Generative MCP Apps**: auto-detect ````mcp-app` code blocks (or `mcp-app` custom blocks / `render_ui`/`show_widget` tool results) and mount them as live, interactive cards.
- **Sandboxed iframe**: `sandbox="allow-scripts allow-forms"` without `allow-same-origin`, `referrerPolicy="no-referrer"` — full isolation from host cookies/tokens/DOM.
- **SEP-1865 JSON-RPC bridge**: `ui/initialize`, `ui/resize`, `ui/submit` / `ui/update-model-context`, plus live `host-context-changed` theme broadcasts.
- **Bidirectional feedback**: user interactions produce a natural-language prompt written straight into the composer via React 18 native setter (instant, no stale-DOM whitespace).
- **Live dark/light sync**: MutationObserver + matchMedia drive instant re-theming with zero first-frame flash.
- **Pixel-perfect auto height**: content-bottom bounding-box measurement + ResizeObserver; 60px–2400px smooth grow/shrink, no double scrollbars or wasted whitespace.
- **Redesigned minimal container**: removed protocol/status chrome, 14px-radius subtle card, icon-only reset.
- **Skill pack**: `skills/generative-mcpapps/` with SKILL.md, protocol reference, HTML boilerplate template, and interactive quiz example.
- **Docs**: bilingual `README.md` / `README.en.md`; DESIGN.md contract updated.
- 49 regression tests.

## 0.1.0

First public release of the accepted reading-view plugin, published as `dsh-better-display`.

- Native context and tool details with source-ordered, unmodified reasoning.
- Bounded long-reasoning cards with two-line following, expanded follow and manual pause/resume.
- Successful-turn process folding with a separate final answer.
- Source-ordered text reveal and quiet busy-state shimmer.
- Stable status typography and compact disclosure spacing.
- Native content fallbacks and a trusted-plugin block extension slot.
- 42 regression tests; no changes to DSH Agent, SDK, providers or core.
