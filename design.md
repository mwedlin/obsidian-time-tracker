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
| `types.ts` | no | `Entry`/`Tracker` interfaces, `ReportData`/`TrackerRow` (Templater-facing data shapes) |
| `model.ts` | no | tracker state machine (start/stop/split/remove), duration/timestamp formatting, `flattenEntries`, CSV/table row building |
| `report-logic.ts` | no | pure report math: `toName`, `isWithin`, `findProjects`, `findDays`, `daySumSeconds`/`daySum`, `buildReportData`, `createMarkdownTable` |
| `zip-path-safety.ts` | no | `sanitizeRelativePath` — zip-slip-safe path validation for the template kit installer |
| `dateutil.ts` | yes (`App` type only) | `parseDate` — strict format, falls back to the nldates-obsidian plugin |
| `templater.ts` | yes (`App` type only) | `renderTemplaterFile` — soft dependency on the Templater community plugin |
| `api.ts` | yes (`App` type only) | this plugin's public API (`app.plugins.plugins["time-tracker"].api`) + the internal "stash and consume" state behind it |
| `confirm-modal.ts` | yes | reusable "are you sure?" dialog |
| `file-suggest-modal.ts` | yes | fuzzy file picker, used by the Templater path settings and the kit installer |
| `folder-suggest-modal.ts` | yes | fuzzy folder picker, used by the kit installer |
| `template-kit-installer.ts` | yes | `InstallTemplateKitModal` — installs a `.zip` of Templater templates into a chosen vault folder |
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

## Robustness against hand-edited/malformed JSON

Since a tracker's data is just JSON sitting in a note, nothing stops a user from editing it directly and
introducing a mistake - a syntax error, or a field like `entries` set to the wrong type. `loadTracker`
(`model.ts`) is the single gatekeeper for this, and returns `Tracker | null`:

- An **empty block** (nothing typed yet - the normal state right after inserting one) returns a blank
  `Tracker`. Not an error.
- A **missing or `null` "entries"** field is healed to `[]` rather than treated as an error: there's
  nothing recoverable being lost (if it was absent, there was nothing there to preserve), and this keeps
  older/hand-written trackers that never had `entries` from getting flagged unnecessarily.
- **Anything else that doesn't parse into a plausible shape** — broken JSON syntax, the parsed value not
  being an object, or `entries` being present but not an array (a string, a number, an object) — returns
  `null`. This was found to matter in practice: several places downstream assume `entries` is a real array
  and throw otherwise (verified: `displayTrackerDefault`'s `tracker.entries.length` throws
  `Cannot read properties of undefined (reading 'length')` if `entries` is missing; a string value gets
  iterated character-by-character by `for...of`, each character treated as a fake "entry" with no
  `endTime`, which `isRunning` would then report as a running task).

