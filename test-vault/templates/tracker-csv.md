<%*
/*
 * Example Templater template for a Time Tracker block's "Copy as CSV"
 * button (Settings -> Time Tracker -> Templater integration -> Tracker
 * "Copy as CSV" template).
 *
 * Reproduces the plugin's built-in Task/Start/End/Duration CSV as a
 * starting point. Change the delimiter/columns below however you like.
 */
const api = app.plugins.plugins["time-tracker"].api;
const rows = api.consumeTrackerRows(); // must be called first - see design.md
const delimiter = ",";

let out = "";
for (const row of rows) {
    const start = row.startTime ? api.formatTimestamp(row.startTime) : "";
    const end = row.endTime ? api.formatTimestamp(row.endTime) : "";
    const duration = (row.endTime !== null || row.startTime === null)
        ? api.formatDuration(row.durationSeconds * 1000)
        : "";
    const fields = [row.name, start, end, duration];
    // escapeCsvField quotes fields containing the delimiter/quote/newline,
    // and neutralizes leading =/+/-/@ so a free-text name can't be read as
    // a spreadsheet formula when the CSV is opened later.
    out += fields.map(f => api.escapeCsvField(f, delimiter)).join(delimiter) + "\n";
}

tR += out;
%>
