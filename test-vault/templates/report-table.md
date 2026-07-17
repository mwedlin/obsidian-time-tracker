<%*
/*
 * Example Templater template for Time Tracker's "Report" command
 * (Settings -> Time Tracker -> Templater integration -> Report table template).
 *
 * Reproduces the plugin's built-in table (rows = projects, columns = days +
 * a Total column) as a starting point - copy this file, then change the
 * loops below however you like (different column order, hours instead of
 * a table, only the grand total, ...).
 */
const api = app.plugins.plugins["time-tracker"].api;
const data = api.consumeReportData(); // must be called first - see design.md

let out = "Project |";
for (const day of data.days)
    out += ` ${day} |`;
out += " **Total**\n";
for (let i = 0; i < data.days.length + 1; i++)
    out += "---|";
out += "---\n";

for (let p = 0; p < data.projects.length; p++) {
    // escapeMarkdownCell neutralizes "|"/"<"/">" so a free-text project/
    // client name can't break the table or inject markup.
    out += `${api.escapeMarkdownCell(data.projects[p])} |`;
    for (let d = 0; d < data.days.length; d++)
        out += ` ${(data.cellsSeconds[p][d] / 3600).toFixed(2)} |`;
    out += ` **${(data.projectTotalSeconds[p] / 3600).toFixed(2)}**\n`;
}

out += "**Total:** |";
for (let d = 0; d < data.days.length; d++)
    out += ` **${(data.dayTotalSeconds[d] / 3600).toFixed(2)}** |`;
out += ` **${(data.grandTotalSeconds / 3600).toFixed(2)}**\n`;

tR += out;
%>
