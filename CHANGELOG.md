# Changelog

## Unreleased (frosted glass)

**设置「视效」页多了「磨砂玻璃」开关：打开后阅读视图不再自带不透明底板，透出宿主壁纸与皮肤；开关下面还有六个滑块，分别调各面的不透明度。**

上游 0.2.0 的 `data-reader-glass` 整套搬过来，按本 fork 的类名重新映射，并把上游写死的那几个百分比变成**读者自己的旋钮**：

- **存储与接线**：`dsh.reader.v1` 新增 `glass`（默认 `false`）与 `glassParts`（只记改过的面），读取端一律带回退——持久化是**整体替换**，在这两条偏好存在之前写下的记录回来时根本没有这些键（和 `shortcuts` 同一个坑，`store.ts` 里两处都写着）。根元素挂 `data-reader-glass`，整套皮肤就是一组 `.root[data-reader-glass] …` 覆盖规则；设置项加在「视效」页、排在「动效」下面（`data-ud-check="reader-settings-glass"`）。
- **六个旋钮**（`src/client/glass.ts`，一个面一个 CSS 自定义属性）：工具栏 / 用户气泡 / 卡片与面板 / 代码块 / 差异面板 / 产物标签。刻度按面的本性走：**`0%` = 这个面什么都不画（底板彻底拿掉，宿主透出来），`100%` = 关掉皮肤时那块不透明底板**；出厂值就是皮肤原本写死的那些（25 / 25 / 0 / 25 / 20 / 0），所以打开皮肤看着和加旋钮之前一样。旋钮只在皮肤开着时出现——皮肤关着时一个面的不透明度没有意义，六行死控件只会把面板撑长（面板因此加了 `max-height` 与纵向滚动）。样式侧仍是声明式的：`color-mix(in srgb, <该面自己的颜色> var(--glass-…, <出厂值>%), transparent)`，值由根元素的行内样式给出。

  **分组按"是什么"而不是"在哪"**：`bundle` 里 `[data-diff]` 是产品 `DiffBlock` 根的标记，也就是**差异块本身**，它出现在两处——差异面板里（面板的滚动区把它自己的底板重置成透明，所以你看到的是面板那一层），以及工具「结果」页里那份**行内**差异块。第一版照搬上游，把 `[data-diff]` 挂在「代码」旋钮下、又给面板单独一个，等于同一个东西按位置被拆成两个旋钮。现在「差异」这一个旋钮管所有差异纸：面板底板、它的文件标签、以及行内那份差异块；「代码块」只管围栏代码。**边框的发丝比例没有做成旋钮**：它们不参与"透出壁纸"这件事，只有底色参与。
- **皮肤本身**（本 fork 的表面对应上游那一批）：吸顶工具栏（本视图只有 `.toolbar` 这一条吸顶泳道，见 relayout.7；另有一个零高度的 `.jumpDock`，自身没有底板可拿）不再画不透明底板，改为按旋钮把自己底色混向透明 + `blur(16px)`，去边框去阴影；用户气泡同一套（+ `blur(12px)` + 发丝边框）；推理卡、工具框 / 提示 / 未知块 / 原始数据 / 系统提示词 / 压缩备忘框 / 注意条 / 图片框 / 图片弹层按「卡片与面板」这一个旋钮；围栏代码块按「代码块」旋钮 + `blur(12px)`；差异纸（面板底板、文件标签、行内差异块）按「差异面板」旋钮——选中标签在同一旋钮上高 25%，一个控件同时管静止与选中；行内小标签（压缩胶囊、交付 chip、工具状态、`+N -M` 计数块）按「产物标签」，出厂 0——静止时全透明，悬停 / 聚焦 / 展开才显出底面与边框。
- **两处刻意的差异**：上游在皮肤模式下把吸顶工具栏降到 `z-index: 6`，我们保持各处一致的 **9**（那条被 guard 钉住；而且本 fork 只有 `.toolbar` 这一条泳道，状态行在 relayout.6 就撤了吸顶，它不会被夹进 composer 那条带里）；上游那批选择器里有本 fork 没有的类（`flowCell` / `closedProcessSummary` / `foldControl` / `liveFoldContainer`），对应过来是上面列的那些。

新增单测 `tests/glass.test.ts`（4 条，测试文件 16 → 17）：缺键回退到出厂值、越界夹到 0–100 并取整、垃圾值（字符串 / `null` / `NaN`）一律回退、六个面的属性名与面板行引用的是同一批字符串。

五条 marker 进 `check-bundle-markers.mjs`：皮肤是根属性（`"data-reader-glass": glassPreference`）、设置面板确实提供这个开关、**皮肤是「拿掉底板」而不是「换个颜色」**（吸顶工具栏必须是把自身底色混向透明，且混的比例来自旋钮；用户气泡必须有真实的 `backdrop-filter`）、**每个面都读得到自己的旋钮**（样式里出现的属性名与面表里的字符串是同一批六个——某个面接到没人写的属性、或某个旋钮没人读，都会在这里失败）、以及**每个旋钮都有一行设置**。前四条里的三条都做过阴性测试：把泳道换成纯色、把某个属性名改掉、把旋钮的模板改动，各报一次 `MISS`，还原后 sha256 一致、`BUNDLE STATE OK`。

顺带记一条踩坑：第一版「拿掉底板」那条 marker 钉的是源码写法 `background: transparent`，而这条管线的最小化器把它输出成 **`background:0 0`**，于是它一直 `MISS`——marker 现在钉的是**产物里的拼写**，注释里也写明；等底色改成 `color-mix` 之后，那个拼写依赖自然消失了。

## Unreleased (diff review)

**改了文件的工具行尾部多出 `+N -M`，点开是就地展开的差异面板。**

上游 0.2.0 的这条把计数挂在**折叠后的步骤摘要**上（他们的 `foldDiffHunks(steps)`）；本 fork 没有那层摘要，所以按先前的形态落在**工具行本身**：行尾计数 + 点开的就地面板。

- **计数从哪来**（`src/client/tool-activity.ts` 的 `callDiffHunks`，上游同款的三级来源，按优先级）：先读宿主已附在结果里的 `meta.diffs`；没有则退回**调用自己的参数**，但只对 `write` / `edit` / `str_replace_editor` 这三个会改文件的工具——好几个不相干的工具都有名为 `content` 的字段（一条备忘、一段输入的消息），把它们当文件正文读，会给「根本没改文件」的调用**凭空造出增删行**；最后把**子调用**改的文件并进来：一段写文件的脚本，改动在下一层，不能因此丢掉计数。
- **面板**（`src/client/DiffPanel.tsx`）：`+N -M` 只在非零时显示（增绿、删红），点开按文件分页，每页用产品自己的 `DiffBlock` —— 和官方工具行渲染的是同一个东西，不是另起一套差异视图。面板**在流内**而不是浮层：详情单元的 `overflow: clip` 会把浮层切掉。开合动画动的是真高度（面板把 transcript 往下推，阅读滚动要测量这次增长），并且和本视图其它动画一样守住两件事：受**动效开关**管（关掉时一帧到位），以及有**墙上时钟兜底**（动画走不到 `onfinish` 时，收起的面板会永远挂着、展开的会卡在第一帧）。
- 与上游的两处刻意差异：他们的面板还会派发 `reader-layout-start` / `reader-layout-end` 供折叠编排读取，本 fork 没有编排也没有监听者，所以不发（不朝空气喊）；面板动效受开关管，理由同上。
- 行尾计数与详情页里原有的 `DiffBlock`（我们自己那个 `write` 分支）**并存**：一个是随手一瞥，一个是随卡片展开的完整记录。

新增单测 `tests/tool-diff.test.ts`（4 条，测试文件 15 → 16）：宿主元数据优先于调用参数且不被重复计一遍、参数回退只对会改文件的工具生效（`read` 带 `content` 必须什么都不产出）、空的一侧不算差异（纯新增仍算）、父调用报告子调用改了什么。四条 guard 加进 `check-bundle-markers.mjs`：行尾计数存在、**白名单就是那条规则**（按产物里的 set 字面量钉住——从名单里删掉一个名字会静默恢复"凭空计数"）、子调用被折进来、面板确实按文件分页。

