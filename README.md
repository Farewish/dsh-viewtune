# dsh-viewtune

[English](./README.en.md)

给 DeepSeek Harness 的**阅读**页签：一轮对话在进行时，过程是看得见的——思考在写、工具在跑、到了第几步；一轮成功结束后过程收起来，只留最终回答。

上游原版的「对话 / 轨迹」页签、输入框、模型选择、工具与审批全部保留，本插件只增加一个阅读视图。

面向 DeepSeek Harness **0.1.5-rc.2**。只改展示，不碰 Agent 执行、SDK 或模型凭据。Node.js `^22.19.0 || >=24`。

## 特性

- **过程可见**：思考、工具调用、子代理与进度实时呈现，长轮次不会只剩一个转圈。
- **结束后自动收起**：整轮成功结束时折起过程、留下回答；运行中或未完成的轮次保持展开。
- **短思考与长思考同框**：不再因为「没有溢出」就取消边框，短思考的标题与正文内边距与长思考一致。
- **思考区滚轮交给浏览器**：卡片内原生滚动，滚到底后整格原生上链到会话。跨过底边那一格、卡片吃不下的余量会被丢掉（最多一格，一个手势只发生一次）——这是「一格都不从浏览器手里拿走」的代价；没有溢出的短思考完全不拦截滚轮。
- **用户消息都在最前**：一轮里可能以系统提示词开头并携带多条 user/steering 消息（系统提示词、你的话、注入的上下文），它们按源顺序全部渲染在过程折叠开关之前。带与不带系统提示词的对话，顺序一致：

  ```
  用户的话 → 折叠开关（用时 X 秒，可点击）→ 流程（系统提示词 / 思考卡 / 工具 / 回答正文）
  ```

- **等待时钟**：模型正在思考或输出时，状态行右边显示「这一轮交给模型多久了」，**前 3 秒完全不显示**（等待通常比这更短，数字一冒出来只会把眼睛拉过去），过十秒挂一个「暂未响应」。锚点是**最后一次交棒**（工具返回、上下文注入、命令结束、你刚发言），不是轮次开始——所以刚开始的等待不会继承工具已经花掉的分钟数；**工具还在跑时不计时**，那时忙的是工具而不是模型。

- **工具栏吸顶**：「收起」+「viewtune ⚙」固定在阅读列顶部，滚动时始终够得到。
- **设置面板**：点「viewtune ⚙」打开一个小面板，分「视效」「快捷键」两页（键盘用方向键 / Home / End 在两页间切换）。「视效」里偏好一项一行——「动效」（被系统的减少动态效果设置覆盖时会说明）和「磨砂玻璃」（默认关闭；打开后吸顶栏、卡片、工具框与代码块都不再自带不透明底板，透出宿主壁纸与皮肤，路径/行数这类标签静止时透明、悬停或聚焦才显出轮廓。**开关下面六个滑块**分别调各面不透明度：工具栏 / 用户气泡 / 卡片与面板 / 代码块 / 差异面板 / 产物标签，`0%` 是「这个面什么都不画」，`100%` 是关掉皮肤时那块不透明底板，出厂值就是加旋钮之前的样子（分组按"是什么"而不是"在哪"：差异纸无论出现在面板里还是工具「结果」页里，都归「差异面板」这一个滑块）；「快捷键」页可以改本插件自己的两个快捷键（点键帽录制新组合，Esc 取消，清除即不带快捷键），会拒绝没有修饰键或已被浏览器占用的组合。加一个偏好就是加一行，加一类就是加一页，工具栏不会因此变宽。每行那句话说明挂在**该行的 `title` 上**（浏览器弹的原生框，和按钮、「收起」是同一套），平时不占版面；而被系统覆盖、录制中、组合被拒这类**状态**仍然直接写在行里。
- **「收起」只作用于当前这一轮**：一个「对话」在这里就是一**轮**（提问 + 回复）。按钮收起的是读者正在看的那一轮的过程，不是页面上所有轮次；判定方式与阅读滚动选锚点用的是同一条谓词，视口横跨两轮时取**上面那一轮**。
  键盘上按 **Alt+C** 等价于点它。若你另外还展开过别的轮次，工具栏里会多出一个 **「全部收起」**（**Alt+Shift+C**，只在真的还有别的展开轮次时出现）——一次收完，不需要逐轮回滚。
  收起之后如果按钮本身消失了，焦点会**回到工具栏的另一个控件**而不是页面 `<body>`：键盘读者不会因为按了一下按钮就被丢回文档开头。
