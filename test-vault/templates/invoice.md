<%*
/*
 * Example Templater template for Time Tracker's "Report" command, styled as
 * a simple client invoice rather than a plain per-day/per-project table.
 * Unlike report-table.md, this one only covers a single client: it prompts
 * for the client's name (in addition to the From/To dates already asked for
 * by the Report dialog itself) and an optional hourly rate, then lists that
 * client's logged time as one line per distinct task name, summing all
 * sessions that share the same task (across every project/day in range).
 *
 * Settings -> Time Tracker -> Templater integration -> Report table template.
 */
const api = app.plugins.plugins["time-tracker"].api;
const data = api.consumeReportData(); // must be called first - see design.md

const client = await tp.system.prompt("Client name");
if (!client) {
    tR += "*(No client entered - invoice not generated.)*";
} else {
    const rateInput = await tp.system.prompt("Hourly rate (leave blank to omit amounts)", "");
    const rate = rateInput ? parseFloat(rateInput) : null;

    // ReportData only carries each project's already-combined "Project/Client"
    // name (see toName() in report-logic.ts) - there's no separate client
    // field to filter on directly, so a name matches this client if it's
    // exactly the client (no project set) or ends with "/<client>". Case-
    // insensitive, to forgive how the client was typed here vs. in the
    // tracker. If a project name itself legitimately contains "/", this
    // simple match could over-match - adjust to your own naming scheme if so.
    const clientLower = client.toLowerCase();
    const matches = name => {
        const lower = name.toLowerCase();
        return lower === clientLower || lower.endsWith("/" + clientLower);
    };

    // data.entries is the raw escape hatch (already clipped to the chosen
    // date range, one row per task/work session), each carrying its own
    // `task` name separately from the "Project/Client" `name` - grouped here
    // by task, summing every session sharing the same task name. (`task` is
    // only set on these Report-pipeline entries, not on a tracker's own
    // stored entries, where the same name is just called `name` - see
    // types.ts's Entry.)
    const totalsByTask = new Map();
    for (const e of data.entries) {
        if (!matches(e.name))
            continue;
        const task = e.task || "(no task)";
        totalsByTask.set(task, (totalsByTask.get(task) ?? 0) + (e.endTime - e.startTime));
    }
    const rows = Array.from(totalsByTask, ([task, seconds]) => ({ task, seconds }))
        .sort((a, b) => a.task.localeCompare(b.task));

    const totalSeconds = rows.reduce((sum, row) => sum + row.seconds, 0);
    const totalHours = totalSeconds / 3600;

    let out = "";
    out += "# Invoice\n\n";
    out += `**Bill to:** ${api.escapeMarkdownCell(client)}\n\n`;
    out += `**Period:** ${data.days[0] ?? "-"} to ${data.days[data.days.length - 1] ?? "-"}\n\n`;
    out += `**Invoice date:** ${tp.date.now("YYYY-MM-DD")}\n\n`;

    out += rate ? "Task | Hours | Rate | Amount\n---|---|---|---\n"
                : "Task | Hours\n---|---\n";
    for (const row of rows) {
        const hours = row.seconds / 3600;
        out += `${api.escapeMarkdownCell(row.task)} | ${hours.toFixed(2)}`;
        if (rate)
            out += ` | ${rate.toFixed(2)} | ${(hours * rate).toFixed(2)}`;
        out += "\n";
    }
    out += rate ? `**Total** | **${totalHours.toFixed(2)}** | | **${(totalHours * rate).toFixed(2)}**\n`
                : `**Total** | **${totalHours.toFixed(2)}**\n`;

    if (rows.length === 0)
        out += `\n*(No entries found for "${api.escapeMarkdownCell(client)}" in this date range.)*\n`;

    tR += out;
}
%>
