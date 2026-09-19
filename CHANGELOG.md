# Changelog

## Unreleased

**从源码构建回来了。** 上游的 `tsdown.config.ts` 从一个不对外发布的 Harness 适配器取
`externalClientBundle`，所以克隆出来的仓库构建不了；本仓库把它的真身——官方预设
`packages/client/tsdown.client.ts` 的 `clientBundle()`（Harness tag `dsh-v0.1.5-rc.2`）——
移植成 `scripts/client-bundle.mjs` 并内联了它引用的三处 Harness 内部模块。`npm run build`
现在能从 `src/` 产出 `lib/`，`npm run guard`（18 条针对产物的断言）与 `npm test` 一起构成两层验证。

**类型检查不再需要那份单仓库**：客户端 UI 包在 npm 上是独立发布的，`npm install` 会按
`peerDependencies` 装齐（含 launcher 自己没带的 `dsh-client-store`、`dsh-client-ui-primitives`、
`dsh-client-ui-slots`），`npm run typecheck` 对着真实声明检查。<br>
顺带修掉一处装不出来的缺陷：peer 范围从前写 `^0.1.2-rc.1`，semver 的预发布规则使它**匹配不到**
`0.1.5-rc.2`，于是干净安装拿到的是与本插件目标不同的宿主 API 类型；现在按目标版本声明并钉进 devDependencies。

**重建暴露并修掉的三处漂移**（只有能构建才看得见）：
- 已发布的 `lib/client.js` 在 6 处 CSS 模块 region 注释里带着上游维护者的本机绝对路径
  （`/Users/wu/Documents/DeepSeekHarness/…`）；移植版改用仓库相对路径。
- 已发布的宿主半边 `lib/dsh-viewtune.js` 仍导出 `name = "dsh-better-display"`，而源码早已改名；
  `dshx.yml` 的加载标记也跟着修正。
- `src/client/StepsPill.tsx` 与产物在局部变量名、组件名、以及两处调用次数上不一致；
  重建以源码为准，守卫从此按**源码命名**断言（`scripts/guard/bundle-anchors.mjs`），
  于是这类不一致以后会被守卫直接报出来，而不是等到下一次构建。

**B1：被历史窗口截断的轮次不再静默消失。**
- 这类轮次**仍然不显示任何数字**（偏小的分母会误导），但动作行里会给出 **「步骤记录」** 标记
  （虚线灰标记），悬停提示：**请完全加载该轮次记录后查看**。
- **用量缺失的轮次不加标记**：一度加过一枚「用量 —」，维护者判断不需要——缺数字就是缺数字，
  多一枚标记是噪音。README 的「已知限制」写明了这个取舍。

**B2：收起多了键盘路径与"全部收起"，并且不再把焦点丢掉。**
- **Alt+C** 等价于工具栏的「收起」（只收当前这一轮）。按住 Shift（**Alt+Shift+C**）则收起**全部**已展开的过程；
  工具栏会出现一个 **「全部收起」** 按钮，但**只在真的还有别的展开轮次时**出现——它不是常驻控件，
  也不会改变「收起」本来只作用于当前这一轮的决定。
- **焦点交接**：收起之后按钮自己会隐藏，而隐藏元素无法持有焦点——键盘读者会被丢回 `<body>`。
  现在会先把焦点交给工具栏的另一个控件（动效开关），不会掉出工具栏。
- 两处快捷键只有在"确实有可收的东西"时才 `preventDefault`，否则浏览器自己的绑定不受影响；
  `Alt` 修饰键是为了不和输入框抢按键（裸字母会被正在打字的人吃掉）。

**B3（可访问性部分）：标记的理由要能被读屏读到，快捷键要能被念出来。**
- 那枚灰标记原本把理由只写在 `title` 里——而 `title` **不是可靠的 accessible name**，很多读屏器直接忽略。
  理由现在同时作为**隐藏文本**（`.srOnly`）放进标记内部，于是它进入控件名：读屏会念
  「步骤记录 请完全加载该轮次记录后查看」，与鼠标悬停看到的一致。
- 收起与全部收起用 **`aria-keyshortcuts`** 声明各自的快捷键（`Alt+C` / `Alt+Shift+C`），
  而不是只写在 tooltip 里。装饰性图标补了 `aria-hidden="true"`。
