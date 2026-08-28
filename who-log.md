[SIGNAL]
Last updated: 2026-07-02 after 6 sessions

[PROFILE]
Primary interaction language: Vietnamese, freely mixed with English technical/code terms. Depth of response is never reduced based on language.
Active project: A solo-built Electron desktop app orchestrating four parallel LLM web sessions (ChatGPT, Gemini, Claude, Grok) via DOM injection/extraction. Custom control panel handles prompt broadcasting, cross-LLM "think" annotation sharing, and partial-text "broadcast" highlighting.
Stack: Architecture optimizes for single large files, inline strings, and unified surfaces over distributed systems. Written in vanilla JavaScript/HTML/CSS, Electron (multi-BrowserWindow, ipcMain/ipcRenderer), with no frontend framework. Operates as sole architect using AI purely for execution.

[CORE]
LOCKED: He instruments before fixing. When a result is inconsistent, he reaches for a diagnostic tool before accepting any explanation. Diagnostic output is treated as ground truth; explanations are treated as hypotheses.
LOCKED: He resolves implementation forks decisively and with reasoning in a single pass before code is written, then treats the decision as settled and does not revisit it. (Observed across three independent forks this session: selection granularity, state persistence, toggle behavior).
STABLE [count: 2/4]: He names the threshold where a system's own complexity becomes the next problem to solve — unprompted, before the model frames it.
STABLE [count: 1/4]: He cross-examines AI-generated diagnoses against each other and against the literal file rather than accepting convergence as proof.
NEW — STABLE [count: 1/4]: He revises his own previously locked architectural decisions without resistance when a downstream goal (e.g., readability for peer LLMs, natural turn-taking) supersedes the original justification.

[THRESHOLDS]
Inconsistent result across attempts → instruments before fixing (asks for logs, does not guess)
Something breaks after a specific change → bisects to that change before accepting new hypotheses
Model gives long explanation → extracts the one actionable line, ignores scaffolding
Physical discomfort accumulates → flow breaks regardless of task state; does not push through
Signal appears to work but hasn't been stress-tested → proposes a load test himself before declaring done
Debugging session compounds across many small patches without resolution → names the cost (quota, time, fatigue) explicitly and closes the session rather than continuing to push
Presented with a genuine implementation fork before code is written → answers decisively with reasoning in one pass; does not need to be re-asked once resolved

[GROWTH]
His trajectory continues to shift toward treating all internal and external reference points as provisional rather than authoritative. He now extends his diagnostic skepticism inward, overturning a previously locked formatting decision without friction the moment a new architectural goal outgrew the original justification. This structural flexibility is balanced by a tightening tolerance for ambiguity at the boundary of implementation: when presented with open development forks, he completely resolves them in a single decisive pass, moving his exploration loop into highly predictable execution. His inherent tendency to circle problems from multiple angles, prioritize system-level coherence over rapid feature additions, and rely strictly on his own phenomenological observations has stabilized into his baseline profile.

[METAPHOR]
The diver no longer only reads independent gauges in the water — he surfaces periodically to check whether the gauges themselves are reporting honestly, comparing one gauge's reading against another's before trusting either, and he recognizes when his own air supply, not the dive's difficulty, is the binding constraint, surfacing on his own schedule rather than waiting for the tank to force him up. Now he has also started recalibrating instruments he mounted himself on an earlier dive, without ceremony, the moment a new depth makes the old reading stop meaning what it used to.