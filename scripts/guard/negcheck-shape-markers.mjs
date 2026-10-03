/**
 * Negative checks for the guard markers: for each one, put the artifact back into the shape the fork emitted BEFORE the
 * fix, run the guards that own that marker, and require every one of them to FAIL.
 *
 * This is the other half of `check-bundle-markers.mjs`, and the reason it lives in the repository rather than in a
 * scratch directory beside it: a marker whose negative check is not runnable by anyone who clones the project is a claim
 * about a check that nobody can verify. Every case is a mutation of the ARTIFACT — never of `src/` — because that is the
 * file the guards read, and the original bytes are restored and compared after each case.
 *
 * Deliberately NOT part of `run.mjs`: each case spawns one to three guard processes, so the whole table is minutes of
 * work, while `run.mjs` is the fast gate that runs after every build. Run it before a release:
 *
 *     node scripts/guard/negcheck-shape-markers.mjs
 *
 * A `SKIP` counts as a failure on purpose: it means the artifact no longer carries the fixed shape (so the marker is
 * asserting nothing), or already carries the reverted one (so the case is not testing what it says).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BUNDLE = 'lib/client.js';
/** The host half, for the decisions the routes own rather than the view. */
const HOST = 'lib/dsh-viewtune.js';
const GUARD_DIR = '.';

