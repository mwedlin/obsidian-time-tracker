// Escaping for free-text (task/project/client names) that gets interpolated
// into generated output, rather than rendered via Obsidian's own text-setting
// DOM helpers (which are already safe). Two different output formats, two
// different escaping rules.

// Safe for one Markdown table cell: neutralizes pipe characters (which would
// otherwise break the table's column structure) and HTML angle
// brackets/ampersands, so a name can't inject raw HTML into a note that later
// gets rendered in reading view.
export function escapeMarkdownCell(value: string): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, " ");
}

// Safe for one field of a delimited CSV row: quotes the field if it contains
// the delimiter, a quote, or a newline, and neutralizes a leading
// =, +, -, @, tab, or CR so spreadsheet software (Excel, Google Sheets, ...)
// won't interpret the field as a formula when the CSV is opened later
// ("CSV/formula injection").
export function escapeCsvField(value: string, delimiter: string): string {
    let field = String(value);
    if (/^[=+\-@\t\r]/.test(field))
        field = "'" + field;
    if (field.includes(delimiter) || field.includes('"') || field.includes("\n") || field.includes("\r"))
        field = '"' + field.replace(/"/g, '""') + '"';
    return field;
}