The reason this returns `null` instead of silently substituting a fresh blank tracker (which is what the
code used to do, and is a real difference from before): rendering an *interactive* UI over a guessed-at
fallback means one stray button click (Start, Edit, Remove — anything that calls `saveTracker`) writes
that fresh/guessed tracker straight back over the file, discarding whatever the user's original text
actually was, with no undo. Returning `null` lets the caller render a **read-only** error instead
(`displayParseError` in `tracker.ts` — a plain message with a `background-color: var(--background-modifier-error)`
box, wired up in `main.ts`'s code-block processor), so no save can happen and the original text stays
untouched in the file until the user fixes it by hand. `files.ts`'s `readAll` skips a block entirely when
`loadTracker` returns `null` for it, for the same reason: an unparseable block shouldn't be silently
included in — or written to — vault-wide operations like `stopAll` or the reporting/status widgets.

Deliberately out of scope: validating individual entries' fields (a bad `startTime`, say). Those don't
crash — `moment.unix()` on a bad value produces an "Invalid Date", and `formatDuration` renders it as a
visible `"NaNs"` rather than a plausible-looking wrong number — so it degrades cosmetically rather than
destructively, and wasn't worth the added complexity of deep recursive validation.

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
  "current" + "total" countdown (driven by the shared ticker at `settings.timerUpdateSeconds` — see
  "Ticker" below), Task/Project/Client input boxes, and (default only) a table of entries with inline
  edit/continue/remove per row, plus "Copy as table" / "Copy as CSV" buttons. Removing an entry now asks
  for confirmation first (improvement #7). Starting a new entry here calls `stopAll()` first (vault-wide
  invariant above), then starts the new one locally.
  - A chevron button next to Start/End toggles `tracker.dispType` between `"default"` and `"compact"`
    (just flips the field and calls `saveTracker`, same as any other button here — no special-cased
    re-render, Obsidian reprocesses the block once the note's content changes) — always present regardless
    of the current mode, unlike "Copy as table/CSV" which only exist in `"default"`. Previously the only
    way to switch a block's display mode was hand-editing `"dispType"` in the JSON directly.
- **status** (`displayStatus`) — a vault-wide widget: scans with `readAll(app)` for whichever
  file/tracker is currently running (if any) and shows a single "stop all trackers" button, or a
  "nothing running" message. Meant to be dropped into a dashboard-style note (see
  `test-vault/Tidsredovisning.md`).
  - Re-checked on every vault change (event-driven — see "Ticker" below — not on a fixed poll), so
    stopping/starting a timer elsewhere — another pane, or the "Stop all timers" command — is picked up
    as soon as it happens, without needing a note reload. The row is only rebuilt on an actual
    running/not-running (or active-file) transition; otherwise nothing needs to happen on that check at
    all, since the live number is ticked separately and doesn't need a rebuild.
  - When something is running, it also shows a live "Today" timer, ticking every 1s: total vault-wide
    seconds already logged today across **all** projects (via `allTracks`/`daySumSeconds(undefined, ...)`),
    computed once per transition, plus the running entry's own elapsed time (clipped to today) added back
    in — the same "static total + live delta" pattern the default view uses for its own Current/Total
    timers.
  - The note name in "Active timer in note ..." is a real clickable link to that note (via
    `createNoteLink`, see below) — unambiguous here since there's only ever one active file at a time.
- **today** (`displayToday`) — vault-wide summary table of hours-per-project for the current calendar
  day, built from `allTracks`/`findProjects`/`daySumSeconds` (see below), also meant for a dashboard note.
  Uses the same event-driven-refresh/rebuild-only-on-transition pattern as `status`, but ticks its live
  numbers every 30s rather than every 1s — precision matters less here. If something is running, its
  project's row (added even if it has no completed entries logged yet today) and the Total row tick with
  its elapsed-today time added on top of the completed-entries total, the same "static total + live
  delta" split used everywhere else. The active project's row also gets a green "active" marker after its
  duration value (`.time-tracker-active-marker`, `--text-success`, spaced with `margin-left` rather than a
  literal space character) — rendered as a separate sibling `<span>` next to the value's own span,
  specifically so the periodic `setText()` update to the value doesn't wipe the marker out along with it.
  - Each project name is a link to the note that best represents it (see below), since a project isn't
    necessarily confined to one note.

**Ticker** (`src/ticker.ts`): one shared loop, driven by `requestAnimationFrame` rather than
`setTimeout`/`setInterval`, fanning out to per-listener callbacks. rAF is scheduled by the renderer's own
paint cycle (~60/sec) instead of the generic timer queue — both more frequent (so a listener gating on
"has 1000ms passed" gets checked far more often than a 1-per-second timer would, making a single delayed
check very unlikely to cost a whole missed interval) and smoother for anything meant to update
continuously, which is what it's for. It also does nothing while the window isn't visible (nothing to
redraw), and self-corrects immediately once it resumes, since callbacks recompute from the real current
time rather than counting elapsed ticks.

Each `onTick(element, callback, { intervalMs, onDisconnect })` call can ask for a slower effective cadence
than the frame rate — a listener asking for `30_000` just skips frames until 30s of wall-clock time has
passed since its own last run, so there's still only one `requestAnimationFrame` loop regardless of how
many different cadences are in use. `onDisconnect`, if given, fires once, the moment `element.isConnected`
is first found false — used by `displayStatus`/`displayToday` to unsubscribe their vault event listener
(see below) at the same point they'd otherwise have been pruned from the tick loop.

**Chasing down "status's live timer occasionally skips/jitters a second" took six rounds** before landing
on rAF. Reported symptom: roughly 1 in 3 seconds visibly skipped, never more than one at a time — regular
enough that it clearly wasn't just occasional main-thread jank. What actually fixed it, and what didn't,
all on a `setTimeout`-based ticker before the eventual switch to rAF:

1. *Drift correction* (a self-rescheduling `setTimeout` chain, recomputing its next delay off `Date.now()`
   each cycle instead of a flat "+1000ms from now") and *debouncing the vault-scan-collision* (below) were
   both real, legitimate improvements, but retesting after each showed no change in the reported symptom —
   so neither was the (main) cause.
2. *A listener leak*: all three `onTick` call sites originally passed the `element` parameter Obsidian
   hands the code-block processor, not an element scoped to that specific render. Since Obsidian can reuse
   that outer container across repeated re-invocations of the same code-block processor (e.g. during
   live-preview view updates), `element.isConnected` could stay `true` even after `main.ts`'s `e.empty()`
   had wiped out everything a previous render put inside it — so a stale render's ticker (and, for
   `status`/`today`, its `vault.on("modify")` subscription) never got cleaned up, leaking one more of each
   alongside the current render on every re-invocation. Fixed by passing `tbl` (a `<table>` created fresh
   at the top of each render function, only ever connected for that specific render's lifetime) instead.
   Real bug, worth fixing regardless — but retesting still showed no change, so this wasn't the (main)
   cause either.
3. *Oversampling*: tightened the `setTimeout` chain's base interval from 1000ms to 250ms so `status`'s live
   update sampled 4x more often than the 1-second precision it actually needs, on the theory that
   `setTimeout`'s "no earlier than the requested delay, never exactly on time" imprecision occasionally
   fires late enough to land in the next whole second, and oversampling would usually still catch it inside
   the same intended second. This did eliminate the skips, confirming the diagnosis — but retesting showed
   a new symptom in its place: noticeably uneven pacing between visible updates.
4. Root cause of *that* new symptom: the displayed value was still computed via `moment().unix()`
   (`Math.floor(ms / 1000)`), so whether a given ~250ms sample's floor differed from the previous one
   depended on exactly where the true 1-second boundary happened to fall within that sample's 250ms window.
   Tried switching to `Date.now()`-based rounding to the nearest second (`Math.round`) instead of floored
   *and reverting the base interval back to 1000ms* (removing the oversampling), reasoning that rounding's
   full second-wide tolerance (N-0.5s to N+0.5s all display as N) no longer needed the oversampling's
   redundancy to compensate for a razor-thin floor boundary. This fixed the uneven pacing — but retesting
   showed the original skipping symptom was back: rounding alone doesn't help if an *individual*
   `setTimeout` cycle is delayed enough (main-thread contention, timer coalescing, ...) to be the *only*
   sample near a given transition and it lands more than 0.5s off; oversampling's redundancy (several
   nearby chances to catch each transition) and rounding's wide tolerance (each of those chances is very
   likely to land in the right window once it does get sampled) were solving two different halves of the
   same problem, not substitutes for each other.
