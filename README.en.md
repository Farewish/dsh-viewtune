# dsh-viewtune

[中文](./README.md)

A **reading** tab for DeepSeek Harness: while a turn runs you can see the process — thinking as it is written, tools as they run, which step it is on. When a turn finishes successfully the process folds away and the final answer stays. Over that sits an adjustable skin: a wallpaper, a frosted-glass layer, and a panel that keeps its settings inside the reading tab.

Upstream's Chat / Trajectory tabs, the composer, the model picker, tools and approvals are all untouched; this plugin adds a reading view alongside them.

Targets DeepSeek Harness **0.1.5-rc.2**. Display only — it does not change agent execution, the SDK, or credentials. Node.js `^22.19.0 || >=24`.

## Install

Needs the official `dsh` on PATH (or `npx @deepseek-ai/dsh`) and **pnpm** — `dsh plugin add` runs pnpm inside `$DSH_HOME/profiles/web`.

```sh
# from GitHub
dsh plugin --profile web add github:Farewish/dsh-viewtune

# or from a local directory / tarball
dsh plugin --profile web add ./dsh-viewtune
dsh plugin --profile web add ./dsh-viewtune-0.4.0.tgz
```

**Restart the Host** and reload the page afterwards: `dsh plugin add` only writes the profile, it does not hot-mount a running process.

Remove it with:

```sh
dsh plugin --profile web remove dsh-viewtune
```

Three things that are easy to get wrong:

- `dsh.bundle` is captured **at boot**; do not hand-write the same insert into the profile's `cordis.patch.yml`, or it mounts twice.
- The compiled `lib/` is **committed**, so installing needs no `prepare` and no `allowBuilds` in the profile.
- Do not install this alongside upstream `dsh-better-display`: both bundle patches insert the same entry id, and mounting both duplicates it. `remove` this one first.

## What a turn looks like

A conversation is a sequence of **turns** (a prompt plus its answer), and the reading view is organised by that unit:

- **The process is visible**: thinking, tool calls, subagents and progress are rendered live, so a long turn is more than a spinner; a turn that **finished successfully** folds its process away and keeps the answer, while a running or unfinished one stays open.
- **Every user message comes first**: a turn may open with a system prompt and carry several user / steering messages. They are all rendered, in source order, above the process disclosure — with or without a system prompt, the order is the same:

  ```
  your messages → the disclosure (用时 X 秒, clickable) → the process (system prompt / thinking cards / tools / answer)
  ```

- **Short and long thinking share one frame**: a short thinking card no longer loses its border just because nothing overflowed; heading and body padding match the long one.
- **A wait clock**: while the model is thinking or streaming, the status row shows how long *this turn* has been with the model. It shows **nothing for the first 3 seconds** (most waits are shorter, and a number appearing immediately only pulls the eye), and adds a 「暂未响应」 badge past ten. It is anchored to the **last handover** — a tool returning, context injected, a command finishing, your own message — not to the start of the turn, so a fresh wait does not inherit the minutes the tools already spent; and it does not tick while a tool is running, because then the tool is busy, not the model.
- **A steps pill**: the action row under an answer says which step this answer landed on and how many the turn has, and opens the turn's process record in Chinese prose rather than raw JSON.
- **Changed-line counts**: a tool row that changed files ends with `+N -M` (additions green, deletions red) and opens a per-file diff panel. The counts prefer the host's own `meta.diffs` and only fall back to the call's arguments — and only for the **three tools that actually mutate files**, because several unrelated tools carry a field named `content`; files changed by a child call count towards the row too.
- **Interactive mcp-app cards**: an ````mcp-app```` code block in an answer becomes a live card inside `<iframe sandbox="allow-scripts allow-forms">` — deliberately **without** `allow-same-origin`; the card can fill the composer with the next prompt over JSON-RPC. See [`skills/generative-mcpapps/`](skills/generative-mcpapps/).
- **The wheel over a thinking card belongs to the browser**: the card scrolls natively and chains to the transcript natively at its edge. The one notch that crosses the bottom edge and does not fit is dropped (at most one, once per gesture) — that is the price of never taking a notch away from the browser; a short card with no overflow intercepts nothing at all.

## Toolbar and the collapse control

