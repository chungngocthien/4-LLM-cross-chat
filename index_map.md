[DISPATCH]
window layout, bounds, LLM windows → ZONE_MAIN
tab bar, tab toggle, tab overlay → ZONE_TABS
account, profile, partition, switch → ZONE_ACCOUNTS
project, /proj, url assignment → ZONE_PROJECTS
command, parser, CLI, slash command → ZONE_COMMANDS
usage, timer, log, duration → ZONE_USAGE
debug, state dump, factory reset → ZONE_DEBUG
restore, session, startup → ZONE_RESTORE

[ZONES]
ZONE_MAIN
PATH: index.js
ROLE: Electron main process — window lifecycle, IPC orchestration, all LLM interactions
SIGNAL: CRITICAL
NOTE: controlWindow.on('closed') is lifecycle anchor for entire app — do not decouple

ZONE_TABS
PATH: tabs.html
ROLE: Frameless transparent overlay — four color-coded tabs toggle LLM window opacity
SIGNAL: STABLE

ZONE_CONTROL
PATH: control.html
ROLE: Control panel UI — prompt input, result display, command parser, system box
SIGNAL: CRITICAL
NOTE: mainPrompt doubles as CLI input when value starts with /

ZONE_PROJECTS
PATH: appdata/projects.json
ROLE: Persisted project state — URLs per LLM, account binding, current active project
SIGNAL: HIGH
NOTE: corrupt file falls back to empty state via try/catch in loadProjects()

ZONE_USAGE
PATH: appdata/usage-log.json
ROLE: Processing time log — today and yesterday only, pruned on load
SIGNAL: STABLE

ZONE_LOGS
PATH: narrative-log.md, architecture-log.md
ROLE: Session memory for cold LLM entry — narrative and architectural state
SIGNAL: HIGH
NOTE: currently .txt extension — recommend migrating to .md for consistency

[UNKNOWN]
appdata/ — directory confirmed to exist, internal file list not fully verified beyond two known files
package.json — not read, dependency list unknown