5. *Both together* (250ms base interval **and** `Math.round`-based elapsed time) fixed the skipping, but
   the reported jitter in update pacing persisted at a level found "annoying." A follow-up attempt to
   compute the millisecond diff before dividing (`(Date.now() - runningStart*1000) / 1000`, rather than
   `Date.now()/1000 - runningStart`) changed nothing, as expected going in — the two are algebraically
   identical, and floating-point error between them is many orders of magnitude below anything that could
   flip which second `Math.round` lands on. That confirmed the remaining jitter wasn't an arithmetic
   artifact at all, but the practical precision floor of scheduling against the generic `setTimeout` queue.
6. *What actually resolved it*: switched the whole ticker from `setTimeout` to `requestAnimationFrame` (the
   mechanism described above). Distinct from oversampling a `setTimeout` chain — rAF is tied to the
   renderer's actual paint cadence rather than the generic timer queue, which is the more fundamental fix
   for a display that's meant to visually update smoothly. The explicit 250ms base interval from point 3 is
   gone (moot once checks happen on every paint frame instead — `status`'s tick call now just states its
   real target, `intervalMs: 1000`), but the `Math.round`-based elapsed time from point 4 stayed: it's
   still the more correct way to turn a millisecond timestamp into "the nearest second," independent of
   whatever's driving how often that computation runs.

Per-widget cadence, chosen per how much a stale number actually matters for that widget: `status` ticks
every 1s (its own live "Today" number, cheap local math), `today` every 30s (same idea, but precision
matters less for a summary table), and the default view's own Current/Total every 5s (also cheap local
math against the in-memory tracker — Start/Stop/Edit/Remove already trigger a fresh re-render as soon as
the note's content changes, so the slower cadence only affects how smoothly the number ticks up between
clicks, not how quickly an action itself is reflected).

**Why `status`/`today` moved from polling to event-driven refresh:** both used to re-run their entire
`readAll(app)` vault scan on every tick — 1s and (before this change) also 1s respectively — regardless of
whether anything had actually changed. They now instead call `app.vault.on("modify", () => refresh())`
once, when first rendered, and only pay for a `readAll()` scan when a note is actually modified anywhere
in the vault — which is exactly when the running/not-running state could have changed. This is a net win
on both axes: faster reaction (near-instant on the actual change, rather than up to a full tick interval
of staleness) and less wasted work (no scanning at all while nothing is happening, e.g. a status widget
left open on a note the user is just reading). The tradeoff accepted knowingly: this relies on `vault.modify`
firing for every write that matters, which holds for this plugin's own writes (`saveTracker`/`stopAll` both
go through `app.vault.modify(...)`), but there's no separate polling fallback anymore if some future write
path bypassed that event for any reason.

**Avoiding a redundant second vault scan per refresh.** Both `refresh()` functions call `readAll(app)`
directly (to find the active section), and both also needed the flattened, date-ranged entry list
`allTracks` produces (for `daySumSeconds`) — but `allTracks(app, start, end)` originally did its *own*
internal `readAll(app)` call, so every transition-triggered refresh scanned the whole vault twice. Split
`allTracks`'s flattening logic out into `flattenTracks(sections, start, end)`, with `allTracks(app, ...)`
as a thin wrapper around it and a new `allTracksFromSections(sections, ...)` for callers that already have
a section list in hand. `displayStatus`/`displayToday` now pass their own already-fetched `sections`
through to that instead of calling `allTracks(app, ...)` again — halving the scan work on exactly the path
that matters most: starting a new timer (which stops the old one first, then writes the new one — two
separate `vault.modify` writes, two debounced-together `refresh()` triggers, each of which used to scan
twice).

