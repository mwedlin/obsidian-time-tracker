# Changelog

All notable changes to the Time Tracker plugin, starting from `1.0.0` (the first release prepared for
public use). Versions follow [semantic versioning](https://semver.org/) — see `design.md`'s "Versioning"
section for how patch/minor/major are chosen in this project.

## [1.1.2] - 2026-07-17

### Added
- **Favorite projects.** Configure a project/client pair in Settings and it gets its own stable
  `Time Tracker: Start <name>` command, registered at startup — for triggering from outside Obsidian
  (e.g. a StreamDeck button via the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)
  community plugin's `POST /commands/{id}` endpoint) or from the command palette like any other command.
  Picks which note to start using the same "running timer wins, otherwise most recent entry wins" logic
  as the `status`/`today` widgets' note links; won't create a new tracker block if none exists yet for
  that pair, and shows a notice instead of guessing where to put one.

## [1.1.1] - 2026-07-17

### Added
- **Read-only error display for malformed tracker JSON.** A broken block (invalid JSON syntax, or a field
  like `"entries"` set to something other than a list) now shows a clear, red-background, read-only
  message instead of silently resetting to a blank interactive tracker — which previously risked
  overwriting your original text the moment you clicked any button on it.
- **Clickable note links** in the `status` and `today` widgets — the active timer's note (`status`) and
  each project name (`today`) link straight to the right note.
- **A green "active" marker** next to the running project's row in the `today` widget.
- **Three new settings** for how often each live display refreshes: Timer display / Status widget / Today
  widget update interval (seconds) — defaults `5` / `1` / `30`.
- **A compact/full view toggle button** on the default tracker, next to Start/End — previously the only
  way to switch a block's display mode was hand-editing its `"dispType"` field.
- A Husky pre-commit hook that automatically bumps the patch version on any commit touching `src/`.

### Changed
- Minutes and seconds are now zero-padded to 2 digits in duration displays (e.g. `1h 05m 09s` instead of
  `1h 5m 9s`).
- The shared ticker driving all live-updating displays now uses `requestAnimationFrame` instead of
  `setTimeout`, for smoother and more reliable updates.
- `status`/`today` no longer re-scan the entire vault on every refresh tick — they react to actual note
  changes (`vault.on("modify")`, debounced) instead of polling, and no longer scan the vault twice per
  refresh — meaningfully cutting the delay after starting or stopping a timer.

### Fixed
- An intermittent skipped or jittery second in the `status` widget's live "Today" timer (root-caused
  across several iterations: JS timer drift, a stale-listener leak from re-rendered blocks never being
  cleaned up, and floor-based rather than rounded elapsed-time math).
- A listener leak where Obsidian re-rendering a code block (e.g. during live-preview updates) could leave
  a previous render's ticker — and, for `status`/`today`, its vault-change subscription — running forever
  alongside the current one.

## [1.1.0] - 2026-07-17

### Added
- The `status` widget now re-checks the vault's running/not-running state live (previously only at
  render time), so stopping a timer elsewhere — another pane, the command palette — is reflected without
  reloading the note.
- The `status` widget's live "Today" timer now totals time across **all** projects, not just the
  currently active one.

### Fixed
- **CSV/formula injection and Markdown/HTML injection** via free-text task/project/client names in
  generated CSV and Markdown output (`Copy as CSV`/`Copy as table`, the `Report` command's table) — a
  name starting with `=`/`+`/`-`/`@` could be read as a spreadsheet formula when opened later, and raw
  `<`/`>`/`|` could break table formatting or inject markup.

### Changed
- Settings tab no longer reads "Super Simple Time Tracker Settings" (a leftover from the plugin this was
  originally forked from).
- Author contact updated to `mwe@wewid.se` (`manifest.json`, `package.json`, and the settings tab, which
  now shows a plain mailto contact link instead of the original fork author's donation link/image).

## [1.0.0] - 2026-07-17

The first release prepared for public use — the plugin did not reliably build before this point.

### Fixed
- Roughly 90 TypeScript errors that blocked `npm run build` outright.
- Several runtime bugs that `npm run dev`'s looser build had let through silently: an undefined
  `obsidianApp` global, `this.app` used outside class methods (always `undefined` there), undeclared loop
  variables, and an operator-precedence bug in `files.ts`.
- A day-boundary bug in the reporting logic (`findDays`) that duplicated a calendar day across a
  "fall back" daylight-saving transition — found via the test suite added in this release.

### Added
- Unit tests (`tests/`, `npm test`) covering the plugin's pure logic, made possible by splitting it out
  into Obsidian-independent modules (`types.ts`, `model.ts`, `report-logic.ts`).
- A confirmation dialog before removing a logged entry.
- `version-bump.mjs`, referenced by `package.json`'s version script but previously missing.

### Changed
- Vault-wide scanning (`readAll`) now uses Obsidian's `metadataCache` instead of scanning raw file text
  for the `time-tracker` fence marker.
- A single shared ticker now drives all live-updating displays, instead of every tracker block starting
  its own `setInterval`.
- The "Debug files" command is now gated behind a settings toggle instead of always being in the command
  palette.

### Removed
- The `"legacy"` display type (`dispType`) — a recognized but never-implemented no-op.
