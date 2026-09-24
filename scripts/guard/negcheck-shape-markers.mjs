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
    search: 'if (scroller !== null) scroller.scrollTop += grew;',
    replace: 'if (scroller !== null) scroller.scrollTop += 0;',
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
    search: 'animation:1s ease-in-out infinite alternate',
    replace: 'animation:9s ease-in-out infinite alternate',
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