- DESIGN.md 的「Reading and accessibility」补了一句契约：数据给不出的信息用文字说明、理由进入
  accessible name；有快捷键的动作声明它；**动作把自己藏起来时，焦点交给仍然可见的控件**。

**B3（英文 UI）：经权衡后不做。** 宿主提供语言座位，插件也已经借用它翻译宿主自己的两条文案，
但插件自身文案的完整 zh/en 化需要先加一个 locale provider 边（`@deepseek-ai/dsh-client-locale`
进 `dsh.client.inject`）**并重启 Host**，收益（界面文案，上游同样是中文）与代价不成比例。
这条是决定，不是漏项——README 的「已知限制」两版都写明了。

## 0.3.0-relayout.13

- **GitHub 仓库也改名为 `dsh-viewtune`**（原来叫 `dsh-better-display-reforged`）。包名与仓库名现在**同名**，从 GitHub 安装的写法随之回到最简形式：`dsh plugin --profile web add github:Farewish/dsh-viewtune`。
- 同步的四处：`git remote` 的 URL、`package.json` 的 `repository` / `homepage` / `bugs`、两份 README 里从 GitHub 安装的命令与推送说明。GitHub 会为旧路径保留重定向，所以改名前克隆的副本不会立刻失效。
- 保留不改的：CHANGELOG 里记录改名历史的条目、README/CHANGELOG 对上游 `aa2246740/dsh-better-display` 的署名，以及 `tests/stock-install.test.ts` 里"禁止安装上游"的反向断言——它们指的是**上游**，不是本仓库。
- **两份 README 重写为面向公开仓库的文档**（本仓库即将公开）。原文是"给未来的自己看的运维笔记"：功能说明被压在一堆机器特定配置之后，还夹着本机的绝对路径、私钥位置与 SSH 覆盖配置、以及一节"为什么历史补全做不到"的宿主缺陷剖析——后者按维护者判断不再需要出现在门面上。新版结构为：这是什么 → 特性 → 安装 → 已知限制 → 开发 → 许可；**已删除**：绝对路径、私钥与 SSH 配置、机器网络的吐槽、"改完重装"的内部维护约定、以及那节宿主缺陷剖析。
- 重写时保留了三件**必须留**的东西：`tests/stock-install.test.ts` 断言的两条安装/卸载命令与 `pnpm` 字样（这些是仓库自带的守卫，去掉测试就红）；对上游的 MIT 署名；以及"编译产物已提交、重新构建需要一份 DSH 单仓库"这一条——它解释了仓库为什么提交 `lib/`。
- 顺手修掉一处会误导读者的说法：旧 README 让开发时把仓库克隆到 `D:\repos\...`，那是对**本机**的建议，与读者无关。新版改为说明"不要把仓库放在 `node_modules` 里"这个真正的原因。
- 「已知限制」一节把两个"看起来像 bug、其实是取舍"的行为写明了：被历史窗口截断的轮次不显示步骤/用量；用量胶囊在宿主无法**精确证明**该轮计费时缺失（本插件不猜、不估算）。

## 0.3.0-relayout.12

