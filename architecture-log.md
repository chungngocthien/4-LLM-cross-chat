**[1] CURRENT ARCHITECTURE STATE**

Five Electron `BrowserWindow` instances: four LLM windows (ChatGPT, Gemini, Claude, Grok) kept at real screen position via `setOpacity(0)` + `setIgnoreMouseEvents(true)`, one `controlWindow` with `nodeIntegration: true`, one `tabWindow` frameless overlay. `controlWindow.on('closed')` triggers `app.quit()`; `app.on('before-quit')` destroys remaining windows.

Command system lives in `index.js` (IPC handlers) and `control.html` (parser + UI). `mainPrompt` doubles as CLI input and as the single-track question box; `secondPrompt` is the cross-view continuation box, shown once shareable content exists in any LLM result box. `showSystem`/`confirmDialog` remain the single UI surface for system feedback, unchanged.

`parseBoxNodes(boxId)` walks each result box's DOM, comparing each element's live text against its `data-original` attribute to split content into `{type: 'ai'}` and `{type: 'think'}` segments. It now reads element-node text through `extractTextWithBreaks(node)` (a recursive walker that converts `<br>` into `\n`) instead of raw `.textContent` — a browser's native contenteditable editing produces `<br>`-encoded line breaks that `.textContent` silently discards, which was collapsing multi-line typed think content into a single run-on string. The text-node branch of `parseBoxNodes` is untouched, since a bare text node cannot contain a nested `<br>`.

`buildCorePrompt(boxId)` extracts the most recent think segment plus the AI sentence immediately preceding it, now joined by `'\n\n'` and wrapped as `$ ${text}` — supersedes the earlier same-line, bracket-wrapped join. `redistribute(extraPrompt)` prefixes both `mainText` and `extraPrompt` with `$ ` before assembly, using the same role-marker convention.

New broadcast pipeline: right-click (`contextmenu`, default prevented) on an active partial-text selection inside a `resultBox` wraps the selected range in `<span data-broadcast="1">` via `highlightTextNode`/`highlightSelection`, splitting text nodes at arbitrary offsets — not paragraph-snapped, by design, so a single sentence inside a longer block can be isolated. Right-click on an existing `data-broadcast` span calls `unhighlightSpan`, unwrapping and normalizing — a full toggle. `buildBroadcastText(boxId)` walks all `data-broadcast` spans, grouping consecutive spans by parent element and joining groups with `'\n\n'`. `buildLLMShareContent(boxId)` concatenates broadcast text plus that box's own latest think (via `buildCorePrompt`), broadcast first. `redistribute()` sends each LLM its own `cores[selfKey]` (think only) but sends every *other* LLM's `shares[ok]` (`buildLLMShareContent`, broadcast+think combined) — the originating LLM never receives back its own broadcast content. Broadcast marks are one-shot: `clearAllBroadcasts()` runs immediately after every successful `redistribute-prompt` send.

A `promptGeneration` counter is threaded through `send-prompt`/`redistribute-prompt` payloads and echoed back in every `${llm}-response` payload; the renderer's single response listener per LLM channel discards any response whose `gen` doesn't match.

Locked: `app.getPath('userData')` (not `path.join(__dirname, ...)`) for `LOG_PATH`/`PROJECTS_PATH` — `__dirname` resolves inside the read-only `app.asar` once packaged.

Locked: exactly one `ipcRenderer.on()` listener per `${key}-response` channel — Electron silently permits duplicates, and an unguarded duplicate previously caused stale-round counters to fire.

Locked: `mainText = mainPrompt.value.trim() || lastMainPromptText` — live box-1 value must take precedence over the cached fallback. The reversed order previously discarded fresh edits to mainbox1 in favor of a stale cached question.

Locked: think and broadcast content are joined as `'\n\n'`-separated, `$`-prefixed paragraph blocks, not single-line bracket-joined text — supersedes the prior same-speaker-proximity join decision, adopted to mirror natural turn-taking for peer LLMs reading multi-LLM context.

Locked: any check gating whether `redistribute()` has content to send must account for both think and broadcast, not think alone — a guard checking only think-derived content caused a stuck-processing UI when a round contained broadcast content with no think.