**Picking which note represents a project** (`bestSectionPerName` in `report.ts`, shared by
`pickProjectFiles`, `pickProjectSection`, and `startFavorite`): a project/client pair can have tracker
blocks in several different notes, so this picks one per project name, from an already-fetched
`FileSection[]` (no extra vault scan — `displayStatus`/`displayToday` already have one from their own
`readAll(app)` call, and both re-scan on every vault change, so avoiding a second scan on top matters here
more than it would for a one-off call): whichever section has a currently running timer wins outright;
otherwise, whichever has the most recent already-stopped entry (`latestEntryTime` in `model.ts`, the max
`endTime` across an entry list's leaves/subEntries, ignoring still-running ones) wins.
`pickProjectFiles`/`createNoteLink` (`tracker.ts`) use this to link `status`/`today`'s project names to a
note: `createNoteLink` renders an `<a class="internal-link" href="...">` — that class is also what makes
Obsidian's own Page Preview hover-popup work on it — and opens the actual `TFile` directly via
`app.workspace.getLeaf(ctrlOrCmd).openFile(file)` on click, rather than resolving a link path, since the
file is already in hand. `pickProjectSection` (returning the section itself, not just its file) is what
lets `startFavorite` (see Commands below) find and mutate the right tracker without a rendered view.

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
   collapsing what used to be two near-identical loops in the original code into one.) Each record also
   keeps the entry's own task name in a separate `task` field (`Entry.task`, optional - only ever set
   here, never on entries as actually stored in a tracker's JSON), since `name` itself gets overwritten
   with the project/client composite - a template that wants to group/sum by task rather than just by
   project/client (see `invoice.md` below) needs this. This is also why the tracker UI's "Task" text
   field (`newTaskNameBox` in `tracker.ts`) and a stored entry's `name` field can read as synonyms - they
   are the same field, just named differently in the UI vs. the type; `task` only exists as a separate
   field on these Report-pipeline records, where `name` no longer means that.
2. `findProjects(entries)` — the sorted set of distinct composed names present in that flattened list.
3. `findDays(start, end)` — one moment per calendar day covering `[start, end]`, stepping with moment's
   DST-aware `.add(1, "day")` (see improvement #8 — the original fixed-24h-step version double-counted a
   day across a "fall back" transition).
4. `daySumSeconds(project, day, entries)` — total seconds matching a given project (or all, if
   `undefined`) and a given day (or the whole range, if `undefined`); `daySum` is a thin wrapper that
   formats this as a `"12.34"`-style hours string. `daySumSeconds` is reused for every table cell, every
   per-project total, every per-day total, the grand total, and the `status` widget's live "Today" timer.
5. `buildReportData(start, end, entries)` — packages steps 2–4 into a `ReportData` object (raw seconds,
   no formatting): `days`/`projects` arrays, a `cellsSeconds[project][day]` grid, per-project/per-day/grand
   totals, and the flattened `entries` themselves as an escape hatch. This is the data handed to a
   Templater template (see "Templater integration" below); it's also the input `createMarkdownTable`
   itself now builds from, so there's exactly one place that computes the grid.
6. `createMarkdownTable(start, end, entries)` — calls `buildReportData`, then formats it into a Markdown
   table: rows = projects, columns = days + a **Total** column, cells = hours to 2 decimals.

`ReportModal` (in `report.ts`) is the UI for the `Report` command: two text boxes (From/To) parsed
by `parseDate`, a "Check dates" button that just normalizes/echoes the parsed dates back into the boxes,
and "Append table at cursor" which runs the full pipeline above and hands the resulting text back to the
caller via an `onSubmit` callback (`main.ts` wires that callback to `editor.replaceSelection`) — via
`buildReportText`, which uses a configured Templater template instead of `createMarkdownTable` when
`settings.reportTemplatePath` is set (see below).

### Timezone

Timestamps are stored as raw Unix seconds (timezone-agnostic), but every place that turns one into a
date/time — `formatTimestamp`, `findDays`, `daySumSeconds`'s day boundaries — calls plain
`moment(...)`/`moment.unix(...)` with no `.utc()`/`.tz(...)` anywhere in the codebase (no
`moment-timezone` dependency either). Plain `moment()` resolves to whatever timezone the JS runtime
reports as local, which comes from the OS (desktop) or the device (mobile) — there's no setting inside
the plugin to configure or override this. Practical effect: "today" and day boundaries are always the
*current device's* local midnight-to-midnight; logging time from two devices in different timezones can
attribute the same instant to different calendar days depending on which device generated the report.

### Known caveats around day boundaries