顺带一件事值得记：加了面板这条动画之后，原来那条 deadline 不变量**当场失败**——新站点有 `clearTimeout(deadline)` 却没有 `fill: 'both'`（计数 4≠3）。那正是它该做的事。现在它写成「每个以 settle 提交状态的动画都要有墙上时钟兜底」：`fill: "both"` 三处、settle 四处、deadline 四处，三个数各有明确含义并被钉住；两半都实测能失败（改掉任一侧的 `clearTimeout(deadline)` 或 `let settled = false;` 都报 `MISS`，还原后 sha256 一致、`BUNDLE STATE OK`）。

**第一版把两半（计数按钮与面板）放在同一个组件里、都由行的 `collapsedContent` 渲染，结果是面板被压成一条窄缝、上下还被裁断。**原因在结构不在样式：原语包的 disclosure 行是**固定 24px 高、`overflow: hidden`、不换行**的 flex 行，面板作为其中一个 `flex: 1 1 100%` 的项被挤窄，再被行高与溢出裁掉。现在拆成 `DiffStatButton`（在行里——那行只放得下一行内容）与 `DiffPanel`（行的**兄弟节点**，渲染在行之后、和详情面板同级）。CSS 里也把 `.diffOverlayRow` 的 `flex: 1 1 100%` 去掉并写明原因，免得下一个人再把它塞回行内。

配套加了一条 guard，专门钉这个位置：**用花括号配对取出 `collapsedContent` 那段对象字面量**，要求该区域内出现 `DiffStatButton`、**不**出现 `DiffPanel`。之所以不能只查「产物里有没有 `DiffPanel`」——面板是同一个 JSX 数组里更靠后的兄弟节点，两种位置在纯文本上无法区分。这条 marker 实测能失败：把产物里 collapsedContent 区域内任一处的 `className:` 换成 `DiffPanel.` 前缀（模拟"面板又回到行里"）即报 `MISS`，还原后 sha256 一致、`BUNDLE STATE OK`。

**同一处还有一个更顽固的截断：hover 填充的底边。**第一轮把计数块改成挂在行的字号轴上（`height: calc(20px + var(--dsh-content-font-delta, 0px))`）——那确实是它该有的形状，但**没有解决问题**。真正的裁剪源是**行盒**：`collapsedContent` 是原语行（固定 24px、`overflow: hidden`）的**直接 flex 子项**，而计数块外层 `.diffStatRoot` 原本只是个 `span`，里面的 `inline-flex` 按钮于是落在行盒上；行盒高度取继承来的 `line-height`（本视图 `.root` 是 28px），算下来约 30px，被 `align-items: center` 居中塞进 24px 的行里，上下各溢出约 3px——**底部那 3px 连同 hover 填充一起被行裁掉**，点击热区也就看着比填充还多一截。把容器改成 flex 盒（`display: flex; align-items: center`）后行盒消失、容器高度就等于按钮高度，任何阅读字号下都不再溢出。

两条 guard 各钉一半，都实测能失败、还原后 sha256 一致、`BUNDLE STATE OK`：容器**必须是 flex 盒**（`_diffStatRoot{…display:flex`，改回 `display:inline` 即报 `MISS the counts chip sits in a flex box, not a line box`），计数块**必须挂在行的字号轴上**（换回固定像素即报 `MISS the counts chip is sized on the row axis, not a fixed height`）。

## Unreleased (wait clock)

**状态行右边多了一个等待时钟：模型拿到这一轮多久了，前 3 秒不显示秒数，过十秒挂「暂未响应」。**

上游 0.2.0 的这条功能，模型部分照搬、接线按本 fork 的版面重做：

- `src/client/waiting-clock.ts` —— **逐字照搬**上游的纯模型。`handsBackToModel` 判定「这个节点是否把球交回给模型」，`waitingAnchor` 从后往前找**最后一次交棒**的时间（工具返回、上下文注入、命令结束、用户发言），而不是轮次开始——否则一个刚开始的等待会继承工具已经花掉的分钟数。`HANDOVER_KINDS` 用 `satisfies readonly ChatNodeKind[]` 对着宿主的 kind 联合类型做检查：写错一个名字是 `tsc` 失败，而不是运行时静默失效。
- `src/client/WaitClock.tsx` —— 主体照搬（每 250ms 刷新、显示 `formatRunDuration` 的秒数、`WAIT_OVERTIME_MS` 10 秒后追加「暂未响应」徽标、数字走 `tabular-nums`），**一处本 fork 的改动**：`WAIT_COUNT_FROM_MS = 3_000`，前 3 秒什么都不渲染。理由：等待通常比 3 秒短，数字一出现就把眼睛拉到一个还没来得及读就已经结束的东西上；3 秒大致是「一拍」变成「有点久」的地方，也是读数第一次真的带来新信息的时候。

  第一版把读数**挂载着但设为 `visibility: hidden`**，想的是"宽度先占住、出现时不推动箭头"。实际效果是在标签和箭头之间留了三秒**空槽**——比它要防的那一次位移更糟，所以改掉了。现在前 3 秒完全不渲染（连 8px 外边距都没有），代价是读数出现时箭头动一次，而这正是状态文案本身变化时也会发生的同一种移动；读数随后带上宽度下限 `min-width: calc(2ch + 1em)`（两个数字 + 秒，覆盖第 3 秒到第 59 秒），所以计数本身不再推动任何东西，过一分钟数字真的变宽、那一行才真的变长。
- **接线不同**：上游把它做成整条 transcript 下面独立的一行 `WaitingStatus`（「深度求索中…」）；本 fork 的状态行本来就属于**每一轮**（disclosure 按钮里那一行），所以时钟挂进 `GroupStatus`，跟在「正在思考 / 正在输出 / 正在准备回复 / 正在处理」后面。

**什么时候计时**（判据来自上游的 `isAwaitingModel`，按"一组"改写）：

- 轮次已闭合 → 不计时；
- 有 pending interaction（该你回答或确认）→ 不计时，那时行里写的是「等待你的操作」；
- 末尾节点是 assistant-step：**产出过 block 就不计时**（等待已经结束），只有「还在跑且一个 block 都没有」才计时——请求已发出、模型还没吐字，正是该计时的那一刻；
- 其余看最后那个节点是否 `handsBackToModel`。**工具还在跑就不算等待**（忙的是工具，不是模型），这一点靠「已返回的调用带 `kind: 'tool-result'`」区分。

时钟按 `key={anchor.key}` 重挂，所以一次新的交棒拿到自己的新时钟，而不是继承上一个等待已经走过的秒数。

样式取上游那三条选择器的原样（`.waitClock` / `.waitSeconds` / `.waitOvertime`，含 `--dsw-alias-label-caption`、`--dsw-alias-state-warning-primary` 的兜底值），外面套一个 `.statusLine` 让时钟与标签同行。四条 guard 加进 `check-bundle-markers.mjs`：时钟的 `data-reader-wait-clock`、超时的 `data-reader-wait-badge`、**前 3 秒不计数**（内联后的 `if (waited < 3e3) return null;` 与宽度下限 `min-width:calc(2ch + 1em)`），以及**锚点必须走 `group.keys`**（按形状断言；锚点算法换了它仍成立，而"从轮次开始计时"这个 bug 会让它失败）。

那条 3 秒的 marker 被阴性测试逼着改了两次，两次都是"它根本没在保护规则"：第一版写成 `/WAIT_COUNT_FROM_MS/`，对一个本该失败的样本照样通过（子串匹配，而且测试脚本只替换了第一处出现）；第二版钉的 `WAIT_COUNT_FROM_MS = 3e3` 在这版实现里也失效了——它只被读一处，构建会**内联**它，常量根本不进产物（也就是说同一条 marker 上一版通过、这一版失败，而源码语义没变）。现在它钉的是**产物的行为**：`if (waited < 3e3) return null;` 与 `min-width:calc(2ch + 1em)`。两半都实测能失败：把阈值改成 `0`、或把宽度下限去掉，各报一次 `MISS`；两次还原后 sha256 一致、`BUNDLE STATE OK`。

## Unreleased (animation deadlines)

**每个 `fill: 'both'` 的 Web Animation 都配了一条墙上时钟兜底。**

