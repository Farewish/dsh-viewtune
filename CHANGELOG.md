# Changelog

## 0.3.0-relayout.9

- **工具栏与「收起」的外观**：工具栏的**高度由 `min-height: 42px` 明确给定**，靠 `align-items: center` 把两个开关居中——所以「收起」上下各有 **4px** 余量，而不是让容器和药丸碰巧对上。字号从 `12px/18px` 提到 `14px/22px`，内边距 `2px 10px` → `5px 14px`（圆角仍是 `999px`）。工具栏加了 `border-bottom: 1px solid var(--dsw-alias-border-l1)` 作分界线。
- **左右位置没动**：工具栏的 `justify-content: space-between` 与**零横向内边距**都没改，所以「收起」仍贴左、「动效」仍贴右。
- 这四条外观选择现在是**可算的**，不是只写在文件里：`test-toolbar-geometry.mjs` 把产物里的 CSS 字面量求值后，按 CSS 的规则展开 `padding` 简写并**算**出药丸高度与余量（药丸 34px 落在 42px 车道里 → 每侧 4px），还会挡住「余量被吃光」「横向内边距被悄悄加上」这类回归。

## 0.3.0-relayout.8

- **「收起」改为只收起当前这一轮**。此前它把页面上所有展开的过程一起折起来；现在一个「对话」就是**一轮**（提问 + 回复），按钮只作用于读者**正在看的那一轮**。判定「正在看哪一轮」用的是阅读滚动本来就在用的那条谓词——**第一个底边还没越过滚动视口顶边的轮次**，所以视口同时横跨两轮时，落在**上面那一轮**（这正是约定的规则）。两个地方共用同一个定义，就不会出现「滚动锚点认为在这儿、收起按钮认为在那儿」。
- 该谓词抽成了具名函数 `currentTurnOf(content, viewportTop)`，因此可以**单独跑测试**：`test-current-turn.mjs` 用假 DOM 跑 8 条，含「横跨两轮取上面那个」「已滚出视口的轮次跳过」「`unresolved` 分组永不算当前」「都不可见时没有当前轮」。
- 按钮的出现条件随之变成「**当前这一轮**有展开的过程」，所以滚动到一轮已折叠的对话时按钮会自己淡出。文案的悬停提示改为「收起当前这一轮的过程」。
- 测量放在 `useLayoutEffect` 里，`scroll` 事件用 `requestAnimationFrame` 限流，并且只有当**当前轮真的换了**才写 state（`previous === next ? previous : next`），所以长对话里滚动不会每帧重渲染。

## 0.3.0-relayout.7

- **工具栏装回吸顶，状态行不装**。relayout.6 把两条泳道一起撤了，但意图只是不要**状态行**那条：工具栏承载「收起」和「动效」两个开关，滚到深处够不到就等于没有。现在只有 `.toolbar` 是 `position: sticky; top: 0; z-index: 9` + 底色，过程状态行照旧随内容滚走。
- **清掉只为状态行而存在的三样东西**，它们没有别的消费者：`--reader-toolbar-height` 的实测、那个 `ResizeObserver` 效果与 `toolbarRef`、以及 `.root` / `.turn` / `.mainFlow` 的 `overflow` / `position` 覆盖。第三条尤其值得说明：`.root` 唯一的 `overflow` 声明是 `overflow-anchor: auto`，那是**另一个属性、不形成裁剪盒**，而上游的 `.jumpDock` 本来就在这套祖先链下正常吸顶——所以工具栏吸顶根本不需要动祖先。少这三处覆盖，就少三处与上游的无声分歧。
- 验收判据现在是**形状**而不是「有没有回退」：工具栏那条 sticky 必须在（源码 + 产物）、状态行那条必须 0 次、`reader-toolbar-height` 必须 0 次。见 `check-lane-shape.mjs`（原 `check-sticky-reverted.mjs`，已改名以匹配它真正断言的东西）。

## 0.3.0-relayout.6

