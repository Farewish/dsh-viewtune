# dsh-better-display-reforged

[English](./README.en.md)

> 本仓库基于 [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display)（MIT）修改，
> 调整了阅读页签里的几处显示细节，**顺序**与**用时胶囊**保持上游原样。改动清单见下方
> [相较上游的改动](#相较上游的改动)。
>
> 包名是 `dsh-better-display-reforged`（与上游**不同名**）。**上游的 `dsh-better-display`
> 不要再装回来**：本仓库的 bundle 补丁把自己的入口解析到 `dsh-better-display-reforged`，
> 而两者的补丁都插入同一个入口 id `dsh-better-display`，同时挂着会重复挂载。
>
> **本仓库是唯一的维护源。** 以后改显示逻辑都改这里，改完重装并重启 Host 生效：
> `dsh plugin --profile web add D:\DSH\Plugin\dsh-better-display-reforged`。
> 不要再用上游包或对已安装副本打补丁的方式更新。

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
dsh plugin --profile web add ./dsh-better-display-reforged-0.3.0-relayout.4.tgz
```

`dsh.bundle` 是开机捕获的。不要再往 profile 的 `cordis.patch.yml` 手写同一条 insert，会重复挂载。

```sh
dsh plugin --profile web remove dsh-better-display-reforged
```

> **要给这个仓库做开发或推送到 GitHub？先把仓库放在 `node_modules` 之外的目录**，
> 例如克隆到 `D:\repos\dsh-better-display`。pnpm 在重装依赖时会清理 `node_modules` 下
> 未在 `package.json` 中声明的目录，仓库（含 `.git`）可能被一起删掉。

## 一项做不到的改动：自动补全历史

历史补全（自动加载更早记录）不在此仓库中，且不建议重新实现。原因是宿主自身的缺陷：
分页只能走 `Session.prependWindow`，而宿主自己的 `system-message` 定义在该路径上对一个**已经产出过**的
目标返回了 `null`，装配器据此抛错：

```
conversation Definition "system-message" withdrew materialized target "chat";
return the same key with hidden visibility instead
```

宿主规定：Definition 一旦产出过节点，就不能再返回 `null`，必须返回同一 key 并标记 hidden。
插件侧只有 `loadOlder()` / `loadThrough()` 两个翻页入口，**调用即触发**，因此无法从插件规避。
截断的轮次只能按原样呈现——这也正是「被截断的轮次不显示步骤气泡」的由来。

本仓库试过三次，每次都只是换一种方式踩同一个缺陷：

1. **单页加载**：长轮次仍被切、短轮次又越过边界（窗口按消息条数计，轮次长度可变）；
2. **循环到「最上面那轮看起来完整」**：用户消息不在快照里的轮次永远不会显得完整，于是一路翻到上限，一次涌入约 20 轮；
3. **循环到「本轮第 1 步已加载」**（判据本身可靠、必然终止）：一调用就打出上面那条宿主错误。

判断能不能做的关键教训：**先确认那条路径在宿主侧是否本就可用**，再花力气设计判据。
`loadOlder()` 看着是公开 API，实际在当前版本上不可用。

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
5. **工具栏吸顶**：工具栏（「收起」+「动效」两个开关）固定在阅读列顶部，滚动时始终够得到；
   底色保证正文从下方滚过而不穿透。**过程状态行不吸顶**——它曾一起固定在工具栏下方
   （relayout.4），已在 relayout.6 撤掉、relayout.7 只把工具栏装回。因此也不需要工具栏的高度实测：
   那个 `--reader-toolbar-height` 唯一的消费者就是状态行的偏移。
6. **工具栏的固定「收起」开关**：那行「阅读 · 原始记录完整保留」被撤掉，位置改放一个常驻按钮。
   一个**对话**在这里就是**一轮**（提问 + 回复），所以按钮只收起**读者正在看的那一轮**的过程，
   不是页面上所有轮次。判定「正在看哪一轮」用的是阅读滚动同一条谓词：**第一个底边还没越过视口顶边的
   轮次**——视口横跨两轮时即为**上面那一轮**。因此滚动到一轮已折叠的对话时，按钮会自己淡出。
   过程是否展开用的是 `TurnGroup` 同一套判据，所以被文本选区临时顶开的那一轮也算在内。

## 开发

**本仓库不发布类型声明**：`lib/` 只含编译好的 `lib/client.js`（Host 真正加载的文件）与宿主入口。
`lib/types/` 是 `npm run build`（tsconfig 的 `outDir`）的产物，需要一份 DSH 单仓库，本机没有；
因此 `package.json` 不再声明 `types`。**类型检查同样需要那份单仓库**（`@deepseek-ai/dsh-client-ui-*`
并未作为独立包发布，本机 launcher 里也没有 react / typescript），所以 `npm run typecheck` 在本机跑不起来。
验证只能依赖产物层：`check-bundle-markers.mjs`、`probe-linked-host.mjs`、`blank-page-triage.mjs` 等。

```sh
npm test
npm run typecheck
```

构建浏览器半边需要一份 DSH 单仓库（提供 `tools/dshx` 的 client-build 适配器与
`packages/client` 源码），本仓库按上游方式沿用其 `tsdown.config.ts`。**仓库已提交编译好的
`lib/`，安装时不需要构建。**

### 推送到 GitHub

`github.com:443` 在本机**被 TLS 拦截**（TCP 能连上，TLS 握手超时），所以
`git push https://github.com/...` 用不了。仓库已配好走 `ssh.github.com:443`：

```sh
git push            # origin 已指向 ssh://git@ssh.github.com:443/Farewish/dsh-better-display-reforged.git
```

`core.sshCommand` 固定了密钥与端口，无需任何全局配置：

```sh
git config --get core.sshCommand
# "C:/Windows/System32/OpenSSH/ssh.exe" -i D:/DSH/.ssh/github_farewish_ed25519 \
#   -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
#   -o UserKnownHostsFile=D:/DSH/.ssh/known_hosts
```

换机器/换仓库时要一起改这两项（`git remote set-url origin <新的 ssh URL>` 与
`git config core.sshCommand "<新的密钥路径>"`）。


## 许可

展示与 Markdown 部分来自 DeepSeek Harness（MIT）。上游插件为
[`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display)（MIT）。
动效参考 [Transitions.dev](https://transitions.dev/)。本仓库代码 [MIT](LICENSE)。