- **A running (not-yet-stopped) entry is invisible to `allTracks`/`daySumSeconds` themselves**, not just
  partially counted. `isWithin` compares against `entry.endTime`, and a `null` `endTime` coerces to `0` in
  that numeric comparison, which is always "before" any real duration range — so `allTracks` silently
  excludes it. Both the `status` and `today` widgets work around this deliberately (computing the running
  entry's elapsed-today time separately, via `getRunningEntry`, and adding it back on top of the
  `allTracks`-derived total — see the Display modes section above), so they do reflect a running timer's
  time live. The `Report` command's table does **not** work around it — a running entry still contributes
  nothing to a report until it's stopped — but `ReportModal` shows a non-blocking warning
  ("⚠ A timer is currently running within this period and won't be included...") rather than silently
  producing an incomplete report. A blocking "stop it first?" confirmation was considered and rejected:
  generating a report and stopping your current timer are different actions, and forcing that choice
  risks an unwanted side effect (ending a work session) just to preview numbers.

  The warning only appears once both From/To fields parse to valid dates (re-checked live via each field's
  `onChange`, and again after "Check dates" normalizes them - `TextComponent.setValue` doesn't itself fire
  `onChange`) *and* a currently running entry's elapsed-so-far window actually overlaps that specific
  range (`hasRunningTimerWithin`, treating a still-running entry's open-ended time as running "from its
  start time through right now," the same convention the `status`/`today` widgets use for a live timer -
  reusing the existing `isWithin`/`getRunningEntry` helpers, no new logic beyond that). A timer running
  somewhere in the vault but outside the chosen range no longer triggers it - only one that would actually
  leave a gap in *this* report does.
- **A ~1-second-per-midnight-crossing rounding quirk**, found while verifying the above: an entry
  spanning midnight gets clipped to each day's `[startOf("days"), endOf("days")]` window in
  `daySumSeconds`. `endOf("days")` computes `23:59:59.999`, but `.unix()` truncates that to whole
  seconds (`23:59:59`), so the day-before-midnight portion of a split entry is undercounted by up to 1
  second (verified: a 3h entry from 23:00→02:00 comes out as 3599s + 7200s = 10799s, one second short of
  the true 10800s). Invisible at the report's 2-decimal-hour display precision — accepted as-is, not
  worth the complexity of switching to a half-open `[start, nextDayStart)` interval for a difference that
  never surfaces in the UI.

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
| Start &lt;favorite&gt; | one per configured favorite (see below), calls `startFavorite(app, project, client)` |
| Debug files | dev-only scratch command, only registered when Settings → "Enable debug command" is on (improvement #6) |

**Favorites** (`src/favorites.ts`, `startFavorite` in `report.ts`): each entry in
`settings.favoriteProjects` gets its own command, registered at `onload` — `favoriteCommandName` for the
display name ("Start Project 4/Client 4"), `favoriteCommandId` for a stable id (a slugified version of the
same name, e.g. `start-project-4-client-4`; stable across reloads since it's derived from the favorite's
own text rather than its position in the list). This was built specifically so external tools that can
trigger an Obsidian command — a StreamDeck via the Local REST API community plugin's
`POST /commands/{id}`, for one — can start a *specific* tracker without opening its note; no existing
command took a project as a parameter, and the REST API's command-execution endpoint doesn't pass
arguments through to a command's callback, so parameterizing an existing command wasn't an option.
`startFavorite` calls `stopAll` first (same vault-wide invariant as the Start button), then uses
`pickProjectSection` to find the right block (same running-wins/most-recent-wins strategy as linking a
project to a note, above) and starts a new entry in it. Deliberately doesn't create a new tracker block if
none exists yet for that project/client — no good place to insert one without a cursor position — and
surfaces a `Notice` instead of guessing.

## Settings (`src/settings.ts`, `src/settings-tab.ts`)

- `timestampFormat` — a moment.js format string, used for both display and strict parsing.
- `csvDelimiter` (default `,`) — so it can be swapped to `;` for locales where `,` is a decimal separator.
- `debugMode` (boolean, default off) — gates the "Debug files" command; requires reloading the plugin
  after toggling, since commands are registered once at `onload`.
- `timerUpdateSeconds` / `statusUpdateSeconds` / `todayUpdateSeconds` (default `5` / `1` / `30`) — how
  often, in seconds, the default view's Current/Total timer, the `status` widget's live "Today" timer, and
  the `today` widget's live numbers each refresh (fed straight into their respective `onTick(...)` calls in
  `tracker.ts` as `intervalMs`, ×1000). The settings tab validates each as a positive number, falling back
  to its default on anything else (empty, non-numeric, zero or negative).
- `favoriteProjects` (`Favorite[]`, default `[]`) — see the Favorites entry under Commands above. The
  settings tab lets you add a project/client pair (skipping exact duplicates) and remove existing ones;
  like `debugMode`, changes need a plugin reload to take effect.
