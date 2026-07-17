<%*
/*
 * Example Templater template for Time Tracker's "Report" command - same
 * behavior as invoice.md (prompts for a client and an optional hourly rate,
 * bills one line per distinct task name), but builds a styled HTML table
 * instead of a plain Markdown one. Obsidian renders inline HTML in reading
 * view/live preview, so this shows up with real borders, spacing and colors
 * - and since Obsidian's own "Export to PDF" renders that same view, this
 * also prints as a nicer-looking PDF than the Markdown version, with no
 * extra toolchain (no LaTeX, no external compiler) required.
 *
 * This is still a normal .md template file, like every other Templater
 * template here - only the *output string* it builds contains HTML tags,
 * not the template file itself. The CSS below is scoped under .tt-invoice
 * so it can't bleed into the rest of the note it's inserted into, and uses
 * Obsidian's own theme CSS variables so it matches light/dark themes
 * automatically instead of hardcoding colors.
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

    // See invoice.md for why matching is done this way (ReportData only
    // carries the combined "Project/Client" name, not a separate client
    // field) and why grouping is by `task`, not `name`.
    const clientLower = client.toLowerCase();
    const matches = name => {
        const lower = name.toLowerCase();
        return lower === clientLower || lower.endsWith("/" + clientLower);
    };

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

    // HTML-escaping, not api.escapeMarkdownCell - that helper neutralizes
    // Markdown/table syntax (|, <, >), which isn't the right escaping for
    // text embedded directly as HTML (needs &/" handled too, so a client or
    // task name can't break out of the markup).
    const escapeHtml = s => String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const period = `${data.days[0] ?? "-"} to ${data.days[data.days.length - 1] ?? "-"}`;

    let out = `<div class="tt-invoice">
<style>
.tt-invoice { border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); padding: 1.5em; max-width: 40em; }
.tt-invoice h2 { margin-top: 0; color: var(--text-accent); }
.tt-invoice .tt-meta { margin-bottom: 1em; color: var(--text-muted); }
.tt-invoice .tt-meta strong { color: var(--text-normal); }
.tt-invoice table { width: 100%; border-collapse: collapse; margin-top: 1em; }
.tt-invoice th, .tt-invoice td { padding: 0.5em 0.75em; border-bottom: 1px solid var(--background-modifier-border); text-align: left; }
.tt-invoice th { color: var(--text-muted); font-weight: 600; border-bottom: 2px solid var(--background-modifier-border); }
.tt-invoice td.tt-num, .tt-invoice th.tt-num { text-align: right; }
.tt-invoice tfoot td { font-weight: bold; border-top: 2px solid var(--background-modifier-border); border-bottom: none; }
</style>
<h2>Invoice</h2>
<div class="tt-meta">
<div><strong>Bill to:</strong> ${escapeHtml(client)}</div>
<div><strong>Period:</strong> ${escapeHtml(period)}</div>
<div><strong>Invoice date:</strong> ${tp.date.now("YYYY-MM-DD")}</div>
</div>
<table>
<thead><tr><th>Task</th><th class="tt-num">Hours</th>`;
    if (rate)
        out += `<th class="tt-num">Rate</th><th class="tt-num">Amount</th>`;
    out += `</tr></thead>
<tbody>`;
    for (const row of rows) {
        const hours = row.seconds / 3600;
        out += `<tr><td>${escapeHtml(row.task)}</td><td class="tt-num">${hours.toFixed(2)}</td>`;
        if (rate)
            out += `<td class="tt-num">${rate.toFixed(2)}</td><td class="tt-num">${(hours * rate).toFixed(2)}</td>`;
        out += `</tr>`;
    }
    out += `</tbody>
<tfoot><tr><td>Total</td><td class="tt-num">${totalHours.toFixed(2)}</td>`;
    if (rate)
        out += `<td></td><td class="tt-num">${(totalHours * rate).toFixed(2)}</td>`;
    out += `</tr></tfoot>
</table>`;
    if (rows.length === 0)
        out += `<p><em>No entries found for "${escapeHtml(client)}" in this date range.</em></p>`;
    out += `</div>
`;

    tR += out;
}
%>