- **One pinned lane**: 「收起」 and 「viewtune ⚙」 sit in a strip across the top of the reading view, spanning it edge to edge — the divider reaches as far as the host's top bar does, while both controls stay at the text's left edge. It is **pinned under the top bar** as part of the chrome rather than floating over the prose, so it is reachable at any scroll depth.
- **One control, three modes**: 收起 and 全部收起 are merged into one button, because the reading column's left edge has room for exactly one control. When both actions apply, the main button folds **the turn you are reading** and the double chevron beside it folds everything at once (its tooltip and accessible name are 「全部收起」, word for word); when only one applies the button **is** that action, with no chevron. The settings can pin it to a single action.
- **Its scope is the current turn**: the same predicate the reading scroll uses to pick an anchor, and when the viewport straddles two turns it takes **the upper one**.
- Shortcuts **Alt+C / Alt+Shift+C**, rebindable in the settings. If the button disappears because it collapsed itself, focus goes to **the toolbar's other control** rather than the document body.

## The settings panel

Opened by 「viewtune ⚙」, with **three pages** (arrows, Home and End move between them):

- **视效** (look): motion, the frosted glass, its nine dials, and the wallpaper.
- **功能** (behaviour): what this plugin does to the app — the **strip wheel**, **产物用右侧栏打开**, the **reveal cadence**, the **reveal blur**, the **per-word reveal**, the **follow mode**, **自动收起更早流程**, the **reasoning card's follow mode**, its **pace**, and **焦点思考展开**.
- **快捷键**: what the collapse button does, plus recording for this plugin's two bindings (click a key to record, Escape cancels, clearing drops it; combinations without a modifier, or ones the browser already owns, are refused).

One layout rule: a preference is a row and a new subject is a page, so the lane never grows a control wider; and **only an option whose label does not say it all carries a description**, which rides the row's `title` — the browser's own hover box, the same mechanism the button and 收起 use — so it takes no space. Genuine **state** (a system override, a recording in progress, a refused combination) is written in the row instead.

**The defaults are this plugin's shipped ones** (see below: the skin on, the wallpaper shipped with it, the window scope, and a reveal cadence fixed at 60 per second). A stored record only carries the keys a reader **changed**; anything missing falls back to those defaults.

### Frosted glass

With it on, the toolbar, cards, tool frames and code blocks stop painting plates of their own and let the wallpaper and the host's skin through; labels like paths and counts stay transparent until hovered or focused. **Nine dials under the switch** set each surface's opacity:

| Dial | What it moves |
| --- | --- |
| 工具栏 | the top lane's plate, and the 「回到最新」 pill floating over the prose |
| 用户气泡 | your own message's background |
| 卡片与面板 | reasoning cards, tool frames, the system prompt, note boxes |
| 代码块 | fenced code blocks |
| 差异面板 | the diff panel, its file tabs, and inline diffs in a tool's result |
| 滚动条槽位 | the rightmost scrollbar's track |
| 产物标签 | the product-file chips at the end of a turn |
| 用量与步骤胶囊 | the two counters, 「用量 … tok」 and 「… 个步骤」 |
| 输入框 | the host composer's plate (both the reading page and the conversation page) |

`0%` paints nothing at all there; `100%` is the opaque plate of the skin-off look. Surfaces are grouped by what they **are** rather than where they sit (diff paper follows the diff dial wherever it is drawn), and **only surfaces that already have a plate get a dial** — the tool-state label and the `+N -M` count have no resting background, so they are wired to none.