- `reportTemplatePath` / `trackerTableTemplatePath` / `trackerCsvTemplatePath` (each `string`, default
  `""`) — vault-relative paths to Templater template files for the Report command's table, a tracker's
  "Copy as table" button, and its "Copy as CSV" button respectively. Unlike the settings above, an empty
  value here is the valid, expected default (keep the built-in hardcoded format) — the settings tab
  doesn't fall back to anything else on empty input. Each has a "Browse" button next to its text field
  that opens `FileSuggestModal` (`src/file-suggest-modal.ts`, a `FuzzySuggestModal<TFile>` over
  `app.vault.getMarkdownFiles()`) so the path doesn't have to be typed by hand - this browse button only
  picks a single file; typing a folder path directly is how you opt into the per-use picker described
  below. See "Templater integration" below.

## External/optional integrations

- **nldates-obsidian** — optional, enables relaxed natural-language date parsing in `parseDate`.
- **Templater** — optional, lets a user replace this plugin's hardcoded output formats with their own
  template. See "Templater integration" below.
- **buttons** (community plugin) — not called by this plugin's code at all; `test-vault/Tidsredovisning.md`
  shows the *user* embedding a `buttons`-plugin block that invokes this plugin's own "Stop all timers"
  command by name. It's a composition the vault author set up, not something `time-tracker` renders itself.

## Templater integration (templating system for the Report table and Copy as table/CSV)

Both output surfaces this plugin generates — the `Report` command's table and a tracker's own
"Copy as table"/"Copy as CSV" buttons — were previously hardcoded Markdown/CSV formats in TypeScript. They
can now be replaced, per-surface, with a normal [Templater](https://github.com/SilentVoid13/Templater)
template (full JS, loops, conditionals) instead of this plugin building and maintaining its own template
language. Each of the three settings above is independent and empty by default, so nothing changes unless
a path is explicitly configured.

**Split "compute" from "render".** Computing the data stays this plugin's job (`buildReportData` /
`flattenEntries`, both pure and already covered by tests) — rendering it becomes the user's Templater
template when one is configured. The data handed to a template is always raw seconds/numbers, never
pre-formatted strings — formatting (decimal places, day headers, CSV quoting, whatever) is the template's
decision, not baked in twice.

**The "stash and consume" pattern (`src/api.ts`).** Templater's render entry point doesn't accept custom
parameters, so there's no direct way to hand a template our computed data. The plugin computes the data
and stashes it on its own public API object (`app.plugins.plugins["time-tracker"].api`) immediately before
invoking Templater; the template's first step is to call `api.consumeReportData()` or
`api.consumeTrackerRows()` to retrieve (and clear) it — the same general approach other community plugins
(e.g. QuickAdd) use for passing data into a Templater render, just namespaced under this plugin's own api
object instead of a bare `window` global. `consumeReportData`/`consumeTrackerRows` are the only stash-side
methods on the *public* `TimeTrackerApi` type; the actual stashing methods (`stashReportData`/
`stashTrackerRows`) live on a wider `InternalApi` type in `api.ts` that only this plugin's own code
(`report.ts`, `tracker.ts`) casts to — a template author never needs or sees them.

`TimeTrackerApi` also exposes `getReportData(start, end)` (an async, on-demand version of
`buildReportData` for a template that wants a different range than what was stashed),
`getTrackerRows(tracker)`, `formatTimestamp`/`formatDuration` (the same formatting this plugin's own
built-in views use), and the CSV/Markdown escaping helpers (`escapeMarkdownCell`/`escapeCsvField`) — exposed
for convenience, never auto-applied, since a template might not even be targeting Markdown or CSV.

