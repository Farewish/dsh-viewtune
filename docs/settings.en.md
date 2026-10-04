# Settings reference

This document is the companion to [`README.en.md`](../README.en.md): the README says what the plugin is and how to use it;
this one describes **every setting**, its default, and which places that row affects.

**Every default can be checked in the code**, and the source file is named at the end of each section. Several defaults are
values a reader settled on, adopted as the shipped state so that a fresh install already looks that way without adjusting
anything.

---

## The panel

Open it with **viewtune ⚙** on the right of the toolbar. It has **three pages**; arrow keys move between them, `Home` and
`End` jump to the first and last.

| Page | Content |
| --- | --- |
| **视效** (look) | Motion, frosted glass (switch + nine surfaces + two masks + the conversation-page switch + solid background), wallpaper |
| **功能** (behaviour) | Small features (9 rows), the answer display (3 rows), the process display (4 rows) |
| **快捷键** | Recording for this plugin's two bindings |

One layout rule: **a preference is a row** and a new subject is a page, so the toolbar never grows a control wider. **Only
an option whose label does not say it all carries a description**, riding the row's `title` (the browser's own hover box)
so it takes no space. Genuine **state** — a system override, a recording in progress, a refused combination — is written
in the row itself.

---

## 视效 (look)

### Motion (动效)

Controls this plugin's animation and transitions (a card expanding and collapsing, the process opening, the answer's reveal
animation).

- When the system's "reduce motion" setting overrides it, the row says so;
- **It does not decide whether the reasoning card follows.** Following and pausing follow work with motion off; the card
  simply jumps to the newest line instead of gliding there. Handing that switch to a look setting would take a reading
  function away from readers who turned animation off.

*Source: `store.ts` (`motion: true`), `ReasoningCard.tsx` (the follow gate does not read motion).*

### Frosted glass (磨砂玻璃)

The master switch. With it on, the toolbar, cards, tool boxes and code blocks stop painting an opaque background and let
the wallpaper and the host's colours through.

**Every surface has two dials:**

- **Opacity**: how much of the wallpaper this surface lets through. `0%` means the surface paints nothing; `100%` is the
  opaque background of the skin-off look;
- **Blur**: whether what shows through is the image itself or a blur. `0px` means transparency without blur. At the lowest
  value the plugin **removes the property** rather than writing `0px`: `backdrop-filter: blur(0px)` is not the absence of
  blur — it creates a stacking context and hands the paint to the compositor, at a cost that buys nothing.

| Surface | What it covers | Opacity | Blur |
| --- | --- | --- | --- |
| Toolbar | The top toolbar, the 「回到最新」 pill floating over the transcript, and the conversation page's own 「回到底部」 button | 10% | 0px |
| User bubble | The background of your own message | 30% | 3px |
| Cards and panels | The reasoning card, tool boxes, the system prompt, memo boxes | 25% | 8px |
| Code blocks | The background of fenced code blocks | 35% | 25px |
| Diff panel | Diff panels and the added/removed line backgrounds (including the line-number gutter), file labels, inline diffs inside tool results, and the conversation page's 「已编辑 x 个文件」 card (header and hover detail included) plus its per-file deliverable cards (hover colour included) | 30% | 25px |
| Scrollbar gutter | The track of the scrollbar on the right | 20% | — (the gutter is a scrollbar pseudo-element, where blur has no effect, so there is no blur dial) |
| Deliverable bar | The row of deliverable files at the end of a turn | 35% | 5px |
| Usage and steps pills | The two counting pills (「用量 … tok / … 个步骤」) | 30% | 2px |
| Composer | The host composer's background (both pages) | 35% | 10px |

**Two masks** (sidebar mask / header mask) have the same two dials and control the darkening layer over the wallpaper: the
shipped values are **sidebar 25% + 15px** and **header 25% + 5px** (the two blur values are independent). At `0px` the
property is removed here too, so these two elements do not acquire a compositing layer.

**Surfaces are grouped by what they are, not by where they appear**: diff paper belongs to the diff panel whether it is
drawn in the panel or in a tool's result page. **Only a surface that already has a background gets a dial** — tool states
and step counters have no static background in the base look, so they are not attached to any dial.

**Conversation page**: the same skin can be extended to the conversation page (the separate 「为对话页启用」 switch). That
page also has the independent solid-background option (theme background plus a fade above the composer), which does not
depend on the skin.

*Source: `glass.ts` (the nine surfaces and two masks), `wallpaper-scope.ts` (the masks), `conversation-glass.ts` /
`conversation-solid.ts` / `composer-glass.ts` (the conversation page).*

### Wallpaper (壁纸)

A default wallpaper ships with the plugin, `assets/sample-gradient.png`: on first start the host copies it into the
reader's wallpaper folder, so a fresh install already looks like that without finding an image first.