`fill: 'both'` 会把动画的起始姿态一直钉住，直到有人取消它。于是**永远走不到 `onfinish` 的动画会把行固定在开帧上**——在阅读视图里就是「点了展开，什么都没发生」（上游 0.2.0 记的正是这个症状：被重跑取消、被卸载、或者合成器直接跳过）。上游的修法是给每个这样的动画配 `setTimeout(settle, 时长 + 240ms)`，并让 `settle` 同时干两件事：提交状态、撤掉 fill；duration 之后那 240ms 余量是上游给的。

本 fork 有三处，**上游只覆盖了其中两处**：

- `motion.tsx` 的 `ProcessFragment`（展开与收起共用一条，260ms）——上游同款；
- `ReasoningCard.tsx` 的尺寸动画（300ms）——上游同款。它卡住的样子是：`fill:'both'` 钉住起始高度，而为了让第一帧能收起临时设的 `max-height: none` 还留在身上，于是「可滚动阅读 / 展开阅读」这个开关看着像坏了；
- `motion.tsx` 的 `RetiringContent`（旧旁白退场，220ms）——**上游没加**。它的失败形态正好相反：`fill:'both'` 钉住收起帧，动画卡住时 `present` 永远为 true，已经退场的旁白就留在屏幕上不消失。按同一条规则补上，注释里写明这是上游没覆盖的那一处。

`settle` 保留了本 fork 原本更强的守卫（`running.current !== animation` 时什么都不做），所以一次 effect 重跑不会让旧动画提交过期状态；layout effect 的 cleanup 负责清掉那条计时器，onfinish 与计时器之间靠 `settled` 去重。

配套加了一条 guard（`check-bundle-markers.mjs`）：**产物里 `fill: "both"` 的处数必须等于 `clearTimeout(deadline)` 的处数**。比计数而不是钉死三个数字，是因为 duration 会被构建折成常量（源码里的 `260 + 240` 在产物里是 `500`），钉数字等于在断言一个源码里根本看不到的值；而计数是语义不变量——新加一个 `fill:'both'` 动画却忘了兜底，这里就会 MISS。这条 marker「能失败」是实测的：把产物里一个 `clearTimeout(deadline)` 改名后它报 `MISS every fill:both animation arms a wall-clock deadline`，还原后 `BUNDLE STATE OK`，且还原前后产物 sha256 一致。

## Unreleased (streaming pace)

**文字显现的节奏改成跟着源的速率走；一次到达的一批词在同一个短窗口里落下。**

这两处来自上游 0.2.0，而且是**逐字节照搬**：`src/client/stream-buffer.ts` 与 `src/client/word-timeline.ts` 现在和上游 tag `v0.2.0` 上的同名文件完全相同，两个单测文件（`tests/stream-buffer.test.ts`、`tests/word-timeline.test.ts`）也是。

- **feed-forward**：原来只有比例项 `rate = max(minimumRate, remaining * 1000 / windowMs)`，而比例控制器**每个窗口正好排空一个窗口**，于是显示恒定落后 `catchUpMs`——75 字符/秒时"顺滑但永远读不到最新"，1000 字符/秒时永远追不上。现在加了到达速率的 EWMA（`rateWeight: 0.35`；间隔超过 `rateGapMs: 250` 视为两次运行之间的停顿，不污染估计），`rate = rateEwma + remaining * 1000 / windowMs`：前馈负责跟上源，比例项负责把抖动留下的积压排掉，延迟于是**衰减**而不是停在某个常数上。配套调参：窗口 180→520ms、`minimumRate` 100→260、`maxQueuedMs` 240→600——最后这个必须大于窗口，否则决定节奏的就变成队列上限那个兜底了。
- **批量节奏**：批内节奏原来只有一条固定间隔（`WORD_MOTION.gap`，60ms）——按字面读就是"最多 16 词/秒"，但那不是它实际的样子：出生时间同时还有 `maxDelay`（240ms）这道上限，所以**一批 N 个词实际铺开 `min(60 × (N−1), 240)` 毫秒**，前几个词是 60ms 一颗，第四、五个之后由 240ms 那道上限接管。改法是先数这批到了几个词，`gap = clamp(batchMs / arriving, minGap, gap)`，并把出生时间上限收到 `now + batchMs`：动画时钟永远不会比最新文字超前超过一个窗口，队列也就无法形成。单独到达的一个词（`arriving === 1`）仍走原来的 60ms 打字节奏。

**实测**（旧版用 `git show c512c18:` 取出，两版真模块喂同一条源时间线、16ms 帧，也就是阅读视图 rAF 循环的节奏）：

- 稳态下"最新可见字符的年龄"：60 字符/秒时新旧都是 16ms（慢源本来就没受影响）；300 字符/秒旧版 **160ms 恒定**、新版 0ms；1000 字符/秒旧版 160ms 恒定（3 秒后仍差 164 字）、新版 0ms。
- 一批词同时到达时动画铺开：3 个词旧 120ms→新 60ms；20 个词旧 240ms→新 85.5ms；60 个词旧 240ms→新 90ms。持续流式（每帧 3 词、约 188 词/秒到达）时，旧版最远把动画排到 240ms 之后、新版只排到 90ms 之后。
- **代价也记下来**：轮次中途来一次 1000 字突发然后停顿，旧版 240ms 全部上屏（那是它 240ms 的队列年龄上限在兜底），新版 608ms（上限涨到 600ms，且必须大于 520ms 的窗口，否则兜底就变成节奏本身）；随后继续以 300 字符/秒输出时，新版 t=800ms 落后 416ms、t=1.6s 64ms、t=3s **0ms**，而旧版从头到尾都是 160ms、不收敛。

两个单测随之更新，而且断言从"被调参钉死的数字"换成了**不变量**，因为节奏本来就是会被调的：批量那条改成「一批词按同一时钟、顺序、且全部落在 `batchMs` 窗口内」，另加「单独到达的一个词不能被排到过去」；缓冲那条不再写死 256ms，改用 `STREAM_TIMING.catchUpMs * 2`，并新增「第一帧必须立即出现」（`firstFrameAt <= 32`）。

上游 `streaming.tsx` 里同时改动的 `paused` / `resumed` handoff（折叠编排期间继续吸收源、只在交接时限制追赶）**没有一起搬**：那属于折叠编排那套，本 fork 没有 `ChoreographedFlow`，也就没有那个 `paused` 状态。那个文件里属于本次改动的另一处只有一行：`STREAM_TIMING` 是它导入却没用到的名字，一并删掉（`WORD_MOTION` 仍在用，`maxDelay` 也仍由 `streaming.tsx` 的收尾计时器读着，没变成死常量）。

## Unreleased (settings hints)

**设置面板里的「说明」改成挂在该行 `title` 上的原生悬停框；末尾那句操作提示删掉了。**

面板里那些一句话解释（「新到文字柔和显现，过程平滑展开」「折起你正在看的那一轮」）不再占一行灰字，也不再自绘：整句挂在该行的 `title` 上、由浏览器弹框——和「viewtune ⚙」按钮、「收起」是同一套机制。整个视图只有一种悬停语言，也没有第二种框要维护：不用定位（阅读视图根 `.root` 声明了 `container-type: inline-size`，即 layout containment，`position: fixed` 的气泡在这样的根里会被按**根的起点**摆放）、不用配色、不用把它接到「动效」开关上。行也因此不必为说明留一行：有说明和没说明的行一样高。

选原生换来的代价，一并写清楚，免得当成免费：浏览器那个框有自己的延迟；样式由浏览器定，跟主题无关；可靠触发只有鼠标悬停（键盘聚焦弹不弹由浏览器决定，触屏没有悬停）；它也基本不进无障碍树——这些行不是可聚焦元素，屏幕阅读器没有可念的对象。要自绘的深色框、或者给屏幕阅读器留一句，都还在桌上，加回来只在 `SettingsMenu` 一处。

**没有跟着进 title 的三类**，因为它们不是说明而是状态：动效被系统覆盖时那句「已按系统的『减少动态效果』关闭」、录制中的「按下新的组合…（Esc 取消，Backspace 清除）」、以及组合被拒（缺修饰键／被浏览器占用／与另一个动作冲突）的报错。这些写在行里常显，而且此时该行**不带 `title`**——否则框会盖住读者正在回应的那句话。

顺带删掉「改键后立即生效并保存下来；清除后该项没有快捷键，不影响按钮本身。」这句：设置页的形状已经足够直观，不需要操作说明。它用的 `.settingsEmpty` 样式也随之删掉，不留死代码。

