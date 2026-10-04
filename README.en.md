# dsh-viewtune

**A reading view for DeepSeek Harness.**

It lays a conversation out for reading: one page per turn, a tunable frosted-glass skin and wallpaper, deliverables and
diffs readable in place, and scrolling that stays usable in very long sessions. Everything the host already does keeps
working — this plugin adds its own parts and does not replace the host.

[中文](./README.md) · [Settings reference](./docs/settings.en.md) · [Changelog](./CHANGELOG.md)

---

## What it is, and what it is not

**Three things it adds:**

1. **A reading page**: each turn is laid out as one readable page (answer, process, reasoning, tools and deliverables each
   in their own place), with the reading-side controls that go with it: fold, jump, load history, reveal the answer.
2. **A tunable skin**: frosted glass (**nine surfaces, each with two dials**: opacity and blur), a wallpaper, and the same
   skin plus a solid-background mode carried over to the **conversation page**.
3. **Long-session handling**: a fold window, rendering only what is near the viewport, and plain statements when loading
   older history fails (instead of a button that appears to do nothing).

**What it is not:**

- **Not a theme replacement**: the host's structure, class names and components stay where they are; this plugin adds its
  own parts (the reading page) or injects styles (the conversation page).
- **Not a replacement for the host**: the host's own turn rail, diff panel, review, deliverable cards, goal bar and MCP
  hosting all still exist; this plugin either uses them or adds its own parts beside them.
- **It does not guess numbers**: only what can be proven is shown (for example the usage pill). What cannot be proven is
  left out, and the reason is stated.

---

## Install

Build in the plugin directory first (dependencies are managed by the host with **pnpm**):

```bash
npm run build
```

Then add **this directory** to the host as a plugin (`--profile web` is the default Web profile):

```bash
# add (run from the directory that CONTAINS dsh-viewtune)
dsh plugin --profile web add ./dsh-viewtune

# remove
dsh plugin --profile web remove dsh-viewtune
```

A packed tarball works too: after `npm run build`, `npm pack` produces a `.tgz`, and the same command with that file in
place of `./dsh-viewtune` installs it.

**Restart the Host** afterwards (or reload as the host prompts). Then:

- **viewtune ⚙** appears in the sidebar — that is every setting;
- which page a **brand new session** opens on is decided by 「新会话默认视图」 (the default is the **reading page**);
- the shipped state is already the values a reader settled on: skin on, the bundled wallpaper filling the window, cards
  and code blocks frosted from the start — nothing has to be adjusted first.

---

## What a turn looks like (reading page)

Top to bottom:

| Place | Content |
| --- | --- |
| Top | **Toolbar** (session information on the left, viewtune ⚙ and the collapse button on the right); sticky |
| Each turn | **Your message** (bubble) → **process** (reasoning card, tool rows, diffs) → **answer** → **deliverables** (交付 / 编辑 / 提交) |
| Right | **Turn rail**: every turn of the session is on it; click to go there; the turn being read is marked as you read |
| Floating | The **「回到最新」** pill, shown only when you have actually left the tail **and** there is content below |

**The process folds.** Each turn's process is shown on demand: the line above the answer is that turn's process, click to
expand, click again to collapse. 「自动收起更早流程」 and 「自动折叠更早的轮次」 control folding of the **process** and of
**whole turns** respectively.

**The fold window is recalculated only when a new turn starts, never while you read** — so the page is not rearranged
under you mid-sentence. To see older turns, use the button above that turn to bring more of them into view.

---

## The conversation page has its own copy (separate switch)

- **Frosted glass and user bubbles** follow the nine dials above;
- **Solid background mode**: theme background plus a fade above the composer, independent of the skin;
- The host's own 「回到底部」 button and the reading page's 「回到最新」 pill **share one floor**: a dial turned all the way
  down still cannot make either invisible.

---

## Reading page in detail

### Answer and Markdown

The answer renders block by block: headings, lists, tables, quotes, task lists, footnotes and fenced code blocks; a code
block's language label, line numbers and copy button keep the host's structure. Three things are this plugin's own:

