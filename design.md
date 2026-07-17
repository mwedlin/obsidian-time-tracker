# Design — how this plugin works

Status: `problems.md`'s fixes and all 8 suggested improvements below have been implemented. This
document now describes the actual, current architecture (updated from the original pre-fix version).

## Purpose

An Obsidian plugin (forked from "Super Simple Time Tracker") for tracking time spent on
Project/Client/Task combinations, directly inside notes, plus vault-wide status and reporting.

## File layout

The logic is now split by whether it needs a live Obsidian `App` or not, so the pure parts can be
unit-tested under plain Node (`tests/`, see improvement #4 below):

| File | Depends on Obsidian? | Contents |
|---|---|---|
| `types.ts` | no | `Entry`/`Tracker` interfaces |
| `model.ts` | no | tracker state machine (start/stop/split/remove), duration/timestamp formatting, CSV/table row building |
| `report-logic.ts` | no | pure report math: `toName`, `isWithin`, `findProjects`, `findDays`, `daySumSeconds`/`daySum`, `createMarkdownTable` |
| `dateutil.ts` | yes (`App` type only) | `parseDate` — strict format, falls back to the nldates-obsidian plugin |
| `confirm-modal.ts` | yes | reusable "are you sure?" dialog |
| `ticker.ts` | yes (DOM) | single shared 1s interval for all rendered trackers |
| `files.ts` | yes | vault-wide scanning/rewriting (`readAll`, `stopAll`) |
| `tracker.ts` | yes | per-note rendering (`displayTracker` and friends), `saveTracker` |
| `report.ts` | yes | `allTracks` (vault-wide gathering) + `ReportModal` |
| `main.ts` | yes | plugin entry point, commands |
| `settings.ts` / `settings-tab.ts` | yes | settings + settings UI |

## Core data model (`src/types.ts`)

```
Tracker {
  dispType: "default" | "compact" | "status" | "today"
  currTask, project, client: string   // last-used values, prefilled into the input boxes
  entries: Entry[]
}

Entry {
  name: string
  startTime, endTime: number | null   // unix seconds; endTime == null/undefined means "running"
  subEntries: Entry[] | null
}
```

An `Entry` is either a **leaf** (has `startTime`/`endTime`, no `subEntries`) or a **split** task
(`subEntries` populated, its own `startTime`/`endTime` unused/null). Splitting happens when you
resume a task that already has an end time: the original entry's timespan becomes `subEntries[0]`
("Part 1"), and a new "Part N" leaf is appended and started — this is how one named task accumulates
multiple, non-contiguous work sessions. `getRunningEntry`/`isRunning` recurse into `subEntries`, so a
"running" tracker is really "some leaf, anywhere in the entry tree, has no `endTime`".

**Vault-wide invariant:** at most one `Entry` in the *entire vault* is running at a time. Starting a
new entry anywhere always calls `stopAll()` first (see below).

## Storage: a tracker is a fenced code block, not a separate file

Each `Tracker` lives as JSON inside a ` ```time-tracker ... ``` ` fenced block in a normal note. A note
can contain multiple such blocks (see `test-vault/Project 1.md`, which has two independent trackers for
different projects in one file).

- `registerMarkdownCodeBlockProcessor("time-tracker", ...)` (`main.ts`) is what turns the raw JSON into
  the interactive table/buttons whenever Obsidian renders that block (live preview / reading mode).
- Persistence is done by **rewriting the block's JSON in place** (`saveTracker` in `tracker.ts`): it
  reads the whole file, uses the code block's reported line range (`MarkdownSectionInformation`) to
  splice in a new `JSON.stringify(tracker)`, and writes the file back. There's no separate database —
  the note *is* the database, and the block position is only valid until the next edit.

## Cross-file scanning (`src/files.ts`)

Because trackers are scattered across arbitrarily many notes, several features need to look at *all* of
them at once:

- `readAll(app)` — walks every markdown file in the vault and reads Obsidian's own parsed metadata
  (`app.metadataCache.getFileCache(file).sections`) to find `"code"` sections whose opening line is
  exactly `` ```time-tracker ``, rather than scanning raw file text for that string. Returns one
  `FileSection { file, lineStart, lineEnd, tracker }` per block, using line numbers (matching how
  `saveTracker` already anchors a block) rather than character offsets.
- `stopAll(app)` — uses `readAll(app)` to find the one running entry (if any) anywhere in the vault,
  ends it, and writes it back. It re-scans from scratch after every write and loops until nothing
  changes, because rewriting one file invalidates the positions of anything scanned in the same pass —
  this is a deliberately conservative "stop-the-world, reconverge" loop, not an oversight. (See
  improvement #2 below for the residual fragility this doesn't fully solve.)

## Display modes (`Tracker.dispType`, handled in `displayTracker`)

- **default / compact** (`displayTrackerDefault`) — the per-note tracker UI: Start/End button, a live
  "current" + "total" countdown (now driven by the shared ticker, see improvement #5), Task/Project/Client
  input boxes, and (default only) a table of entries with inline edit/continue/remove per row, plus
  "Copy as table" / "Copy as CSV" buttons. Removing an entry now asks for confirmation first (improvement
  #7). Starting a new entry here calls `stopAll()` first (vault-wide invariant above), then starts the
  new one locally.
- **status** (`displayStatus`) — a vault-wide widget: scans with `readAll(app)` for whichever
  file/tracker is currently running (if any) and shows a single "stop all trackers" button, or a
  "nothing running" message. Meant to be dropped into a dashboard-style note (see
  `test-vault/Tidsredovisning.md`).
  - Re-checks vault-wide state on every tick of the shared ticker (not just once at render), so
    stopping/starting a timer elsewhere — another pane, or the "Stop all timers" command — is picked up
    live instead of needing a note reload. The row is only rebuilt on an actual running/not-running (or
    active-file) transition; otherwise only the live timer text is updated in place, to avoid rebuilding
    the button every second.
  - When something is running, it also shows a live "Today" timer: total vault-wide seconds already
    logged today across **all** projects (via `allTracks`/`daySumSeconds(undefined, ...)`), computed once
    per transition, plus the running entry's own elapsed time (clipped to today) added back in and ticked
    live — the same "static total + live delta" pattern the default view uses for its own Current/Total
    timers.
- **today** (`displayToday`) — vault-wide summary table of hours-per-project for the current calendar
  day, built from `allTracks`/`findProjects`/`daySum` (see below), also meant for a dashboard note.

`dispType: "legacy"` has been removed entirely (was a recognized but unimplemented no-op branch).

## Reporting (`src/report.ts` + `src/report-logic.ts`)

This is the logic behind both the "today" widget and the `Report` command. Gathering entries from the
vault (`allTracks`) needs a live `app` and lives in `report.ts`; everything downstream of that flat list
is pure and lives in `report-logic.ts`:

1. `allTracks(app, start, end)` (`report.ts`) — flattens every tracker in the vault (via `readAll(app)`)
   down to a flat list of leaf `Entry`-like records whose `[startTime, endTime]` overlaps `[start, end]`
   (clipped to the boundary), relabeling each one's `name` to `toName(project, client)`
   (`"Project/Client"`, or whichever half exists) — so from this point on, "project" really means
   "project/client pair". (A split entry's `subEntries` are treated as `entry.subEntries ?? [entry]`,
   collapsing what used to be two near-identical loops in the original code into one.)
2. `findProjects(entries)` — the sorted set of distinct composed names present in that flattened list.
3. `findDays(start, end)` — one moment per calendar day covering `[start, end]`, stepping with moment's
   DST-aware `.add(1, "day")` (see improvement #8 — the original fixed-24h-step version double-counted a
   day across a "fall back" transition).
4. `daySumSeconds(project, day, entries)` — total seconds matching a given project (or all, if
   `undefined`) and a given day (or the whole range, if `undefined`); `daySum` is a thin wrapper that
   formats this as a `"12.34"`-style hours string. `daySumSeconds` is reused for every table cell, every
   per-project total, every per-day total, the grand total, and the `status` widget's live "Today" timer.
5. `createMarkdownTable(start, end, entries)` — assembles a Markdown table: rows = projects (from step
   2), columns = days (from step 3) + a **Total** column, cells = `daySum` per project/day.

`ReportModal` (in `report.ts`) is the UI for the `Report` command: two text boxes (From/To) parsed
by `parseDate`, a "Check dates" button that just normalizes/echoes the parsed dates back into the boxes,
and "Append table at cursor" which runs the full pipeline above and hands the resulting Markdown table
back to the caller via an `onSubmit` callback (`main.ts` wires that callback to
`editor.replaceSelection`).

## Date parsing (`parseDate` in `src/dateutil.ts`)

Tries a strict `moment(dt, format, true)` parse first, using the user-configured timestamp format
(Settings → "Timestamp Display Format"). If that fails, it falls back to the **Natural Language Dates**
community plugin (`nldates-obsidian`, via its `parseDate(text, ref, option)` API) to interpret relaxed
input like "next monday" — so that plugin is an optional soft dependency, not a hard one; if it isn't
installed, relaxed parsing just won't work. `parseDate` now takes `app` as an explicit parameter rather
than reading `this.app` from a non-method context (that was one of the bugs in `problems.md`); the old
`src/dateparser.ts` experiment along the same lines has been removed as dead code.

## Commands (`src/main.ts`)

| Command | Effect |
|---|---|
| Insert Time Tracker | inserts a fresh `dispType:"default"` block at the cursor |
| Insert Time Tracker Status | inserts a `dispType:"status"` block |
| Insert Time Tracker for logged times today | inserts a `dispType:"today"` block |
| Stop all timers | calls `stopAll(app)` directly, no UI |
| Report | opens `ReportModal` |
| Debug files | dev-only scratch command, only registered when Settings → "Enable debug command" is on (improvement #6) |

## Settings (`src/settings.ts`, `src/settings-tab.ts`)

Three values: `timestampFormat` (a moment.js format string, used for both display and strict parsing),
`csvDelimiter` (default `,`, so it can be swapped to `;` for locales where `,` is a decimal separator),
and `debugMode` (boolean, default off — gates the "Debug files" command; requires reloading the plugin
after toggling, since commands are registered once at `onload`).

## External/optional integrations

- **nldates-obsidian** — optional, enables relaxed natural-language date parsing in `parseDate`.
- **buttons** (community plugin) — not called by this plugin's code at all; `test-vault/Tidsredovisning.md`
  shows the *user* embedding a `buttons`-plugin block that invokes this plugin's own "Stop all timers"
  command by name. It's a composition the vault author set up, not something `time-tracker` renders itself.

## Versioning

Standard semantic versioning (`MAJOR.MINOR.PATCH`), same as `npm version` and Obsidian's manifest expect:

- **PATCH** (`1.1.0` → `1.1.1`) — bug fixes and internal changes with no visible change in behavior. E.g.
  the CSV-escaping fix, the settings-tab title fix, or the `findDays` DST fix would each normally be a
  patch on their own.
- **MINOR** (`1.1.0` → `1.2.0`) — new, backward-compatible functionality: existing trackers/notes keep
  working exactly as before, but something new is added. E.g. the status widget's live "Today" timer.
- **MAJOR** (`1.x` → `2.0.0`) — breaking changes: something that could make existing data or setups stop
  working as before. For this plugin that would mean changing the `Tracker`/`Entry` JSON shape so old
  notes can't be read, removing a command, or changing a setting's meaning.

Two Obsidian-specific wrinkles on top of plain semver, both handled by `version-bump.mjs` (run via
`npm version <patch|minor|major|x.y.z>`):

- `manifest.json`'s `minAppVersion` only goes up when the plugin starts relying on a newer Obsidian API —
  it's independent of the plugin's own major/minor/patch number.
- `versions.json` is an append-only map of *every* released plugin version → the `minAppVersion` it
  needed at release time, so Obsidian can pick the right release for a user on an older Obsidian build.
  That's why bumping adds a new entry rather than overwriting the old one.

**Patch bumps are automatic.** A Husky `pre-commit` hook (`.husky/pre-commit`) runs on every commit: if
the commit touches anything under `src/`, it runs `npm version patch --no-git-tag-version` and folds the
resulting `package.json`/`package-lock.json`/`manifest.json`/`versions.json` changes into that same
commit. Commits that don't touch `src/` (docs, `test-vault/`, config) are left alone — no patch churn for
non-code changes. Minor and major bumps stay a deliberate, manual `npm version minor|major`.

## Confirmed with the author

- The "one running entry per vault" invariant is deliberate: starting a timer anywhere is meant to stop
  every other timer in the vault.
- `dispType: "legacy"` is not meant to be resurrected — it should be removed (from `displayTracker`'s
  switch, and from the `Tracker.dispType` type/docs) rather than kept as a no-op branch.

## Suggested improvements — all implemented

1. **Find code blocks via Obsidian's own parser, not string search.** ✅ `readAll(app)` in `files.ts` now
   reads `app.metadataCache.getFileCache(file).sections` and filters for `type === "code"` sections whose
   opening line is exactly `` ```time-tracker ``, instead of scanning raw file text for that string.
2. **Position-based persistence is fragile by construction.** ✅ Mitigated (not fully eliminated): `readAll`
   now anchors blocks by line number (via the metadata cache) rather than raw character offsets, matching
   how `saveTracker` already worked, so both paths share the same, more robust anchoring. `stopAll`'s
   reconverge-after-each-write loop is unchanged (it was already the right defensive pattern for the
   vault-wide case). A block-local ID embedded in the JSON would remove the residual same-file race
   entirely, but that's a data-format migration — left as a future option rather than done here, since it
   wasn't needed to fix the concrete bugs in `problems.md`.
3. **Duplicated table/CSV logic.** ✅ `report.ts`'s old `createListTable`/`createTableSection` were dead
   code (never called anywhere) and have been deleted. The remaining formatting logic
   (`formatTimestamp`, `formatDuration`, `createTableSection`, `createCsv`, `createTrackerTable`) now
   lives once, in `model.ts`, shared by every caller.
4. **No automated tests.** ✅ Added `tests/model.test.ts` and `tests/report-logic.test.ts` (Node's built-in
   test runner via `tsx`, run with `npm test`), covering the tracker state machine (start/split/end/remove),
   duration formatting, and the report math (`toName`, `isWithin`, `findProjects`, `findDays`, `daySum`).
   This is what `types.ts`/`model.ts`/`report-logic.ts` being Obsidian-free enables.
5. **Per-block `setInterval` doesn't get cleaned up promptly.** ✅ `ticker.ts` now runs a single shared
   1-second interval; each rendered tracker registers via `onTick(element, callback)`, and entries are
   pruned automatically once their element leaves the DOM, with the interval itself stopped when no
   tracker is listening.
6. **"Debug files" command is dev-only scratch code shipped in the command palette.** ✅ Gated behind a new
   `debugMode` setting (off by default); the command is only registered at `onload` when it's enabled.
7. **No confirmation before "Remove" on an entry row.** ✅ Added `confirm-modal.ts`; the Remove button now
   opens a confirmation dialog before calling `removeEntry`.
8. **Timezone/DST assumptions in day-boundary math are untested.** ✅ Testing this surfaced a real bug:
   `findDays` advanced by a fixed `3600*24` unix seconds, which duplicated a calendar day across a
   "fall back" DST transition (a 25-hour day makes the fixed-size step land short of the next midnight).
   Fixed by stepping with moment's calendar-aware `.add(1, "day")` instead of raw seconds; verified with a
   test that reproduces the duplicate against the old implementation and passes against the fix
   (`tests/report-logic.test.ts`, forcing `TZ=America/New_York` across the 2024-11-03 transition).