- **改名：包名 `dsh-better-display-reforged` → `dsh-viewtune`**。改的不只是字面：宿主按 profile 里安装包的 `name` 生成客户端行 id，浏览器加载器会拒绝注册成别的名字的产物，所以**产物里 15 处必须同时改**——`__ModuleLoader__.load({ id })` 那一处，加上 7 组 CSS 模块的 `tagId` 前缀与 `dataset.plugin`（HMR 是按 plugin id 删本插件 `<style>` 的）。改完由 `check-bundle-markers.mjs`（断言产物注册 id = 包名）与临时宿主端到端共同验证：模块图收录 `dsh-viewtune`、产物注册同名、reveal 路由照常。
- **入口文件名跟着包名走**：`src/dsh-better-display.ts` → `src/dsh-viewtune.ts`，`lib/dsh-better-display.js` → `lib/dsh-viewtune.js`，并同步 `package.json` 的 `main`/`exports`、`tsdown.config.ts` 的入口、`cordis.yml`/`dshx.yml` 的 entry、以及 `tests/stock-install.test.ts` 里**断言该文件名**的两处——只改 package.json 不改测试，将来一构建测试就会红。
- **保留不改的（都不是"被解析的包名"）**：`cordis.patch.yml` / `cordis.yml` 里的 `id: dsh-better-display`（配置行标识，只有 `name:` 参与模块解析）、`data-dsh-better-display` DOM 属性、`dsh-better-display.block` 插槽名、`dsh-better-display-entry` / `dsh-better-display-client` 内部注册 id、`/better-display/reveal` 路由。
- **工具侧顺带修掉一个隐患**：`plugin-location.mjs` 原本靠「依赖名以 `dsh-better-display` 开头」找插件，**改名即全工具失效**；现在改成「profile 里唯一的非 `@deepseek-ai/` 依赖」，并优先用 manifest 的 bundle 列表消歧义，于是下次再改名也不会坏。
- profile 侧四处同步改名（manifest、lockfile importer、pnpm 的 `.package-map.json`、`node_modules` 的 junction）。本机 `dsh plugin` 跑不了（没有 pnpm，launcher 只经 corepack 提供 shim），所以这四处是手工改的，改前状态备份在工具目录 `_backup/web-*.before-viewtune`。
- **修掉一处仓库元数据错误**：`package.json` 的 `repository` / `homepage` / `bugs` 当时指向 `github.com/aa2246740/dsh-better-display-reforged`——`aa2246740` 是**上游作者**，而那个带 `-reforged` 的仓库**并不存在**（后缀是 fork 才有的）。先改为当时的真实远端，relayout.13 随仓库改名收敛为 `Farewish/dsh-viewtune`。

## 0.3.0-relayout.11

- **修复：向上淡出看不见**（relayout.5 引入的 bug，用户实测发现）。为了让退出动画有东西可动，我在 `[hidden]` 规则上强制了 `display: inline-flex`（否则浏览器自带的 `[hidden] { display: none }` 会让动画无从播放）——但**同一条规则上还写了 `visibility: hidden`，它是立即生效的**：控件在第一帧就已不可见，而不可见的元素不会绘制动画，所以看到的是「瞬间消失」。`display` 那个坑绕开了，`visibility` 这个坑踩进去了。
- 修法：把可见性变化从 `[hidden]` 移到 **idle 状态**上，并给它**等于退出时长的延迟**——`transition: visibility 0s linear 140ms`。于是控件在整个 140ms 动画期间保持可见，动画结束后才隐藏。`open` 规则里那句 `visibility: visible` 也随之删掉：没有东西再隐藏它，那句只是在掩盖问题。
- **新增 `test-collapse-fade.mjs`**：它把产物 CSS 字面量求值，**按浏览器的方式解析层叠**（区分无条件规则与 `@media` 内的规则、处理 `[data-motion=off]` 这类祖先选择器），然后断言"退出动画期间可见性不会被提前改掉"。写成这样是因为：**这个 bug 无法用子串断言发现**——动画声明、关键帧、`visibility` 规则全都在文件里，字面看毫无问题。
- **配 `selftest-collapse-fade.mjs`**：把当初出问题的那版 CSS 造成临时产物喂给检查器，要求它**报错**（再确认健康产物仍通过）。一个从未报过错的检查器，和一个什么都不报的检查器无法区分。

## 0.3.0-relayout.10

- **边框与分界线加深到与宿主同级**。原来用的是 `1px solid var(--dsw-alias-border-l1)`——`l1` 是**最浅的一档**（浅色主题下 `#0000000a`，即 4% 黑），而且比宿主自己的线还粗。查了宿主实际服务的前端产物后改成 **`.5px solid var(--dsw-alias-border-l2)`**：宿主一共 107 处 `border-bottom`，其中 55 处是 `l2`、16 处是 `l3`、只有 12 处是 `l1`，header/tabs 一类分隔线都用 `l2`~`l3`。工具栏下沿分界线与「收起」胶囊的描边现在**同宽同档**（`test-toolbar-geometry.mjs` 会断言两者字面一致）。
- **「收起」加了填充色**：用 `--dsw-alias-interactive-bg-hover`——这是宿主里用作静止填充最多的 token（309 处），所以它是"应用自己的做法"而不是我挑的颜色。因为静止态已经用了这个色，hover 改成它的强化兄弟 `--dsw-alias-interactive-bg-hover-solid`，否则填充会把 hover 反馈吃掉（这条也有断言）。

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
