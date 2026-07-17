<%*
/*
 * Example Templater template for a Time Tracker block's "Copy as table"
 * button (Settings -> Time Tracker -> Templater integration -> Tracker
 * "Copy as table" template).
 *
 * Reproduces the plugin's built-in Task/Start/End/Duration table as a
 * starting point - each row's `depth` (0 = top-level entry, 1+ = a split
 * "Part N" sub-entry) is available if you want to indent or otherwise mark
 * split entries differently.
 */
const api = app.plugins.plugins["time-tracker"].api;
const rows = api.consumeTrackerRows(); // must be called first - see design.md

let out = "Task | Start time | End time | Duration\n---|---|---|---\n";
for (const row of rows) {
    const start = row.startTime ? api.formatTimestamp(row.startTime) : "";
    const end = row.endTime ? api.formatTimestamp(row.endTime) : "";
    const duration = (row.endTime !== null || row.startTime === null)
        ? api.formatDuration(row.durationSeconds * 1000)
        : "";
    // escapeMarkdownCell neutralizes "|"/"<"/">" so a free-text task name
    // can't break the table or inject markup - same helper the built-in
    // format uses.
    out += `${"  ".repeat(row.depth)}${api.escapeMarkdownCell(row.name)} | ${start} | ${end} | ${duration}\n`;
}

tR += out;
%>