const cases = [
  {
    label: 'memoized mainKeys reverted to the inline per-render filter',
    search: 'const mainKeys = (0, react.useMemo)(() => group.keys.filter((key) => !turnUserKeys.includes(key)), [group, turnUserKeys]);',
    replace: 'const mainKeys = group.keys.filter((key) => !turnUserKeys.includes(key));',
    guards: [
      'scripts/guard/check-turn-order.mjs',
      'scripts/guard/outline-turn.mjs',
      'scripts/guard/check-bundle-markers.mjs',
    ],
  },
  {
    label: 'keyed whitespace reverted to a bare string in the same children array',
    search: ': /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MotionGap, { children: word.text }, word.key)',
    replace: ': word.text',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the cadence fallback inverted, so an unrecognised record would fall back to the per-frame cadence',
    search: 'return value === "frame" ? "frame" : "steady";',
    replace: 'return value === "steady" ? "steady" : "frame";',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the default cadence reverted to the per-frame one a fresh install would then open with',
    search: 'textCadence: "steady"',
    replace: 'textCadence: "frame"',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the publication gate reverted to publishing every frame',
    search: '} else if (publishDue(now, publishedAt.current, cadence)) {',
    replace: '} else if (true) {',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the blur "off" path turned into a no-op filter, which is the trap the switch exists to avoid',
    search: 'if (!blur) return [{ opacity: 0 }, { opacity: 1 }];',
    replace: 'if (!blur) return [{ opacity: 0, filter: "blur(0px)" }, { opacity: 1, filter: "blur(0px)" }];',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the per-word reveal gate removed, so the timeline would be started even with the reveal off',
    search: 'if (perWord) timeline.current.begin',
    replace: 'if (true) timeline.current.begin',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'one of the two follow-mode gates dropped, leaving the other path still gliding',
    search: 'followMode === "snap"',
    replace: 'false',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the auto-collapse fold removed, so earlier processes would stay open while a turn grows',
    search: 'if (foldEarlier && boundary.status !== "open") return false;',
    replace: 'if (false) return false;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the mode and pace dropped from the follower dependencies, so changing them mid-stream would not apply',
    search: 'reasoningMode,\n\t\t\t\trate\n\t\t\t])',
    replace: 'rate\n\t\t\t])',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: '手动滚动 turned back into an auto-following mode',
    search: 'reasoningMode !== "manual"',
    replace: 'true',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the focused growth left un-quantised, so a card would relayout on every publication',
    search: 'const lines = Math.max(1, Math.ceil(content / line));',
    replace: 'const lines = Math.max(1, content / line);',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the focus height allowed to fight an explicit 展开阅读',
    search: '%SEL:reasonCard%[data-focus=true]:not([data-expanded=true]) %SEL:reasonViewport%{max-height:min(60vh,560px);transition:none}',
    replace: '%SEL:reasonCard%[data-focus=true] %SEL:reasonViewport%{max-height:min(60vh,560px);transition:none}',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the upward compensation dropped, so a growing card would push the newest line out of view',
    // The needle moved with the gate: the write is no longer a one-liner inside a null test — the reader's place is
    // checked between the two now — so the mutation zeroes the write itself. Same shape under test ("the compensation
    // is dropped"), and the marker still has to refuse it.
    search: 'scroller.scrollTop += grew;',
    replace: 'scroller.scrollTop += 0;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the page left following the tail while a card holds the focus, so two auto-scrollers would pull at once',
    search: 'useReadingScroll(root, motion, live, followMode, focusedCard !== null)',
    replace: 'useReadingScroll(root, motion, live, followMode)',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'a dependent row left ungated, so a pace would look settable with no auto-scroll to pace',
    search: '"data-inactive": reasoningFollow !== "auto"',
    replace: '"data-inactive": false',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the grouping hairlines dropped, leaving one undivided list of ten rows',
    search: '%SEL:settingsGroup%{border-top:.5px solid var(--dsw-alias-border-l2)',
    replace: '%SEL:settingsGroup%{border-top:0',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the producing state read from a passive effect again, so the observer could beat it to the growth',
    search: '(0, react.useLayoutEffect)(() => {\n\t\t\t\tliveRef.current = live;',
    replace: '(0, react.useEffect)(() => {\n\t\t\t\tliveRef.current = live;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the SUSPENSION left on a passive effect — the same race, one line below the fix that missed it',
    search: '(0, react.useLayoutEffect)(() => {\n\t\t\t\tsuspendedRef.current = suspended;',
    replace: '(0, react.useEffect)(() => {\n\t\t\t\tsuspendedRef.current = suspended;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'a write to the tail recording a position the scroller cannot hold, so the follower reads its own frame as the reader',
    search: 'writeTop(scroll.scrollHeight, scroll.scrollHeight - scroll.clientHeight)',
    replace: 'writeTop(scroll.scrollHeight)',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the publication clock seeded inside the effect again, so the gate measures time since the last ARRIVAL and the reveal stalls',
    search: 'const publishedAt = (0, react.useRef)(0);',
    replace: 'let publishedAt = performance.now();',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the focused card compensating the height it ASKED for, which the stylesheet had already refused',
    search: 'const grew = rendered - focusRendered.current;',
    replace: 'const grew = wanted - focusHeight.current;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the grant leaving the tail gap open again, so the card bottom stays behind the composer for the whole focus',
    search: 'scroller.scrollTop = scroller.scrollHeight;',
    replace: 'scroller.scrollTop = scroller.scrollTop;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the compensation measuring the viewport again, so the card own bottom row pushes itself out of view',
    search: 'const rendered = card?.getBoundingClientRect().height ?? 0;',
    // Not `port.offsetHeight`: the chase's own step reads that now, so a revert to it would be an ambiguous (and
    // silently-skipped) mutation. `port.getBoundingClientRect().height` is the same mistake, spelled unambiguously.
    replace: 'const rendered = port.getBoundingClientRect().height;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the pre-grant card height left unrecorded, so the ceiling jump a focus grant causes is never compensated',
    search: 'focusRendered.current = viewport.current?.closest("[data-reader-reasoning-card]")?.offsetHeight ?? 0;',
    replace: 'focusRendered.current = -1;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'a document with a head-less <html> returned verbatim again, so its frame never follows the theme nor reports its height',
    search: 'trimmed.replace(/<html([^>]*)>/i,',
    replace: 'trimmed',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the focused height eased for every reader again, ignoring the 贴底 choice and the two motion gates',
    search: '@media (prefers-reduced-motion:no-preference){[data-reader-follow-mode=glide]:not([data-motion=off]) %SEL:reasonCard%[data-focus=true]:not([data-expanded=true]) %SEL:reasonViewport%{transition:height .16s var(--reason-ease,ease-out)}}',
    replace: '%SEL:reasonCard%[data-focus=true] %SEL:reasonViewport%{transition:height .16s}',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the height chase turned off, so an eased growth pushes the content below the card and never pulls it back',
    // The stop condition moved when the still-frame count was added (a clamped ceiling never reaches the target, and the
    // old equality test spent the whole deadline there): `if (true) return` at the still-frame test ends the chase on its
    // first frame, which is the same "turned off" shape.
    search: 'if (++still >= CHASE_STILL_FRAMES) return;',
    replace: 'if (true) return;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'a tool row left out of the file vocabulary again, so a mention produced later stays inert',
    search: 'previous.fileMentions === next.fileMentions',
    replace: 'previous.fileMentions !== undefined',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the wallpaper column scanned out of the whole document once per frame again',
    search: 'if (column !== null && !column.isConnected) column = document.querySelector',
    replace: 'if (false) column = document.querySelector',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'a panel revealed by scrollIntoView again, which walks ancestor scrollers and lifts the sticky composer',
    search: 'landTurn(element, port);',
    replace: 'landTurn(element, port); element.scrollIntoView({ block: "nearest" });',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the tool table naming a cordis verb again that this host does not register, leaving the real one unnamed',
    search: 'cordis_inspect_self: "read",',
    replace: 'cordis_runtime_inspect: "read",',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'a jump into loaded history landed from a guessed delay again, so a slow commit silently did nothing',
    // The retry's body grew a deadline check beside the landing test, so the pinned shape is now the block form.
    search: 'if (revealTurn(pendingReveal)) {',
    replace: 'if (false) {',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the running turn scanned inside the store selector again, so every streamed delta walks every turn',
    search: 'for (const turn of timeline.turns.values())',
    replace: 'for (const turn of snapshot.timeline.turns.values())',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the process disclosure toggling from the state it holds behind the decision, which makes the button dead for 150ms',
    search: 'onToggle: () => setExpanded(!wantsProcess),',
    replace: 'onToggle: () => setExpanded(!expanded),',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the rail’s busy tick left looping forever with no gate for a reader who asked for less movement',
    // The mutation removes the GATE, not a timing value — which is what the label says and what the marker asserts. It
    // used to nudge the duration (`1s` → `9s`), i.e. it tested the marker's pin on a number that is the minifier's and
    // the designer's business; that needle is gone by design (it is what made the marker flake inside a full guard
    // run), so the case now expresses the regression it names. `{animation:none}` appears in every reduced-motion
    // block in the stylesheets, so this takes them all away at once.
    search: '{animation:none}',
    replace: '{animation:initial}',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the 产物栏 label renamed in code, so the settings row the reader asked for stops existing',
    // The dial's LABEL is what the reader named; its id stays `chip` (the stored-record key) on purpose. A one-character
    // change is enough — the guard pins the label, and nothing else in the plugin would notice it had gone.
    search: '产物栏',
    replace: '产物拦',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the guide kind misspelled, so a lone 「开始」 page stops being recognised and is never replaced',
    // The guide tab's kind is the short string the sidebar package declares (`const GUIDE_KIND = "guide"`); comparing it
    // against anything else never matches. That is exactly the bug this mechanism shipped with first — it compared the
    // kind against the guide BODY's registration key, and nothing happened, silently.
    search: 'kind === "guide"',
    replace: 'kind === "gide"',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the changed-files list card’s rows renamed, so the card loses the row shape the reader asked to match',
    // The card is the host's shape: a header, then ROWS. Losing the row class leaves the files as unshaped text, which is
    // what the marker guards. A case flip, since the harness skips a replacement that is already present.
    search: 'changedCardRow',
    replace: 'CHANGEDCARDROW',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the changes-review address prefix changed, so the host’s review can no longer be opened at all',
    // The address is the contract: the deliverables package's `canOpen` parses this exact prefix, so a different one opens
    // nothing — and the reader's switch silently does nothing instead. A case flip, because the harness skips a mutation
    // whose replacement is already present and that test is a substring test.
    search: 'dsh-resource://changes-review/session/',
    replace: 'DSH-RESOURCE://CHANGES-REVIEW/SESSION/',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the click-revealed diff panel renamed, so 共 x 项编辑 has no way to show the turn’s diff at all',
    // The panel is the ONLY route to the diff now that the hover window is gone (the reader dropped it), so losing its
    // class is losing the feature: the heading's click would reveal nothing. The replacement is a case flip, because the
    // harness skips a mutation whose replacement is already present and that test is a substring test.
    search: 'deliverablesBoxPanel',
    replace: 'DELIVERABLESBOXPANEL',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the commit pattern no longer allowing a global option, so every `git -C … commit` stops being a commit',
    // Exactly the reported bug: the reader's own commits are all `git -C <dir> commit …`, so without the global-option
    // allowance the 提交 box is empty forever while the files still pile up under 编辑.
    search: '-C|-c|--git-dir|--work-tree',
    replace: '-Z|-z|--git-dir|--work-tree',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the box heading allowed to stretch, which makes the whole first row read as clickable',
    // A grid item stretches by default, so a heading button without `justify-self: start` covers its entire column — the
    // reader's report that the whole first line was clickable. `align-self` rather than a value containing the search,
    // because the harness skips a mutation whose replacement is already present.
    search: 'justify-self:start',
    replace: 'align-self:start',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the balanced row pushed into the grid’s narrow column, which is exactly the half-row the reader saw',
    // `grid-column: 1 / -1` is what makes the row span a grid parent; starting it at column 2 leaves it in the
    // `max-content` column — the box hugging its content at the right end of the row, which is the report this fixes.
    search: 'grid-column:1/-1',
    replace: 'grid-column:2/-1',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the balanced boxes left uncapped, so a long file list shows every row instead of the two the reader asked for',
    // 「一般只显示两行，展开后显示全部」 is the spec: the cap is what makes the box a summary rather than a list, and
    // lifting it silently turns the balanced mode into the detailed one's height cost.
    search: 'max-height:62px',
    replace: 'max-height:620px',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the two deliverable regions merged back into one by renaming the hook that tells 编辑 from 产物',
    // The split IS the correction: one region for what the turn EDITED, one for what it DELIVERED. Renaming the hook
    // merges them into the single list the reader asked us to stop showing under one label. (`data-area` rather than
    // something containing `data-region`, because the harness skips a mutation whose replacement is already present.)
    search: 'data-region',
    replace: 'data-area',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the per-file 产物 cards left out of the diff dial, so the two cards the host renders side by side disagree',
    // The host itself calls them neighbours (`.nyYjTG_root[data-after-changes=true]` exists to sit this row directly
    // under the changed-files card), and one of a pair being dialled while the other is not is the split this plugin's
    // grouping rule forbids — which is exactly what the reader noticed.
    search: '[data-presented-file]',
    replace: '[data-presented-file-moved]',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the goal bar’s expanded height left where it never lands, so the bar stays one line high while the objective wraps',
    // `data-goal-bar` is the outer DOCK and the 36px is on its child, so a height written against the hook does nothing
    // at all: the objective (a descendant rule) keeps wrapping while the bar it is inside stays one line tall. That is
    // the reader's report, word for word, and the mutation restores exactly it.
    //
    // The replacement is `34px` rather than the host's own `36px` on purpose: the harness refuses a mutation whose
    // replacement is ALREADY present, and `min-height: 36px !important` (the next declaration in the same block)
    // contains that string — so a `36px` here is skipped as a no-op rather than run.
    search: 'height: auto !important',
    replace: 'height: 34px !important',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the turn-trigger row renamed away from the words the conversation page uses for the same record',
    // The two views must say the SAME thing about the same record — that is the whole point of mirroring the host's
    // title table rather than paraphrasing it — so the copy is pinned, not just the presence of a row.
    search: '继续执行目标',
    replace: '执行目标',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the goal bar’s own buttons treated as the control, so 暂停 / 编辑 / 清除 fold the bar instead of doing their job',
    // The excluded element kinds are what keeps the four icon actions and the edit field out of the toggle. The mutation
    // kills the CALL while leaving the list declared, which is exactly why the marker pins the call and not the name.
    search: 'GOAL_BAR_INTERACTIVE.some((selector) => target.closest(selector) !== null)',
    replace: 'false',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the settings panel closed by an outside click dropping the number the reader had just typed',
    // A panel removed from under the pointer never delivers `blur` to the field it took away, so closing is the only
    // exit that can still apply it. The mutation takes that exit away and leaves blur/Enter in place — which is exactly
    // the reader's report, and exactly what a marker that only looked at the two event handlers would miss.
    search: 'commitFoldDraft()',
    replace: 'void 0',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the turn window computed and then never applied, so the page renders a history it was told not to',
    // The regression is the render guard disappearing while the window itself still gets computed — which is exactly
    // what a marker that only checked `insideWindow`/`renderedTurnsOf` would miss, so the case is aimed at the call
    // site rather than at the arithmetic.
    search: 'hiddenTurnKeys.has(group.key)',
    replace: 'false',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the steps pill interpolating a denominator it does not have, which printed the word null',
    search: '`${answer} 步`',
    replace: '`${answer}/null 个步骤`',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the 动效 switch read raw again, so an old record makes React treat the switch as uncontrolled',
    search: 'state.motion) !== false',
    replace: 'state.motion)',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'a settings read that failed treated as an empty record again, so the browser seeds its defaults over the record it could not fetch',
    search: 'if (read.kind === "unavailable")',
    replace: 'if (read.kind === "unavailable" && false)',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the per-turn expansion choices pushed into the shared record again, where they grow without bound in a file the host refuses whole',
    search: 'settingsWriter.push(hostRecordOf(readerState))',
    replace: 'settingsWriter.push(readerState)',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the focus read by the frame loop written in a passive effect, so the observer can beat it to the resize',
    search: '(0, react.useLayoutEffect)(() => {\n\t\t\t\tfocusedRef.current = focused;',
    replace: '(0, react.useEffect)(() => {\n\t\t\t\tfocusedRef.current = focused;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the tail window dropped, so a turn rows laid out on its own close would be left behind',
    search: 'producingRef.current = liveRef.current || now - endedAt.current < OUTPUT_TAIL_MS;',
    replace: 'producingRef.current = liveRef.current;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },

  // ===================== the audit round =====================
  // Each case reverts one defect the audit found in our own code. `bundle` is optional and defaults to the client half;
  // the host cases name `HOST` because two of the decisions this round were made on the routes rather than in the view.
  {
    label: 'a step count of NaN let through to the pill again, because typeof NaN === "number"',
    search: 'typeof data.answerStep === "number" && Number.isFinite(data.answerStep) ? data.answerStep : null',
    replace: 'typeof data.answerStep === "number" ? data.answerStep : null',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the failed-block retry removed, so one half-arrived payload replaces the block for the session',
    search: 'if (this.state.attempt >= BLOCK_RETRY_LIMIT) return;',
    replace: 'if (true) return;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the frame-message boundary removed from the listener again',
    search: 'console.warn("[dsh-better-display] MCP app message failed:", error);',
    replace: 'void 0;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the rail pulse wired back to the loading tick alone, so a streaming turn’s tick stands still',
    search: 'const isBusy = loading || runningTurn === item.turn;',
    replace: 'const isBusy = loading;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the rail’s smooth scroll ungated again, so a reduced-motion reader is animated every jump',
    search: 'behavior: allowMotion ? "smooth" : "auto"',
    replace: 'behavior: "smooth"',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'new_str dropped from the diff body’s field list again, so str_replace_editor shows counts and no body',
    search: 'content: stringValue(args, "content", "new_string", "new_str", "newText", "file_text")',
    replace: 'content: stringValue(args, "content", "new_string", "newText", "file_text")',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the diff badge’s label reverted to “changed lines”, which is not what those two numbers are',
    search: '差异视图：新内容',
    replace: '改动 ',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the expansion read without its fallback again, where a record missing the key throws inside a selector',
    search: 'state.expanded ?? NO_CHOICES)',
    replace: 'state.expanded)',
    guards: ['scripts/guard/check-collapse-control.mjs'],
  },
  {
    label: 'the per-turn expansion read without its optional chain again',
    search: 'state.expanded?.[choiceKey])',
    replace: 'state.expanded[choiceKey])',
    guards: ['scripts/guard/check-collapse-control.mjs'],
  },
  {
    label: 'the wallpaper served with the old minute-long cache again, so a replaced file stays invisible',
    search: '"Cache-Control": "private, no-cache"',
    replace: '"Cache-Control": "private, max-age=60"',
    bundle: HOST,
    guards: ['scripts/guard/check-host-markers.mjs'],
  },
  {
    label: 'the settings write failing silently with a 200 again',
    search: 'json(res, 500, {',
    replace: 'json(res, 200, {',
    bundle: HOST,
    guards: ['scripts/guard/check-host-markers.mjs'],
  },
  {
    label: 'the macOS Option fallback removed again, so Option+C stops reaching Alt+C',
    search: 'if (event.altKey || event.metaKey) {',
    replace: 'if (false) {',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the second meta.diffs normaliser put back, so the row can advertise a diff the pane will not show',
    search: 'function diffHunksOf(meta) {',
    replace: 'function diffHunksOf(meta, extra) {',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },

  // ===================== the 0.2.0-rc.2 adaptation =====================
  // Each case puts one platform contract back to its 0.1.5 spelling. They are the "would this have been caught?" half of
  // the adaptation: none of these reverts is a compile error at the artifact level, so without them a stale rebuild would
  // reach the page and fail there — the icon names as a blank glyph, the tail fields as a missing number.
  {
    label: 'an icon put back to the drawn-size name 0.2.0 removed, which renders nothing at all',
    search: 'IconBrowseOutlineRegular',
    replace: 'IconBrowseOutline16',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the throughput derivation dropped, so the ported reading can be reverted to fields the record no longer has',
    search: 'function tokensPerSecondOf(',
    replace: 'function tokensPerSecondOfX(',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the retired per-session pending hook referenced again',
    search: 'useSessionStatus',
    replace: 'useSessionPendingInteraction',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the running-call narrowing removed, so a preparing call reads arguments it does not have',
    search: 'phase === "start"',
    replace: 'phase !== "start"',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the no-exit-code label dropped, which 0.2.0 requires of every terminal card',
    search: 'noExitCode:',
    replace: 'noExitCodeX:',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the context row reading the retired `provenance` field again',
    search: 'producer.role',
    replace: 'provenance.role',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the top bar’s scrim moved onto the leading CELL instead of the bar itself, which is the shape a `:has(>)` mix-up produces',
    search: '*:has(> [data-conversation-header-leading])',
    // A replacement that does NOT contain the needle: the first cut appended a comment to it, so the marker still found
    // its string and the case passed the guard it was supposed to fail — a self-defeating mutation, caught by the run.
    replace: '*:is([data-conversation-header-leading])',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the Windows title-bar strip’s scrim moved to the wrong pseudo-element',
    search: '[data-windows-titlebar] *:has(> [class*="_sidebarCol"])::before',
    replace: '[data-windows-titlebar] *:has(> [class*="_sidebarCol"])::after',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'one of the two chrome scrims renamed out from under its rule, leaving that surface with no dial at all',
    // The split's marker requires BOTH variables to survive, so the mutation is a rename nothing else follows — the
    // shape a copy-paste between the two rules leaves behind. The replacement is deliberately a name the artifact does
    // not contain: reusing the header's would already be present, and this script counts that `SKIP` as a failure.
    search: '--viewtune-wallpaper-chrome-sidebar',
    replace: '--viewtune-wallpaper-chrome-left',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the focused card’s page compensation ungated from the reader’s place, so it pulls the page back under their wheel',
    // The gate is the whole fix for 「只有在卡片变高的时候」 the page being pulled back while reading further up: with it
    // disabled the compensation writes on every line again, and the marker that requires the gate has to say so.
    search: 'if (!pageAtTailRef.current) return;',
    replace: 'if (false) return;',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the card’s own takeover turned back into a release, so scrolling inside a card folds it shut under the reader',
    // The reader's rule in one line: reading INSIDE a card pins the focus; the release may only fire while the card is
    // still following. Reverting it to the old `!following || !active` is exactly the regression the pin's marker exists
    // to catch.
    search: 'if (following && !active) onFocusChange(focusKey, false);',
    replace: 'if (!following || !active) onFocusChange(focusKey, false);',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the changed-files card renamed out from under its rule, so 0.2.0’s card stays the one opaque surface',
    // The hook is the whole handle: a rename nothing follows is what a copy-paste leaves behind, and the marker that
    // requires the attribute has to refuse it.
    search: '[data-changed-files]',
    replace: '[data-changed-files-renamed]',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'the portaled detail’s own copy of the diff row plates dropped, so its green and red bands stay solid',
    // The override is stated twice on purpose — once in the column, once on the portaled card, which a column-scoped
    // token cannot reach — so dropping ONE copy is the shape to catch, and its marker counts them.
    search: '--dsw-alias-file-diff-added-bg: color-mix(',
    replace: '--dsw-alias-file-diff-added-bg: color-mixX(',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
  {
    label: 'one surface’s frost property renamed in the part table, so a row moves a dial no stylesheet reads',
    // The marker pairs every frosted surface's property with the stylesheet that reads it, so a rename in the table
    // alone is exactly "the panel writes a name no surface reads" — the coupling that marker exists to protect.
    search: '"--glass-blur-chip"',
    replace: '"--glass-blur-chips"',
    guards: ['scripts/guard/check-bundle-markers.mjs'],
  },
];

let failed = 0;
/**
 * Fill `%SEL:<local>%` with the class name this artifact actually carries.
 *
 * The CSS cases below rewrite RULES, and a rule's selector contains the hash lightningcss derived from this checkout's
 * absolute path — so a case written with one build's hash passes here and `SKIP`s on every other machine, which this
 * script counts as a failure. The token is resolved from the artifact under test instead; an unresolvable token is left
 * in place on purpose, so the case skips loudly rather than mutating something it did not mean to.
 */
const fillSelectors = (text, artifact) => text.replace(/%SEL:([\w-]+)%/g, (whole, local) => {
  const hash = new RegExp(`\\.([A-Za-z0-9_]+)_${local}(?![\\w-])`).exec(artifact)?.[1];
  return hash === undefined ? whole : `.${hash}_${local}`;
});

for (const item of cases) {
  const file = item.bundle ?? BUNDLE;
  const original = readFileSync(file);
  const text = original.toString('utf8');
  const search = fillSelectors(item.search, text);
  const replace = fillSelectors(item.replace, text);
  if (!text.includes(search)) {
    console.log(`SKIP — artifact does not contain the fixed shape for: ${item.label}`);
    failed += 1;
    continue;
  }
  if (text.includes(replace) && replace.length > 20) {
    console.log(`SKIP — the reverted shape is already present for: ${item.label}`);
    failed += 1;
    continue;
  }
  try {
    writeFileSync(file, text.replaceAll(search, replace));
    for (const guard of item.guards) {
      // stdio: 'inherit' on purpose — this sandbox cannot capture a child's piped output, and
      // the exit code is the whole signal this check needs.
      const run = spawnSync(process.execPath, [guard], { cwd: GUARD_DIR, stdio: 'inherit' });
      const rejected = run.status !== 0;
      console.log(`${rejected ? 'ok  ' : 'BAD '} ${guard} rejected: ${item.label} (exit ${String(run.status)})`);
      if (!rejected) failed += 1;
    }
  } finally {
    writeFileSync(file, original);
  }
  const identical = Buffer.compare(original, readFileSync(file)) === 0;
  console.log(`${identical ? 'ok  ' : 'BAD '} artifact restored byte-identically after: ${item.label}`);
  if (!identical) failed += 1;
}

console.log(failed === 0 ? 'NEGATIVE CHECK OK' : `NEGATIVE CHECK FAILED (${String(failed)})`);
process.exit(failed === 0 ? 0 : 1);