另外把「Upstream releases」那一段的两处错记改了：`0.2.0` 底下原本记的是上游**没发布的开发笔记**（上游把它并进了 0.1.1），`0.2.1` 底下原本记的是一次没成为发布的提交。两处都按上游 tag 上的 `CHANGELOG.md` 重写，并给每个上游发布补了日期和层级（此前 `0.2.0` / `0.1.0` 与本文档自己的版本同级，读起来像是本 fork 发的）。

## 0.3.0-relayout.14

本次发布的条目按主题倒序列在下面。旧主题的标题只降了一级、去掉了 `Unreleased` 字样，正文一个字
没动——记录用的措辞与当时的讨论保持原样。

### configurable shortcuts

**新功能：设置面板的「快捷键」页不再是占位——本插件自己的两个快捷键可以改了。**

先把现状说清楚，因为它决定了这一页能做什么：查过已安装的 harness，**DSH 本体没有应用级快捷键这一层**（没有快捷键注册表、没有任何 `aria-keyshortcuts`、也没有「快捷键」文案），存在的都是组件级按键——输入框的 Enter 提交 / Shift+Enter 换行 / Ctrl-Cmd+Enter 加速提交（忙时作为 steering 插进当前运行）、Escape 关弹层、方向键在菜单与页签里移动。**所以「能配置的」只有我们自己加的那两个**：收起本轮、收起全部。

这一版把它们做成可配置：

- 绑定存在 `store.ts` 的 `dsh.reader.v1` 里，**只记改动**：键缺失 = 用默认（`Alt+C` / `Alt+Shift+C`），空字符串 = 清除。持久化是**整体替换**而不是与 `init` 合并，所以旧记录里根本没有这个字段——读取端一律带回退，写入端自己补字段。
- 绑定用 **`aria-keyshortcuts` 的语法**存（`Alt+Shift+C`），于是按钮上那个属性、tooltip 里那个提示、监听器匹配的**是同一个字符串**；tooltip 与 `aria-keyshortcuts` 现在跟着绑定走（清空则整个属性省略）。
- 录制就在行里：点键帽 → 「按下新的组合…」，`Esc` 取消，`Backspace`/`Delete` 清除。录制期间**吞掉按键**（`preventDefault` + `stopPropagation`）：否则正在按的组合会顺手触发已经在用的那个快捷键，`Esc` 也会被面板自己的关闭逻辑抢走。
- 两条校验、一条冲突检测（纯模型 `src/client/shortcuts.ts` + `tests/shortcuts.test.ts`）：**必须带 Alt/Ctrl/Cmd**（只按 Shift 仍然是打字，裸字母会被输入框吞掉）；**拒绝浏览器已占用的组合**（`Ctrl/Cmd + C/V/X/A/Z/F/S/P/N/T/W`、`Alt+Tab/F4`）——在文档级监听里 `preventDefault` 掉复制粘贴，比让快捷键换个字母糟糕得多；两个动作不能绑同一个组合。
- 匹配是**精确**的（四个修饰键逐一比较），所以 `Alt+C` 不会被 `Ctrl+Alt+C` 触发；而 `Ctrl+C` 被拒绝之后，页面里的复制依旧是复制。
- **键数不固定**（这条特意说明，因为默认值看起来像规则）：`收起` 默认 2 键、`全部收起` 默认 3 键只是默认值，模型**从不数键**——任意修饰键层级 + 末尾一个主键都行，`Alt+J` 给「全部收起」或 `Alt+Control+Shift+K` 给「收起」都合法。测试里专门钉了一条，免得以后被"顺手加个对称性校验"破坏。

面板为此加宽到 280px（两行「动作名 + 键帽 + 清除」在 252px 里太挤）。守卫换了口径：`check-collapse-control.mjs` 原先断言的是写死的 `event.code !== "KeyC"` 与 `"aria-keyshortcuts": "Alt+C"` **字面量**，现在断言的是**接线**——处理器用配置值匹配、属性与 tooltip 跟随绑定、默认值只有一处表；另加一条标记盯住这一页。

### settings

**新功能：工具栏右侧的「动效」开关变成一个设置入口——`viewtune ⚙`，点开是个小面板，动效开关搬进去了。**

先说为什么不是「在工具栏上再加几个开关」：工具栏是一条**钉住的、几何被断言的**车道（`test-toolbar-geometry.mjs` 会核它上下留白是否对称、「收起」那颗胶囊的描边要不要和分隔线同款），而且是 `justify-content: space-between`——左边「收起」，右边原来那个「动效」。每加一个开关，都从「收起」身上拿走横向空间。所以偏好改成**面板里的一行**：以后加偏好就是加一行，车道宽度不变。

面板是个 disclosure，不是模态：按钮带 `aria-expanded`/`aria-controls`，面板是 `role="group"`，DOM 顺序紧跟按钮（Tab 自然进得去），**Esc 关闭并把焦点还给按钮**，点面板外任意处也关闭——不做焦点陷阱，因为面板后面的正文仍然可读，读者往往只是想顺手关掉动效。

动效那一行用产品自带的 `Switch`（受控 + 自带无障碍名）。开关显示的是**存下来的偏好**（`store.ts` 的 `motion`，持久化在 `dsh.reader.v1`）；是否真的生效还取决于系统设置，这一点没丢——偏好开着但系统要求减少动态效果时，行下面写「已按系统的『减少动态效果』关闭」（原来这条信息在按钮文字里，是「动效 · 跟随系统关闭」）。

顺带一处耦合：「收起」消失后焦点原来回退到「动效」按钮，现在回退到设置按钮（`settingsRef`）；`check-collapse-control.mjs` 的焦点回退断言按标识符计数，照旧通过。`check-bundle-markers.mjs` 加了一条，防止这个面板被悄悄拆掉。

**你上手之后发现的，都修了：**

- **在面板里把动效打开时，面板会闪一下。** 入场动画原来挂在 `[data-motion=off] .settingsPanel { animation: none; }` 这条门上，而你在面板里打开动效，那扇门恰好抬起——`animation: settingsIn` 于是被**重新应用**，入场又播了一遍。现在「这一次开要不要动」在**打开那一刻**定下来（`SettingsMenu` 的 `reveal` 状态，动画只挂在 `.settingsPanelIn` 上），开关再也碰不到面板；偏好与系统设置照旧生效（`motion` 里已经折进了系统那一项）。守卫里加了条 `forbidden` 专门盯这个坑：面板的入场不得由状态属性开关。
- **`viewtune` 的字大一点点**：12px → 13px，只加在 `.settingsButton` 上。没有碰 `.textButton`——「全部收起」的字体是它和工具栏递下去的，工具栏几何守卫依赖这一点。

- **「收起 / 全部收起」也跟着刷新一下。** 你观察对了一半，而那一半正好解释了这个闪：这两颗按钮的**入场**（`readerCollapseIn`）一直就挂在 `[data-motion=off]` 上——所以你打开动效时那扇门抬起，停在屏幕上的按钮就把入场又播了一遍，跟面板那个是完全同一个病。而**退场**（`readerCollapseOut`）是当年**故意豁免**的，理由就在守卫里：退场才是真正把控件藏起来的那一半，若被覆盖，控件会靠一个 reduced-motion 也可能被丢掉的 transition 留在无障碍树里。

  现在两半都归开关管，并且换掉了「移除动画」这种会重播的手法：门里改成**同名、零时长**的简写（`animation: readerCollapseIn 0s ease-out` / `readerCollapseOut 0s ease-in both`）——动画名没变，所以不重播；时长 0，所以立即结束；开关再也不碰已经画出来的像素。退场那半同时去掉 `transition: visibility 0s linear 140ms`：那个延迟的意义是「等退场演完再隐藏」，没有退场可等时它只会留下一个幽灵。系统级减少动态效果照旧经 `data-motion` 走同一条路，`@media (prefers-reduced-motion)` 那条保险仍然只压入场。

  守卫 `test-collapse-fade.mjs` 的口径随之从「motion off 只压入场」改成「motion off 把两半都立即结束、且退场不留幽灵」。顺带一条经验：门里不能写光秃秃的 `animation-duration: 0s`——浏览器会把它合并进简写，但守卫是按属性名查声明的简化级联，它看不见，断言会误报。用同名简写，浏览器和守卫看到的是同一件事。