- **撤回吸顶泳道**（relayout.4 引入，整体回退）。工具栏不再固定在阅读列顶部，每轮的过程状态行也不再固定在工具栏下方——两者都回到正常文档流，滚过去就滚过去。连同它们的依赖一起移除：工具栏高度的实测（`--reader-toolbar-height` 与那个 `ResizeObserver` 效果），以及为了让 `sticky` 生效而覆盖掉的 `.root` / `.turn` 的 `overflow: visible`、`.mainFlow` 的 `position: relative`。产物里已无任何 `reader-toolbar-height`。
- 保留的 `.jumpDock`（「跳到最新」）与时间轴轨道的 `sticky` 是上游原有的，与本次改动无关，未动。
- 顺带修掉一处**换装产物时留下的编译痕迹**：插入「收起」开关那次替换，在工具栏 `children` 数组里留下了一段旧缩进和重复的 `/* @__PURE__ */`。它语法合法（`node --check` 一直是通过的），所以不会被解析检查抓到，但已不是编译器会产出的形状，现已清理。
- 这次回退由 `revert-sticky-lanes.mjs` 完成：每个锚点在**源码与产物两处**都必须精确命中一次才写入，产物每改一处即 `node --check`。验收脚本里的吸顶断言已反过来变成「吸顶不在」的断言（`check-sticky-reverted.mjs`、`check-bundle-markers.mjs` 的 forbidden 列表、`verify-reader-css-string.mjs`），其中「产物里不许再出现 `reader-toolbar-height`」是最硬的一条。

## 0.3.0-relayout.5

- **工具栏的固定「收起」开关**：原来那行说明文字（「阅读 · 原始记录完整保留」）连同它的悬停提示一起撤掉，位置留给一个常驻按钮。阅读页默认是**展开**的（运行中/未完成的轮次，以及没有存过选择的历史轮次），所以「回去」是一个**阅读动作**而不是某一轮的开关：只要有任意一轮的过程是展开的，按钮就出现；点一次把当前对话里所有展开的过程一起收起，然后自己向上淡出；再有任何一轮展开时，它从上方淡入。进出是同一条节点上的纯 CSS 动画（`readerCollapseIn` / `readerCollapseOut`），所以关掉动效开关时动画照常播放，只是少了位移；`prefers-reduced-motion` 下同理。
- **`hidden` 不能用 `display:none`**：`hidden` 让按钮脱离无障碍树、无法聚焦，但也正因为它不渲染，`display:none` 会把「收起」的淡出直接吃掉（变成瞬间消失）。所以闲置态保留 `display:inline-flex` 并改用 `visibility:hidden`——退出动画才有东西可动。这条不变量已进验收脚本（`verify-reader-css-string.mjs`），因为在文件里看不出来，只会在浏览器里表现为「动效对不上」。
- **判定「有没有展开」的方式与 `TurnGroup` 逐字一致**（同一个 `expanded[key]` + `boundaryOf` + `processExpanded`），所以被文本选区临时顶开的那一轮也算在内；收起时对这些 key 写 `false`，与手动折叠走同一条 store 路径，因此同样持久化。

## 0.3.0-relayout.4

- **吸顶泳道**：阅读页的工具栏（「阅读 · 原始记录完整保留」+ 开关）固定在阅读列顶部；每一轮的过程状态行（「正在使用工具」/「用时 X 秒」那个折叠开关）在该轮范围内固定在工具栏**下方**，滚过长轮次时始终能看到当前状态。两行都带底色，内容从下方滚过而不是穿透；状态行的偏移量取工具栏的**实测高度**（`--reader-toolbar-height`），所以标签换行时不会重叠。同一条链上的 `.root` / `.turn` / `.mainFlow` 取消裁剪——祖先一旦形成裁剪盒，`sticky` 就失效。

  与上游的差别：上游的吸顶是叠在它那次「工具栏整行、无分割线、右对齐」的布局改版上的；本仓库**只取吸顶**，保留原有的工具栏外观。（那行说明文字已在 0.3.0-relayout.5 撤掉，位置改放固定「收起」开关；**状态行那条泳道已在 0.3.0-relayout.6 撤掉，工具栏那条在 0.3.0-relayout.7 装回**。）

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