- **Dim**: 0–100, shipped at **50**;
- **Scope**: the whole window, the transcript area only, and so on (`wallpaper-scope.ts`);
- The list comes from the host's wallpaper folder (`/better-display/wallpapers`).

*Source: `wallpaper.ts` (`DEFAULT_WALLPAPER`, `WALLPAPER_DIM_INITIAL = 50`), `wallpaper-scope.ts`.*

---

## 功能 (behaviour)

### Small features (9 rows)

| Row | Effect | Default |
| --- | --- | --- |
| 竖条滚轮缓动 | How the mouse wheel is handled over scrollbar-shaped areas (a horizontal list, for example) | on |
| 产物用侧边栏打开 | Clicking a deliverable opens it in the host's right pane instead of externally | off (external) |
| 产物展示方式 | How a turn's deliverables are drawn: **brief** / **balanced** / **cards** | balanced |
| 新会话默认视图 | Whether a brand new session opens on the **reading page** or the **conversation page** | reading page |
| 记录 git 提交 | A 「提交」 row of bubbles at the end of a turn (message as the label, short hash in the tooltip, click to copy) | off |
| 差异在侧边栏审查 | 「共 x 项编辑」 opens **the host's own review panel** rather than the reading page's diff panel | off (the reading page's own panel) |
| 自动收起更早流程 | Older turns show their answer only, with the process collapsed | on |
| 自动折叠更早的轮次 | Only the newest turns are rendered in full; `0` keeps all of them | `0` |
| 收起按钮的行为 | What the toolbar button and the shortcuts **do**: collapse the previous turn / collapse all / default | default (both) |

*Source: `store.ts` (`init`), `deliverables.ts` (the three display modes and the open mode), `entry-policy.ts` (which page a
new session opens on), `turn-fold.ts` (the fold window), `collapse-mode.ts` (the collapse behaviour).*

### The answer display (3 rows)

| Row | Effect | Default |
| --- | --- | --- |
| 逐词显现 | Arriving text is revealed word by word instead of appearing as a whole | on |
| 逐词显现的模糊 | Blur during that reveal. **The cost of repainting every frame is the reader's own trade-off**, so it is off | off |
| 正文更新节奏 | Follow the display's refresh rate, or a fixed 60 per second | follow the display |

With the per-word reveal off, the two related rows are greyed out (they only mean something while it is on).

*Source: `store.ts` (`revealWords: true`, `revealBlur: false`, `textCadence: 'steady'`), `text-cadence.ts`.*

### The process display (4 rows)

| Row | Effect | Default |
| --- | --- | --- |
| 跟随到最新 | How the page follows new content (snap to the newest position, or follow at a cadence) | snap |
| 思考卡的自动跟随方式 | The reasoning card's automatic scrolling: follow the latest / manual | follow the latest |
| 自动滚动的速度 | The cadence of the card's and the answer's following | 3 |
| 焦点思考展开 | The card being written into expands to show its content; scrolling inside the card keeps it expanded | on |

「自动滚动的速度」 only applies while 「思考卡的自动跟随方式」 is **follow the latest**; otherwise it is greyed out.

*Source: `store.ts` (`followMode: 'snap'`, `reasoningFollow: 'latest'`, `reasoningRate: 3`), `reasoning-follow.ts`,
`focus-expand.ts`.*

---

## 快捷键 (shortcuts)

Two actions can be bound:

| Action | Default |
| --- | --- |
| Collapse the current turn | `Alt+C` |
| Collapse all | `Alt+Shift+C` |

Recording: click a key cap to record, `Esc` cancels, and clearing it leaves the action without a shortcut. Two rules keep
a binding safe to own at the document level:

- **a modifier is required** — a bare letter is refused, because it would fire while the reader types;
- **a combination the browser already owns is refused**.

「收起按钮的行为」 is a **behaviour**, not a binding, so it lives on the 功能 page under 小功能 (the last row of the table
above).

*Source: `shortcuts.ts` (`DEFAULT_SHORTCUTS`), `store.ts` (`shortcuts` records only the actions that were changed).*

---

## Where the settings live

- They are stored in the **host's** plugin record (`/better-display/settings`), which the host commits to disk (a temporary
  file, then a rename);
- **Only the keys a reader changed are written**; untouched settings are absent and fall back to the shipped value;
- **Reads are defensive**: when a record written by an earlier version lacks a key added later, every reader treats a
  missing key as the shipped value, so an upgrade cannot lose a reader's choices;
- **Whole-record writes**: every change writes the entire record. The cost, and why it is accepted, is in the README under
  Known limits.

*Source: `settings-sync.ts`, `store.ts` (hydrate and how defaults are read), `dsh-viewtune.ts` (the server-side read and
write).*