改这次的 CSS 还顺带暴露了一条**守卫工具的缺陷**：`bundle-anchors.mjs` 的 `normaliseCss` 在文档里声称会剥掉「keyframe-name hashes」，实现却是一份**手写的关键帧名清单**（`readerCollapse…|thinkShimmer|slideUp|…`）。于是新加一个关键帧（这次的 `settingsIn`），`verify-build` 就把「两次构建的哈希前缀不同」报成「规则声明不同」——`shipped: [".settingsPanelIn"] vs rebuilt: []`，读起来像行为回归，其实只是哈希。现在按**形状**剥前缀（`<hash>_<local>`），与类名那条同源：文档说的本来就是这件事，只是实现没做到。

**再加一层结构：面板分页。** 顶上多了「视效」「快捷键」两个页签——`role="tab"` 配 roving tabindex，方向键 / Home / End 把**焦点和选中一起**移动（就是工具账本里那套；这个视图里不该有第二处要靠猜的键盘交互）。「视效」页放着动效开关；「快捷键」页先只放一句占位说明，列出目前内置的两个固定动作（Alt+C、Alt+Shift+C），等你决定要做哪些设置时，加一行就是加一项。页签是**导航状态不是偏好**，只活在打开期间，不写进 `dsh.reader.v1`。顺手把外部点击关闭换成了产品自己的 `useDismissOnOutsidePointer`（我手写的那段正是它的复制品）。

页签的**皮**照抄产品会话头那三个（阅读/对话/轨迹）：选中文字转 `--dsw-alias-state-business-primary`，底下一段 **2px 同色圆角横线**用 `::after` 压在行下那条 `.5px` 分隔线上（`bottom: -1px`），未选中是 `label-tertiary`。**度量与排布仍用面板自己的**——整宽页签、2px 间距、13px/20px、标签位置一律不动（第一版我连字号和排布一起照搬了产品：36px 行距、`font-weight:500`、16px 行高，那是多改的，已改回）。横线挂在页签自己的盒子上，所以底部内边距取「原来的行内边距 6px + 原来的页签内边距 5px」，标签因此纹丝不动。

**页签的蓝线会滑过去。** 改成一根**共享的滑杆**——挂在页签行自己的 `::after` 上，切页时用 `transform` 从「视效」平移到「快捷键」（180ms `cubic-bezier(.22,1,.36,1)`），文字颜色同时用 160ms 过渡，切换读起来是一个动作。原来每个页签各有一条 `::after`，那种结构只能「出现/消失」，滑不起来。两页签是 `flex: 1` 等宽的，所以几何不用测量：滑杆宽度正好是一个页签，第二站的 `+2px` 就是行自己的间距。两半都归动效开关管——`[data-motion=off]` 下 `transition: none`，直接跳过去。这一次**不需要**额外的 `prefers-reduced-motion` 媒体查询：系统那项已经折进 `data-motion`，而且 `transition` 不像 `animation` 那样会在门抬起时重播（上一节那个闪的教训只适用于 animation）。

### tool presentation

**修复：`ask_user_question`（提问）和 `present`（交付文件）在流程里显示成 "Tool call"——不是设计如此，是移植漏了。**

你问的这两条我都查了，结论是：**产品给它们各做了一张卡，而阅读视图没有消费那套机制**。DSH 客户端有一个按工具名选渲染器的 keyed 槽位 **`tool.call.toolview`**，键命中会**替换**通用行（这件事本仓库 `tool-call-model.ts` 的注释里就写着）。已安装 harness 里实际注册的键有：`dsh-client-ui-tool` 的 `ask_user_question`（→ `AskQuestionRow`）、`bash`、`read`、`read_image`、`edit`、`write`、`grep`、`glob`、`todo_write`、`web_search`、`web_fetch`，`dsh-client-ui-deliverables` 的 `present`（→ `PresentRow`），以及 `ui-skill` / `ui-cordis` 的几个。对照本仓库的 `TOOL_VARIANTS` / `TOOL_TITLES`，**漏了四个**：`ask_user_question`、`present`、`read_image`、`todo_write`。

漏掉的不止是名字：`others` 变体的摘要槽读不到顶层字符串参数时会退回**原始参数 JSON 的首行**，所以那两行长得像 `Tool call | {"questions":[{"id":"…`。

这一版按「把四个名字补进本仓库自己的行词汇」做（自洽，不新增对产品槽位契约的依赖）：

| 工具 | 行 | 结果体 |
| --- | --- | --- |
| `ask_user_question` | 标题 `Question`，摘要为第一个问题（多个时 `N 个问题 · …`） | 一张卡：问题用 tertiary、回答用 primary，逐条配对 |
| `present` | 标题 `Deliveries`，摘要 `N 个文件 · a.md、b.md`（多于两个缀「等」） | 交付清单：路径 + 说明 |
| `read_image` | 归入 `read` 行族，标题 `Read image` | 图片本身仍由 `ToolMedia` 渲染 |
| `todo_write` | 标题 `Todo`，摘要 `1/2 完成` | 沿用通用结果 |

图标也得跟着改：这四条以前都落在 `other` 类，用那颗**通用星星**，而产品给它们各有图案。现在按产品的口径归类——`ask_user_question` → `IconQuestionOutline14`、`todo_write` → `IconChecklistOutline14`、`read_image` 归入 read 家族（产品那边它的行就是 read 行，用 `IconBrowseOutline16`）。`present` 照产品来：那张交付行**没有图案**，用的是 `StateDot`（状态点），本仓库同样用点，并按行的阶段映射到 `ongoing`/`done`/`warning`/`error`。归类由 `tool-activity.ts` 的 `ToolCategory` 承担，图标表的键类型是 `Exclude<ToolCategory, 'delivery'>`——每个有图案的类都必须有图标，漏一个编译就过不去。

提问卡的配对是**严格**的：按问题 id 配对，结果里没有对应 id 的问题显示「未回答」，重复 id 丢掉——配错会让读者以为自己做了一个其实没做过的选择。这条规则由新增的 `tests/question-card.test.ts` 与 `tests/tool-row-model.test.ts` 覆盖（测试文件 12 → 14），`check-bundle-markers.mjs` 另加两条标记，防止这两张卡以后被改回通用行。

还没做的是**更彻底的那条**：让本仓库成为 `tool.call.toolview` 的 owner（`children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } }`，就是 `ui-tool` 的写法），产品以后新增的卡片便自动就有、不必再维护镜像表。代价是新增对产品槽位契约（`ToolCallOwnerProps`）的依赖，而且那些卡是聊天 UI 的样式。

### disclosure animation

**修复：展开和收起的动画，终点都比 DOM 实际停下来的位置早一步——所以两处都在动画结束时"啪"地跳一下。**

**展开**：长思考卡片底部那行「可滚动阅读 / 展开阅读」在动画里没有，播完才顶出来。终点高度是我在**父组件**的 layout effect 里读一次 `scrollHeight` 就冻住的，而那一行是**思考卡片自己**在自己的 layout effect 里量出"我溢出了"之后才渲染的——子 effect 先跑、父 effect 后跑，子组件排的那个 state 更新要等这一批 effect 全跑完才 flush。卡片在绘制前就补上了那一行（第一帧它已经在 DOM 里），可它那 ~38px 不在终点里，被 `.disclosureBody { overflow: hidden }` 整段动画裁掉，最后 `height: auto` 接管时才跳出来。

现在终点**跟着内容走**：动画期间用 `ResizeObserver` 盯**内容盒**（不是 body 本身——body 每帧都在变，内容只在子树真长大时变），一变高就 `effect.setKeyframes()` 把终点补上。修正在**同一帧绘制之前**生效（插入 → 布局 → RO 回调 → 绘制），所以不会出现"前半段按旧终点走、某一刻拐一下"。

**收起**：动画末尾停在"流程里上一条的末尾"，回答离折叠开关还有很长一段空白，播完才瞬移上去。原因不是高度，是**弹性间隙**。`.mainFlow` 是 `display: flex; flex-direction: column; gap: 16px`，而 `BlockBoundary` 只是错误边界、不产生 DOM，所以那些 `.disclosureBody` 就是直接的 flex 子项。**移走一条项目，带走的是「它的高度 + 一条 gap」**；而动画只把高度收到 0——每条步骤留下一条 gap（4~6 条步骤就是 64~96px 空白），等 `present=false` 卸载，gap 才随之消失。

