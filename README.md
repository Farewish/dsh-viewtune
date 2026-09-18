# dsh-viewtune

[English](./README.en.md)

给 DeepSeek Harness 的**阅读**页签：一轮对话在进行时，过程是看得见的——思考在写、工具在跑、到了第几步；一轮成功结束后过程收起来，只留最终回答。

上游原版的「对话 / 轨迹」页签、输入框、模型选择、工具与审批全部保留，本插件只增加一个阅读视图。

面向 DeepSeek Harness **0.1.5-rc.2**。只改展示，不碰 Agent 执行、SDK 或模型凭据。Node.js `^22.19.0 || >=24`。

## 特性

- **过程可见**：思考、工具调用、子代理与进度实时呈现，长轮次不会只剩一个转圈。
- **结束后自动收起**：整轮成功结束时折起过程、留下回答；运行中或未完成的轮次保持展开。
- **短思考与长思考同框**：不再因为「没有溢出」就取消边框，短思考的标题与正文内边距与长思考一致。
- **思考区滚轮接力**：思考内容滚到它正在前往的那一侧边缘后，滚轮改为滚动会话；没有溢出的短思考完全不拦截滚轮。
- **用户消息都在最前**：一轮里可能以系统提示词开头并携带多条 user/steering 消息（系统提示词、你的话、注入的上下文），它们按源顺序全部渲染在过程折叠开关之前。带与不带系统提示词的对话，顺序一致：

  ```
  用户的话 → 折叠开关（用时 X 秒，可点击）→ 流程（系统提示词 / 思考卡 / 工具 / 回答正文）
  ```

- **工具栏吸顶**：工具栏（「收起」+「动效」两个开关）固定在阅读列顶部，滚动时始终够得到。
- **「收起」只作用于当前这一轮**：一个「对话」在这里就是一**轮**（提问 + 回复）。按钮收起的是读者正在看的那一轮的过程，不是页面上所有轮次；判定方式与阅读滚动选锚点用的是同一条谓词，视口横跨两轮时取**上面那一轮**。
- **步骤胶囊**：回答末尾的动作行里显示该轮回答落在第几步 / 全轮共几步，点开是中文的过程记录，不是原始 JSON。
- **交互式 mcp-app 卡片**：回答里的 ````mcp-app` 代码块挂成交互卡片，跑在 `<iframe sandbox="allow-scripts allow-forms">` 内、**没有** `allow-same-origin`；卡片可通过 JSON-RPC 把下一轮 prompt 填进输入框。技能包见 [`skills/generative-mcpapps/`](skills/generative-mcpapps/)。

## 安装

需要 PATH 上有官方 `dsh`（没有就用 `npx @deepseek-ai/dsh`）与 **pnpm** —— `dsh plugin add` 会在 `$DSH_HOME/profiles/web` 里跑 pnpm。

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:Farewish/dsh-viewtune

# 或从本地目录 / tarball 安装
dsh plugin --profile web add ./dsh-viewtune
dsh plugin --profile web add ./dsh-viewtune-0.3.0-relayout.13.tgz
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

## 已知限制

- **被历史窗口截断的轮次**不显示步骤胶囊与用时/用量。Harness 按消息条数分页，最上面那一轮可能只加载了一部分，此时它的步骤数是局部和，与过程记录里的绝对步数不可比——所以宁可不显示，也不显示一个会误导的偏小数字。
- **用量胶囊偶尔不出现**属于有意为之：宿主只在能**精确证明**该轮计费数据时才给出用量（例如该轮某次尝试没有可用的用量样本、或轮次尚未结束时，宿主宁可返回"无法确定"）。本插件跟随这一取向，不猜、不估算。

## 开发

### 为什么仓库提交了编译产物

浏览器半边是预编译的 `lib/client.js`，Host 启动时直接加载它。**从源码重新构建需要一份 DSH 单仓库**（提供客户端构建适配器与 `packages/client` 源码），本仓库沿用上游的 `tsdown.config.ts`。正因为构建有这一层依赖，仓库才把编译结果一并提交——安装与分享都不需要构建。

类型检查同样需要那份单仓库（客户端 UI 包并未作为独立包发布），所以在没有它的机器上 `npm run typecheck` 跑不起来。`lib/` 只含编译产物与宿主入口，本仓库**不发布类型声明**，`package.json` 也没有 `types` 字段。

### 改代码

改动显示逻辑时，**源码 `src/` 与产物 `lib/client.js` 必须一起改**——Host 加载的是产物。请务必留意产物里的两处身份标记，它们必须与 `package.json` 的 `name` 完全一致，否则整页会因为
`loaded without registering "<id>" via __ModuleLoader__.load` 而失败：

- `window.__ModuleLoader__.load({ id })` 的行 id（宿主由安装清单的包名派生）；
- 每个 CSS 模块的 `tagId` 前缀与 `document.createElement("style")` 的 `data-plugin`（HMR 按 plugin id 移除本插件的样式）。

`tests/stock-install.test.ts` 就是这两条的守卫；同一测试还会检查本文档的安装命令与包名一致。

> **把克隆出来的仓库放在 `node_modules` 之外。** `dsh plugin add` 会在 profile 目录里跑 pnpm，而 pnpm 会清理 `node_modules` 下未在 `package.json` 中声明的目录——仓库连同 `.git` 可能被一起删掉。

### 验证

`npm test` 跑仓库自带的测试。此外，本项目开发时主要依赖**产物层**的验证：检查产物的结构标记、把编译后的函数从产物里抠出来在假 DOM 上跑行为用例、并起一个临时 Host 确认模块图收录的 id 与产物注册的 id 一致。

这套做法有个前提值得说明：**能解析（`node --check` 通过）不等于正确**。本仓库改动的是压缩过的产物，所以出现过语法完全合法、却因为一个引用被删掉而在运行时抛错的情况——那类错误只有"名字是否有声明"这一层的检查能抓住。

## 许可

本仓库按 MIT 发布，见 [LICENSE](LICENSE)。

它的起点是 [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display)（MIT）：阅读页签、流式动效与 Markdown 渲染来自那里。展示与 Markdown 部分源自 DeepSeek Harness（MIT）。动效参考 [Transitions.dev](https://transitions.dev/)。