- **CJK emphasis**: `**bold**` / `*italic*` are decided with Chinese punctuation and mixed CJK/Latin text in mind
  (`markdown/cjkFriendlyStrong.ts`);
- **Math**: rendered with KaTeX, and a syntax the renderer cannot handle does not take the whole paragraph down
  (`markdown/katex.tsx`, `mathCompatibility.ts`);
- **Incremental parsing**: when text arrives in a stream, only the changed part is re-parsed (`markdown/incremental.ts`).

### The reasoning card

A turn's reasoning is rendered as one card:

- **Follow mode** is a choice: follow the latest (continuous) or manual; the **pace** is adjustable;
- The **pause / resume** button sits at the bottom of the card. Scrolling inside the card or making a selection pauses the
  following; returning to the latest resumes it;
- **Focus expand**: the card being written into expands to show its content; scrolling inside the card keeps it expanded
  (that counts as reading it);
- **Scrollable reading**: content taller than the card scrolls on its own, without moving the page.

### Tool rows and diffs

A tool call renders as a row (name, argument summary, state, duration); expanding it shows input, result and structure.
Failed, interrupted and refused calls each get their own mark. Diffs render separately: a panel that opens in place,
inline diffs, a line-number gutter, and a 「增删 N 行」 statistics button.

### Process folding and the collapse button

- 「**自动收起更早流程**」: older turns show their answer only, with the process collapsed;
- 「**自动折叠更早的轮次**」: only the newest turns are rendered; older ones are fetched with the button above the turn;
- 「**收起按钮的行为**」 has three options: collapse the previous turn / collapse all / default (`collapse-mode.ts`). The
  toolbar button and the keyboard shortcuts share that one behaviour.

### Revealing the answer

- 「**逐词显现**」: arriving text is revealed word by word instead of appearing as a whole;
- 「**逐词显现的模糊**」: blur during that reveal (**off by default** — the cost of repainting every frame is the reader's
  own trade-off to make);
- 「**正文更新节奏**」: follow the display's refresh rate, or a fixed 60 per second (the default is to follow the display).

### Native rows and MCP

- **Context rows**: context the host records (system prompt, recalled content) is rendered with the host's own row style;
- **Tool rows and question cards**: the same structures the host uses; this plugin lays them out on the reading page;
- **MCP app frames**: an MCP app (a web-based tool, for example) runs in its own frame, resizable, with the same message
  channel the host uses.

### Goal bar, toolbar and shortcuts

- **Goal bar**: the line above the composer keeps the host's structure; this plugin adjusts how it is displayed;
- **Toolbar**: one sticky line, session information on the left, viewtune ⚙ and the collapse button on the right;
- **Shortcuts**: this plugin has two bindings (collapse the current turn, collapse all), recorded on the **快捷键** page;
- **Strip wheel**: how the mouse wheel behaves over scrollbar-shaped areas (a horizontal list, for example).

---

## Deliverables and diffs

- **Deliverable display**: brief / balanced / cards, deciding how a turn's deliverables are drawn;
- **Delivery bubbles**: clicking one follows 「产物用侧边栏打开」 — the host's review panel, or an external open;
- **Diffs**: a panel that opens in place plus **inline diffs**; 「差异在侧边栏审查」 hands it to the host's own review panel;
- **Commits**: with 「记录 git 提交」 on, a turn ends with a 「提交」 row of bubbles (message as the label, short hash in the
  tooltip, click to copy).

---

## History and the turn rail (how it differs from the host)

**First, what belongs to the host**: the host's conversation page **already has** a turn rail. It lists every turn of the
session and it loads older history too. This plugin provides one on the **reading page** as well, and differs in these
places:

| Situation | What this plugin does |
| --- | --- |
| The target turn is **folded** | The fold window is enlarged first so the row exists, and only then does the jump land (without it there is no row to land on) |
| Loading older history **failed or brought nothing** | The interface **says so** (「没能读到更早的记录…」) instead of doing nothing |
| The host says there is **nothing older** | It displays 「已经是最早的记录。」 |
| A region **cannot be fetched** | It offers one alternative with its cost written in the label: 「一次性加载到最早（较慢）」 — it fetches the whole history while still rendering only what needs rendering |
| A conversation too **short to scroll** | 「回到最新」 does not appear (there is nothing below to return to) |

> One kind of "cannot be fetched" **is not this plugin's**: the host's event feed is killed by an event that withdraws a
> materialized target, after which no history page lands — and because every request pages contiguously back from the
> window's oldest sequence, **no target avoids it either**. This has been filed with DeepSeek Harness itself, with the full
> stack, the derivation and reproduction steps. This repository does not copy that write-up, because it describes the
> host's behaviour rather than this plugin's implementation.

---

## Performance: why long sessions stay usable

Three parts, each with its own job:

1. **The fold window** limits **how many turns are rendered** (recalculated when a new turn starts, never while reading);
2. **Rendering near the viewport only**: turns far from the viewport are skipped by the browser for layout and paint
   (`content-visibility`); the placeholder height declares the **block axis only** (declaring width as well squeezes the
   controls inside a turn). **The turn being written is exempt** — the reasoning card follows itself inside its own
   subtree, and containment there breaks that;
3. **The rail's reading** is a binary search over the rendered rows (logarithmic), and it re-measures only when the window
   actually changes.

> The cost is stated: the **first** time a turn enters the viewport, the browser has to lay it out (a large turn carries
> cards, diffs and reasoning). That can be reduced, not removed — doing the same viewport rendering in JS would not remove
> it either.

---

## The settings panel

Open it with **viewtune ⚙** on the right of the toolbar. It has **three pages** (arrow keys move between them, `Home` and
`End` jump to the first and last):

- **视效** (look): motion, frosted glass (nine surfaces), wallpaper;
- **功能** (behaviour): small features (how deliverables open, how they are displayed, which page a new session opens on,
  recording git commits, reviewing diffs in the sidebar, collapsing earlier processes, folding earlier turns, what the
  collapse button does), the answer display (per-word reveal, its blur, its cadence), and the process display (follow
  mode, the reasoning card's follow mode, its pace, focus expand);
- **快捷键**: recording for this plugin's two bindings.

**Every row, every default, and what each of the nine glass surfaces covers is in
[`docs/settings.en.md`](./docs/settings.en.md).**

One layout rule: a preference is a row and a new subject is a page, so the toolbar never grows a control wider; **only an
option whose label does not say it all carries a description**, and that description rides the row's `title` (the
browser's own hover box), taking no space.

---

## What it does when it cannot say

- **State is written in the row**: a system override, a recording in progress, a refused combination — written where it
  applies;
- **A missing number is left missing**: the host reports usage only when it can **prove** a turn's accounting; this plugin
  follows that, does not guess, does not estimate, and does not add a badge of its own;
- **It does not claim success**: a history note appears only when it is certain (the host explicitly says there is nothing
  older); what cannot be done is stated as such.

---

## Known limits

- **Chinese interface**: the host offers a localisation seat and this plugin borrows it to translate two host strings, but
  the plugin's **own** copy is not localised — a full zh/en split needs a locale provider edge in the plugin (a Host
  restart). That is a trade-off, not an oversight.
- **Settings are written as one whole record**: no revision, no timestamp. Two windows changing settings at once means the
  later write silently overwrites the earlier one. Accepted because this record is one reader's own preferences; fixing it
  would mean revisions and a conflict policy, more machinery than the thing it protects.
- **A change made in the few hundred milliseconds before the stored record arrives is rolled back**: settings are read
  once at startup; until that read answers, changes cannot be sent, and the arriving record then overwrites them.
- **Observability attributes**: several `data-reader-*` / `data-ud-check` have no reader inside this plugin. They are the
  observation points for the workspace scripts (`render-dump.mjs`, `feature-matrix.mjs`, and others), and the only way to
  run a real page and see where the state machine got to.