现在让间隙**跟着高度一起走**：正在收起的帧自己带一个 gap 大小的负 margin，外框尺寸变成 `−g`，正好抵消旁边那条 gap，它和高度在同一组关键帧里动。

| 这一帧的位置 | 动画最后一帧 | 卸载之后 |
| --- | --- | --- |
| 中间项 | `h_A + g + (0 − g) + g + h_C = h_A + g + h_C` | 移除它 → 同式 |
| 末项 | `h_A + g + (0 − g) = h_A` | 移除它 → 同式 |

于是**最后一帧的布局就已经是卸载后的布局**，之后 `present` 变 false 不再改变任何东西。展开方向是同一组关键帧反过来（`−g → 0`），所以挂载那一刻也不会先把回答顶下去一格。`motion` 关掉或 `prefers-reduced-motion` 时没有动画，但内联样式同样是"高度 0 + 负 margin"，静止状态一致，不会跳；被反向打断时从实际 margin 续接。

**一处更正写在前面**：我最初说"用 `margin-bottom` 抵不到末项、会留 16px 残跳"——**这是错的**。gap 插在帧的 margin box **之前**，所以一个 gap 的负 margin 放在哪一侧，消掉的都正好是它被移除时会消掉的那一条；重新算过（上表），两种都成立。代码用 `margin-top`，注释里是算得准的那句。保留的唯一限制：只有 flex/grid 父容器才用 `row-gap` 排队（block 父容器可以带这个属性却什么都不做），所以先看 `display`；帧在某容器里是独子时为 0。

两处改动都在 `ProcessFragment` 一个函数里（展开：终点跟随内容；收起：终点含该帧带走的 gap）。

### 滚轮完全交给浏览器

**改动：跨过底边的那一格不再由我拆——剩下的余量直接不要了。** 这是你提的方案，我照做，并把理由记在这里。

你说的现象和机制都对：那一格我先 `preventDefault()`，再把卡片吃不下的部分用 `host.scrollBy(0, 余量)` 补给会话。`scrollBy` 是**程序化写入、一帧到位**，而浏览器的滚轮滚动是**合成器动画**——于是每到最后那一格就出现一个硬台阶。

现在**滚动完全归浏览器**。滚轮处理器不再拦任何一格、不再写任何滚动位置，只做它真正该做的两件事：

```ts
let wheelUntil = 0;
const onWheel = (event: WheelEvent) => {
  if (!event.deltaY) return;
  if (automatic) pause();                       // 读者一滚，自动跟随让位
  wheelUntil = Date.now() + WHEEL_IDLE_MS;      // 这次手势引起的 scroll 事件不进 React 状态
};
```

`splitNotch` / `REMAINDER_EPSILON_PX`（以及判据、host 查找、两处写入）**整个删掉**了：没有任何调用者。

**代价（你选的，也是对的）**：滚轮落在卡片上时，浏览器把这个滚动节点闩住，**只有卡片完全不能滚时才会把整格上链**，所以跨过底边那一格里、卡片吃不下的部分会被**丢掉**：

| 这一格 | 卡片 | 会话 |
| --- | --- | --- |
| 装得下 | 原生滚整格 | 不动 |
| **跨过底边** | **吃掉能吃的（如 76px），余下的丢掉** | **不动**（下一格才开始动） |
| 卡片已在底边 | 不动 | 整格原生链过去 |

丢掉的是"一格以内的余量"（0 到一格之间），而且**一个手势只发生一次**；换来的是任何一格都不再有程序化台阶。真实浏览器实测：三种情形处理器全部 `prevented=false`、`wrote=false`。

**守卫随之换了口径，而且是更强的口径。** 之前几条 marker 都在描述"怎么拆那一格"（投影、越界交棒、恰好写一次、边缘不得拦截）——每一次拆法都变成了台阶。现在只剩一条：**`wheel-leaves-scrolling-to-the-browser`** —— 处理器区域里不得出现 `preventDefault`、`scrollBy`、以及对 `scrollTop` 的任何写入。`test-wheel-handler.mjs` 全部重写为对**每一种格子形状**断言"处理器没消费事件、没写卡片、没写会话、也没伸手要手势之外的东西"，并把浏览器的默认行为照实测建模（闩住时丢余量、完全不能滚时整格上链、line 模式按行高换算）。第 10 组是**自证能失败**：把"越界就拆"的旧形状塞进同一套检查，它必须被判红。`test-follow-rules.mjs` 里那 27 条拆分用例删掉了，原处留了一段说明为什么它们不该再存在。

### edge pass-through — superseded, kept as a record

> **更正：这一条只解决了一半。** 它正确地取消了"卡片已在底边时仍拦截"（那让指针停在卡片上的每一格都变成硬跳），但**保留了"跨过底边那一格由我拆"**——而 `host.scrollBy(0, 余量)` 同样是程序化写入，同样是一个台阶。上一节把这一半也去掉了：**余量丢掉，换全程原生**。

**修复：卡片滚到底之后的每一格，都该由浏览器自己滚——之前是我替它滚，所以"跳格"。**

先说清上一条错在哪，因为它比这次改动本身更重要：

1. **上一条的改动几乎是空的。** 我写 `Math.abs(consumed - delta) < REMAINDER_EPSILON_PX`，说它取代了旧的 `Math.abs(remainder) < REMAINDER_EPSILON_PX`——可 `splitNotch` 的定义里 `consumed - delta === -remainder`，两个表达式恒等。你回"没有变化"，是对的。
2. **上一条引用的读数不成立。** 那组"距底 5px 只走 5px、2px 只走 2px"来自一个无头浏览器探针，而它当时（a）连的是 Edge 自己的内部页面而不是探针页，（b）探针页里处理器缺一个闭包变量 `overflow`，每次滚轮都在第一行抛异常。它量到的是**浏览器原生滚动**，不是我的代码。**一条只会说"没问题"的探针，比没有探针更糟。**

真正造成长思考"跳格"的是**卡片已经在底边时仍然拦截**：

```ts
if (consumed === 0) return;                                 // ← 新增：这一格不属于卡片，交还浏览器
if (Math.abs(remainder) < REMAINDER_EPSILON_PX) return;     // 装得下 → 原生滚
event.preventDefault();                                     // 只有"跨过边缘"这一格由我拆
port.scrollTop += consumed;
host.scrollBy(0, remainder);
```

滚轮落在卡片上时，浏览器会**闩住（latch）卡片这个滚动节点**：卡片还能滚，余量就被丢掉；只有卡片**完全不能滚**时才把整格链给会话。所以：

- **卡片已在底边（`consumed === 0`）时必须放行。** 放行后浏览器自己把整格链给会话，走的是和别处相同的合成器动画；而我此前 `preventDefault()` + `host.scrollBy()` 是**程序化写入、一帧到位**——于是"卡片滚完、指针还停在卡片上"期间的**每一格**都变成硬跳，指针一离开卡片就恢复正常。这正是你的描述："卡片内部滚动完之后，再次滚动就开始跳格了，直到鼠标离开卡片。"
- **只有跨过边缘的那一格**必须由我拆，否则浏览器会把整格花在卡片上、把余下的丢掉（这正是"必须再来一格才交棒"的来源）。

**这次在真实浏览器里量过，而且探针先自证没有量错**（Edge + CDP；探针页现在会先报告钩子装上没有、目标是不是那个 `file://` 页面、处理器有没有抛异常，并且抽 `splitNotch` 与 epsilon 常量喂给它）：

| 情形 | 处理器 | 结果 |
| --- | --- | --- |
| 整格落在卡片内 | 不介入（`prevented=false`） | 卡片原生滚 120px |
| 距底 5 / 2 / 1px | 拆一次 | 卡片 +5/2/1，会话 +115/118/119，**合计 120** |
| **卡片已在底边** | **不介入（`prevented=false`）** | **整格 120px 由浏览器链给会话** |