- **步骤胶囊**：回答末尾的动作行里显示该轮回答落在第几步 / 全轮共几步，点开是中文的过程记录，不是原始 JSON。
- **改动行计数**：改了文件的工具行尾部显示 `+N -M`（增绿删红），点开是按文件分页的差异面板，每页用的就是官方工具行那个 `DiffBlock`。计数优先读宿主已附在结果里的 `meta.diffs`，没有才退回调用参数——而且**只对真正会改文件的三种工具**这么做（好几个不相干的工具都有叫 `content` 的字段，读错会给没改文件的调用凭空造出增删行）；子调用改的文件也算在这一行里。
- **交互式 mcp-app 卡片**：回答里的 ````mcp-app` 代码块挂成交互卡片，跑在 `<iframe sandbox="allow-scripts allow-forms">` 内、**没有** `allow-same-origin`；卡片可通过 JSON-RPC 把下一轮 prompt 填进输入框。技能包见 [`skills/generative-mcpapps/`](skills/generative-mcpapps/)。

## 安装

需要 PATH 上有官方 `dsh`（没有就用 `npx @deepseek-ai/dsh`）与 **pnpm** —— `dsh plugin add` 会在 `$DSH_HOME/profiles/web` 里跑 pnpm。

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:Farewish/dsh-viewtune

# 或从本地目录 / tarball 安装
dsh plugin --profile web add ./dsh-viewtune
dsh plugin --profile web add ./dsh-viewtune-0.3.0-relayout.14.tgz
```

装完**重启 Host**再刷新页面：`dsh plugin add` 只写 profile，不会热挂正在运行的进程。

卸载：

```sh
dsh plugin --profile web remove dsh-viewtune
```

几点说明：

- `dsh.bundle` 是**开机捕获**的，不要再往 profile 的 `cordis.patch.yml` 手写同一条 insert，会重复挂载。
- 本仓库**已提交编译好的 `lib/`**，安装时不需要 `prepare`，也不需要给 profile 加 `allowBuilds`。
- 本插件与上游 `dsh-better-display` **不要同时安装**：两者的 bundle 补丁插入同一个入口 id，同时挂着会重复挂载。用上面的 `remove` 卸掉本插件后，再装回上游才是干净的。

## 已知限制（以及"说不出来时它怎么显示"）

- **被历史窗口截断的轮次**不显示步骤**数字**。Harness 按消息条数分页，最上面那一轮可能只加载了一部分，
  它的步骤数是局部和，与过程记录里的绝对步数不可比——偏小的分母会误导，所以不显示。
  取而代之的是 **「步骤记录」** 标记，悬停提示：**请完全加载该轮次记录后查看**。
- **用量胶囊偶尔不出现**属于有意为之：宿主只在能**精确证明**该轮计费数据时才给出用量（例如该轮某次尝试
  没有可用的用量样本、或该轮落在压缩上下文里）。本插件跟随这一取向，不猜、不估算，**也不为它加标记**——
  缺数字就是缺数字，多一枚"用量 —"是噪音而不是信息（这一条是权衡后的取舍：给截断轮次的那枚标记有用，
  因为它解释了"为什么这里没有数字"；用量缺失的轮次本身没有可展示的位置概念，加了反而显眼）。

「步骤记录」这枚标记只是**说明**，不是控件：没有点击行为、没有 hover 高亮，也不会出现任何估算出来的数字。

另外一条**有意为之**：**界面文案目前只有中文**。宿主提供了语言座位，本插件也已经在借用它翻译宿主自己的
两条文案（`message.contextRecall` / `message.contextInjection`），但插件**自身**的文案没有走本地化——
做成完整的 zh/en 需要先给插件加一个 locale provider 边（要重启 Host）。这条是权衡后的取舍，不是遗漏。

## 开发

### 构建

浏览器半边是预编译的 `lib/client.js`，Host 启动时直接加载它。仓库把编译结果一并提交，所以**安装与分享都不需要构建**；但**从源码构建现在是可以的**：

```sh
npm ci                # 按仓库里的 package-lock.json 装依赖
npm run build         # src/ -> lib/client.js 与 lib/dsh-viewtune.js
```

