# dsh-better-display-reforged

[English](./README.en.md)

> 本仓库基于 [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display)（MIT）修改，
> 调整了阅读页签里的几处显示细节，**顺序**与**用时胶囊**保持上游原样。改动清单见下方
> [相较上游的改动](#相较上游的改动)。
>
> 包名是 `dsh-better-display-reforged`（与上游**不同名**），因此它可以和上游包并存于
> `node_modules`，但**不要同时装进同一个 profile**：两者的 bundle 补丁都插入同一个入口 id
> `dsh-better-display`，同时挂载会重复。

```sh
# 从本地仓库安装（开发用；pnpm 会为本地目录建链接）
dsh plugin --profile web add D:\DSH\Plugin\dsh-better-display-reforged

# 或从 GitHub 安装
dsh plugin --profile web add github:你的用户名/dsh-better-display-reforged
```

PATH 上要有官方 `dsh`（没有就用 `npx @deepseek-ai/dsh`）和 **pnpm**。`dsh plugin add` 会在 `$DSH_HOME/profiles/web` 里跑 pnpm。仓库已提交编译好的 `lib/`，安装不用 `prepare`，也不用改 profile 的 `allowBuilds`。

然后重启这个 Host，再刷新页面。`dsh plugin add` 只写 profile，不会热挂正在跑的进程。

给 DeepSeek Harness 加一个 **阅读** 页签：执行时能看到步骤、思考和进度；整轮成功结束后把过程收起来，留下最终回答。原版「对话 / 轨迹」、输入框、模型选择、工具和审批都还在。

最终回答里的 ````mcp-app` 代码块会在阅读视图里挂成交互卡片，跑在 `<iframe sandbox="allow-scripts allow-forms">` 里，没有 `allow-same-origin`。卡片可以通过 JSON-RPC 把下一轮 prompt 填进输入框。技能包在 [`skills/generative-mcpapps/`](skills/generative-mcpapps/)。

面向 DeepSeek Harness **0.1.5-rc.2**。只改展示，不改 Agent 执行、SDK 或模型凭据。Node.js `^22.19.0 || >=24`。新会话默认进阅读。

本地目录或 tarball：

```sh
dsh plugin --profile web add ./dsh-better-display-reforged
dsh plugin --profile web add ./dsh-better-display-reforged-0.3.0-relayout.2.tgz
```

`dsh.bundle` 是开机捕获的。不要再往 profile 的 `cordis.patch.yml` 手写同一条 insert，会重复挂载。

```sh
dsh plugin --profile web remove dsh-better-display-reforged
```

> **要给这个仓库做开发或推送到 GitHub？先把仓库放在 `node_modules` 之外的目录**，
> 例如克隆到 `D:\repos\dsh-better-display`。pnpm 在重装依赖时会清理 `node_modules` 下
> 未在 `package.json` 中声明的目录，仓库（含 `.git`）可能被一起删掉。

## 相较上游的改动

1. **短思考也带边框**：去掉「无溢出时取消边框/底色」的规则，短思考沿用与长思考相同的框；
   盒子高度仍由内容决定，不会出现滚动条，也没有折叠/展开按钮。
2. **短思考框的内边距**：标题为 `10px 16px 0`、正文为 `8px 16px 16px`，与长思考一致，
   文字不再顶住边框。
3. **思考区滚到边缘后滚轮接力**：思考内容滚到它正在前往的那一侧边缘后，滚轮改为滚动会话；
   短思考（无溢出）完全不拦截滚轮。
4. **本轮所有用户/上下文消息渲染在轮次最前**：真实轮次可能以系统提示词开头、并携带多条
   user/steering 消息（系统提示词、用户消息、注入上下文）。现在它们全部渲染在过程折叠开关
   之前，于是带与不带系统提示词的对话顺序一致：

   ```
   用户的话 → 折叠开关（用时 X 秒，可点击）→ 流程（系统提示词 / 思考卡 / 工具 / 回答正文）
   ```

   回答末尾的动作行（复制 / 分叉 / 用时胶囊 / 时间戳）与上游一致，未改动。

## 开发

```sh
npm test
npm run typecheck
```

构建浏览器半边需要一份 DSH 单仓库（提供 `tools/dshx` 的 client-build 适配器与
`packages/client` 源码），本仓库按上游方式沿用其 `tsdown.config.ts`。**仓库已提交编译好的
`lib/`，安装时不需要构建。**

## 许可

展示与 Markdown 部分来自 DeepSeek Harness（MIT）。上游插件为
[`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display)（MIT）。
动效参考 [Transitions.dev](https://transitions.dev/)。本仓库代码 [MIT](LICENSE)。