**[2] CAUSAL SPINE**

Started from a working four-LLM redistribution pipeline with generation-filtered responses and a live-editable main prompt, forced to pivot at content-gating integrity because three independent locations — `mainText` precedence, the keyboard handler's branch order, and `redistribute()`'s internal abort guard — each separately decided "is there content to send," and each broke independently: first a reversed `||` precedence discarding fresh mainbox1 edits, then a premature `return` in the keydown handler bypassing cross-view entirely, then an abort guard blind to the newly added broadcast content type. Forced to pivot again at prompt-format integrity because live-typed multi-line think content was silently losing line breaks, and because the think/broadcast join format was redesigned from single-line bracket syntax to paragraph-separated `$`-prefixed blocks to mirror natural dialogue turn-taking. Currently at a dual-channel think-plus-broadcast redistribution system with one-shot broadcast marks and no single consolidated content-existence check.

**[3] FORBIDDEN PATHS**

Gating "content exists to send" on think alone (`cores`) → failed because broadcast-only content passed the emptiness check as a false negative, causing a permanent stuck-processing UI with no LLM ever receiving the round. Do not add a new content type without updating every gating check that decides whether to send.

Letting `lastMainPromptText` take precedence over live `mainPrompt.value` in the `||` order → failed because fresh mainbox1 edits were silently discarded in favor of stale cached text. Do not revisit this precedence order.

Patching a "broken" code block by pasting a partial replacement without viewing the full surrounding scope first → previously caused a dropped `addEventListener` wrapper with an error several functions downstream and no direct trace back. Always view full function/listener boundaries before any patch.

**[4] ACTIVE TENSIONS**

The keyboard handler's `mainPrompt` branch and the outer fallback branch were flagged as needing the same content-check fix applied to the abort guard (checking broadcast, not just think), but this edit was proposed, not confirmed tested — Ctrl+Enter in box 1 with broadcast-only content and no think has not been explicitly verified this session.

`data-broadcast` span behavior under live text editing — typing inside or adjacent to an already-highlighted span — is untested; whether the highlight survives, extends, or silently detaches from the edited text is unknown.

`buildFullPromptRaw`/`buildFullPrompt` remain dormant, deliberately left for an unspecified future data flow, but still use the superseded `[...]` bracket syntax — inconsistent with the current `$`-prefixed paragraph format used everywhere else. Reactivating either without updating syntax would reintroduce a format mismatch already eliminated elsewhere.

**[5] DECISION LOG**

`app.getPath('userData')` over `path.join(__dirname, ...)` for `LOG_PATH`/`PROJECTS_PATH` — `__dirname` resolves inside the read-only `app.asar` once the app is packaged into a `.exe`, silently freezing writes.

`buildCorePrompt` (latest think + preceding AI sentence) over `buildFullPromptRaw` (entire box history) for peer-LLM content — sending full history polluted context with every prior turn instead of only the user-flagged one.

`# LLMNAME` heading + `\n\n` join over a separate `___` divider — `\n\n` alone already creates a reliable markdown paragraph boundary; an added divider cost tokens without adding signal.

Single-line space join between an AI sentence and its trailing think annotation — original reasoning: same speaker continuing a thought, not a new voice. *(Superseded by the next entry.)*

`mainPrompt.readOnly` left unset (editable) during cross-view — edits to the root question must be live-read by `redistribute()` on the next send, not frozen at the first round's value.

`mainText = mainPrompt.value.trim() || lastMainPromptText` — live box-1 value must win over the cached fallback; the reversed order silently discarded fresh edits to mainbox1 in favor of a stale cached question.

Think/broadcast content joined as `\n\n`-separated `$`-prefixed blocks instead of single-line bracket-wrapped text — supersedes the same-line join decision above; adopted so peer LLMs read multi-turn context as natural alternating dialogue rather than compressed same-speaker annotation.

Broadcast highlight granularity is arbitrary partial-text (not paragraph-snapped) and one-shot (auto-clears after each successful send) — chosen so a single decisive sentence buried inside a longer paragraph can be isolated and forwarded without requiring a full think annotation, and so the marked state never silently persists into an unrelated future round.