- **One platform defect** (the "cannot be fetched" above): the plugin can work around it, not fix it.

---

## Who it is for

- Reading a conversation **as reading**: one turn at a time, the process on demand, deliverables and diffs visible in place;
- **Long sessions**: folding, jumping and history loading, with scrolling that stays usable;
- A consistent look across the **reading page and the conversation page**: frosted glass, wallpaper, solid background;
- Accepting some limits in exchange for **certainty**: only what can be proven is shown, a failed load is stated, and what
  cannot be done is said to be impossible.

**It may not suit you if** you want a theme package (it ships a skin, but its work is the reading page's layout and
interaction); or a fully English interface (the plugin's own copy is Chinese, see the limits); or a replacement for the
host's own rail, diff panel or deliverable cards (this plugin uses them or adds its own parts beside them).

---

## Where the settings live

They are stored in the **host's** plugin record (`/better-display/settings`), which the host commits to disk:

- **Only the keys a reader changed are written**; untouched settings are absent and fall back to the shipped value;
- **Reads are defensive**: when a record written by an earlier version lacks a key added later, every reader treats a
  missing key as the shipped value, so an upgrade cannot lose a reader's choices;
- **Whole-record writes**: every change PUTs the entire record (the cost is described under Known limits).

---

## Development

### Build

```bash
npm run build
```

### Layout of the client

| File | What it owns |
| --- | --- |
| `Reader.tsx` | The reading page: a turn's layout, folding, buttons, history interaction |
| `ReasoningCard.tsx` | The reasoning card: following, reading, focus, expansion |
| `motion.tsx` | Motion and following: scroll takeover, anchor compensation, cadence |
| `SettingsMenu.tsx` / `store.ts` / `settings-sync.ts` | The settings panel, state, and the host record |
| `deliverables.ts` / `DiffPanel.tsx` / `ToolActivity.tsx` | Deliverables, diffs, tool rows |
| `TimelineRail.tsx` / `projection.ts` / `turn-fold.ts` | The rail, the process projection, the fold window |
| `glass.ts` / `conversation-glass.ts` / `composer-glass.ts` / `app-backdrop.ts` | The glass dials and injected styles |
| `markdown/` / `native/` | Markdown rendering (CJK, KaTeX, incremental parsing) and the host's native rows |
| `reader-*`, `turn-*`, `text-cadence.ts` and others | Small reading behaviours (each file's header says why it exists) |

### Checks

```bash
npm run build
node ../verify-types.mjs                       # TYPES OK
node ../run-plugin-tests.mjs                   # test cases
node scripts/guard/run.mjs                     # artifact guard (invariants)
node scripts/guard/negcheck-shape-markers.mjs  # reverse check (a mutation must be refused)
```

**All four must be green before a commit.** Every marker in the guard corresponds to a bug that actually happened. The
reverse check rewrites the artifact into the broken shape and requires the guard to go **red** and the artifact to be
**restored byte-identically**; it has itself been corrected twice (a mutation the minifier undid, and a search string
written in the source's spacing rather than the artifact's), and both are recorded in the changelog.

---

## Versioning

- A tagged version's **bytes are fixed**: one version number never corresponds to two different byte streams, so any
  change starts a new version number;
- `CHANGELOG.md` is written **in time order** and keeps the entries that were **tried and then withdrawn**, with their
  reasons — why a path does not work is information;
- One commit does one thing: a fix and a refinement are kept apart, and a change is made one item at a time, so locating a
  regression does not begin by withdrawing the refinement.

---

## Origin and licence

MIT, see [LICENSE](./LICENSE).

It started from [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display) (MIT): the **reading
tab, the streaming motion and the Markdown rendering** come from there; this plugin differs from it substantially by now.
Parts of the presentation and the Markdown rendering derive from DeepSeek Harness (MIT). Motion references
[Transitions.dev](https://transitions.dev/). The default wallpaper shipped with the package,
`assets/sample-gradient.png`, was made for this repository and is released under the same MIT as the code.
