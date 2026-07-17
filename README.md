# Time Tracker
Time Tracker plugin for Obsidian. It started as a clone of Super Simple Time Tracker (Thank you Ellpeck, great program), but has been extended to have all the bells and whistles I needed to track time spent on my own projects. It is explicitly konstructed for my needs and the reporting is formed to conform to the report format we use at my work, but if anyone else find it useful, please use it.

# Usage
Time is tracked in Clients/Projects and tasks.
To get started tracking your time in a project, open up the note that you want to track your time in. Move the cursor to the area you want the tracker to reside in, and then open your command palette and execute the `Time Tracker: Insert Time Tracker` command.

When switching to live preview or reading mode, you will now see the time tracker you just inserted! First enter a project name and a client. Now, simply name the first task (or leave the box empty if you don't want to name it) and press the **Start** button. Once you're done with the thing you were doing, simply press the **End** button and the time you spent will be saved and displayed to you in the table.

**Only one timer can run at a time across your whole vault.** Starting a new timer anywhere — even in a different note — automatically stops whichever one was running before. This is deliberate: it means you never end up with two trackers silently running at once.

## Continuing, editing, and removing entries
Once a task has an entry in its table, you can:
- **Continue** (▷) — resume a task that already has an end time. This splits it into "Part 1", "Part 2", etc., so you can track separate, non-contiguous work sessions under the same task name.
- **Edit** (✎) — adjust a task's name, start time, or end time by hand. Times can be typed either in your configured timestamp format, or as natural language (e.g. "yesterday at 3pm") if you have the [Natural Language Dates](https://github.com/argenos/nldates-obsidian) community plugin installed.
- **Remove** (🗑) — deletes the entry, after asking you to confirm.

## Copying your data out
At the bottom of a tracker, **Copy as table** and **Copy as CSV** copy that tracker's own entries to your clipboard, ready to paste into a spreadsheet or another note.

## Dashboard blocks: status and today
Two more commands insert small, vault-wide widgets rather than a full tracker — handy for a personal dashboard note:
- `Time Tracker: Insert Time Tracker Status` — shows whether any timer is currently running anywhere in your vault, a clickable link to the note it's in, a button to stop it, and a live-updating total of time logged **today across all projects** (ticking every second). It reacts as soon as a timer starts or stops anywhere — another pane, the "Stop all timers" command — so you don't need to reload the note to see it catch up.
- `Time Tracker: Insert Time Tracker for logged times today` — a table of hours logged today, broken down by project. Like the status widget, a currently running timer's project shows its live elapsed time ticking up in this table too (updating every 30 seconds — precision matters less here), not just completed entries — that row is marked with a green **active** label next to its duration so it's easy to spot at a glance. Each project name is a clickable link to its note; if the same project has entries in more than one note, it links to whichever one currently has the running timer, or otherwise whichever has the most recent completed entry.

## Stopping everything
`Time Tracker: Stop all timers` stops whichever timer is currently running, from anywhere — no need to go find the note it's in.

## Favorite projects — starting a specific timer from outside Obsidian
Add a project/client pair as a "favorite" in Settings and it gets its own command, `Time Tracker: Start <name>`, that starts that project's timer from anywhere without opening its note — stopping whatever else is running first, same as pressing Start normally. This is meant for triggering from outside Obsidian: a StreamDeck button, for instance, can hit it through the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin's `POST /commands/{id}` endpoint (the command's id is a slug of its name, e.g. `time-tracker:start-project-4-client-4`), or you can just run it from the command palette like any other command. If the same project/client has trackers in more than one note, it starts whichever currently has the running timer, or otherwise whichever has the most recent completed entry — same as the note links in the status/today widgets above. It won't create a brand-new tracker if one doesn't exist yet for that pair; add/remove favorites in Settings, and reload the plugin afterward for the commands to update.

## Generating a report
Place your cursor where you want the report to appear in the current note, then open the command palette and execute the `Time Tracker: Report` command. Choose a start and end date (typed in your configured format, or as natural language if Natural Language Dates is installed) — "Check dates" lets you confirm they were parsed correctly first. Hit **Append table at cursor** and a Markdown table of hours logged per project, per day, is written directly into the note at the cursor position.

A few things worth knowing about how the report is put together:
- **A timer that's still running isn't included at all**, on any day, until you stop it — unlike the "today" table above, the `Report` command doesn't add its live elapsed time back in. If a timer is running when you open the Report dialog, you'll see a warning about this; stop it first if you want its time reflected.
- **A task that spans midnight has its time split across both days** it touches — e.g. a task from 23:00 to 02:00 shows up as roughly one hour on the first day's column and two hours on the second, rather than all three hours landing on one day. The task's own "Total" column still shows the full, un-split duration.
- **Days and "today" are based on your device's local timezone**, since all times are shown and grouped using your system clock's timezone — there's no separate timezone setting in this plugin. If you log time from devices in different timezones, an entry near midnight could be attributed to a different calendar day depending on which device generated the report.

## Customizing the output format with Templater
By default, the `Report` command's table and a tracker's **Copy as table**/**Copy as CSV** buttons all use a fixed, built-in format. If you have the [Templater](https://github.com/SilentVoid13/Templater) community plugin installed, you can replace any (or all) of these three with your own template instead — full control over columns, formatting, grouping, whatever you need. Configure a vault-relative path to a template file for each surface you want to customize in Settings → "Templater integration" — either type the path directly, or click the search button next to the field to pick the file from a searchable list of your vault's notes; leave a path blank to keep the built-in format for that surface (this is the default — nothing changes unless you set a path).

Point a setting at a **folder** instead of a single file to keep several template variants around (e.g. an invoice, a plain table, a summary) and pick between them each time: whenever that surface is used, you'll get a searchable list of that folder's template files to choose from before it renders. Cancelling the picker (Escape, clicking outside) leaves things untouched — nothing is inserted or copied, rather than silently falling back to the built-in format. The picker recurses into subfolders too, and always shows each file's full path (e.g. `Templates/Reports/invoice.md`), so a folder of templates can be organized into subfolders however you like and still show up as one combined, disambiguated list.

Note that a Report table template and a tracker table/CSV template aren't interchangeable — each expects a different shape of data from the plugin's API (see below), since the Report table covers the whole vault/date range while a tracker template covers just one tracker's own entries. If you have only a handful of templates, keeping them all in one folder and remembering which is which is fine: picking the wrong one for a given surface isn't destructive, it just fails fast (the template's first line - retrieving data it never got - throws immediately) and you get a notice plus the built-in output instead, same as any other broken template. If you have many templates, it's worth splitting them into separate folders (or subfolders) per surface so the list you actually see each time stays short and unambiguous.

Your template's first step must be to call this plugin's API to retrieve the data:
- `app.plugins.plugins["time-tracker"].api.consumeReportData()` for the Report table template — returns per-day, per-project hours (in raw seconds) plus totals.
- `app.plugins.plugins["time-tracker"].api.consumeTrackerRows()` for the tracker table/CSV templates — returns each entry as a flat row (name, start/end time, duration in seconds, and its nesting depth if it's a split "Part N" entry).

The API also exposes `formatTimestamp`/`formatDuration` (the same formatting the built-in views use) and `escapeMarkdownCell`/`escapeCsvField` (to keep free-text task/project names from breaking a table or being read as a spreadsheet formula) — handy building blocks, not required. Starting-point example templates are in [`test-vault/templates/`](test-vault/templates/) in this repo — copy one in as a starting point rather than writing from scratch: `report-table.md`/`tracker-table.md`/`tracker-csv.md` reproduce the built-in formats, and `invoice.md` is an alternate Report table template styled as a single-client invoice — it uses Templater's own `tp.system.prompt` to additionally ask which client (and, optionally, an hourly rate) when you run the Report command, then bills one line per distinct task name, summing all the time logged under that task across the period. If Templater isn't installed, a configured path is missing, or your template throws an error, you'll get a notice and the built-in format is used instead — you'll never end up with nothing.

A template isn't limited to Markdown — since it's just building a string, `invoice-html.md` produces the same invoice as `invoice.md` but as a styled HTML table (borders, a header, right-aligned numbers) that renders directly in the note, matching your current theme's colors. It's still a normal `.md` template file — only the *output* it builds is HTML. This can be a nicer starting point than Markdown if you want something closer to a real invoice's look, and it also carries over into Obsidian's own **Export to PDF** for sending to a client, all without needing LaTeX or any other external tool.

## Installing a template kit
If you've got a `.zip` of one or more Templater templates — bought, downloaded, or just backed up from another vault — `Time Tracker: Install template kit` installs it for you instead of unzipping and dragging files in by hand:

1. Run the command. A dialog opens with a drop zone.
2. Drop the `.zip` onto it, or click it to browse for the file — this works even if the zip is outside your vault entirely (e.g. still in Downloads).
3. Choose which vault folder to install into ("Choose folder" — defaults to your vault's root).
4. Click **Install**. Whatever structure is inside the zip is preserved under that folder: loose template files land flat, a folder inside the zip becomes a subfolder with its contents intact — however the kit's author packaged it.

If any of the files would already exist at the destination, you're asked once whether to overwrite them all or skip just the existing ones and install the rest — nothing is ever silently overwritten. Once installed, point the relevant Templater setting above at the new file(s) or folder to start using them.

**Packaging your own kit to distribute:** a single template is just the `.md` file — no packaging needed, whoever gets it just drags it into their vault. For more than one, zip them up; if you zip a folder, that folder's name and structure is preserved on install, so organize the kit's internal folders however you'd want them to land in someone else's vault.

# ⚙️ Settings
- **Timestamp Display Format** — the [moment.js](https://momentjs.com/docs/#/parsing/string-format/) format used to display and strictly parse timestamps (default `YY-MM-DD hh:mm:ss`).
- **CSV Delimiter** — the character used to separate fields when copying a tracker as CSV (default `,`; useful to change to `;` in locales where `,` is a decimal separator).
- **Timer display update interval**, **Status widget update interval**, **Today widget update interval** — how often (in seconds) the default view's Current/Total timer, the status widget's live "Today" timer, and the today widget's live numbers each refresh (defaults `5`, `1`, `30`). Lower for smoother live updates, higher if you'd rather trade that off for fewer background refreshes.
- **Favorite projects** — add/remove the project/client pairs that get their own "Start" command (see above). Changes need a plugin reload to take effect.
- **Templater integration** — vault-relative paths to a Templater template (or a folder of templates to choose from each time) for the Report table, tracker "Copy as table", and tracker "Copy as CSV" respectively; blank (the default) keeps the built-in format. See "Customizing the output format with Templater" above.

# 👀 What it does
A time tracker is really just a special code block that stores information about the times you pressed the Start and End buttons on. Since time is tracked solely through timestamps, you can switch notes, close Obsidian or even shut down your device completely while the tracker is running! Once you come back, your time tracker will still be running.

The tracker's information is stored in the code block as JSON data. The names, start times and end times of each task are stored. They're displayed neatly in the code block in preview or reading mode. There's also a "compact" display, which shows just the Start/End controls and timers without the entries table below — toggle it with the chevron button (⌃/⌄) next to Start/End.

Since it's just JSON in your note, nothing stops you from editing it by hand — but if that edit breaks it (invalid JSON, or a field like `"entries"` set to something other than a list), the block won't try to guess at your data and silently reset it. Instead it shows a read-only error with a red background, and leaves the note's text exactly as you left it until you fix it by hand.

# 🧩 Works well with
- **[Natural Language Dates](https://github.com/argenos/nldates-obsidian)** (optional) — install it to type things like "next monday" or "yesterday at 3pm" wherever this plugin asks for a date, instead of the strict timestamp format.
- **[Buttons](https://github.com/shabegom/buttons)** (optional) — since `Stop all timers` is a regular command, you can wire a Buttons block to it for a one-tap "stop everything" button on a dashboard note.
- **[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)** (optional) — since every command here (including per-favorite "Start" commands) is a regular Obsidian command, it can be triggered remotely through this plugin's REST endpoints — handy for a StreamDeck or similar.
- **[Templater](https://github.com/SilentVoid13/Templater)** (optional) — install it to replace the Report table's and/or a tracker's Copy as table/CSV's output format with your own template. See "Customizing the output format with Templater" above.

# 🛣️ Roadmap
Time Tracker is still in its early stages! Use it at your own risk. I make no guarantees at all and I have limited time for support issues. With that said, I have used it extensibly for some years now and I like it a lot. No promises, but send me an email to mwe@wewid.se if you have any questions or suggestions. Or just want to encourage me to carry on.