`test-wheel-handler.mjs` 现在把浏览器的默认行为**照实建模**（闩住时丢余量、完全不能滚时整格上链、line 模式按行高换算），并新增两条**在旧产物上必然失败**的断言：边缘那一格不得被消费、连续三格都不得被消费（反向验证：同一份测试跑旧产物 → 2 条 BAD）。守卫侧加 `wheel-lets-the-browser-chain-at-the-edge`：`consumed === 0` 的返回必须出现在 `event.preventDefault()` **之前**。

### projection handoff — superseded, kept as a record

> **更正：这一条把"改了写法"当成了"改了行为"。** 下面的 `Math.abs(consumed - delta) < ε` 与它声称要取代的 `Math.abs(remainder) < ε` 恒等，实际行为一字未变；文中引用的浏览器读数也来自一个没在测量目标代码的探针。仍然成立的部分：交棒判据应当**投影这一格**而不是问"现在在不在边缘"，以及"交棒那一次必须写卡片位置、且只能写一次"。而真正缺的那部分——**已经在边缘时不得拦截，越界那一格也不再拆**——由上面两条补上，最后这一格干脆整个交给浏览器。

**修复：交棒该在"这一格会越过边缘"时就发生，而不是等卡片真的贴到边缘。** 上一条我又把判据写回了"**当前是否已经在边缘**"——只是换成 `atScrollEdge(投影是否被 clamp)`，还给它加了 1px 余量。**方向就是错的，余量救不了**：

滚轮事件在浏览器**应用滚动之前**就派发。所以内容离底边还有 5px 时滚一格：处理器看到"不在边缘"→ 放行 → 浏览器把卡片滚到底；**必须再来一格**才会被判成在边缘 → 交棒。这就是用户说的"要停顿一下才接力"。短思考从一开始就在边缘（不可滚），所以第一格就交棒——这也解释了为什么只有长思考有此症状。

正确的问题是「**这一格会不会越过边缘**」，而不是「现在在不在边缘」：

```ts
const { consumed, remainder } = splitNotch(port.scrollTop, delta, maxOffset);
if (Math.abs(remainder) < REMAINDER_EPSILON_PX) return;  // 卡片吃得下 → 浏览器原生滚
event.preventDefault();                                    // 越界 → 这一次事件内完成交棒
port.scrollTop += consumed;                                // 卡片贴到边缘
host.scrollBy(0, remainder);                               // 越过的那部分交给会话
```

两处判断都抽成纯函数（`splitNotch` / `REMAINDER_EPSILON_PX`），因此可单测。`test-follow-rules.mjs` 扩到 **27 条**：中间时卡片吃下整格、**距底 5px 时卡片只吃 5px 而 115px 同一次交棒**、亚像素缝隙同样当次交棒、在边缘时整格给页面、"吃掉+交出=整格"守恒、卡片永不被超额滚动。并有一条专门喂进**"已经在边缘"那种形状**，确认它确实会吞掉越界的格子——也就是这次修掉的坏形状。

**这里必须更正我上一条的说法**：我曾断言"手势路径不得写卡片位置"。那是对的，但不够——**交棒那一次必须写**（`preventDefault` 之后浏览器不会再滚卡片，只有这一写能让它精确落在边缘）。真正会毁掉平滑度的是**每一格都写**；每手势一次不是。守卫因此从"禁止写入"改为**"处理器内恰好一次写入，且用的是 `consumed`"**。

### edge slack — superseded, kept as a record

**~~修复：交棒判定没有余量~~**（方向错误，见上一条）。我用的判据是精确相等，而 `port.scrollTop` 是小数，于是加了 1px 余量。**余量不是问题所在**：无论余量多少，"当前是否已经在边缘"这个提问方式都会让越界的那一格被卡片吃掉。这段改动已由上面的投影判定取代。

### auto-follow takeover

> **与上面第一条的关系**：这一条是**同一个症状**（长思考滚到底后页面"跳格"）的另一套解释。用户后来的描述——"并非自动跟随，我说的一直是已经完成的轮次"——说明症状与自动跟随无关；可以在真实浏览器里复现的成因是"卡片已在底边时仍被拦截"（见文首）。本条的改动（任何方向的滚轮都解除跟随）**保留**：读者一碰滚轮就算接管，这本身就是对的；但它不是这个症状的解药。

**修复：长思考滚到底后，页面滚动"跳格"（同一个病症的另一半）。** 上一条只治好了卡片内部——短思考已正常，长思考在**卡片滚完、滚动转移到页面之后**仍会跳格，且只要指针还在卡片上就一直如此。

原因在**自动跟随**那侧：`useReadingScroll` 的滚轮处理器只把**向上**滚动当作"读者接管了滚动"：

```js
if (event.deltaY < 0) { following.current = false; setDetached(true); capture(); }
```

而卡片在向下滚时**不会** `preventDefault`（中途交给浏览器原生滚动），事件照常冒泡到页面 scroller。于是向下这一路 `following.current` 一直是 `true`；而卡片在流式输出期间**持续增高**，`ResizeObserver` 每次看到 `following` 为真就**重新武装跟随动画**，那个动画每帧把 `scroll.scrollTop` 往底部写——你的滚动和跟随动画互相拉扯，页面就被一帧一帧拽着跳。

"鼠标离开卡片就好"也对上了：指针在卡片上时事件必经卡片处理器与冒泡路径；移开后由页面原生消费。

**修法**：任何方向、只要真的移动了位移的滚轮都解除跟随（`wheelClaimsScroll`）——读者一碰滚轮，就说明他在自己滚。

**这次改成可单测的行为**：把两个判断抽成纯函数 `isNearTail` / `wheelClaimsScroll`，新增 `test-follow-rules.mjs`（10 条，含一条"能识别只允许向上滚动的坏实现"，避免提取错了还全绿）。这类"方向判断写反"的回归，字符串断言表达不出来。

### native scroll

**修复：手动滚轮时卡片不再"跳格"，因为它不再被脚本写位置。** 上一条把"卡"当成了性能问题，方向错了——你描述的是**没有平滑滚动、位置瞬间跳过去**，而不是掉帧。原因就在滚轮处理器自己身上：

```js
if (Math.abs(consumed) >= .5) port.scrollTop += consumed;   // ← 就是它
```

浏览器本来会用合成器做子像素累积的平滑滚动，而这一行在手势中途把卡片位置**硬写成整数**，于是每次滚动都变成"整数跳一格"。把卡片的位置写回去（哪怕只是为了让它精确停在边缘）都会破坏平滑度——顺滑只能有一个来源：让浏览器自己滚。

现在滚轮处理器**完全不写卡片位置**：只在「卡片已经停在滚轮正推的那一侧边缘」时消费这次滚轮，把**整个** notch 交给会话（`host.scrollBy(0, delta)`）；中途一律不干预，由浏览器原生滚动。代价是卡片尾部最多可能少走一个 notch（旧实现会先把卡片顶到边缘再交棒），换来的是每一次手势都平滑。

**顺带修掉一个真 bug**：`onWheel` 现在读 `overflow`（决定这张卡能否滚动），但那个 effect 的依赖是 `[allowed, pause]` —— `overflow` 被闭包捕获，卡片从"装得下"长到"溢出"后处理器会一直读到旧的 `false`，**永不交棒**。依赖已补上 `overflow`（历史那版本来就是三元素，是重建时退成了两元素）。

这条历史值得记下：这次修复（"不再由脚本写滚动位置"）**早就做过**——`cfcd42f` 里 `atEdge` 那一版就是它。但紧接着的 `0fdfaa1` 把 `port.scrollTop += consumed` 又加了回来，而源码里那次修复没保留下来。所以它一直在产物里有效，直到本仓库改成**从源码构建**，重新构建时才把它退回去。

守卫相应更新：`test-wheel-handler` 从 17 条扩到 **23 条**，新增"处理器从不写卡片""卡在边缘时交棒整个 notch""浏览器原生滚掉最后几像素时页面不动"；`check-bundle-markers` 的滚轮标记改为按语义断言（旧标记找的是已删除的 `remainder` 表达式），并新增两条：**手势路径不得写卡片位置**、**effect 依赖必须包含 `overflow`**。

### scroll spy