**Always falls back to the built-in format.** `buildReportText` (`report.ts`) and `buildTrackerOutput`
(`tracker.ts`) both follow the same shape: if the relevant setting is empty, behavior is unchanged (call
the existing `createMarkdownTable`/`createTrackerTable`/`createCsv` directly). If a path is configured,
stash the data, call `renderTemplaterFile`, and use its output — but on `null` (Templater not installed,
or the template file doesn't exist) *or* a thrown exception (a broken template), show a `Notice` and fall
back to the built-in format anyway. A misconfigured template degrades to "you get the built-in output",
never "nothing happens" — the report/copy action always produces something.

**A template-path setting can point at a folder instead of a single file.** `buildReportText`/
`buildTrackerOutput` both check `app.vault.getAbstractFileByPath(templatePath)` before rendering; if it
resolves to a `TFolder`, the user is prompted (via `pickFile` in `src/file-suggest-modal.ts` - a
`Promise`-wrapped `FuzzySuggestModal<TFile>`, scoped to that folder's own markdown files via
`getMarkdownFilesInFolder`, recursing into subfolders) to choose which template file inside it to use for
this run, and that file's path is used in place of the folder path for the rest of the flow (stash,
render, fallback-on-failure) - otherwise unchanged. If that picker is cancelled (Escape, clicking
outside - detected by overriding the modal's `onClose` and checking whether `onChooseItem` already fired),
the function returns `null` rather than falling back to the built-in format: an explicit cancel means "I
changed my mind," not "render anyway," so `ReportModal`'s "Append table at cursor" leaves the dialog open
instead of inserting text, and a tracker's Copy button leaves the clipboard untouched, on a `null` result.

**`templater.ts` reaches into Templater's undocumented internals, and this is an accepted, flagged
tradeoff.** Templater has no official/stable public API for "render this template file and return the
string" — `renderTemplaterFile` calls `app.plugins.plugins["templater-obsidian"].templater
.create_running_config(...)` / `.read_and_parse_template(...)` with a `RunMode` value, based on the same
undocumented surface other community integrations (e.g. QuickAdd) rely on. **Verified against Templater
2.20.6's actual bundled source** (`test-vault/.obsidian/plugins/templater-obsidian/main.js`, once it got
installed there) rather than just assumed: `create_running_config(template_file, target_file, run_mode)`
returns `{template_file, target_file, run_mode, active_file}`, `read_and_parse_template(config)` reads
`template_file`'s content and parses it, and `RunMode.DynamicProcessor` is enum value `4` — all confirmed
by reading the minified source directly (grepping for `create_running_config`, `read_and_parse_template`,
and the `RunMode` enum's `a[a.DynamicProcessor=4]` assignment). Since Templater's internals can still
change in a future version, the try/catch + Notice-and-fall-back behavior above stays in place regardless
— if rendering ever starts misbehaving after a Templater update, re-verify the same way (grep its
`main.js`, or poke `app.plugins.plugins["templater-obsidian"].templater` in the console).

**Known edge case, accepted as-is:** stashing then immediately rendering is not atomic. Clicking two
template-triggering buttons in quick succession, before the first render's `await` resolves, could have
the second stash overwrite the first before it's consumed. The same caveat applies to the community's
`window`-global version of this pattern, so this isn't a regression — not mitigated with a queue, since the
realistic trigger (clicking twice within a few hundred ms) is rare and the failure mode (wrong tracker's
data in a paste) is easy to notice and redo.

**Bug found via testing: picking a folder-based template from `ReportModal` looked like the date dialog
"came back" instead of finishing.** Two independent causes, both fixed:
1. `pickFile`/`pickFolder` (`file-suggest-modal.ts`/`folder-suggest-modal.ts`) resolve their wrapping
   `Promise` from two places - the developer-supplied `onChooseItem` callback (a real selection) and an
   overridden `onClose` (a cancel, e.g. Escape). The `onClose` override checked a `resolved` flag
   *synchronously*, but Obsidian's own `SuggestModal` calls `onChooseItem` and `close()` as part of the
   same selection with an order this code doesn't control - if `close()`'s `onClose` fired before
   `onChooseItem` finished setting `resolved`, a real selection could read as a cancel (`Promise.resolve`
   is a no-op on any later call, so the correct file/folder would already have lost the race by the time
   `onChooseItem` ran). Fixed by deferring the `onClose` fallback with `setTimeout(..., 0)`: pushing it to
   the next macrotask lets either ordering settle `resolved` first, regardless of which one Obsidian
   happens to call first.
2. Independently of (1), `ReportModal`'s "Append table at cursor" only called `this.close()` *after*
   `buildReportText` resolved - meaning while a folder-based template's file-picker was open, the date
   dialog was still open underneath it (Obsidian modals stack; nothing had told this one to close yet). On
   both a real pick (before this was closing correctly for other reasons) and a cancel, the picker closing
   revealed the still-open date dialog, reading as "it reappeared" whether or not the report actually
   completed. Fixed by closing `ReportModal` *before* resolving the template, not after - the same restructure
   also means a cancelled folder-picker now surfaces a `Notice` ("report cancelled") instead of trying to
   silently leave an already-closed dialog "open".

Starting-point example templates live in `test-vault/templates/` — kept inside the test vault (rather
than at the repo root) so they can be pointed at directly while testing against the Templater plugin
installed there: `report-table.md`/`tracker-table.md`/`tracker-csv.md` reproduce the three built-in
formats, and `invoice.md` is a second Report-table template demonstrating that a template can ask its own
questions beyond the Report dialog's From/To dates — via Templater's `tp.system.prompt`, it additionally
asks which client to bill (matched against the combined "Project/Client" names by suffix, since that's
the only name `ReportData` carries) and an optional hourly rate, then renders one invoice line per
distinct task name, summing every work session across the range that shares that task (using
`ReportData.entries[].task`, see above), rather than pre-summed per-project totals. See `README.md`'s
Templater section.

`invoice-html.md` is the same invoice logic as `invoice.md` again, but building an HTML string (a styled
`<table>`, scoped under a `.tt-invoice` wrapper class so its inline `<style>` block can't bleed into the
rest of the note it's inserted into, styled with Obsidian's own theme CSS variables rather than hardcoded
colors) instead of a Markdown one - demonstrating that Templater doesn't care about output format at all,
since a template is just building a string either way. It's still a normal `.md` template file (Templater
templates are conventionally markdown files, and it's the only file type Obsidian's own editor can open
normally) - only the string it *produces* contains HTML tags, which Obsidian's reading view/live preview
already renders inline regardless of whether that HTML came from a hand-written note or a
Templater-generated one. This is offered as the better fit over asking Templater to emit actual LaTeX
source: Obsidian has no LaTeX compiler (its built-in LaTeX support is math-only, via MathJax/KaTeX's
`$...$`/`$$...$$`, not general document typesetting), so raw `\begin{document}`-style LaTeX would just
render as inert text - producing a real LaTeX-typeset document would need an entire separate LaTeX
distribution installed and invoked, a much heavier, desktop-only dependency for what's fundamentally a
"make the report look nicer" ask. HTML gets most of the same visual payoff (colors, borders, spacing,
theme-aware styling) with no extra toolchain, renders immediately, and - since Obsidian's own **Export to
PDF** renders that same view - still reaches "a nice PDF to send a client" without ever leaving Obsidian.

## Template kit installer (`src/template-kit-installer.ts`)

Motivated by the templating system above making custom output formats possible in the first place:
someone (including the author) could sell/share a pre-built set of Templater templates as a "kit," and a
kit of more than one file needs some way to get installed that's better than "unzip it yourself and drag
files into your vault by hand." `Time Tracker: Install template kit` opens `InstallTemplateKitModal`,
which:

1. **Reads a `.zip` picked via drag-and-drop or a hidden `<input type="file">`** - deliberately not via
   `app.vault`/Node's `fs`. The zip file itself lives *outside* the vault (a Downloads folder, wherever) -
   `app.vault` is scoped strictly to the vault and can't reach it, and while a plugin *can* use Node/Electron
   APIs to reach arbitrary OS paths on desktop, that would be desktop-only (mobile has no Node/Electron
   access or Downloads-folder equivalent) and requires guessing at OS-specific paths. A standard HTML
   `<input type="file">`/drag-and-drop, on the other hand, is a plain Web API: it opens the OS's native file
   picker (desktop) or document picker (mobile), and hands back the chosen file's bytes directly
   (`file.arrayBuffer()`) - no vault-relative path needed for this half at all, and no Node dependency, so
   it works the same way cross-platform. Only the *write* side (extracting into the vault) touches
   `app.vault`, which is exactly where it should stay sandboxed.
2. **Parses it with `jszip`** (a new runtime dependency, pure JS, bundled into `main.js` by esbuild same as
   the rest of the plugin - not marked `external` the way `obsidian`/`electron` are, since Obsidian doesn't
   provide it itself).
3. **Preserves whatever structure the zip has**, writing each entry to `<chosen target folder>/<its own
   path inside the zip>` - loose files at the zip's root land flat in the target folder, a folder inside
   the zip becomes a subfolder with its tree intact. There's no "flat vs. nested" mode to choose in the
   installer itself: the kit's own author already decided that by how they built the zip, and replicating
   its structure verbatim under the target folder reproduces either case with no extra logic.
4. **Validates every entry's path before writing it anywhere** (`sanitizeRelativePath`,
   `src/zip-path-safety.ts` - pure, unit-tested): rejects a `".."` segment appearing anywhere in an entry's
   path, an absolute path, or a Windows drive letter, all classic **"zip slip"** vectors (a crafted archive
   entry escaping the intended extraction folder to overwrite arbitrary files). This is a real, known risk
   class for any "extract an untrusted zip" feature - confirmed non-hypothetical by reading `jszip`'s own
   type definitions and source directly (`node_modules/jszip/index.d.ts` documents
   `JSZipObject.unsafeOriginalName` with a citation to the zip-slip vulnerability by name): `jszip`'s own
   internal path resolution (`lib/utils.js`'s `resolve()`) neutralizes `".."` traversal by simply discarding
   excess `pop()`s on an empty result array, but does **not** strip a leading `/` - an entry literally named
   `/etc/passwd` passes through `jszip`'s own "safe" name unchanged, confirming this plugin's own extra
   validation layer is load-bearing, not redundant defense-in-depth. Any entry that fails validation is
   skipped (never written) and counted in the completion `Notice` rather than silently dropped.
5. **Never silently overwrites existing files.** If any target path already exists, a small purpose-built
   two-button prompt ("Overwrite" / "Skip existing") decides the whole batch's behavior - not
   `ConfirmModal` (styled for a single destructive Cancel/Remove decision that doesn't map cleanly onto
   "install only the new ones"). Its two buttons resolve a `Promise` *before* calling `close()` precisely so
   that an `onClose` fallback (for Escape/click-outside, resolving `false`) can't race with a button's own
   resolution - `Promise.resolve` is a no-op on any call after the first, so whichever fires first wins
   safely.
6. **Creates missing intermediate folders** via a small recursive `ensureFolder`, since
   `vault.createFolder` throws on an already-existing folder rather than being a no-op - each level is
   checked first, and existing-folder races are treated as success rather than re-thrown.

The target folder defaults to the vault root and is changed via `pickFolder` (`folder-suggest-modal.ts`,
mirroring `file-suggest-modal.ts`'s `pickFile`/`FileSuggestModal` pattern but over `TFolder` instead of
`TFile`).

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