用 `npm ci` 而不是 `npm install`：`package.json` 里 `tsdown` / `lightningcss` / `typescript` 都写在 `^`
区间上，只有锁文件能保证在别的机器上装出**能复现当前 `lib/`** 的同一套工具链——`npm run guard` 里的
`verify-build` 正是这么比的：它真的重建一遍，再报 `REBUILD REPRODUCES THE SHIPPED SHAPE`。只有改动了
`package.json` 的依赖时才用 `npm install` 去回写锁文件。

上游的 `tsdown.config.ts` 从一个不对外发布的 Harness 适配器（`<harness>/tools/dshx/src/client-build.js`）
取 `externalClientBundle`，所以那个配置在克隆出来的仓库里跑不起来。本仓库把它的真身——
官方预设 `packages/client/tsdown.client.ts` 的 `clientBundle()`（Harness tag `dsh-v0.1.5-rc.2`）——
移植成了 [`scripts/client-bundle.mjs`](scripts/client-bundle.mjs)，并内联了它引用的三处 Harness 内部模块。
产物契约不变，所以下面那套针对产物的断言依然有效。

改完记得**同时提交 `lib/`**：安装别人拿到的是这份产物，而不是让他在本地构建。

**类型检查同样不需要那份单仓库。** 客户端 UI 包在 npm 上是独立发布的，装依赖时会按
`peerDependencies` 把它们（含 launcher 自己没装的 `dsh-client-store`、`dsh-client-ui-primitives`、
`dsh-client-ui-slots`）一并装好：

```sh
npm run typecheck     # tsc -p tsconfig.json --noEmit，对着真实声明检查
```

`lib/` 只含编译产物与宿主入口，本仓库**不发布类型声明**，`package.json` 也没有 `types` 字段。

### 改代码

改动显示逻辑时，改 `src/` 然后 `npm run build`。产物里的两处身份标记必须与 `package.json` 的
`name` 完全一致，否则整页会因为 `loaded without registering "<id>" via __ModuleLoader__.load` 而失败：

- `window.__ModuleLoader__.load({ id })` 的行 id（宿主由安装清单的包名派生）；
- 每个 CSS 模块的 `tagId` 前缀与 `document.createElement("style")` 的 `data-plugin`（HMR 按 plugin id 移除本插件的样式）。

`tests/stock-install.test.ts` 就是这两条的守卫；同一测试还会检查本文档的安装命令与包名一致。
（`tsdown.config.ts` 从 `package.json` 读包名，所以改包名不会再漂。）

> **把克隆出来的仓库放在 `node_modules` 之外。** `dsh plugin add` 会在 profile 目录里跑 pnpm，而 pnpm 会清理 `node_modules` 下未在 `package.json` 中声明的目录——仓库连同 `.git` 可能被一起删掉。

### 验证

分两层，因为它们回答的是不同的问题：

```sh
npm test     # 源码层：Node 自带测试跑 15 个测试文件
npm run guard   # 产物层：19 条断言，全部针对构建出来的 lib/client.js
```

`npm run guard` 检查的是**产物**：模块表注册 id 与 `require()` 集合、注入的 CSS 字面量是否完整、
轮次渲染顺序、§ 收起开关的作用域与淡出、工具栏吸顶形状、步骤胶囊用到的标识符是否都有声明，
以及**`src/` 与产物的对应关系**（`compare-source-and-bundle`、`audit-source-edits`）与
**"重新构建仍能复现已提交的形状"**（`verify-build`）。最后一条是这类仓库唯一能做的"产物与源码一致"证明——
字节相等不可用（压缩器输出本就不稳定），所以它比对的是契约面与样式表规则。

这套做法有个前提值得说明：**能解析（`node --check` 通过）不等于正确**。本仓库的历史大量是直接改压缩产物，
出现过语法完全合法、却因为一个引用被删掉而在运行时抛错的情况——那类错误只有"名字是否有声明"这一层检查能抓住
（`check-pill-scope`），或者"重新构建一次"能暴露（漂移在源码与产物之间）。两条都在 `npm run guard` 里。

## 许可

本仓库按 MIT 发布，见 [LICENSE](LICENSE)。

它的起点是 [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display)（MIT）：阅读页签、流式动效与 Markdown 渲染来自那里。展示与 Markdown 部分源自 DeepSeek Harness（MIT）。动效参考 [Transitions.dev](https://transitions.dev/)。