**修复：手动滚轮从思考区交接给页面时卡顿。** 原因是阅读视图里有**两个滚动监听器在做同一件测量**：老的"活跃轮次"滚动侦测，与 relayout.13 之前新增的"当前轮"侦测（`收起` 的作用域要用它）。两者各自 `querySelectorAll('[data-reader-turn]')`，再对**每一个**轮次元素读一次 `getBoundingClientRect()` —— 而每次 rect 读取都会强制布局刷新。交接那一刻卡片会写 `scrollTop`、页面会 `scrollBy`，布局随即失效，于是一个滚轮事件要触发**两遍、每遍几十次**强制重排；只要指针还停在思考区上，每个滚轮事件都会继续走这条路，所以表现成"从交接那刻起一直卡，鼠标移开就好"。

现在合并成**一个**滚动监听器、**一次遍历同时算出两个值**（当前轮 + 活跃轮次），并且只查询一次 DOM、把结果传给两侧。滚动监听器数量回到 3 个（与 relayout.3 相同），每次滚动的 DOM 遍历从两遍降为一遍。

`currentTurnOf` 仍然是一个具名函数（`test-current-turn.mjs` 靠它单独验证"横跨两轮取上面那个"这条规则），只是多了一个可选的 `rows` 参数，好让滚动回调复用已查到的元素。`check-collapse-control` 里 6 条与旧写法耦合的断言改为断言不变式，并**新增 4 条断言把这次的回归钉住**：滚动监听器只能有一个、不得再有第二个遍历轮次的侦测、一次查询供两处使用。

### previous

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

**打磨：「全部收起」与「收起」同族。** 它原来是纯文字按钮，现在和「收起」一样有**描边**
（`.5px solid var(--dsw-alias-border-l2)`、`border-radius:999px`）和**同样的进入/退出**
（共用 `readerCollapseIn` / `readerCollapseOut`：自上方向下淡入、向上淡出；`hidden` 上强制
`display`、`idle` 上把可见性变化延后到动画结束——与主控件同一套机制，动效开关与
`prefers-reduced-motion` 的处理一并共用）。两处刻意**不同于**「收起」：**不加任何填充**
（静止无填充，悬停也不加——否则 `.textButton:hover` 的填充会把它变成主按钮；悬停只提亮文字并把描边
升一档到 `l3`，该 token 已用 `inventory-tokens.mjs` 核实存在 `#0000001f` / `#ffffff29`），以及
**不设字号**（它仍走 `.textButton` 的字号，由工具栏下发）。收起组同时加了 6px 间距。

`check-collapse-control` 新增 8 条断言把这些差别钉住，其中"无填充"按**值**断言而不是拼写——
压缩器会把 `background:transparent` 改写成 `background:0 0`。


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

The headings below are **upstream's** releases, kept so this fork can say what it took from where; they are not versions of this fork. Two of them were recorded wrong here and are corrected in this pass. What stood under `0.2.0` was upstream's **unpublished development notes** — upstream says so itself: "Earlier `0.2.0` / `0.2.1` headings were unpublished development notes; those changes ship in this release [0.1.1], not as separate published versions." What stood under `0.2.1` described a commit that never became a release. The entries below are read from upstream's own `CHANGELOG.md` **at the tags**, not from its working tree.

### 0.2.1 — 2026-09-20

- **Pinned reader lanes stop painting over the composer**: the live status row (`执行过程` / `正在使用工具`) pinned at the scrollport top with `z-index: 8`, while the host's sticky composer seat owns `z-index: 7` and nothing between the reader and `<body>` creates a stacking context. A scrolling reader clamps every turn-level sticky lane down into the footer band — the lane stops at its containing block's bottom, which passes behind the input card — so the reader painted its own opaque plate over the composer.
  - The live status lane now owns the measured lane under the toolbar, like the closed summary rows, instead of sharing the toolbar's lane.
  - Lanes a scroll can clamp into the footer band stay below the composer seat (`z-index` 6); only the top toolbar lane keeps 7, which also keeps it above the host's code-block banners.
  - Skin mode no longer carries a second lane ladder of its own.
  - `tests/footer-precedence.test.ts` guards the ladder in the source sheet and in the committed bundle.

### 0.2.0 — 2026-09-18

The release this fork has **not** followed as a release. One item in it — the `data-chat-flow` hook — is already here, taken from the commit before it shipped. Grouped as upstream grouped it:

- **Diff review**: `+N -M` for `write` / `edit`, read from the tool result the host already attaches (`meta.diffs`, `{ path, oldText, newText }`) and falling back to the call's own arguments only for a whitelist of names, because several unrelated tools take a field called `content` and counting those invented additions for calls that changed no file. A parent call folds its children's counts in, so a `run_code` whose edits live one level down does not report what its own arguments contain. The counts sit at the end of the row in green/red and open an **in-flow** panel — one tab per changed file, removed lines on a red wash, added lines on a green one, through the same `DiffBlock` primitive the official tool row renders — never a floating popup, because the flow cell's `overflow: clip` would cut it off.
- **Translucent frosted glass**: an opt-in setting that makes card backgrounds, tool detail frames and code blocks translucent with backdrop blur, and gives sticky lanes the liquid glass of the dsh-auto-memory pane (translucent `bg-layer-2`, `blur(28px)`, hairline border, 16px radius).
- **Folding, back to one switch**: a single 自动折叠 开/关 on the toolbar and in Settings, reasoning and tools completely unfolded when it is off, and multi-level rules removed. A later reasoning step folds only the finished run it follows, so the run that is still streaming stays expanded. Every animated disclosure gets a **wall-clock deadline**, because `fill: 'both'` pins the opening keyframe and a Web Animation that never reaches `onfinish` (cancelled, unmounted, or skipped by the compositor) left the row in the DOM at zero height and zero opacity — clicking it looked like nothing happened. The fold choreography gets the same treatment (a cancelled animation or a hidden tab could hold a phase forever), and the stream buffer keeps absorbing while the reveal is held.
- **Settings**: glass, auto-fold and deliverable open-mode share the root `dsh.reader.v1` store; deliverables open in the system app by default with an optional right-Sidebar preview (folder/reveal stay OS); the generative-mcpapps skill root is detected and reported.
- **Waiting and timing**: a clock showing how long the model has been given the turn, anchored to the last event that handed control to it — a returned tool, an injected context, a run command, the user's message — never to the start of the turn; a 暂未响应 badge past ten seconds, withdrawn the moment the model produces its first block; a tool that is still running is not a wait. The anchor bug behind it was a kind read from the wrong layer (`tool-result` in the conversation contract, `tool-call` in the chat layer the reader sees), which made the branch dead; the kinds are now typed against the host's own union so a wrong name fails `tsc`.
- **Scroll and streaming**: tail-follow detaches only on a real upward move by the reader (content growth and the follow easing also move `scrollTop`, and reading that as "the user left the bottom" froze following mid-turn); browser scroll anchoring is disabled on the conversation scroller while the reader is mounted; only a focused text field suspends following. The reveal gains a **feed-forward** term estimated from the arrival rate on top of the proportional controller — a proportional one drains exactly one window per window and trails live output by a constant `catchUpMs` forever — and a batch of words now lands inside one short window instead of one word per fixed gap, which had capped the reveal at roughly 16 words/second however fast the model wrote. The reasoning pane's own follow steps with the backlog instead of two lines every ~1.3 seconds.
- **Also**: how many sub-agents the turn dispatched, read from the host's own turn-process row rather than counted again; the `command-input` render branch dropped as unreachable (that string is not a chat node kind in any released host); pending-submission image echoes guarded, because `images` / `attachments` may be missing and a text-only send must not crash `conversation.view`; a compaction divider that arrives — rule sweeps out from its centre, pill settles, dial turns once — instead of simply appearing; install guidance naming only conventional relative roots.

### 0.1.1 — 2026-09-16

This is what this changelog used to file under `0.2.0`. It is the release that actually carried those changes (upstream consolidated PRs #2, #5 and #8 into it), so the wording below is unchanged.

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

### 0.1.0

First public release of the accepted reading-view plugin, published as `dsh-better-display`.

- Native context and tool details with source-ordered, unmodified reasoning.
- Bounded long-reasoning cards with two-line following, expanded follow and manual pause/resume.
- Successful-turn process folding with a separate final answer.
- Source-ordered text reveal and quiet busy-state shimmer.
- Stable status typography and compact disclosure spacing.
- Native content fallbacks and a trusted-plugin block extension slot.
- 42 regression tests; no changes to DSH Agent, SDK, providers or core.