The same skin can reach the **conversation page** (its own switch): the code blocks and user bubbles there follow these dials. A third, independent switch makes the **conversation page a solid page** (the theme's base colour plus a fade above the composer).

### Wallpaper

The plugin **ships a default wallpaper** (`assets/sample-gradient.png`), which the host puts into the reader's folder on first activation — a fresh install opens looking like this, with no picture to find first.

- **Images live in the plugin's own folder**: 「打开文件夹」 creates and opens it (drop files in, then 「刷新」 turns them into a thumbnail list); click one to use it, 「清除」 to go back to **none** — which is a different thing from *no record at all*: the first means you want no wallpaper, the second falls back to the shipped one. Replacing a file under the same name updates both the thumbnail and the backdrop.
- **The browser is never told where that folder is**: it asks for a name, and the host half answers only for image extensions inside that one folder (no svg).
- A **压暗** dial mixes the image toward the theme's background so prose stays readable on top; with the skin on, the cards blur exactly this image.
- The **scope** defaults to the **whole window**: the left column and the top bar show it too (their own plates step aside), and the colours around the composer follow. Turning 「铺满整个窗口」 off restricts it to the reading column, where the image **fills the reading page** (the MAX ratio of image ÷ target, centred, overflow cropped, small images scaled up). The window scope fills with `cover`.
- A **界面遮罩** dial, in the window scope, sets how opaque those two columns stay over their copy of the image — they carry nothing but text, so `0%` is prose straight on a photograph. The image is painted once and the scrim counted once for the window, so the reading area is never darker than the columns beside it.
- The **fade band above the composer** turns the host's opaque gradient into a mask over the same backdrop, so content still fades out smoothly — just into your picture instead of into a colour. All three pages (reading, conversation, trajectory) use the same lift.

### The reveal

Three choices govern how a streaming message grows:

- **Reveal cadence** (default: **a fixed 60 per second**). One publication is one whole render of the growing node: the Markdown tail re-parsed, word identities rebuilt, new word elements mounted, and then the layout every follower below measures. Following the display's refresh rate means **four times** that work on a 240Hz screen, with a pace that depends on whatever the last frame cost. **Following the screen refresh** is therefore the explicit option, and its cost is stated in that row's own description; both cadences drive the **same reveal trajectory** (the advance is a function of the clock), so the fixed one merely samples it less often. Measured on one machine and one page streaming the same kind of long answer: **3430 → 4435–4568 frames per 20s (≈171 → 222–228fps), dropped frames 4 → 2, long tasks 0**, with an idle page back at 4800 (240Hz).
- **Reveal blur** (default on): the reference recipe fades each word in while resolving a 1px blur, and `filter` is **not a property the compositor can animate on its own** — so every animating word repaints its own area on every frame, and with a 350ms reveal and ~50 words per second arriving, a dozen of those repaints overlap. Off, only the fade remains (crisp appearance rather than clearing up).
- **Per-word reveal** (default on): off, the text simply appears, and **no word identities or timeline are built at all** (not just the animation: the segmentation and the birth table go too, and the Markdown path drops its reveal hooks entirely). The pace still comes from the stream buffer, so it still writes itself out.
- **Follow mode** (default: **the per-frame glide**). The glide writes the scroll position on every frame, and every one of those writes fires a scroll event — which is what wakes the scroll spy, the anchor compensation and every measurement around it. Writing the tail directly instead writes once per growth, so all of those go quiet; the cost is that content jumps to the newest line rather than sliding to it.
- **自动收起更早流程** (default **off**). On, and while a turn is streaming, only the turn that is growing keeps its process open: every other turn starts folded — including one that ended without completing, and including the ones you had opened yourself, because a newly started turn clears the stored expansion choices. A folded process **unmounts** its content rather than hiding it, so with this on the other processes take no part in rendering or layout. Opening one yourself still holds until the next turn starts.
- **The reasoning card's own follow mode** (default **自动滚动**). Inside the card the movement has always been one fixed cadence: two lines every 840ms, gliding for 500ms (about 2.4 lines/second, roughly a reading pace, which is why it deliberately falls behind a burst). The three modes keep that pace (自动滚动), aim at the newest line instead (跟随最新), or never move on their own (手动滚动). Takeover, the edge fades and the follow/manual handoff are identical in all three.
- **Its pace** (default **2 lines/second**), four presets. The pace is quantised to whole lines, and the default one works out to exactly the two-line step this card has always taken — so nobody who leaves it alone sees any change.
- **焦点思考展开** (default **off**). On, and the reasoning card that is being written into grows to show its content, up to the ceiling 展开阅读 reaches (`min(60vh, 560px)`). A card asks for the focus while it is the one being written into and you are sitting at the bottom of the transcript; scrolling back up does NOT release it, and only taking the card over, asking for the full height with 展开阅读, or — in 跟随最新 only — the thinking ending returns it to the small card (the other two modes keep their height). Exactly one card holds it, the newest request wins, and while it does the PAGE stops following the tail. The growth is quantised to whole lines, so the layout below it changes per line rather than per publication; the ceiling stays in the stylesheet, and an expanded card draws no edge masks at all.

### The strip wheel

The two handles that set the reading column's width belong to the **shell** and sit **beside** the scroller rather than inside it, so a wheel over them used to do nothing at all. With this switch on (the default) the gesture is forwarded to the transcript:

- **Notch by notch**, a critically damped spring carries the scroller — for a lone notch and for every landing — and its two ends (a flick, a single notch) are the feel to tune.
- **A continuous roll** (intervals of 0.06–0.20 s, about 5–16 notches a second) is carried at the **wheel's own pace** instead: the current notch over the average of the last three intervals. That is what the browser does at a steady hand speed; slower and faster rolls stay notch by notch, because at those speeds ordinary scrolling is not even either.
- A roll needs **two intervals** before it counts as one, and a **pause past 0.2 s** ends it. With the switch off, the event is left exactly as it was found — the behaviour of not having the feature.

## Where the settings live

- One copy in the **browser** (`localStorage`) and one on the **host** (`<instance home>/viewtune-settings.json`). The host's is the one that survives a restart: the GUI is served on an ephemeral port, `localStorage` is keyed by **origin** (scheme + host + port), and a browser-only copy is therefore a new, empty one on every launch — reported as "every time I quit DSH, all of viewtune's settings are reset".
- Changes are written to the host **debounced**, flushed on the way out, and only an **accepted** write is broadcast to the app-wide surfaces (the wallpaper, the scrollbar gutter's dial).

## Known limits (and what it shows when it cannot say)

- **A turn truncated by the history window** shows no step **number**. The host pages by message count, so the topmost turn may be partially loaded and its step count is a local sum, incomparable with the absolute steps in the process record; a too-small denominator misleads, so nothing is shown — a **「步骤记录」** badge appears instead, whose tooltip says 「请完全加载该轮次记录后查看」. It is an **explanation**, not a control: no click, no hover highlight, and no estimated number anywhere.
- **The usage pill occasionally does not appear**, deliberately: the host only reports usage when it can **prove** the turn's accounting. This plugin follows that rather than guessing, and **adds no badge of its own** for it — a missing number is a missing number.
- **The interface copy is Chinese only.** The host offers a locale seat, and this plugin already borrows it to translate two host strings (`message.contextRecall` / `message.contextInjection`), but the plugin's **own** copy is not localised: a full zh/en split needs a locale provider edge in the plugin, which needs a Host restart. That is a trade-off, not an oversight.

## Development

### Build

The browser half is the pre-built `lib/client.js`, which the Host loads directly, and the repository commits it — so **installing and sharing need no build**:

```sh
npm ci                # install from the committed package-lock.json
npm run build         # src/ -> lib/client.js and lib/dsh-viewtune.js
npm run typecheck     # tsc -p tsconfig.json --noEmit, against the real declarations
```

Use `npm ci` rather than `npm install`: `tsdown`, `lightningcss` and `typescript` are all on `^` ranges, and only the lockfile guarantees that another machine installs the toolchain that **reproduces the committed `lib/`** — which is exactly what `verify-build` does inside `npm run guard`. Reach for `npm install` only when a dependency changed, to rewrite the lockfile.

Upstream's `tsdown.config.ts` takes `externalClientBundle` from a Harness adapter that is not published, so it cannot run in a clone. This repository ports its real implementation (the official preset's `clientBundle()`, Harness tag `dsh-v0.1.5-rc.2`) into [`scripts/client-bundle.mjs`](scripts/client-bundle.mjs). The artifact contract is unchanged, so every assertion about the artifact still holds.

Remember to **commit `lib/` with the source**: what other people install is that artifact, not a local build.

### Changing the code

Change `src/`, then `npm run build`. Two identity markers in the artifact must match `package.json`'s `name` exactly, or the whole page fails with `loaded without registering "<id>" via __ModuleLoader__.load`:

- the row id in `window.__ModuleLoader__.load({ id })` (the Host derives it from the installed manifest's package name);
- each CSS module's `tagId` prefix and the `data-plugin` of its `document.createElement("style")` (HMR removes this plugin's styles by plugin id).

`tests/stock-install.test.ts` guards both, and checks that this file and `README.md` install the same package by name.

> **Keep a cloned checkout outside `node_modules`.** `dsh plugin add` runs pnpm in the profile directory, and pnpm prunes directories under `node_modules` that `package.json` does not declare — the checkout, `.git` included, can be deleted with them.

### Verification

Two layers, because they answer different questions:

```sh
npm test        # source layer: Node's own test runner, every test file (31 today)
npm run guard   # artifact layer: 19 invariants, all against the built lib/client.js
```

`npm run guard` inspects the **artifact**: the module table's registered id and `require()` set, the injected CSS literal, turn render order, the collapse control's shape and fade, the toolbar geometry, the settings panel's three pages and the width of its sliding bar, the shipped wallpaper's three spellings and the file itself, the correspondence between `src/` and the artifact, and **"a rebuild still reproduces the committed shape"**. That last one is the only proof of source/artifact agreement available here — byte equality is not (a minifier's output is not stable), so it compares the contract surface and the stylesheet rules.

One premise is worth stating: **parsing (`node --check` passing) is not correctness**. This repository's history is largely direct edits of a minified artifact, which produced syntax that was perfectly legal and still threw at runtime because a reference had been deleted — a class of error only a "is this name declared" check catches, or a rebuild exposes. Both are in `npm run guard`, and every new assertion has been **negative-tested** (fed a doctored artifact to prove it really fails).

## License

MIT, see [LICENSE](LICENSE).

It started from [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display) (MIT): the reading tab, the streaming motion and the Markdown rendering come from there. The presentation and Markdown parts derive from DeepSeek Harness (MIT). Motion references [Transitions.dev](https://transitions.dev/). The default wallpaper shipped with the package is `assets/sample-gradient.png`, made for this repository, and released under the same MIT as the code.
